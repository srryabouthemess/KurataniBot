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
 *   leaderboard(mode, opts)            → ranking de pp, do primeiro para baixo
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

const beatmapCache = require('./beatmapCache');
const servers = require('./servers');
const pp = require('./pp');
const officialApi = require('./osu/officialApi');
const banchoPyApi = require('./osu/banchoPyApi');
const rippleApi = require('./osu/rippleApi');
const gatariApi = require('./osu/gatariApi');
const { dedupe } = require('./lib/inflight');
const { parseModsString, parseModTokens } = require('./mods');
const { idSegment } = require('./lib/urlSafe');
const { TtlCache } = require('./lib/ttlCache');
const { logErrorOnce } = require('./lib/logger');
const { criarLote } = require('./lib/batch');
const metrics = require('./lib/metrics');
const scoreStore = require('./scoreStore');

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
  gatari:   gatariApi,
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
 * Metadados de vários mapas numa requisição só, pelo `GET /beatmaps?ids[]=`.
 *
 * O teto de 50 é o da API: o osu-web corta a lista em 50 e ignora o resto em
 * silêncio. O objeto de cada mapa é o MESMO do `GET /beatmaps/{id}` — os dois
 * endpoints usam o mesmo transformer com os mesmos includes (`beatmapset`,
 * `max_combo`...), conferido no BeatmapsController do osu-web.
 *
 * O axios serializa o array como `ids[]=1&ids[]=2` (com os colchetes
 * escapados), que é a forma que o PHP lê como lista.
 */
const BEATMAP_BATCH_MAX = 50;

const carregarMeta = criarLote({
  max: BEATMAP_BATCH_MAX,
  buscar: async ids => {
    const { beatmaps = [] } = await officialApi.officialGet('/beatmaps', { params: { ids } });
    return new Map(beatmaps.map(bm => [bm.id, bm]));
  },
});

/**
 * Metadados de um beatmap, do cache quando possível.
 *
 * O pedido entra no lote (ver `carregarMeta`), e o dedupe compartilha a espera
 * com quem pedir o mesmo mapa enquanto ele está em voo (ver inflight.js).
 *
 * Mapa custom do Daycore não é pedido: a API oficial não o conhece, e a
 * resposta seria sempre "não existe". Antes ele ia, voltava 404 e caía no cache
 * negativo — o mesmo `null`, pago com uma requisição e uma vaga no lote.
 */
async function fetchBeatmap(id) {
  if (isCustomMapId(id)) return null;

  const cached = beatmapCache.get(id);
  if (cached) return cached;

  if (_missingBeatmaps.has(id)) {
    metrics.count('cacheNegativo.beatmap.evitou');
    return null;
  }

  return dedupe(`meta:${id}`, async () => {
    try {
      const data = await carregarMeta(Number(idSegment(id)));

      // O lote não devolve 404: mapa que não veio na resposta é o mapa que a
      // API não conhece, e vira cache negativo como o 404 virava.
      if (data) beatmapCache.set(id, data);
      else _missingBeatmaps.set(id, true);
      return data;
    } catch (error) {
      // Erro da REQUISIÇÃO (5xx, rede) não vira cache negativo. É passageiro,
      // e guardá-lo faria um blip de dez segundos esconder o mapa por dez
      // minutos — trocando uma falha visível por dados faltando no embed, que é
      // bem pior de diagnosticar. Um 404 do próprio endpoint em lote cai aqui
      // também: ele diria que a rota sumiu, não que o mapa não existe.
      logErrorOnce('osuClient:beatmap', error);
      return null;
    }
  });
}

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

