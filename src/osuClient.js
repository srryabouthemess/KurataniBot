/**
 * osuClient.js
 * A porta única para dados de osu!, seja de qual servidor for.
 *
 * O `mode` que circula aqui é a chave de um servidor do registro (servers.js).
 * Cada **tipo** de servidor tem um adaptador em `osu/`, todos com o mesmo
 * contrato:
 *
 *   fetchUser(username, mode)          → usuário normalizado, ou null
 *   bestScores(userId, limit, mode)    → scores crus, do melhor para o pior
 *   recentScores(userId, limit, mode)  → scores crus, do mais recente
 *   beatmapScores(userId, mapId, mode) → scores do jogador num mapa
 *   userUrl(userId, mode)              → link do perfil
 *   mapUrl(mapId, setId, mode)         → link do mapa
 *
 * Antes, seis funções decidiam por `if (isOfficial)` — um tipo novo de servidor
 * obrigaria a editar todas elas. Agora a escolha acontece num lugar só
 * (`apiFor`), e suportar outro tipo é escrever um adaptador e apontar o
 * registro para ele.
 *
 * O que não está aqui: cálculo de PP e download dos `.osu` (pp.js), tradução de
 * mods (mods.js). Ambos reexportados no fim, para quem chama continuar pedindo
 * tudo ao osuClient.
 */

require('dotenv').config();
const beatmapCache = require('./beatmapCache');
const servers = require('./servers');
const pp = require('./pp');
const officialApi = require('./osu/officialApi');
const banchoPyApi = require('./osu/banchoPyApi');
const rippleApi = require('./osu/rippleApi');
const { dedupe } = require('./inflight');
const { parseModsString } = require('./mods');
const { idSegment } = require('./urlSafe');
const { TtlCache } = require('./ttlCache');
const { logErrorOnce } = require('./logger');
const { mapLimit } = require('./concurrency');
const metrics = require('./metrics');

const DEFAULT_MODE = servers.defaultKey();

// A chave do primeiro servidor privado. É o padrão de quem consulta um servidor
// sem dizer qual — hoje só os comandos administrativos, que são de uma
// instância só.
const PRIVATE_MODE = servers.resolveKey('private') ?? DEFAULT_MODE;

/** Adaptadores por tipo de servidor, como o registro os nomeia. */
const ADAPTERS = {
  official: officialApi,
  banchopy: banchoPyApi,
  ripple:   rippleApi,
};

/**
 * O adaptador daquele servidor.
 *
 * Tipo desconhecido só acontece se o registro ganhar um `kind` novo sem o
 * adaptador correspondente — falha alto, em vez de cair no oficial em silêncio
 * e devolver o perfil errado.
 */
function apiFor(mode) {
  const { kind } = servers.get(mode);
  const api = ADAPTERS[kind];
  if (!api) throw new Error(`sem adaptador para servidores do tipo "${kind}"`);
  return api;
}

// ─── Beatmaps (sempre da API oficial) ─────────────────────────────────────────
// Metadados e arquivo `.osu` vêm do osu! oficial mesmo para score de servidor
// privado: lá o mapa é público e não exige autenticação para consulta
// individual, e o servidor privado não devolve estrelas nem combo máximo.

/**
 * Mapas que a API oficial não conhece.
 *
 * Sem isto, um mapa exclusivo de servidor privado (ou apagado do osu!) era
 * pedido DE NOVO a cada renderização: o `precisaEnriquecer` continua verdadeiro
 * para aquele score para sempre, então cada página gastava balde do rate
 * limiter para receber o mesmo 404. O TTL é curto porque a resposta pode mudar
 * — mapa novo aparece no osu! depois de submetido.
 */
const MISSING_TTL_MS = 10 * 60_000;
const MISSING_MAX    = 500;
const _missingBeatmaps = new TtlCache({ ttlMs: MISSING_TTL_MS, max: MISSING_MAX });

