/**
 * osu/banchoPyApi/normalize.js
 * Resposta do servidor → o formato que o resto do bot lê (o da API oficial).
 *
 * Puro — nada de rede. É onde mora o que mais quebra calado: um campo com nome
 * ou formato diferente não estoura, só chega vazio no embed.
 */

const servers = require('../../servers');
const { decodeMods } = require('../../mods');

// ─── Normalização: usuário ────────────────────────────────────────────────────
function normalizeUserPrivate(playerData, statsData, mode, globalRank = null, countryRank = null) {
  if (!playerData) return null;

  return {
    id: playerData.id,
    username: playerData.name,
    avatar_url: servers.avatarUrl(servers.get(mode).avatars, playerData.id),
    country_code: (playerData.country || 'xx').toUpperCase(),
    join_date: playerData.creation_time
      ? new Date(playerData.creation_time * 1000).toISOString()
      : null,
    last_visit: playerData.latest_activity
      ? new Date(playerData.latest_activity * 1000).toISOString()
      : null,
    is_online: false,
    statistics: {
      global_rank:   globalRank,
      country_rank:  countryRank,
      pp: parseFloat(statsData?.pp ?? 0),
      hit_accuracy: parseFloat(statsData?.acc ?? statsData?.accuracy ?? 0),
      level: { current: 1 },
      maximum_combo: statsData?.max_combo ?? 0,
      play_count: statsData?.plays ?? statsData?.play_count ?? 0,
    },
    _private: true,
  };
}

// ─── Normalização: score ──────────────────────────────────────────────────────
// A tradução entre bitmask, acrônimos e texto vive em mods.js.

/**
 * `play_time` chega em três formatos, conforme o endpoint: ISO com `T`,
 * datetime do SQL com espaço, ou epoch em segundos — o mesmo formato que
 * `creation_time` e `latest_activity` já usam no normalizeUserPrivate.
 *
 * Isto era uma linha só, e ela testava o valor convertido (`String(raw)`) mas
 * convertia o valor cru (`raw.replace(...)`): um epoch numérico estourava com
 * "replace is not a function". O estrago passava do score: o catch do
 * `enrichScores` chama esta mesma função de novo, batia na mesma linha e a
 * segunda exceção escapava do try — derrubando a página inteira do /topplays
 * ou do /recent, não só a play problemática.
 */
function parsePlayTime(raw) {
  if (raw === null || raw === undefined || raw === '') return new Date();

  // Epoch em segundos, venha como número ou como string de dígitos.
  if (typeof raw === 'number' || /^\d+$/.test(String(raw))) return new Date(Number(raw) * 1000);

  const text = String(raw);
  const date = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);

  // Formato desconhecido vira "agora": um Invalid Date aqui só estouraria mais
  // adiante, no toISOString(), longe da causa.
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

// Mescla dados da v1 (map info) com dados da v2 (score detalhado)
function normalizeScorePrivate(v1, v2) {
  if (!v1) return null;
 
  const pp = parseFloat(v2?.pp ?? v1.pp ?? 0);
  const acc = parseFloat(v2?.acc ?? v1.acc ?? 0) / 100;
  // O combo cai para o lado v1 porque a resposta nativa do bancho.py já o traz
  // (a da Shiina-Web não tem o campo, e ali o `?? null` continua valendo). Sem
  // isso, uma falha no detalhe da v2 apagaria um número que já estava em mãos.
  const max_combo = v2?.max_combo ?? v1.max_combo ?? null;
  const grade = v2?.grade ?? v1.grade ?? 'F';
 
  const mods = v2
    ? decodeMods(v2.mods ?? 0)
    : (Array.isArray(v1.mods) ? v1.mods : decodeMods(v1.mods ?? 0));
 
  const playTime = parsePlayTime(v2?.play_time ?? v1.play_time);

  const mapName = v1.map_name ?? '';
  const diffMatch = mapName.match(/\[(.+?)\](?:\.osu)?$/);
  const titleMatch = mapName.match(/^(.+?)\s*\(([^)]+)\)\s*\[/);
  const version = diffMatch ? diffMatch[1] : '?';
  const title = titleMatch ? titleMatch[1].trim() : mapName.replace(/\.osu$/, '');

  // Hits: v2 tende a ter n300/n100/n50/nmiss, v1 pode ter count_300 etc.
  const count300  = v2?.n300  ?? v1.count_300  ?? v1.n300  ?? null;
  const count100  = v2?.n100  ?? v1.count_100  ?? v1.n100  ?? null;
  const count50   = v2?.n50   ?? v1.count_50   ?? v1.n50   ?? null;
  const countMiss = v2?.nmiss ?? v1.count_miss  ?? v1.nmiss ?? null;
 
  return {
    pp,
    accuracy: acc,
    rank: grade,
    max_combo,
    mods,
    // Pontuação da play (a de milhões, não o pp). O embed a exibe quando existe;
    // aqui ela só não pode virar zero, que na tela pareceria uma play sem nota.
    score: Number(v2?.score ?? v1.score ?? 0) || null,
    passed: grade !== 'F',
    created_at: playTime.toISOString(),
    mode: 'osu',
    statistics: {
      count_300:  count300,
      count_100:  count100,
      count_50:   count50,
      count_miss: countMiss,
    },
    beatmap: {
      id: v1.map_id ?? null,
      version,
      max_combo: null,
      difficulty_rating: 0,
    },
    beatmapset: {
      id: v1.map_set_id ?? null,
      title,
      artist: '',
      covers: {
        list: `https://assets.ppy.sh/beatmaps/${v1.map_set_id ?? ''}/covers/list.jpg`,
      },
    },
  };
}