/**
 * Começa a baixar o `.osu` dos mapas cujos metadados vão à rede.
 *
 * Sem isto a página de um mapa frio pagava duas idas e voltas em fila: o
 * `/beatmaps` e, só depois dele, o `.osu` que o cálculo de pp pede à thread. Uma
 * não depende da outra, e o Bathbot dispara as duas juntas (`try_join!` em
 * manager/osu_map.rs). O `dedupe` do beatmapFile.js faz a thread, quando pedir
 * os bytes, pegar este mesmo download em voo.
 *
 * Só para o que vai mesmo à rede: com o metadado guardado não há espera para
 * sobrepor. Falha aqui não é dita a ninguém — o pedido de verdade, se vier,
 * tenta de novo e loga.
 */
function aquecerArquivos(ids) {
  for (const id of ids) {
    if (isCustomMapId(id) || beatmapCache.get(id) || _missingBeatmaps.has(id)) continue;
    pp.getBeatmapFile(id).catch(() => {});
  }
}

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.aquecerArquivos] baixa o `.osu` dos mapas frios junto
 *   dos metadados (ver aquecerArquivos). É de quem renderiza UMA página: no
 *   enriquecimento das 100 plays do /nochoke e do /topif, pediria 100 arquivos
 *   ao balde de 4/s, inclusive de play FC, que nem chega a calcular.
 */
async function enrichBeatmapData(scores, { aquecerArquivos: aquecer = false } = {}) {
  // Antes de tudo: um mapa reenviado perde arquivo e metadados aqui, e o resto
  // desta função os busca de novo como mapa frio (ver conferirChecksum).
  await Promise.all(scores.map(score =>
    pp.conferirChecksum(score.beatmap?.id, score.beatmap?.checksum ?? score.map_md5)));

  const idsNeeded = [...new Set(
    scores
      .filter(precisaEnriquecer)
      .map(score => score.beatmap?.id)
      .filter(Boolean),
  )];

  if (aquecer) aquecerArquivos(idsNeeded);

  // Todos de uma vez, e não pelo mapLimit de antes: é o lote que agrupa (ver
  // carregarMeta), e ele só junta o que foi pedido na mesma janela. Com um teto
  // de 5 em voo, cada requisição sairia com 5 ids. A vazão continua segura: 100
  // mapas frios são 2 requisições, e elas passam pelo rate limiter.
  const results = await Promise.all(idsNeeded.map(fetchBeatmap));

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

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.fresh] ignora o que está guardado e busca de novo — é o
 *   que o botão 🔄 usa. A resposta nova continua sendo GRAVADA no cache: quem
 *   pediu para atualizar renova o dado dos comandos seguintes também.
 */
async function getUser(username, mode = DEFAULT_MODE, { fresh = false } = {}) {
  const cacheKey = _userCacheKey(mode, username);
  const cached = fresh ? null : _userCache.get(cacheKey);
  if (!fresh) metrics.cache('usuario', Boolean(cached));
  if (cached) return cached;

  const user = await apiFor(mode).fetchUser(username, mode);
  if (user) {
    _userCache.set(cacheKey, user);
    // Indexa também pelo ID: quem consultou pelo nome aquece a entrada de quem
    // vier pelo link, e vice-versa. Quando a consulta já foi por ID, as duas
    // chaves coincidem e a segunda escrita só renova a mesma entrada.
    _userCache.set(_userCacheKey(mode, user.id), user);
    // Refresh por ID (é como o 🔄 busca): sem renovar também a chave do NOME, quem
    // consultasse o mesmo jogador pelo nome logo depois veria o pp de antes.
    // Nick só de dígitos ficaria de fora: a chave dele seria a de um ID, e
    // sobrescreveria a entrada de outra pessoa.
    if (fresh && user.username && !/^\d+$/.test(user.username)) {
      _userCache.set(_userCacheKey(mode, user.username), user);
    }
  }
  return user;
}

// ─── Guardar o que passou por aqui ────────────────────────────────────────────
/**
 * Entrega ao scoreStore os scores que acabaram de vir da rede.
 *
 * Só registra: normalizar e gravar acontecem depois da resposta (ver
 * scoreStore.js), e nada aqui espera nem lança. Score servido do cache não
 * passa por aqui — já passou quando foi buscado.
 *
 * O nick vem do cache de usuário, que o comando quase sempre aqueceu antes
 * (é o `getUser` que resolve o jogador). Sem ele, fica para o próximo.
 */