/**
 * Metadados de um beatmap, do cache quando possível.
 * O dedupe compartilha a requisição com quem pedir o mesmo mapa enquanto ela
 * está em voo (ver inflight.js).
 */
async function fetchBeatmap(id) {
  const cached = beatmapCache.get(id);
  if (cached) return cached;

  if (_missingBeatmaps.has(id)) {
    metrics.count('cacheNegativo.beatmap.evitou');
    return null;
  }

  return dedupe(`meta:${id}`, async () => {
    try {
      const data = await officialApi.officialGet(`/beatmaps/${idSegment(id)}`);
      beatmapCache.set(id, data);
      return data;
    } catch (error) {
      // SÓ o 404 vira cache negativo. Um 5xx ou uma queda de rede são
      // passageiros, e guardá-los faria um blip de dez segundos esconder o mapa
      // por dez minutos — trocando uma falha visível por dados faltando no
      // embed, que é bem pior de diagnosticar.
      if (error?.response?.status === 404) _missingBeatmaps.set(id, true);
      else logErrorOnce('osuClient:beatmap', error);

      return null;
    }
  });
}

// Teto de requisições simultâneas por chamada — evita que uma página inteira de
// /topplays vire uma rajada e estoure o rate limit.
const BEATMAP_CONCURRENCY = 5;

/**
 * Preenche `max_combo` e `difficulty_rating` nos scores que vieram sem eles.
 *
 * A condição olha os DOIS campos, e não só o combo. Servidor que manda um e
 * não o outro existe: o Ripple devolve `max_combo` no score e nenhuma estrela,
 * então testar só o combo pulava o enriquecimento e deixava a dificuldade em
 * zero — o embed saía com "?★" onde deveria estar o número.
 */
function precisaEnriquecer(score) {
  return !score.beatmap?.max_combo || !score.beatmap?.difficulty_rating;
}

async function enrichBeatmapData(scores) {
  const idsNeeded = [...new Set(
    scores
      .filter(precisaEnriquecer)
      .map(score => score.beatmap?.id)
      .filter(Boolean),
  )];

  // Piscina de posições, e não lotes: um lote só termina quando o mapa MAIS
  // LENTO dele termina, então quatro mapas rápidos ficavam parados esperando o
  // quinto antes de o lote seguinte começar (ver concurrency.js).
  const results = await mapLimit(idsNeeded, BEATMAP_CONCURRENCY, fetchBeatmap);

  const fetched = {};
  idsNeeded.forEach((id, index) => { fetched[id] = results[index]; });

  return scores.map(score => {
    if (!precisaEnriquecer(score)) return score;

    const bm = fetched[score.beatmap?.id];
    if (!bm) return score;

    return {
      ...score,
      beatmap: {
        ...score.beatmap,
        max_combo:         bm.max_combo ?? score.beatmap.max_combo,
        difficulty_rating: bm.difficulty_rating ?? score.beatmap.difficulty_rating,
      },
      beatmapset: {
        ...score.beatmapset,
        title:  bm.beatmapset?.title ?? score.beatmapset.title,
        artist: bm.beatmapset?.artist ?? score.beatmapset.artist,
      },
    };
  });
}

/** Completa o score com os metadados do mapa, preferindo os da API oficial. */
function mergeBeatmapInfo(score, beatmapId, bm) {
  const covers = bm?.beatmapset?.covers ?? score.beatmapset?.covers ?? {};

  return {
    ...score,
    beatmap: {
      ...(score.beatmap ?? {}),
      id:                beatmapId,
      version:           bm?.version ?? score.beatmap?.version ?? '?',
      max_combo:         bm?.max_combo ?? score.beatmap?.max_combo ?? null,
      difficulty_rating: bm?.difficulty_rating ?? score.beatmap?.difficulty_rating ?? 0,
    },
    beatmapset: {
      ...(score.beatmapset ?? {}),
      id:     bm?.beatmapset_id ?? score.beatmapset?.id ?? null,
      title:  bm?.beatmapset?.title ?? score.beatmapset?.title ?? '???',
      artist: bm?.beatmapset?.artist ?? score.beatmapset?.artist ?? '',
      covers,
    },
  };
}

