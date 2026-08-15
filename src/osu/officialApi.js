/**
 * osu/officialApi.js
 * Adaptador para o osu! oficial (API v2, OAuth com client credentials).
 *
 * Implementa o mesmo contrato do osu/banchoPyApi.js, para o osuClient escolher
 * um ou outro sem saber a diferença.
 */

const axios = require('axios');
const servers = require('../servers');
const rateLimiter = require('../rateLimiter');
const { urlSegment, idSegment } = require('../urlSafe');
const { withRetry } = require('../retry');

// ─── Token OAuth ──────────────────────────────────────────────────────────────
// `_tokenPromise` guarda a renovação em andamento: sem ela, N requisições que
// encontram o token expirado ao mesmo tempo disparam N POSTs em /oauth/token.
let _token = null;
let _tokenExpiry = 0;
let _tokenPromise = null;

async function getOfficialToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  if (_tokenPromise) return _tokenPromise;

  _tokenPromise = (async () => {
    const res = await withRetry(async () => {
      await rateLimiter.acquire('osuOAuth');
      return axios.post('https://osu.ppy.sh/oauth/token', {
        client_id: process.env.OSU_CLIENT_ID,
        client_secret: process.env.OSU_CLIENT_SECRET,
        grant_type: 'client_credentials',
        scope: 'public',
      }, { timeout: 10000 });
    });
    _token = res.data.access_token;
    _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    return _token;
  })();

  try {
    return await _tokenPromise;
  } finally {
    _tokenPromise = null;
  }
}

// ─── Helpers de requisição ────────────────────────────────────────────────────
// Todos passam pelo rate limiter (rateLimiter.js) antes de sair e têm retry
// com backoff (retry.js). O token é obtido dentro do withRetry para que uma
// tentativa após um 401 pegue um token renovado.
/**
 * Versão do formato de score que pedimos à API.
 *
 * Sem este header, a resposta vem no formato antigo — e ele **omite o mod CL**,
 * que é o único sinal de que o score foi jogado no stable. Sem esse sinal o
 * `shouldUseLazer` (pp.js) escolhia mecânica de lazer para score que não é de
 * lazer, e o rosu-pp então ignora o combo do jogador. Medido contra o pp oficial
 * em scores com combo quebrado: **18,9% de erro médio, que cai para 7,3%** só
 * com o CL chegando aqui.
 *
 * De quebra vêm as estatísticas de lazer (slider ends) para os scores que são de
 * lazer de verdade. O `legacy_score_id` também chega e diz score a score qual é
 * qual, mas o bot não o consome: o CL já responde a mesma pergunta onde ela é
 * feita, e um score de lazer COM o mod CL usa mecânica clássica de qualquer
 * forma — o mod é o sinal certo, o id seria redundante.
 *
 * Conferido que hoje o header não muda nada nos endpoints de usuário e de
 * beatmap — mas ele vai só nas chamadas de SCORE mesmo assim. Fixar uma versão
 * de formato é um contrato: quanto menos endpoints estiverem presos a ela,
 * menos coisa quebra quando o osu-web publicar a próxima.
 */
const SCORE_FORMAT_VERSION = '20240529';