function guardar(scores, mode, userId, adaptar) {
  const username = userId === undefined || userId === null
    ? null
    : _userCache.get(_userCacheKey(mode, userId))?.username ?? null;
  scoreStore.record(scores, { server: mode, userId, username, adaptar });
}

// ─── Cache de top plays ───────────────────────────────────────────────────────
/**
 * A lista de melhores plays, do cache quando possível.
 *
 * Quatro comandos pedem a mesma coisa — /topplays, /whatif e /pp buscam as 100,
 * o /profile busca a primeira —, e ela não era guardada em lugar nenhum. Olhar o
 * próprio perfil costuma ser exatamente essa sequência, e cada comando pagava
 * 375ms (Bancho) ou 194–262ms (Daycore) pela lista que o anterior acabou de
 * buscar.
 *
 * **O mesmo TTL do cache de usuário, e isso não é coincidência.** Os dois
 * aparecem no mesmo embed: o pp do jogador na linha do autor sai do `getUser`, e
 * a lista logo abaixo sai daqui. Com prazos diferentes, dava para ver um pp já
 * atualizado sobre uma lista velha — o par ficaria contando duas histórias. Com
 * o mesmo prazo, ou os dois estão frescos ou os dois estão velhos.
 *
 * O preço é esse mesmo: uma top play nova pode demorar até um minuto para
 * aparecer. É o mesmo preço que o perfil já cobra, pela mesma razão.
 *
 * A chave inclui o LIMITE. O /profile pede 1 e o /topplays pede 100; servir a
 * lista curta para quem pediu a longa cortaria 99 plays em silêncio, e o
 * /whatif responderia com uma conta feita sobre uma play só.
 *
 * A lista é entregue por referência, e não copiada: conferido que nenhum
 * chamador ordena no lugar — os quatro fazem `[...plays].sort()` ou `slice()`.
 */
const BEST_TTL_MS = USER_CACHE_TTL_MS;
const BEST_MAX    = 300;
const _bestCache = new TtlCache({ ttlMs: BEST_TTL_MS, max: BEST_MAX });

/**
 * `fresh` pula a leitura do cache e grava o resultado (ver `getUser`). O refresh
 * do /topplays e do /profile precisa dele: sem, o botão 🔄 devolveria a lista de
 * até um minuto atrás — justamente a que a pessoa quer ver trocada.
 */
async function getBestScores(userId, limit = 10, mode = DEFAULT_MODE, { fresh = false } = {}) {
  const chave = `${mode}:${userId}:${limit}`;

  const guardado = fresh ? null : _bestCache.get(chave);
  if (!fresh) metrics.cache('topPlays', Boolean(guardado));
  if (guardado) return guardado;

  const api = apiFor(mode);
  const scores = await api.bestScores(userId, limit, mode);
  // Falha não chega aqui: ela sobe para quem chamou, e nada é guardado.
  _bestCache.set(chave, scores);
  guardar(scores, mode, userId, api.paraGuardar);
  return scores;
}

/**
 * As plays recentes, SEM cache — e é o único lugar onde isso é decisão, não
 * esquecimento.
 *
 * Aqui a resposta certa é sempre a mais nova: quem acabou de jogar e roda `k!rs`
 * está perguntando justamente pelo que um cache de um minuto esconderia. O
 * comando existe para responder "o que eu acabei de fazer", e um valor guardado
 * responderia "o que você fez antes".
 *
 * Scores crus, sem enriquecer: quem chama enriquece só a página que vai exibir.
 * Enriquecer as 50 buscadas de uma vez seria uma rajada de requisições.
 */
