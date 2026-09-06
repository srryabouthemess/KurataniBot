/**
 * osu/banchoPyApi.js
 * Adaptador para servidores bancho.py.
 *
 * Implementa o mesmo contrato do osu/officialApi.js — `fetchUser`,
 * `bestScores`, `recentScores`, `beatmapScores`, `userUrl`, `mapUrl` — para o
 * osuClient poder escolher um ou outro sem saber a diferença.
 *
 * ATENÇÃO: "bancho.py" aqui quer dizer a stack completa. As top plays vêm de
 * `get_player_scores`, que é da Shiina-Web (o front-end) e não do bancho.py —
 * por isso `webApi` e `banchoV1/V2` são endereços separados no registro: um
 * servidor com outro front responde o resto e falha nessa.
 *
 * O rank global também saía de lá, do `get_rank_cache`, e deixou de sair: ele
 * não existe fora da Shiina-Web e não traz o rank do país. As duas posições vêm
 * da v1 do bancho.py-ex, que todo servidor desses tem (ver fetchUser).
 */

const axios = require('axios');
const servers = require('../servers');
const rateLimiter = require('../rateLimiter');
const metrics = require('../metrics');
const { decodeMods } = require('../mods');
const { idSegment } = require('../urlSafe');
const { withRetry } = require('../retry');
const { dedupe } = require('../inflight');
const { TtlCache } = require('../ttlCache');
const { logErrorOnce } = require('../logger');

// O servidor padrão de quem consulta sem dizer qual. Hoje só os comandos
// administrativos, que operam uma instância só.
const PRIVATE_MODE = servers.resolveKey('private') ?? servers.defaultKey();

// (Havia um officialPost aqui, do tempo em que as estrelas ajustadas vinham de
// POST /beatmaps/{id}/attributes. Hoje esse cálculo é local, pelo rosu-pp, e
// nenhuma chamada do bot escreve na API oficial.)

/**
 * Se aquele servidor tem o front-end Shiina-Web.
 *
 * O registro decide (`webApi: null`), e não este arquivo: quem hospeda sabe
 * qual front-end subiu, e adivinhar por sondagem custaria uma requisição a
 * cada consulta para descobrir algo que não muda.
 *
 * Vale para o servidor, não para o tipo — o mesmo adaptador atende bancho.py
 * com Shiina-Web (Daycore) e sem (EZPP Farm).
 */
const temShiina = (mode) => Boolean(servers.get(mode).webApi);

/**
 * GET na API do front-end (Shiina-Web) do servidor.
 *
 * É um serviço DIFERENTE do bancho.py, apesar de conviverem no mesmo domínio:
 * o `get_player_scores` daqui não é o de lá. Só chame depois de conferir o
 * `temShiina` — num servidor sem Shiina-Web este endereço responde 200 com o
 * HTML da página, que viraria "resposta vazia" silenciosa.
 */
async function webApiGet(mode, endpoint, params = {}) {
  const server = servers.get(mode);
  const res = await withRetry(async () => {
    await rateLimiter.acquire(`server:${server.namespace}`);
    return axios.get(`${server.webApi}/${endpoint}`, { params, timeout: 10000 });
  });
  return res.data;
}

/**
 * GET na API v1 do bancho.py-ex.
 *
 * `validateStatus` aceita 404 e 422 como respostas normais em vez de erro:
 * "jogador não existe" e "nome fora do formato aceito" são resultados
 * legítimos de uma busca, não falhas de rede que valha a pena relançar.
 */
async function banchoV1Get(mode, endpoint, params = {}) {
  const server = servers.get(mode);
  const res = await withRetry(async () => {
    await rateLimiter.acquire(`server:${server.namespace}`);
    return axios.get(`${server.banchoV1}/${endpoint}`, {
      params,
      timeout: 10000,
      validateStatus: (s) => (s >= 200 && s < 300) || s === 404 || s === 422,
    });
  });
  return res.status === 200 ? res.data : null;
}

/** GET na API v2 do bancho.py-ex (somente leitura). */
async function banchoV2Get(mode, path, params = {}) {
  const server = servers.get(mode);
  const res = await withRetry(async () => {
    await rateLimiter.acquire(`server:${server.namespace}`);
    return axios.get(`${server.banchoV2}${path}`, { params, timeout: 10000 });
  });
  return res.data;
}

