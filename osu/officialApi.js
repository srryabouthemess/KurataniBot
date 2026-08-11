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
async function officialGet(path, params = {}) {
  const res = await withRetry(async () => {
    const token = await getOfficialToken();
    await rateLimiter.acquire('osuApi');
    return axios.get(`https://osu.ppy.sh/api/v2${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 10000,
    });
  });
  return res.data;
}

/**
 * `/scores/users/{user}/all` devolve todos os scores do jogador no mapa, não
 * só o melhor — que é justamente a diferença para o endpoint sem o `/all`.
 * Mapa inexistente responde 404; jogador sem score responde `{scores: []}`.
 */
async function officialBeatmapScores(userId, beatmapId) {
  const res = await officialGet(
    `/beatmaps/${idSegment(beatmapId)}/scores/users/${idSegment(userId)}/all`
  );
  return res?.scores ?? [];
}

const fetchUser    = username => officialGet(`/users/${urlSegment(username)}/osu`);
const bestScores   = (userId, limit) => officialGet(`/users/${idSegment(userId)}/scores/best`, { limit });
const recentScores = (userId, limit) =>
  officialGet(`/users/${idSegment(userId)}/scores/recent`, { limit, include_fails: 1 });

const userUrl = (userId, mode) => `${servers.get(mode).webUrl}/users/${userId}`;
const mapUrl  = (mapId, setId, mode) => `${servers.get(mode).webUrl}/beatmapsets/${setId}#osu/${mapId}`;

module.exports = {
  fetchUser,
  bestScores,
  recentScores,
  beatmapScores: officialBeatmapScores,
  userUrl,
  mapUrl,

  // O download de .osu e a busca de metadados usam a API oficial mesmo quando
  // o score veio de outro servidor: o arquivo é público lá para todo mapa.
  officialGet,
};