/** Extrai o ID numérico de um beatmap a partir de um link ou de um ID puro. */
function parseBeatmapId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  // .../beatmapsets/123#osu/456 → 456    |    .../b/456 e .../beatmaps/456 → 456
  const hashMatch = trimmed.match(/#\w+\/(\d+)/);
  if (hashMatch) return Number(hashMatch[1]);

  const pathMatch = trimmed.match(/\/(?:b|beatmaps)\/(\d+)/);
  return pathMatch ? Number(pathMatch[1]) : null;
}

// ─── Cache de usuário ─────────────────────────────────────────────────────────
/**
 * TTL curto e em memória. O ganho está em rajadas — a mesma pessoa rodando
 * /profile e depois /topplays, ou várias consultando o mesmo jogador conhecido.
 * O BathBot usa 10 min (Redis); aqui 60s, porque exibir PP desatualizado logo
 * depois de uma play nova confunde mais do que a requisição economizada.
 */
const USER_CACHE_TTL_MS = 60_000;
const USER_CACHE_MAX    = 500;
const _userCache = new TtlCache({ ttlMs: USER_CACHE_TTL_MS, max: USER_CACHE_MAX });

/**
 * Chave do cache, com nome e ID apontando para lugares distintos de propósito.
 *
 * O mesmo usuário chega das duas formas: o `userLink` manda o `osu_id` quando o
 * link tem (sobrevive a troca de nick), e quem digita o comando manda o nome.
 * Numerando a chave com `#`, uma consulta aquece a outra — antes o `#id` era
 * escrito e **nunca lido**, porque a leitura montava a chave só pelo texto: o
 * cache carregava o dobro de entradas sem um acerto sequer.
 */
function _userCacheKey(mode, value) {
  const raw = String(value);
  return /^\d+$/.test(raw) ? `${mode}:#${raw}` : `${mode}:${raw.toLowerCase()}`;
}

// ─── Consulta ─────────────────────────────────────────────────────────────────

async function getUser(username, mode = DEFAULT_MODE) {
  const cacheKey = _userCacheKey(mode, username);
  const cached = _userCache.get(cacheKey);
  metrics.cache('usuario', Boolean(cached));
  if (cached) return cached;

  const user = await apiFor(mode).fetchUser(username, mode);
  if (user) {
    _userCache.set(cacheKey, user);
    // Indexa também pelo ID: quem consultou pelo nome aquece a entrada de quem
    // vier pelo link, e vice-versa. Quando a consulta já foi por ID, as duas
    // chaves coincidem e a segunda escrita só renova a mesma entrada.
    _userCache.set(_userCacheKey(mode, user.id), user);
  }
  return user;
}

/**
 * Scores crus, sem enriquecer: quem chama enriquece só a página que vai exibir.
 * Enriquecer as 100 buscadas de uma vez seria uma rajada de requisições.
 */
const getBestScores = (userId, limit = 10, mode = DEFAULT_MODE) =>
  apiFor(mode).bestScores(userId, limit, mode);

const getRecentScores = (userId, limit = 1, mode = DEFAULT_MODE) =>
  apiFor(mode).recentScores(userId, limit, mode);

/**
 * Todos os scores que o jogador tem num mapa — o que o /score exibe.
 *
 * Devolve um score por combinação de mods (é assim que os servidores guardam),
 * do maior pp para o menor.
 */