async function getRecentScores(userId, limit = 1, mode = DEFAULT_MODE) {
  const api = apiFor(mode);
  const scores = await api.recentScores(userId, limit, mode);
  // As que não passaram ficam de fora no próprio store (ver scoreStore.linhaDe).
  guardar(scores, mode, userId, api.paraGuardar);
  return scores;
}

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
  // Aqui todo adaptador já devolve normalizado: nada a adaptar.
  guardar(withMap, mode, userId);

  // pp nulo (score de lazer que a API não pontuou, mapa unranked) vai para o
  // fim, em vez de virar 0 e passar na frente de quem pontuou.
  return withMap.sort((a, b) => (b.pp ?? -1) - (a.pp ?? -1));
}

// ─── Ranking do servidor ──────────────────────────────────────────────────────
/**
 * O ranking de pp daquele servidor, do primeiro colocado para baixo.
 *
 * Cada entrada é `{ id, username, country, pp, accuracy, playCount }` — o
 * suficiente para uma linha de lista, e nada além. Não é um usuário
 * normalizado de propósito: nenhum dos três endpoints manda data de criação,
 * última visita ou nível, e devolver a forma de usuário com metade dos campos
 * nulos convidaria a lê-los.
 *
 * ATENÇÃO à acurácia: aqui ela vai de 0 a 100, como o `hit_accuracy` do perfil
 * — e ao contrário da acurácia de um score, que circula de 0 a 1 no resto do
 * bot.
 *
 * ── Por que o cache é mais longo que o de perfil ──────────────────────────────
 * O de usuário e o de top plays são um minuto porque aparecem no MESMO embed:
 * o pp da linha do autor e a lista logo abaixo teriam de envelhecer juntos. Um
 * ranking não tem esse par — ele é a foto do servidor inteiro, e quem o abre
 * não está conferindo o número de ninguém em particular.
 *
 * Cinco minutos é o preço de a lista não refletir uma play feita agora, e o que
 * ele compra é o comando repetido no canal (que é como um ranking costuma ser
 * consultado) não pagar rede nenhuma. A navegação entre páginas já não paga:
 * quem chama busca a lista inteira de uma vez e pagina em memória.
 *
 * O do osu! oficial fica meia hora, como no Bathbot. Lá uma play quase nunca
 * mexe na lista, e é o host em que os termos da API pedem no máximo 60
 * requisições por minuto. Nos servidores privados continua em cinco: num
 * servidor pequeno uma play muda o ranking, e quem joga confere logo depois.
 *
 * A chave inclui o LIMITE e o PAÍS. Sem eles, um `/leaderboard country:BR`
 * serviria a lista global guardada momentos antes.
 */
const RANKING_TTL_MS          = 5 * 60_000;
const RANKING_OFICIAL_TTL_MS  = 30 * 60_000;
const RANKING_MAX             = 60;
const _rankingCache        = new TtlCache({ ttlMs: RANKING_TTL_MS, max: RANKING_MAX });
const _rankingOficialCache = new TtlCache({ ttlMs: RANKING_OFICIAL_TTL_MS, max: RANKING_MAX });

async function getLeaderboard(mode = DEFAULT_MODE, { limit = 50, country = null } = {}) {
  const pais  = country ? String(country).toUpperCase() : null;
  const chave = `${mode}:${limit}:${pais ?? ''}`;
  const cache = servers.isOfficial(mode) ? _rankingOficialCache : _rankingCache;

  const guardado = cache.get(chave);
  metrics.cache('ranking', Boolean(guardado));
  if (guardado) return guardado;

  const entradas = await apiFor(mode).leaderboard(mode, { limit, country: pais });
  // Falha não chega aqui: ela sobe para quem chamou, e nada é guardado.
  cache.set(chave, entradas);
  return entradas;
}