/**
 * Score do `get_player_scores` do bancho.py na forma que a Shiina-Web entrega.
 *
 * Os dois endpoints têm o mesmo nome e devolvem coisas diferentes: a Shiina-Web
 * manda o mapa achatado (`map_id`, `map_set_id`, `map_name`) e o id em
 * `score_id`; o bancho.py manda o mapa aninhado em `beatmap` e o id em `id`.
 * Traduzir aqui, na entrada, é o que mantém o `normalizeScorePrivate` e o
 * `enrichScores` sem um segundo caminho — eles nunca ficam sabendo de qual dos
 * dois o score veio.
 *
 * O `map_name` é remontado no formato do nome de arquivo (`Artista - Título
 * (Mapper) [Dificuldade]`) porque é dele que o normalizador extrai título e
 * dificuldade por regex. Reconstruir a string em vez de passar os campos
 * separados parece o caminho mais longo, e é de propósito: os campos separados
 * exigiriam um `if` dentro do normalizador, e é justamente ele que não pode
 * saber a diferença.
 */
function nativeScore(s) {
  const bm = s.beatmap ?? {};

  const nomeDoMapa = bm.title
    ? `${bm.artist ?? ''} - ${bm.title}${bm.creator ? ` (${bm.creator})` : ''} [${bm.version ?? '?'}]`
    : '';

  return {
    score_id:    s.id ?? null,
    map_id:      bm.id ?? null,
    map_set_id:  bm.set_id ?? null,
    map_name:    nomeDoMapa,
    pp:          s.pp,
    acc:         s.acc,
    mods:        s.mods,
    grade:       s.grade,
    score:       s.score,
    play_time:   s.play_time,
    max_combo:   s.max_combo ?? null,
    // O normalizador já lê `n300`/`n100`/`n50`/`nmiss` — repassados com o mesmo
    // nome, sem tradução.
    n300:  s.n300,
    n100:  s.n100,
    n50:   s.n50,
    nmiss: s.nmiss,
  };
}

// ─── O mapa que só existe no servidor ─────────────────────────────────────────

/**
 * `status` do bancho.py (número) → o rótulo que a API oficial escreve.
 *
 * O rodapé do embed capitaliza o que receber, e a fonte dele até agora era
 * sempre a API oficial. Traduzir aqui é o que deixa as duas origens saírem
 * iguais na tela.
 *
 * `1` é UpdateAvailable, um estado do bancho.py que a oficial não tem: o mapa
 * está submetido e desatualizado, que para quem lê o rodapé é "pending".
 */
const STATUS_LABEL = {
  '-1': 'graveyard',
  0:    'pending',
  1:    'pending',
  2:    'ranked',
  3:    'approved',
  4:    'qualified',
  5:    'loved',
};

/**
 * Completa o mapa de um score com o que o bancho.py sabe dele.
 *
 * Existe porque a API oficial não conhece mapa custom: pedido o id, ela dá 404,
 * e o embed perde combo máximo, estrelas, status, mapper, duração e capa de uma
 * vez. O `/v2/maps/{id}` do servidor responde para os dois tipos de id.
 *
 * **Só preenche buraco.** Onde o score já tem valor, ele fica: mapa oficial
 * jogado num servidor privado pode ter passado antes pelo enriquecimento
 * oficial, e o dado de lá é o mais completo dos dois. Pelo mesmo motivo um
 * campo zerado no servidor não apaga o que já existe.
 *
 * @param {object} score       score normalizado
 * @param {object|null} map    linha do `/v2/maps/{id}`
 * @param {string|null} coverBase espelho de capas do servidor, quando há um
 */