async function getUserBeatmapScores(userId, beatmapId, mode = DEFAULT_MODE) {
  const scores = await apiFor(mode).beatmapScores(userId, beatmapId, mode);

  // Nenhum dos endpoints devolve os metadados do mapa junto do score. Sem
  // preencher aqui, o getFCpp não teria como saber se o score foi choke e o
  // embed sairia sem capa nem título.
  const bm = await fetchBeatmap(beatmapId);
  const withMap = scores.map(score => mergeBeatmapInfo(score, beatmapId, bm));

  // pp nulo (score de lazer que a API não pontuou, mapa unranked) vai para o
  // fim, em vez de virar 0 e passar na frente de quem pontuou.
  return withMap.sort((a, b) => (b.pp ?? -1) - (a.pp ?? -1));
}

/**
 * Completa scores crus com os detalhes que só uma segunda chamada traz.
 *
 * Nem todo servidor precisa: quem já devolve o score completo na primeira
 * resposta passa direto. A decisão mora aqui de propósito — antes cada comando
 * escrevia `isOfficial(mode) ? página : await enrichScores(página)`, espalhando
 * por quatro arquivos o conhecimento de qual servidor precisa de quê.
 *
 * ATENÇÃO ao que esta função NÃO pode voltar a ser: um `if (isOfficial)`. Ela
 * já foi isso, e dividia o mundo em "oficial" e "bancho.py" — o que era verdade
 * enquanto existiam só dois tipos. Com o adaptador Ripple, todo score do
 * Akatsuki era mandado para o enriquecedor do bancho.py, que consultava uma API
 * inexistente e devolvia os campos zerados: o /profile mostrava o pp certo com
 * `rank F`, `0.00%` de acurácia e o nome do mapa como `[?]`.
 *
 * Agora é o próprio adaptador que diz se precisa, pelo mesmo despacho do resto.
 */
const enrichScores = (scores, mode = DEFAULT_MODE) => {
  const api = apiFor(mode);
  return typeof api.enrichScores === 'function' ? api.enrichScores(scores, mode) : scores;
};

const getUserUrl = (userId, mode = DEFAULT_MODE) => apiFor(mode).userUrl(userId, mode);
const getMapUrl  = (mapId, setId, mode = DEFAULT_MODE) => apiFor(mode).mapUrl(mapId, setId, mode);
const getModeLabel = (mode = DEFAULT_MODE) => servers.label(mode);

module.exports = {
  // Consulta, com o adaptador escolhido pelo tipo do servidor
  getUser,
  getBestScores,
  getRecentScores,
  getUserBeatmapScores,
  getBeatmap: fetchBeatmap,
  enrichBeatmapData,
  enrichScores,

  // Endereços e rótulos
  getUserUrl,
  getMapUrl,
  getModeLabel,
  parseBeatmapId,
  DEFAULT_MODE,
  PRIVATE_MODE,

  // Só bancho.py: leitura crua para os comandos de staff.
  resolvePlayerId:    banchoPyApi.resolvePlayerId,
  getServerPlayerRaw: banchoPyApi.getServerPlayerRaw,
  getServerPlayerStats: banchoPyApi.getServerPlayerStats,
  getServerProfilePage: banchoPyApi.getServerProfilePage,
  getServerMap:       banchoPyApi.getServerMap,
  getServerMapsBySet: banchoPyApi.getServerMapsBySet,

  // Contraparte oficial do anterior, para mapa que o servidor administrado
  // ainda não conhece — ver resolveSet em commands/nominate.js.
  getOfficialMapsBySet: officialApi.officialBeatmapset,

  // De mods.js e pp.js: quem chama continua pedindo tudo aqui, em vez de
  // precisar saber em qual módulo cada peça foi parar.
  parseModsString,
  getAdjustedStars:   pp.getAdjustedStars,
  getFCpp:            pp.getFCpp,
  simulatePP:         pp.simulatePP,
  getBeatmapFile:     pp.getBeatmapFile,
  getDifficultyAttrs: pp.getDifficultyAttrs,
  getMapAttrs:        pp.getMapAttrs,
};