// ─── Melhores scores do servidor ──────────────────────────────────────────────
/**
 * Se aquele servidor sabe responder "quais são as melhores plays daqui".
 *
 * Só o bancho.py sabe, e a diferença não é de implementação: o osu! oficial não
 * tem endpoint disso (testados `top-plays`, `top_plays`, `topplays`,
 * `top-scores`, `scores` e `plays` como tipo de ranking — todos respondem
 * `invalid type specified`; a página do site é HTML renderizado no servidor), e
 * o Ripple exige um mapa (`422 Missing parameters: md5|b`).
 *
 * O despacho é o mesmo do `enrichScores`: o adaptador que sabe expõe o método,
 * e quem chama pergunta antes em vez de tentar e tratar exceção.
 */
const supportsTopScores = (mode = DEFAULT_MODE) => typeof apiFor(mode).topScores === 'function';

/**
 * Se aquele servidor tem "grupos" de jogador — os selos que o front-end mostra
 * embaixo do nick (❌ Closet Cheating, 🗿 Blatant Cheating, ✅ Legit, ✍ Nominator...).
 *
 * Também é coisa só de bancho.py com Shiina-Web: não existe no osu! oficial nem
 * no Ripple, e mesmo entre bancho.py depende do front-end. Quem não tem devolve
 * lista vazia por este mesmo despacho, e quem exibe simplesmente não desenha
 * nada — nenhum comando precisa saber de qual servidor está falando.
 *
 * O "mesmo entre bancho.py" acima é o motivo do segundo teste. Perguntar só se
 * o método existe responde pelo TIPO do servidor, e isso bastava enquanto todo
 * bancho.py rodava Shiina-Web; com o EZPP Farm deixou de bastar, e a resposta
 * passou a depender do servidor. Adaptador que sabe distinguir diz como.
 */
const supportsPlayerGroups = (mode = DEFAULT_MODE) => {
  const api = apiFor(mode);
  if (typeof api.playerGroups !== 'function') return false;
  return typeof api.hasPlayerGroups === 'function' ? api.hasPlayerGroups(mode) : true;
};

/**
 * Os grupos daquele jogador, ou lista vazia se o servidor não tiver o conceito.
 * @returns {Promise<Array<{emoji: string, name: string}>>}
 */
async function getPlayerGroups(playerId, mode = DEFAULT_MODE) {
  const api = apiFor(mode);
  return typeof api.playerGroups === 'function' ? api.playerGroups(playerId, mode) : [];
}

/**
 * As melhores plays do servidor, do cache quando possível.
 *
 * Mesmo prazo do ranking de jogadores, pela mesma razão: é a foto do servidor
 * inteiro, não os números de alguém. E aqui o cache pesa mais, porque a busca é
 * uma varredura de páginas (ver topScores no adaptador) em vez de uma consulta.
 *
 * A lista vem INTEIRA e ordenada, sem corte: quem chama filtra (por grupo, por
 * exemplo) e só então corta, senão o corte come as posições que sobrariam.
 *
 * @returns {Promise<{scores: Array, completo: boolean}>} `completo: false`
 *   quando a varredura estourou o teto — aí a lista não é confiável e vem vazia.
 */
const _topScoresCache = new TtlCache({ ttlMs: RANKING_TTL_MS, max: RANKING_MAX });