function mergeServerMap(score, map, coverBase = null) {
  if (!map) return score;

  const bm  = score.beatmap ?? {};
  const set = score.beatmapset ?? {};

  const setId = set.id ?? map.set_id ?? null;
  // A versão vem com '?' quando o normalizador não achou nada — é ausência
  // escrita, não um nome de dificuldade.
  const version = bm.version && bm.version !== '?' ? bm.version : (map.version ?? bm.version ?? '?');

  // Artista e título andam JUNTOS, e por isso escapam da regra de "só preenche
  // buraco" que vale para o resto da função.
  //
  // O normalizador extrai os dois de um nome de ARQUIVO ("Artista - Título
  // (Mapper) [Dif]") e a regex não separa um do outro: o título sai com o
  // artista grudado na frente e o campo `artist` sai vazio. Preenchendo só o
  // artista a partir do mapa — que é o que "buraco vazio, mapa preenche"
  // manda fazer — o nome aparecia duas vezes na tela:
  //
  //   sma$her - sma$her - VAI NO VAPOR [gamma 260]
  //
  // Um `artist` vazio é, então, a marca de que o par veio do nome de arquivo,
  // e o par do `/v2/maps/{id}` (campos separados na origem) é melhor inteiro.
  // Com artista preenchido nada muda: o score passou pelo enriquecimento
  // oficial, e o dado de lá continua ganhando.
  const doNomeDeArquivo = !set.artist;
  const artist = doNomeDeArquivo ? (map.artist ?? '') : set.artist;
  const title  = doNomeDeArquivo
    ? (map.title || set.title || '???')
    : (set.title || map.title || '???');

  return {
    ...score,
    beatmap: {
      ...bm,
      version,
      max_combo:         bm.max_combo || map.max_combo || bm.max_combo || null,
      difficulty_rating: bm.difficulty_rating || Number(map.diff) || bm.difficulty_rating || 0,
      status:            bm.status ?? STATUS_LABEL[String(map.status)] ?? null,
      total_length:      bm.total_length || map.total_length || bm.total_length || null,
    },
    beatmapset: {
      ...set,
      id:      setId,
      title,
      artist,
      creator: set.creator || map.creator || null,
      covers: {
        ...(set.covers ?? {}),
        // `/list` e não a raiz: o espelho serve o `cover.jpg` do ppy (900x250,
        // uma faixa) quando não se pede forma, e este campo alimenta o
        // `setThumbnail` do embed, que quer o `list.jpg` (150x110). Sem o
        // sufixo, toda play de servidor privado saía com a faixa espremida no
        // canto — e o mapa parecia errado quando só a medida estava.
        //
        // O `/announce` continua chamando a raiz: lá a faixa é o formato certo.
        list: coverBase && setId !== null
          ? `${coverBase}/${setId}/list`
          : (set.covers?.list ?? null),
      },
    },
  };
}

/**
 * Uma linha da tabela de scores + o mapa dela → o score que o resto do bot lê.
 *
 * A metade do SCORE é a do `normalizeScorePrivate` (mods, acertos, acurácia,
 * grade, data), porque a linha vem no mesmo formato v2 que ele já traduz. O que
 * muda é a metade do MAPA: o `get_map_info` entrega artista, título e
 * dificuldade em campos separados, então aqui eles não passam pela extração por
 * regex que o nome de arquivo exige — e o embed sai com o artista no lugar
 * certo, em vez de grudado no título.
 */
function normalizeServerScore(row, map) {
  const base = normalizeScorePrivate({ map_id: map?.id ?? null, map_set_id: map?.set_id ?? null }, row);
  if (!map) return base;

  return {
    ...base,
    beatmap: {
      ...base.beatmap,
      id:                map.id ?? null,
      version:           map.version ?? '?',
      max_combo:         map.max_combo ?? null,
      difficulty_rating: Number(map.diff ?? 0),
    },
    beatmapset: {
      ...base.beatmapset,
      id:     map.set_id ?? null,
      title:  map.title ?? '???',
      artist: map.artist ?? '',
      covers: { list: `https://assets.ppy.sh/beatmaps/${map.set_id ?? ''}/covers/list.jpg` },
    },
  };
}

/** Uma linha do `get_leaderboard` → a entrada do ranking (ver players.js). */
function normalizeRankingEntry(item) {
  return {
    id:        item.player_id ?? null,
    username:  item.name ?? '?',
    country:   (item.country || '').toUpperCase() || null,
    pp:        Number(item.pp ?? 0),
    // `acc` já vem de 0 a 100, como o resto do bot lê a acurácia de um perfil.
    accuracy:  Number(item.acc ?? 0),
    playCount: Number(item.plays ?? 0),
    // (Houve um `clanTag` aqui, tirado junto com o clã da linha do /leaderboard:
    // campo que ninguém lê é peso morto, e o `clan_tag` da resposta continua
    // esperando no mesmo lugar no dia em que alguém for exibi-lo.)
  };
}

module.exports = {
  normalizeUserPrivate,
  parsePlayTime,
  normalizeScorePrivate,
  nativeScore,
  STATUS_LABEL,
  mergeServerMap,
  normalizeServerScore,
  normalizeRankingEntry,
};
