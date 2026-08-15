/**
 * osu/banchoPyApi.js
 * Adaptador para servidores bancho.py.
 *
 * Implementa o mesmo contrato do osu/officialApi.js — `fetchUser`,
 * `bestScores`, `recentScores`, `beatmapScores`, `userUrl`, `mapUrl` — para o
 * osuClient poder escolher um ou outro sem saber a diferença.
 *
 * ATENÇÃO: "bancho.py" aqui quer dizer a stack completa. O rank global e as top
 * plays vêm de `get_rank_cache` e `get_player_scores`, que são da Shiina-Web (o
 * front-end), não do bancho.py. Por isso `webApi` e `banchoV1/V2` são endereços
 * separados no registro: um servidor com outro front responde o resto e falha
 * nesses dois.
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

// O servidor padrão de quem consulta sem dizer qual. Hoje só os comandos
// administrativos, que operam uma instância só.
const PRIVATE_MODE = servers.resolveKey('private') ?? servers.defaultKey();

// (Havia um officialPost aqui, do tempo em que as estrelas ajustadas vinham de
// POST /beatmaps/{id}/attributes. Hoje esse cálculo é local, pelo rosu-pp, e
// nenhuma chamada do bot escreve na API oficial.)

/**
 * GET na API do front-end (Shiina-Web) do servidor.
 *
 * É um serviço DIFERENTE do bancho.py, apesar de conviverem no mesmo domínio:
 * `get_rank_cache` e `get_player_scores` existem aqui e não lá. Um servidor
 * bancho.py com outro front-end responde o resto e falha nestes dois.
 */
async function webApiGet(mode, endpoint, params = {}) {
  const server = servers.get(mode);
  const res = await withRetry(async () => {
    await rateLimiter.acquire(`server:${server.key}`);
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
    await rateLimiter.acquire(`server:${server.key}`);
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
    await rateLimiter.acquire(`server:${server.key}`);
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
  const max_combo = v2?.max_combo ?? null;
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

async function enrichScores(v1Scores, mode = PRIVATE_MODE) {
  return Promise.all(
    v1Scores.map(async (s) => {
      // Sem id não há o que buscar nem o que guardar — e uma chave
      // `${mode}:undefined` faria scores diferentes dividirem a mesma entrada.
      if (s.score_id === undefined || s.score_id === null) {
        return normalizeScorePrivate(s, null);
      }

      try {
        return normalizeScorePrivate(s, await scoreDetail(s.score_id, mode));
      } catch {
        // Falha não entra no cache: uma queda de rede viraria "sem detalhe" por
        // uma hora, que é o mesmo cuidado que o rememberFCpp já toma no pp.js.
        return normalizeScorePrivate(s, null);
      }
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
  await rateLimiter.acquire(`server:${server.key}`);

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

  // O endpoint de stats não retorna rank — buscamos via leaderboard do
  // front-end. Conta nova, sem cache ainda, ou front sem esse endpoint: o rank
  // fica null e sai como "Unranked", em vez de derrubar a consulta inteira.
  let globalRank = null;
  try {
    const rankRes = await webApiGet(mode, 'get_rank_cache', { id: playerId, mode: modeNum });
    if (Array.isArray(rankRes) && rankRes.length > 0) {
      globalRank = rankRes[rankRes.length - 1].rank ?? null;
    }
  } catch {
    // segue sem rank
  }

  return normalizeUserPrivate(playerRes?.data ?? null, statsRes?.data ?? null, mode, globalRank);
}

async function bestScores(userId, limit, mode) {
  const res = await webApiGet(mode, 'get_player_scores', {
    id: userId, mode: servers.get(mode).gameMode, scope: 'best', limit,
  });
  // Cru de propósito: enriquecer as N buscadas de uma vez seria uma rajada de
  // requisições. Quem chama enriquece só a página que vai exibir.
  return res.scores ?? [];
}

async function recentScores(userId, limit, mode) {
  const res = await webApiGet(mode, 'get_player_scores', {
    id: userId, mode: servers.get(mode).gameMode, scope: 'recent', limit,
  });
  return res.scores ?? [];
}

const userUrl = (userId, mode) => `${servers.get(mode).webUrl}/u/${userId}`;
const mapUrl  = (mapId, _setId, mode) => `${servers.get(mode).webUrl}/b/${mapId}`;

module.exports = {
  fetchUser,
  bestScores,
  recentScores,
  beatmapScores: privateBeatmapScores,
  userUrl,
  mapUrl,

  // Exportado para o teste: é a normalização que já derrubou uma página
  // inteira por causa do formato de um campo.
  parsePlayTime,

  // Específicos deste tipo de servidor, usados pelos comandos administrativos.
  enrichScores,
  resolvePlayerId,
  getServerPlayerRaw,
  getServerPlayerStats,
  getServerProfilePage,
  getServerMap,
  getServerMapsBySet,
};