// ─── Normalização: usuário ────────────────────────────────────────────────────
function normalizeUserPrivate(playerData, statsData, mode, globalRank = null, countryRank = null) {
  if (!playerData) return null;

  return {
    id: playerData.id,
    username: playerData.name,
    avatar_url: `${servers.get(mode).avatars}/${playerData.id}`,
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

// ─── Busca ID do jogador pelo nome (via api v2) ──────────────────────────────
async function resolvePlayerId(username, mode = PRIVATE_MODE) {
  // Pode chegar como número (ID vindo do link salvo) ou string (nome digitado
  // no comando). Normalizamos antes de qualquer operação de string — sem isso
  // um ID numérico estourava em `username.trim()`.
  const raw = String(username).trim();

  // /^\d+$/ em vez de !isNaN(): isNaN('   ') é false (Number('   ') === 0),
  // então uma string só de espaços virava silenciosamente o ID 0.
  if (/^\d+$/.test(raw)) return Number(raw);

  // Busca exata pelo nome. Usa a v1 do bancho porque o endpoint /players da
  // v2 NÃO aceita filtro por nome — os parâmetros dele são priv, country,
  // clan_id, clan_priv, preferred_mode, play_style e paginação. Passar `name`
  // ali é silenciosamente ignorado pelo FastAPI: a chamada devolvia a primeira
  // página de TODOS os jogadores, e o código caía no primeiro resultado
  // (`?? results[0]`) quando não achava correspondência.
  //
  // Isso funcionava por acidente enquanto o servidor coubesse numa página de
  // 50: qualquer nome inexistente resolvia para o primeiro usuário da tabela
  // (o BanchoBot, id 1), e a partir de 51 contas qualquer jogador fora da
  // primeira página resolveria para ele também — linkando ou consultando a
  // conta errada sem nenhum aviso.
  const res = await banchoV1Get(mode, 'get_player_info', { name: raw, scope: 'info' });
  return res?.player?.info?.id ?? null;
}

// Busca detalhes completos de cada score via v2
/**
 * Detalhe de um score, guardado porque ele quase não muda.
 *
 * Este endpoint é o mais caro do bot em servidor privado: é UMA requisição POR
 * SCORE, cinco por página do /topplays e uma por play do /recent, e nada disso
 * era reaproveitado. Medido numa página de cinco: 294ms numa rodada, 843ms na
 * seguinte — de 25% a 75% do tempo total do comando.
 *
 * E o dado é quase imutável: acertos, combo, mods e data de um score que já
 * aconteceu não mudam mais. O TTL existe pelo que PODE mudar — o pp, quando
 * quem hospeda roda um recálculo em massa. Uma hora é o prazo de um número
 * ficar velho na tela; guardar para sempre não é possível por causa disso.
 *
 * Só o payload da v2 entra aqui, e não o score já normalizado: o lado v1 da
 * mescla muda conforme quem chama (o beatmapScores monta um sintético a partir
 * do mapa), então guardar o resultado pronto serviria a mescla de um no outro.
 */
const DETALHE_TTL_MS = 60 * 60_000;
const DETALHE_MAX    = 2000;
const _detalhes = new TtlCache({ ttlMs: DETALHE_TTL_MS, max: DETALHE_MAX });

async function scoreDetail(scoreId, mode) {
  const chave = `${mode}:${scoreId}`;

  const guardado = _detalhes.get(chave);
  metrics.cache('scoreDetalhe', guardado !== undefined);
  // `!== undefined` e não um truthy: a resposta vazia é um resultado legítimo
  // ("o servidor não sabe o detalhe deste score") e também merece ser guardada,
  // senão ela é repedida a cada exibição.
  if (guardado !== undefined) return guardado;

  // O dedupe cobre a corrida que o prefetch da paginação criou: quem clica em ▶️
  // antes de a próxima página terminar de ser aquecida pede os mesmos scores de
  // novo, e sem isto os dois pedidos saem (ver inflight.js).
  return dedupe(`bpscore:${chave}`, async () => {
    const res = await banchoV2Get(mode, `/scores/${idSegment(scoreId)}`);
    const detalhe = res?.data ?? null;
    _detalhes.set(chave, detalhe);
    return detalhe;
  });
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
 * O mapa de um score, pelo id, com cache curto.
 *
 * Curto de propósito, e mais curto que o `getServerMapByMd5`: o `status` entra
 * aqui, e ele muda quando a staff rankeia um mapa. Meia hora de cache faria o
 * rodapé de um mapa recém-rankeado continuar dizendo "Loved".
 */
const MAPA_ID_TTL_MS = 10 * 60_000;
const MAPA_ID_MAX    = 500;
const _mapasPorId = new TtlCache({ ttlMs: MAPA_ID_TTL_MS, max: MAPA_ID_MAX });

async function mapaDoScore(mapId, mode) {
  if (!mapId) return null;
  const chave = `${mode}:${mapId}`;

  const guardado = _mapasPorId.get(chave);
  metrics.cache('mapaPorId', guardado !== undefined);
  if (guardado !== undefined) return guardado;

  return dedupe(`bpmapid:${chave}`, async () => {
    try {
      const mapa = await getServerMap(mapId, mode);
      _mapasPorId.set(chave, mapa);
      return mapa;
    } catch {
      // Falha não entra no cache: uma queda de rede deixaria o mapa "sem dados"
      // por dez minutos, mesmo cuidado do scoreDetail.
      return null;
    }
  });
}

/** Se ainda falta ao score algo que só o mapa responde. */
function precisaDoMapa(score) {
  return !score.beatmap?.max_combo
      || !score.beatmap?.difficulty_rating
      || !score.beatmap?.status;
}

async function enrichScores(v1Scores, mode = PRIVATE_MODE) {
  const coverBase = servers.get(mode).covers ?? null;

  return Promise.all(
    v1Scores.map(async (s) => {
      // Sem id não há o que buscar nem o que guardar — e uma chave
      // `${mode}:undefined` faria scores diferentes dividirem a mesma entrada.
      let score;
      if (s.score_id === undefined || s.score_id === null) {
        score = normalizeScorePrivate(s, null);
      } else {
        try {
          score = normalizeScorePrivate(s, await scoreDetail(s.score_id, mode));
        } catch {
          // Falha não entra no cache: uma queda de rede viraria "sem detalhe" por
          // uma hora, que é o mesmo cuidado que o rememberFCpp já toma no pp.js.
          score = normalizeScorePrivate(s, null);
        }
      }

      // O detalhe do score não traz nada do mapa. Buscá-lo aqui, e não deixar
      // para o enriquecimento pela API oficial, é o que faz um mapa custom
      // aparecer completo — lá ele é um 404.
      if (!precisaDoMapa(score)) return score;
      return mergeServerMap(score, await mapaDoScore(score.beatmap?.id, mode), coverBase);
    })
  );
}

/**
 * No bancho.py a busca é pelo HASH do mapa, não pelo id — a tabela de scores
 * guarda `map_md5`. Por isso o id vira hash antes (via /maps/{id}).
 */
async function privateBeatmapScores(userId, beatmapId, mode) {
  let map = null;
  try {
    map = await getServerMap(beatmapId, mode);
  } catch (error) {
    // 404 = mapa nunca foi submetido lá. Qualquer outra falha (rede, 5xx) sobe:
    // devolver "sem scores" nesse caso esconderia o erro de quem chamou.
    if (error?.response?.status !== 404) throw error;
  }
  if (!map?.md5) return [];

  const res = await banchoV2Get(mode, '/scores', {
    map_md5:   map.md5,
    user_id:   userId,
    mode:      servers.get(mode).gameMode,
    page_size: 100,
  });

  const raw = Array.isArray(res?.data) ? res.data : [];

  // status 0 é quit (o bancho.py guarda tentativa falha também). O endpoint
  // oficial só devolve play completa, então filtramos para os dois servidores
  // mostrarem a mesma coisa.
  return raw
    .filter(v2 => (v2.status ?? 0) > 0)
    .map(v2 => normalizeScorePrivate(
      { map_id: map.id, map_set_id: map.set_id, map_name: map.filename },
      v2
    ));
}

// ─── Melhores scores do servidor ─────────────────────────────────────────────

const TOP_PAGE_SIZE = 100;

/**
 * Teto da varredura, em páginas. Trinta são 3000 scores e 30 requisições no
 * pior caso — o Daycore inteiro cabe em 4.
 */
const TOP_MAX_PAGES = 30;

/**
 * As melhores plays do servidor inteiro, do maior pp para o menor.
 *
 * ── Por que é uma varredura, e não uma consulta ordenada ─────────────────────
 * O endpoint devolve a tabela na ordem de INSERÇÃO e não aceita ordenação:
 * `sort=pp` e `sort=pp_desc` foram testados e são silenciosamente ignorados —
 * o mesmo comportamento do FastAPI que já mordeu o `resolvePlayerId` com o
 * parâmetro `name`. A ordenação é nossa, e para ordenar é preciso ter tudo.
 *
 * `status=2` é o que torna isso viável: no bancho.py o 2 é "melhor score
 * daquele jogador naquele mapa" (0 falhou, 1 enviado sem ser o melhor). É
 * exatamente o conjunto que "melhores plays" quer dizer, e ele encolhe a
 * varredura de 20+ páginas para 4 no Daycore.
 *
 * ── Por que o teto RECUSA em vez de truncar ──────────────────────────────────
 * Sem ordenação do lado do servidor, uma varredura parcial não devolve uma
 * resposta incompleta: devolve uma resposta ERRADA. As primeiras 3000 linhas
 * por ordem de inserção não têm relação nenhuma com as 50 maiores por pp.
 *
 * Daí o `completo` voltar junto: num servidor grande demais o comando diz que
 * não sabe, em vez de exibir um pódio que não é o pódio. É a mesma escolha do
 * cache negativo do osuClient — falha visível é melhor que número errado com
 * cara de certo.
 *
 * Os scores voltam CRUS, como os do `bestScores`: quem exibe enriquece só a
 * página que vai mostrar.
 *
 * ── E voltam TODOS, sem corte ────────────────────────────────────────────────
 * Cortar aqui impediria quem chama de filtrar: tirar as plays de contas
 * marcadas (ver os grupos, abaixo) depois de um corte em 50 deixaria buracos no
 * pódio — 50 menos as escondidas, e não as 50 melhores que sobraram. A lista
 * inteira já está na memória de qualquer jeito, porque foi preciso lê-la toda
 * para ordenar.
 *
 * @returns {Promise<{scores: Array, completo: boolean}>}
 */
async function topScores(mode) {
  const modeNum = servers.get(mode).gameMode;
  const todos = [];
  let completo = false;

  for (let pagina = 1; pagina <= TOP_MAX_PAGES; pagina++) {
    const res = await banchoV2Get(mode, '/scores', {
      mode:      modeNum,
      status:    2,
      page_size: TOP_PAGE_SIZE,
      page:      pagina,
    });

    const lote = Array.isArray(res?.data) ? res.data : [];
    todos.push(...lote);

    // Página incompleta é o fim da tabela — inclusive a vazia.
    if (lote.length < TOP_PAGE_SIZE) { completo = true; break; }
  }

  if (!completo) return { scores: [], completo: false };

  return {
    scores: todos.sort((a, b) => Number(b.pp ?? 0) - Number(a.pp ?? 0)),
    completo: true,
  };
}

/**
 * Um beatmap pelo HASH, que é como a tabela de scores o referencia.
 *
 * Vai pela v1 (`get_map_info`) porque o `/v2/maps?md5=` **ignora o filtro**:
 * pedido um md5, ele devolveu a primeira página de 50 mapas, com outro hash no
 * primeiro item. É a armadilha do FastAPI outra vez — e aqui ela seria pior que
 * no `resolvePlayerId`, porque cada score sairia exibindo o mapa de outro.
 *
 * O cache é longo porque o que interessa aqui (artista, título, dificuldade,
 * estrelas, combo máximo) não muda depois de o mapa existir.
 */
const MAPA_TTL_MS = 6 * 60 * 60_000;
const MAPA_MAX    = 1000;
const _mapasPorMd5 = new TtlCache({ ttlMs: MAPA_TTL_MS, max: MAPA_MAX });

async function getServerMapByMd5(md5, mode = PRIVATE_MODE) {
  const chave = `${mode}:${md5}`;

  const guardado = _mapasPorMd5.get(chave);
  metrics.cache('mapaPorMd5', guardado !== undefined);
  if (guardado !== undefined) return guardado;

  return dedupe(`bpmap:${chave}`, async () => {
    const res = await banchoV1Get(mode, 'get_map_info', { md5 });
    const mapa = res?.map ?? null;
    _mapasPorMd5.set(chave, mapa);
    return mapa;
  });
}

/**
 * O nick de um jogador pelo id.
 *
 * Numa lista do servidor inteiro cada linha é de uma pessoa diferente, e o
 * score só traz o `userid`. Vai pelo `/players/{id}` (uma requisição) em vez do
 * `getUser` do osuClient, que faria três — perfil, stats e rank — para usar
 * um campo só.
 */
const NOME_TTL_MS = 30 * 60_000;
const NOME_MAX    = 500;
const _nomes = new TtlCache({ ttlMs: NOME_TTL_MS, max: NOME_MAX });

async function getServerPlayerName(playerId, mode = PRIVATE_MODE) {
  const chave = `${mode}:${playerId}`;

  const guardado = _nomes.get(chave);
  metrics.cache('nomeJogador', guardado !== undefined);
  if (guardado !== undefined) return guardado;

  return dedupe(`bpname:${chave}`, async () => {
    const res = await banchoV2Get(mode, `/players/${idSegment(playerId)}`);
    const nome = res?.data?.name ?? null;
    _nomes.set(chave, nome);
    return nome;
  });
}

// ─── Grupos do front-end ──────────────────────────────────────────────────────

/** O bloco de grupos, logo abaixo do nick na página de perfil. */
const GRUPO_BLOCO = /<div[^>]*class="[^"]*groupPlace[^"]*"[^>]*>([\s\S]*?)<\/div>/;

/**
 * Cada grupo: um `span.shiina-badge` com um `span.groupEmoji` opcional dentro.
 *
 * Os `[^>]*` precisam aceitar quebra de linha, e aceitam: o HTML vem indentado
 * COM as tags abertas em várias linhas (`<span\n  class="...">`). Um `.` comum
 * no lugar deles casaria só o que estivesse numa linha só — que é como este
 * recorte falhou na primeira tentativa, devolvendo zero grupo numa página que
 * tem três.
 */
const GRUPO_ITEM = /<span[^>]*class="[^"]*shiina-badge[^"]*"[^>]*>\s*(?:<span[^>]*class="[^"]*groupEmoji[^"]*"[^>]*>([\s\S]*?)<\/span>)?\s*([\s\S]*?)<\/span>/g;

/**
 * Os grupos de uma página de perfil: `[{ emoji, name }]`.
 *
 * ── Por que sai do HTML, e não da API ────────────────────────────────────────
 * Grupo é do **Shiina-Web**, não do bancho.py: é uma tabela do front-end, e
 * nenhuma das 62 rotas da API o expõe — nem `/v2/players/{id}`, nem o
 * `custom_badge_name` (que está nulo em todo mundo).
 *
 * E não dá para derivar do `priv`. Medido no Daycore: a yumi tem os bits de
 * ADMINISTRATOR e DEVELOPER e mostra só "puppy" e "Legit"; o noober tem o bit
 * de DEVELOPER e mostra "Nominator" e "Cheating". São conjuntos independentes.
 *
 * O recorte é DENTRO do `groupPlace` de propósito: `shiina-badge` é classe de
 * uso geral do tema e aparece em outros pontos da página.
 */
function parseGroups(html) {
  const bloco = String(html ?? '').match(GRUPO_BLOCO)?.[1];
  if (!bloco) return [];

  return [...bloco.matchAll(GRUPO_ITEM)]
    .map(m => ({
      emoji: (m[1] ?? '').trim(),
      name:  m[2].replace(/<[^>]*>/g, '').trim(),
    }))
    .filter(g => g.name);
}

/**
 * Os grupos daquele jogador, do cache quando possível.
 *
 * Custa uma página inteira de HTML (30-70KB) para ler três palavras, então o
 * cache não é otimização: é o que torna o uso viável. Grupo muda por decisão de
 * staff, o que é raro — meia hora é curto para o dado e longo para a lista, que
 * repete as mesmas pessoas em quase toda linha.
 */
const GRUPOS_TTL_MS = 30 * 60_000;
const GRUPOS_MAX    = 300;
const _grupos = new TtlCache({ ttlMs: GRUPOS_TTL_MS, max: GRUPOS_MAX });

async function getServerPlayerGroups(playerId, mode = PRIVATE_MODE) {
  // Grupo é um selo desenhado pela Shiina-Web, e o que se lê aqui é o HTML dela.
  // Noutro front-end a página existe e responde 200, só que sem os selos: a
  // raspagem devolveria lista vazia depois de baixar 30-70KB por jogador, uma
  // vez por linha do /leaderboard. Quem não tem o conceito não paga por ele.
  if (!temShiina(mode)) return [];

  const chave = `${mode}:${playerId}`;

  const guardado = _grupos.get(chave);
  metrics.cache('gruposJogador', guardado !== undefined);
  if (guardado !== undefined) return guardado;

  return dedupe(`bpgroups:${chave}`, async () => {
    try {
      const grupos = parseGroups(await getServerProfilePage(playerId, mode));
      _grupos.set(chave, grupos);
      return grupos;
    } catch (error) {
      // Falha de rede NÃO entra no cache, e devolve lista vazia: quem chama
      // trata "sem grupo" como "não sei", e não como "está limpo".
      logErrorOnce('banchoPy:grupos', error);
      return [];
    }
  });
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

// ─── bancho.py: leitura para ações administrativas ────────────────────────────
// A API v2 do bancho.py-ex é somente leitura, então ela serve para *consultar*
// o estado (privilégios de quem mandou o comando, status atual de um mapa) —
// as escritas vão por outro caminho, via Redis pub/sub (ver daycoreAdmin.js).

/**
 * Dados crus do jogador no servidor, incluindo o bitfield `priv` — é ele que
 * diz se a pessoa é NOMINATOR/ADMINISTRATOR lá, e não no Discord.
 */
async function getServerPlayerRaw(playerId, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, `/players/${idSegment(playerId)}`);
  return res?.data ?? null;
}

/**
 * A página pública de perfil, em HTML.
 *
 * Existe porque o `userpage_content` da API v2 **não** é onde o texto do perfil
 * acaba parando. O bancho declara e seleciona a coluna (`READ_PARAMS` em
 * app/repositories/users.py), mas quem grava o userpage é o front-end
 * Shiina-Web, e ele guarda em outro lugar da mesma base — medido: perfil com
 * texto salvo e visível no site, e a API devolvendo `null` para o mesmo jogador.
 *
 * A página renderizada é a fonte que reflete o que a pessoa realmente salvou.
 * Procurar uma string de alta entropia dentro dela é robusto: não depende de
 * classe de CSS nem de estrutura, só de o texto estar lá.
 */
async function getServerProfilePage(playerId, mode = PRIVATE_MODE) {
  const server = servers.get(mode);
  await rateLimiter.acquire(`server:${server.namespace}`);

  const res = await axios.get(`${server.webUrl}/u/${idSegment(playerId)}`, {
    timeout: 12000,
    // Sem isto o axios tenta interpretar a resposta, e o que se quer é o texto.
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  return typeof res.data === 'string' ? res.data : String(res.data ?? '');
}

/**
 * Estatísticas cruas de um jogador NUM modo: pp, plays, acc, tscore, combo.
 *
 * Existe para o /wipe: é o que permite mostrar o tamanho do estrago antes de
 * causá-lo, e registrar no log o que foi destruído. Depois do wipe esses
 * números não existem mais em lugar nenhum — o log do bot vira o único
 * registro de que existiram.
 */
async function getServerPlayerStats(playerId, modeNum, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, `/players/${idSegment(playerId)}/stats/${idSegment(modeNum)}`);
  return res?.data ?? null;
}

/**
 * UM score pelo id, cru como a tabela guarda — inclusive o `status`.
 *
 * Existe para o /scorewipe, e o campo que importa é o `status`: é por ele que o
 * comando confere que o score existe e é do jogador que o staff digitou, e é
 * ele que a confirmação relê depois para dizer se o wipe pegou (o `wipe_score`
 * do bancho estaciona o score apagado em -1, em vez de apagar a linha).
 *
 * Levanta em 404, como o `getServerMap` — score que não existe é resposta, e
 * quem chama trata.
 */
async function getServerScore(scoreId, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, `/scores/${idSegment(scoreId)}`);
  return res?.data ?? null;
}

/**
 * Os scores de um jogador num modo, COM o id de cada um.
 *
 * Existe porque o id do score não sobrevive à normalização que o resto do bot
 * usa (ver `normalizeScorePrivate`): os embeds nunca precisaram dele. O
 * /scorewipe precisa — é o que ele publica —, então aqui a linha vem crua.
 *
 * Vai pela v1 e não pela v2 por causa da ORDENAÇÃO: o `/v2/scores` devolve na
 * ordem da tabela e obrigaria a puxar tudo do jogador para achar as dez
 * maiores; o `get_player_scores` ordena no banco (pp para `best`, data para
 * `recent`) e corta no `limit`.
 *
 * Cada linha já traz o mapa aninhado em `beatmap`, então listar não custa uma
 * requisição por score.
 */
async function getServerPlayerScores(playerId, modeNum, scope = 'best', limit = 10, mode = PRIVATE_MODE) {
  const res = await banchoV1Get(mode, 'get_player_scores', {
    id:    playerId,
    mode:  modeNum,
    scope,
    limit,
  });

  return Array.isArray(res?.scores) ? res.scores : [];
}

/**
 * Todas as plays de um jogador num mapa, apagadas incluídas.
 *
 * O `getServerPlayerScores` é por modo e não alcança "as deste mapa"; a
 * leaderboard do mapa traz um score por jogador. Nenhum dos dois responde a
 * pergunta que o wipe de mapa faz.
 *
 * Sem cache de propósito: é leitura de confirmação de ação destrutiva, e um
 * valor de meio minuto atrás responderia a pergunta errada.
 *
 * Devolve `null`, e não `[]`, quando não houve leitura: o `banchoV1Get` trata
 * 404 e 422 como respostas normais e devolve `null` sem lançar (restart do
 * servidor, 404 transitório de proxy, md5 que não tem os 32 caracteres que o
 * endpoint valida). Achatar isso em lista vazia faria "não consegui ler" e
 * "não há play nenhuma" chegarem iguais em quem chama — e o
 * `verifyMapScoresWiped` daria verde por vacuidade, confirmando um lote que
 * ninguém conferiu. Cada chamador decide: a tela que só OFERECE o botão
 * trata `null` como zero plays; a verificação trata como "não confirmei".
 */
async function getServerPlayerMapScores(playerId, md5, modeNum, mode = PRIVATE_MODE) {
  const res = await banchoV1Get(mode, 'get_player_map_scores', {
    id:   playerId,
    md5,
    mode: modeNum,
  });

  return Array.isArray(res?.scores) ? res.scores : null;
}

/** Um beatmap (dificuldade única) pelo ID. */
async function getServerMap(mapId, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, `/maps/${idSegment(mapId)}`);
  return res?.data ?? null;
}

/**
 * Todas as dificuldades de um beatmapset.
 * Necessário porque o canal `rank` do bancho age sobre UMA dificuldade por
 * mensagem — para rankear o set inteiro é preciso publicar uma vez por diff.
 */
async function getServerMapsBySet(setId, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, '/maps', { set_id: setId, page_size: 100 });
  const data = res?.data;
  return Array.isArray(data) ? data : [];
}

async function fetchUser(username, mode) {
  const playerId = await resolvePlayerId(username, mode);
  if (!playerId) return null;

  const modeNum = servers.get(mode).gameMode;

  const [playerRes, statsRes] = await Promise.all([
    banchoV2Get(mode, `/players/${idSegment(playerId)}`),
    banchoV2Get(mode, `/players/${idSegment(playerId)}/stats/${idSegment(modeNum)}`),
  ]);

  // O endpoint de stats da v2 não retorna rank; quem tem as duas posições é a
  // v1, dentro das estatísticas e indexadas por modo. Falhar aqui deixa os
  // ranks em null (saem como "Unranked") em vez de derrubar a consulta inteira
  // — o perfil não se perde por causa de uma posição.
  //
  // ── A Shiina-Web saiu deste caminho ───────────────────────────────────────
  // O rank global vinha do `get_rank_cache` do front-end, que é de quando ele
  // era a única fonte que o bot conhecia. Ele responde o HISTÓRICO diário do
  // jogador, e a posição de hoje era o último item da lista — funcionava, e
  // custava a mesma requisição que esta, com duas desvantagens: não existe fora
  // da Shiina-Web (daí o servidor sem ela já ler a v1 aqui) e não traz o rank do
  // PAÍS. Sem ele a linha do autor imprimia "#3 KP", com a bandeira e o país
  // mas sem a posição neles — enquanto a v1 do mesmo servidor respondia
  // `country_rank: 1` o tempo todo.
  //
  // Conferido no Daycore, que tem os dois: v1 e `get_rank_cache` dão o mesmo
  // número, em VN e em RX.
  let globalRank = null;
  let countryRank = null;

  try {
    const info = await banchoV1Get(mode, 'get_player_info', { id: playerId, scope: 'stats' });
    const st = info?.player?.stats?.[modeNum];
    // `|| null` e não `?? null`: quem nunca jogou aquele modo vem com zero, e
    // "rank 0" na tela é pior do que "Unranked".
    globalRank  = st?.rank || null;
    countryRank = st?.country_rank || null;
  } catch {
    // segue sem rank
  }

  return normalizeUserPrivate(playerRes?.data ?? null, statsRes?.data ?? null, mode, globalRank, countryRank);
}

/**
 * As plays daquele jogador, do front-end quando existe e do bancho.py quando
 * não — os dois endpoints se chamam `get_player_scores` e aceitam os mesmos
 * parâmetros, mudando só o host e o formato da resposta (ver nativeScore).
 *
 * Cru de propósito: enriquecer as N buscadas de uma vez seria uma rajada de
 * requisições. Quem chama enriquece só a página que vai exibir.
 */
async function playerScores(userId, limit, scope, mode) {
  const params = { id: userId, mode: servers.get(mode).gameMode, scope, limit };

  if (!temShiina(mode)) {
    const res = await banchoV1Get(mode, 'get_player_scores', params);
    return (res?.scores ?? []).map(nativeScore);
  }

  const res = await webApiGet(mode, 'get_player_scores', params);
  return res.scores ?? [];
}

const bestScores   = (userId, limit, mode) => playerScores(userId, limit, 'best', mode);
const recentScores = (userId, limit, mode) => playerScores(userId, limit, 'recent', mode);

/**
 * Teto de colocados por resposta. Não é escolha nossa: o endpoint valida
 * `limit <= 100` e responde 422 acima disso (medido). Clampar aqui faz um
 * pedido maior devolver o que dá, em vez de lista vazia.
 */
const RANKING_MAX = 100;

/**
 * O ranking de pp do servidor, do primeiro colocado para baixo.
 *
 * Este vem da API v1 do **bancho.py-ex**, e não da Shiina-Web como o
 * `get_player_scores` logo acima — apesar do nome parecido, `get_leaderboard` é
 * do outro serviço, no host `api.`. Servidor com front-end diferente continua
 * respondendo este aqui.
 *
 * O filtro de país é case-insensitive (conferido com `br` e `BR`); mandamos em
 * minúsculo, que é como o bancho.py guarda. País sem ninguém é lista vazia, e
 * não erro.
 *
 * `rank` não sai daqui porque a resposta não tem: o endpoint devolve a lista
 * ordenada e nada mais. Quem exibe conta a posição.
 */
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

async function leaderboard(mode, { limit = 50, country = null } = {}) {
  const res = await banchoV1Get(mode, 'get_leaderboard', {
    mode:  servers.get(mode).gameMode,
    limit: Math.min(limit, RANKING_MAX),
    ...(country ? { country: String(country).toLowerCase() } : {}),
  });

  const lista = Array.isArray(res?.leaderboard) ? res.leaderboard : [];
  return lista.map(normalizeRankingEntry);
}

const userUrl = (userId, mode) => `${servers.get(mode).webUrl}/u/${userId}`;
const mapUrl  = (mapId, _setId, mode) => `${servers.get(mode).webUrl}/b/${mapId}`;

module.exports = {
  fetchUser,
  bestScores,
  recentScores,
  beatmapScores: privateBeatmapScores,
  leaderboard,
  // Parte do contrato só neste adaptador: o osu! oficial não tem endpoint de
  // "melhores scores do servidor", e o Ripple exige um mapa (`md5|b`). O
  // osuClient trata o método ausente como "este servidor não sabe responder".
  topScores,
  // Idem: grupo é coisa do front-end Shiina-Web, e nem todo servidor tem.
  playerGroups: getServerPlayerGroups,
  // Diferente dos outros dois, esta capacidade não se decide pelo TIPO do
  // servidor: entre os bancho.py, uns têm Shiina-Web e outros não. Por isso o
  // adaptador expõe o método e, junto, quem responde por servidor.
  hasPlayerGroups: temShiina,
  userUrl,
  mapUrl,

  // Exportado para o teste: é a normalização que já derrubou uma página
  // inteira por causa do formato de um campo.
  parsePlayTime,
  // Idem para a linha do ranking, que troca o nome de todos os campos.
  normalizeRankingEntry,
  // E para o recorte dos grupos, que sai de HTML indentado — o tipo de coisa
  // que passa a devolver zero sem ninguém perceber.
  parseGroups,
  // E para a tradução do score nativo, cujo estrago seria mudo: os campos que
  // ela erra não estouram, só chegam vazios no embed.
  nativeScore,

  // Específicos deste tipo de servidor, usados pelos comandos administrativos.
  enrichScores,
  mergeServerMap,
  resolvePlayerId,
  getServerMapByMd5,
  getServerPlayerName,
  normalizeServerScore,
  getServerPlayerRaw,
  getServerPlayerStats,
  getServerScore,
  getServerPlayerScores,
  getServerPlayerMapScores,
  getServerProfilePage,
  getServerMap,
  getServerMapsBySet,
};
