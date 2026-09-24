/**
 * osu/banchoPyApi/http.js
 * As três portas de rede de um servidor bancho.py: a API do front-end
 * (Shiina-Web), a v1 e a v2 do bancho.py-ex. Todas passam pelo rate limiter do
 * servidor e pelo retry.
 */

const axios = require('axios');
const servers = require('../../servers');
const rateLimiter = require('../../rateLimiter');
const { withRetry } = require('../../lib/retry');

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

module.exports = {
  PRIVATE_MODE,
  temShiina,
  webApiGet,
  banchoV1Get,
  banchoV2Get,
};