async function officialGet(path, { params = {}, scoreFormat = false } = {}) {
  const res = await withRetry(async () => {
    const token = await getOfficialToken();
    await rateLimiter.acquire('osuApi');
    return axios.get(`https://osu.ppy.sh/api/v2${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(scoreFormat ? { 'x-api-version': SCORE_FORMAT_VERSION } : {}),
      },
      params,
      timeout: 10000,
    });
  });
  return res.data;
}

/** GET num endpoint de score, no formato novo (ver SCORE_FORMAT_VERSION). */
const scoreGet = (path, params = {}) => officialGet(path, { params, scoreFormat: true });

/**
 * Score do formato novo → a forma que o resto do bot já lê.
 *
 * Adaptar na borda, e não espalhar `?? great` por comando: é o mesmo desenho dos
 * adaptadores de bancho.py (ver normalizeScorePrivate). Quem consome continua
 * vendo `count_300`, `created_at` e `mods` como lista de acrônimos.
 *
 * ATENÇÃO ao `statistics` do formato novo: ele é **esparso** — o que vale zero
 * simplesmente não vem. Um FC não traz `miss`, e ler direto daria `undefined`.
 */
function normalizeScore(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  const stats = raw.statistics ?? {};

  return {
    ...raw,
    // O CL vem aqui e é o que decide a mecânica lá no cálculo de PP. Ele não
    // tem bit legado, então o modsToBits o ignora sozinho (ver mods.js).
    mods: (raw.mods ?? []).map(m => (typeof m === 'string' ? m : m.acronym)),

    statistics: {
      ...stats,
      count_300:  stats.great ?? stats.count_300  ?? 0,
      count_100:  stats.ok    ?? stats.count_100  ?? 0,
      count_50:   stats.meh   ?? stats.count_50   ?? 0,
      count_miss: stats.miss  ?? stats.count_miss ?? 0,
    },

    // Campos que mudaram de nome; os antigos seguem valendo para quem lê.
    created_at: raw.ended_at ?? raw.created_at ?? null,
    perfect:    raw.is_perfect_combo ?? raw.legacy_perfect ?? raw.perfect ?? false,
    score:      raw.legacy_total_score || raw.total_score || raw.score || 0,
    mode:       raw.mode ?? 'osu',

  };
}

const normalizeScores = list => (Array.isArray(list) ? list.map(normalizeScore) : []);

/**
 * `/scores/users/{user}/all` devolve todos os scores do jogador no mapa, não
 * só o melhor — que é justamente a diferença para o endpoint sem o `/all`.
 *
 * Jogador sem score responde `{scores: []}`. O 404 é ambíguo e foi medido:
 *
 *   ranked/loved  → 200, lista (vazia quando não há score)
 *   graveyard     → 404 "Specified beatmap difficulty couldn't be found"
 *   inexistente   → 404, a mesma mensagem
 *
 * Ou seja, 404 quer dizer "esse mapa não tem placar" tanto para mapa que não
 * existe quanto para mapa que existe mas nunca foi ranqueado. Deixar a exceção
 * subir fazia o /score responder "erro ao buscar os scores" para qualquer mapa
 * graveyard — enquanto o /recent exibia a play daquele mesmo mapa numa boa.
 *
 * Devolver lista vazia é o certo: quem chama já conferiu que o beatmap existe
 * (o /score busca os metadados antes), então aqui o 404 só pode ser "sem
 * placar", e a resposta vira "fulano não tem score neste mapa".
 */
async function officialBeatmapScores(userId, beatmapId) {
  try {
    const res = await scoreGet(
      `/beatmaps/${idSegment(beatmapId)}/scores/users/${idSegment(userId)}/all`
    );
    return normalizeScores(res?.scores);
  } catch (error) {
    if (error?.response?.status === 404) return [];
    throw error;
  }
}

/**
 * 404 aqui é "esse jogador não existe" — resultado normal de uma busca por um
 * nick errado, não falha de rede.
 *
 * O adaptador bancho.py já devolvia null nesse caso (o `banchoV1Get` aceita
 * 404 e 422 como respostas válidas), e é isso que o contrato do osuClient
 * promete. Enquanto só este lado lançava, o `if (!user)` dos comandos nunca
 * rodava no Bancho: a exceção pulava direto para o catch, e quem errou o nick
 * lia "ocorreu um erro" em vez de "jogador não encontrado".
 */
async function fetchUser(username) {
  try {
    return await officialGet(`/users/${urlSegment(username)}/osu`);
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

/**
 * Todas as dificuldades de um beatmapset.
 *
 * Contraparte de `getServerMapsBySet` para quando o bancho.py ainda não conhece
 * o mapa. O canal `rank` age sobre UMA dificuldade por mensagem, então nomear
 * um set exige a lista de IDs — e o servidor não tem como fornecê-la para um
 * mapa que nunca viu. Aplicar ele aplica: ao receber o publish, o
 * `Beatmap.from_bid` do bancho cai na API oficial e cacheia o set inteiro. O
 * que faltava era só o bot saber quais IDs publicar.
 *
 * Artista, título e criador vivem no SET na resposta oficial, e repetidos em
 * cada dificuldade no formato do bancho.py. Normalizamos para o segundo, que é
 * o que o resto do código já lê.
 *
 * `status` fica de fora de propósito: o status que interessa é o do servidor
 * administrado, e para um mapa que não está lá ele não existe. Preencher com o
 * valor do osu! oficial faria um palpite passar por resposta do servidor.
 */
async function officialBeatmapset(setId) {
  let data;
  try {
    data = await officialGet(`/beatmapsets/${idSegment(setId)}`);
  } catch (error) {
    // Mesmo contrato do fetchUser: 404 é "não existe", não falha de rede.
    if (error?.response?.status === 404) return [];
    throw error;
  }

  const diffs = Array.isArray(data?.beatmaps) ? data.beatmaps : [];
  return diffs.map(diff => ({
    id:      diff.id,
    set_id:  data.id,
    version: diff.version,
    mode:    diff.mode,
    artist:  data.artist,
    title:   data.title,
    creator: data.creator,
  }));
}

// ─── Ranking do servidor ──────────────────────────────────────────────────────

/**
 * Quantos colocados cabem numa resposta de `/rankings`. É fixo na API: não há
 * parâmetro de tamanho, só o número da página.
 */
const RANKING_PAGE = 50;

/**
 * O ranking de pp, do primeiro colocado para baixo.
 *
 * Como a página é fixa em 50, pedir 100 são duas requisições — disparadas
 * juntas, porque uma não depende da outra.
 *
 * ── Por que o `global_rank` de cada item não é normalizado ────────────────────
 * Com `country` ele continua sendo o rank GLOBAL: medido, o #1 do Brasil vem
 * com `global_rank: 51`. Publicá-lo daria uma coluna que não bate com a ordem
 * exibida, e os outros dois adaptadores nem têm o que pôr ali (o bancho.py não
 * devolve rank nenhum). Quem exibe conta a posição na lista, que quer dizer a
 * mesma coisa nos três.
 *
 * País inexistente responde 404 ("Specified CountryStatistics couldn't be
 * found") — aqui isso é lista vazia, pelo mesmo motivo do fetchUser: é
 * resultado de uma busca, não falha de rede.
 */
function normalizeRankingEntry(item) {
  return {
    id:        item.user?.id ?? null,
    username:  item.user?.username ?? '?',
    country:   (item.user?.country_code || '').toUpperCase() || null,
    pp:        Number(item.pp ?? 0),
    // 0-100, como o `hit_accuracy` do usuário normalizado — e ao contrário da
    // acurácia de um score, que circula de 0 a 1.
    accuracy:  Number(item.hit_accuracy ?? 0),
    playCount: Number(item.play_count ?? 0),
  };
}

async function leaderboard(_mode, { limit = RANKING_PAGE, country = null } = {}) {
  const paginas = Math.max(1, Math.ceil(limit / RANKING_PAGE));
  const filtro  = country ? { country: String(country).toUpperCase() } : {};

  const respostas = await Promise.all(
    Array.from({ length: paginas }, (_, i) =>
      officialGet('/rankings/osu/performance', { params: { ...filtro, page: i + 1 } })
        .catch(error => {
          if (error?.response?.status === 404) return null;
          throw error;
        })
    )
  );

  return respostas
    .flatMap(res => (Array.isArray(res?.ranking) ? res.ranking : []))
    .slice(0, limit)
    .map(normalizeRankingEntry);
}

const bestScores = async (userId, limit) =>
  normalizeScores(await scoreGet(`/users/${idSegment(userId)}/scores/best`, { limit }));

const recentScores = async (userId, limit) =>
  normalizeScores(await scoreGet(`/users/${idSegment(userId)}/scores/recent`, { limit, include_fails: 1 }));

const userUrl = (userId, mode) => `${servers.get(mode).webUrl}/users/${userId}`;
const mapUrl  = (mapId, setId, mode) => `${servers.get(mode).webUrl}/beatmapsets/${setId}#osu/${mapId}`;

module.exports = {
  fetchUser,
  bestScores,
  recentScores,
  beatmapScores: officialBeatmapScores,
  leaderboard,
  officialBeatmapset,
  userUrl,
  mapUrl,

  // O download de .osu e a busca de metadados usam a API oficial mesmo quando
  // o score veio de outro servidor: o arquivo é público lá para todo mapa.
  officialGet,

  // Exportado para o teste: é a tradução entre dois formatos de score, e o
  // formato novo é esparso de um jeito que engana fácil.
  normalizeScore,
  // Idem para a linha do ranking, onde a acurácia vem numa escala e a posição
  // não vem de jeito nenhum.
  normalizeRankingEntry,
};
