/**
 * commands/osu/matchcost/bancho.js
 * A partida do Bancho: `GET /matches/{id}` da API v2, paginada para trás.
 *
 * ── Por que paginar ─────────────────────────────────────────────────────────
 * A resposta traz só os 100 eventos MAIS RECENTES da partida (entradas,
 * saídas, troca de host e cada jogo são eventos), junto do `first_event_id`
 * dela. Numa partida de torneio com muita gente entrando e saindo, os
 * primeiros mapas ficam de fora da primeira página — e o match cost sairia
 * calculado só sobre o fim da partida, sem aviso nenhum.
 *
 * O Bathbot (`retrieve_previous`) busca no máximo mais 5 páginas; aqui a busca
 * vai até o primeiro evento, com um teto só para uma resposta estranha da API
 * não virar laço infinito.
 */

const { officialGet } = require('../../../osu/officialApi');
const { idSegment } = require('../../../lib/urlSafe');
const { modAcronym } = require('../../../mods');

/** O máximo que a API devolve por página. */
const EVENTOS_POR_PAGINA = 100;

/** Teto de páginas anteriores — 10 mil eventos, bem além de qualquer partida real. */
const MAX_PAGINAS = 100;

/**
 * A partida inteira, com todos os eventos.
 *
 * @returns {Promise<{partida: object} | {erro: 'not_found'|'private'}>}
 *   A API responde 404 para partida inexistente e 401 para partida privada;
 *   os dois viram `erro` porque são resposta, e não falha de rede.
 */
async function buscarPartida(id) {
  let primeira;
  try {
    primeira = await officialGet(`/matches/${idSegment(id)}`);
  } catch (error) {
    const status = error?.response?.status;
    if (status === 404) return { erro: 'not_found' };
    if (status === 401) return { erro: 'private' };
    throw error;
  }

  let eventos = Array.isArray(primeira?.events) ? primeira.events : [];
  const usuarios = Array.isArray(primeira?.users) ? [...primeira.users] : [];

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const primeiro = eventos[0]?.id;
    if (primeiro == null || primeiro === primeira.first_event_id) break;

    const anterior = await officialGet(`/matches/${idSegment(id)}`, {
      params: { before: primeiro, limit: EVENTOS_POR_PAGINA },
    });
    const novos = Array.isArray(anterior?.events) ? anterior.events : [];
    if (novos.length === 0) break;

    eventos = [...novos, ...eventos];
    if (Array.isArray(anterior?.users)) usuarios.push(...anterior.users);
  }

  return { partida: { ...primeira, events: eventos, users: usuarios } };
}

/**
 * Resposta da API v2 → o formato comum do /matchcost (ver logic.js).
 *
 * O time de cada score vem em `score.match.team` ('none', 'blue', 'red'), e os
 * mods são os do JOGADOR — em sala sem freemod a API devolve a lista vazia e
 * os mods da sala ficam só no jogo. É o mesmo que o Bathbot lê (o `mods` do
 * `MatchScore` no rosu-v2), então a contagem de combinações sai igual.
 *
 * `avatars` fica fora da conta: é só o que o embed usa na miniatura do MVP.
 */
function normalizarPartida(raw) {
  const usuarios = new Map();
  for (const u of raw?.users ?? []) {
    if (u?.id != null) usuarios.set(u.id, u);
  }

  // Um evento é jogo quando carrega `game`. Os ids são únicos; a checagem só
  // protege de uma página repetida.
  const vistos = new Set();
  const games = [];
  for (const evento of raw?.events ?? []) {
    if (!evento?.game || vistos.has(evento.id)) continue;
    vistos.add(evento.id);

    const jogo = evento.game;
    games.push({
      endedAt: jogo.end_time ?? null,
      teamType: jogo.team_type ?? 'head-to-head',
      scores: (jogo.scores ?? []).map(s => ({
        userId: s.user_id,
        username: usuarios.get(s.user_id)?.username ?? null,
        team: s.match?.team ?? 'none',
        mods: (s.mods ?? []).map(modAcronym),
        score: Number(s.score) || 0,
      })),
    });
  }

  const avatars = {};
  for (const [id, u] of usuarios) if (u.avatar_url) avatars[id] = u.avatar_url;

  return {
    id: raw?.match?.id ?? null,
    name: raw?.match?.name ?? '',
    finished: raw?.match?.end_time != null,
    games,
    avatars,
  };
}

module.exports = { buscarPartida, normalizarPartida };