async function getTopScores(mode = DEFAULT_MODE) {
  const api = apiFor(mode);
  if (typeof api.topScores !== 'function') {
    throw new Error(`servidores do tipo "${servers.get(mode).kind}" não expõem os melhores scores`);
  }

  const guardado = _topScoresCache.get(mode);
  metrics.cache('topScoresServidor', Boolean(guardado));
  if (guardado) return guardado;

  const resultado = await api.topScores(mode);
  // A varredura incompleta também é guardada: repetir o comando não vai fazer o
  // servidor encolher, e sem isso cada tentativa refaria as 30 requisições.
  _topScoresCache.set(mode, resultado);
  // Cada linha tem o próprio dono (`userid`), então não há userId de contexto.
  // `varredura` conta à parte no store: são os mesmos scores a cada rodada.
  scoreStore.record(resultado.scores, { server: mode, adaptar: api.topParaGuardar, varredura: true });
  return resultado;
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
/**
 * Onde começam os ids de mapa custom do Daycore (`CUSTOM_ID_BASE` do
 * custom-maps). Abaixo disso o id é de um mapa que existe no osu! oficial.
 */
const CUSTOM_MAP_ID_BASE = 100_000_000;

const isCustomMapId = (id) => Number(id) >= CUSTOM_MAP_ID_BASE;

/**
 * O link do mapa sempre aponta para o osu.ppy.sh, seja qual for o servidor
 * da play: a página oficial tem leaderboard, download e discussão, e a do
 * servidor privado nem sempre tem.
 *
 * A exceção é o mapa custom, que o oficial não conhece. Lá ele daria 404,
 * então o link continua no servidor de onde a play veio.
 */
const getMapUrl = (mapId, setId, mode = DEFAULT_MODE) => {
  const numerico = (v) => /^\d+$/.test(String(v ?? ''));
  // Sem id que preste não há como saber se o mapa é custom: fica o link de
  // sempre, do servidor da play.
  if (!numerico(mapId) || isCustomMapId(mapId)) return apiFor(mode).mapUrl(mapId, setId, mode);

  const oficial = servers.get('official').webUrl;
  return numerico(setId)
    ? `${oficial}/beatmapsets/${setId}#osu/${mapId}`
    : `${oficial}/b/${mapId}`;
};
const getModeLabel = (mode = DEFAULT_MODE) => servers.label(mode);

module.exports = {
  // Consulta, com o adaptador escolhido pelo tipo do servidor
  getUser,
  getBestScores,
  getRecentScores,
  getUserBeatmapScores,
  getLeaderboard,
  getTopScores,
  supportsTopScores,
  getPlayerGroups,
  supportsPlayerGroups,
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

  // Só bancho.py: leitura crua para os comandos de staff, mais as três peças
  // que o /topscores precisa para transformar uma linha da tabela de scores em
  // play exibível (o mapa vem por hash, o jogador por id).
  getServerMapByMd5:    banchoPyApi.getServerMapByMd5,
  getServerPlayerName:  banchoPyApi.getServerPlayerName,
  normalizeServerScore: banchoPyApi.normalizeServerScore,
  resolvePlayerId:    banchoPyApi.resolvePlayerId,
  getServerPlayerRaw: banchoPyApi.getServerPlayerRaw,
  getServerPlayerStats: banchoPyApi.getServerPlayerStats,
  getServerScore:     banchoPyApi.getServerScore,
  getServerPlayerScores: banchoPyApi.getServerPlayerScores,
  getServerPlayerMapScores: banchoPyApi.getServerPlayerMapScores,
  getServerProfilePage: banchoPyApi.getServerProfilePage,
  getServerMap:       banchoPyApi.getServerMap,
  getServerMapsBySet: banchoPyApi.getServerMapsBySet,

  // Contraparte oficial do anterior, para mapa que o servidor administrado
  // ainda não conhece — ver resolveSet em commands/admin/nominate.js.
  getOfficialMapsBySet: officialApi.officialBeatmapset,

  // De mods.js e pp.js: quem chama continua pedindo tudo aqui, em vez de
  // precisar saber em qual módulo cada peça foi parar.
  parseModsString,
  // Quem CALCULA em cima dos mods digitados usa este, e não o tolerante: ver o
  // /simulate e o /map.
  parseModTokens,
  getAdjustedStars:   pp.getAdjustedStars,
  getFCpp:            pp.getFCpp,
  simulatePP:         pp.simulatePP,
  getBeatmapFile:     pp.getBeatmapFile,
  getDifficultyAttrs: pp.getDifficultyAttrs,
  getMapAttrs:        pp.getMapAttrs,
};
