/**
 * osu/banchoPyApi/players.js
 * O perfil de um jogador e o ranking do servidor.
 */

const servers = require('../../servers');
const { idSegment } = require('../../lib/urlSafe');
const { banchoV1Get, banchoV2Get } = require('./http');
const { normalizeUserPrivate, normalizeRankingEntry } = require('./normalize');
const { resolvePlayerId } = require('./lookups');

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
async function leaderboard(mode, { limit = 50, country = null } = {}) {
  const res = await banchoV1Get(mode, 'get_leaderboard', {
    mode:  servers.get(mode).gameMode,
    limit: Math.min(limit, RANKING_MAX),
    ...(country ? { country: String(country).toLowerCase() } : {}),
  });

  const lista = Array.isArray(res?.leaderboard) ? res.leaderboard : [];
  return lista.map(normalizeRankingEntry);
}

module.exports = {
  fetchUser,
  leaderboard,
};
