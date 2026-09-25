/**
 * commands/osu/matchcost/daycore.js
 * A partida do Daycore: leitura direta do MySQL `bancho`.
 *
 * ── Por que o banco, e não uma API ──────────────────────────────────────────
 * O bancho.py não guarda partida nenhuma: a sala vive na memória e some quando
 * fecha. As tabelas `dc_match_*` vêm do patch do bancho.py-ex do Daycore (que
 * não está neste repo), que grava a partida enquanto ela acontece — e nenhuma
 * API expõe essas tabelas. Mesmo caminho do /invitecode, com a mesma conexão
 * (daycoreMysql.js).
 *
 * ── O que cada coluna quer dizer ────────────────────────────────────────────
 * - `dc_match_scores.mods` já é o mod EFETIVO do jogador: em freemod o bancho
 *   grava os mods do slot somados aos da sala, fora dele os da sala. Entra
 *   direto na conta, sem juntar com `dc_match_games.mods`.
 * - `score` é o do último score frame que o cliente mandou, e não um score
 *   submetido. Serve para o match cost porque a fórmula só compara scores do
 *   mesmo mapa entre si.
 * - `ended_at` NULL em `dc_match_games` é jogo abortado (ou em andamento); em
 *   `dc_matches`, partida ainda aberta.
 *
 * ── Partida privada ─────────────────────────────────────────────────────────
 * O site responde 404 para quem não jogou nela, e o bot segue: só mostra se a
 * conta vinculada (/link) de quem chamou tem um `join` naquela partida — senão
 * a resposta é a de "não encontrada", sem confirmar que ela existe. A regra
 * pura mora em logic.js (`podeVerPartida`); aqui só a consulta.
 */

const daycoreMysql = require('../../../daycoreMysql');
const servers = require('../../../servers');
const { decodeMods, stripImpliedDT } = require('../../../mods');
const { podeVerPartida } = require('./logic');

/**
 * `dc_match_scores.team`, na numeração do bancho.py (`MatchTeams`, em
 * app/objects/match.py): 0 neutro, 1 azul, 2 vermelho.
 */
const TIMES = { 0: 'none', 1: 'blue', 2: 'red' };

/**
 * `dc_match_games.team_type`, na numeração do bancho.py (`MatchTeamTypes`, em
 * app/objects/match.py) — a mesma do osu!. Os nomes são os da API v2, que é o
 * formato comum do /matchcost.
 */
const TIPOS_DE_TIME = { 0: 'head-to-head', 1: 'tag-coop', 2: 'team-vs', 3: 'tag-team-vs' };

const SQL_PARTIDA = 'SELECT `id`, `name`, `private`, `ended_at` FROM `dc_matches` WHERE `id` = ?';

const SQL_JOIN_POR_ID =
  "SELECT 1 FROM `dc_match_events` WHERE `match_id` = ? AND `type` = 'join' AND `user_id` = ? LIMIT 1";

// Link antigo, gravado só com o nome: a conta sai do `users` pelo nome.
const SQL_JOIN_POR_NOME =
  'SELECT 1 FROM `dc_match_events` e JOIN `users` u ON u.`id` = e.`user_id` ' +
  "WHERE e.`match_id` = ? AND e.`type` = 'join' AND u.`name` = ? LIMIT 1";

const SQL_JOGOS =
  'SELECT `id`, `team_type`, `ended_at` FROM `dc_match_games` WHERE `match_id` = ? ORDER BY `started_at`, `id`';

const SQL_SCORES =
  'SELECT s.`game_id`, s.`user_id`, s.`slot`, s.`team`, s.`mods`, s.`score`, u.`name` ' +
  'FROM `dc_match_scores` s ' +
  'JOIN `dc_match_games` g ON g.`id` = s.`game_id` ' +
  'LEFT JOIN `users` u ON u.`id` = s.`user_id` ' +
  'WHERE g.`match_id` = ? ORDER BY s.`game_id`, s.`slot`';

/**
 * A partida, respeitando a regra de partida privada.
 *
 * @param {number} id
 * @param {{id: number|null, name: string|null}|null} quem a conta vinculada de
 *   quem chamou no Daycore, ou null sem link
 * @returns {Promise<{linhas: object} | {erro: 'not_found'}>}
 */
async function buscarPartida(id, quem) {
  const pool = daycoreMysql.getPool();
  if (!pool) throw new Error('MySQL do Daycore não configurado (defina DAYCORE_MYSQL_HOST no .env).');

  const [[partida]] = await pool.execute(SQL_PARTIDA, [id]);
  if (!partida) return { erro: 'not_found' };

  const privada = Boolean(Number(partida.private));
  if (privada) {
    const participou = await jogouNela(pool, id, quem);
    if (!podeVerPartida({ private: true }, participou)) return { erro: 'not_found' };
  }

  const [jogos] = await pool.execute(SQL_JOGOS, [id]);
  const [scores] = await pool.execute(SQL_SCORES, [id]);

  return { linhas: { partida, jogos, scores } };
}

async function jogouNela(pool, matchId, quem) {
  if (quem?.id != null) {
    const [linhas] = await pool.execute(SQL_JOIN_POR_ID, [matchId, Number(quem.id)]);
    return linhas.length > 0;
  }
  if (quem?.name) {
    const [linhas] = await pool.execute(SQL_JOIN_POR_NOME, [matchId, String(quem.name)]);
    return linhas.length > 0;
  }
  return false;
}

const dataOuNull = valor => {
  if (valor == null) return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? String(valor) : data.toISOString();
};

/**
 * Linhas do MySQL → o formato comum do /matchcost (ver logic.js).
 *
 * @param {{partida: object, jogos: object[], scores: object[]}} linhas
 * @param {{avatars?: string|null}} [opcoes] base das URLs de avatar do servidor
 */
function normalizarPartida({ partida, jogos, scores }, { avatars = null } = {}) {
  const porJogo = new Map(jogos.map(j => [j.id, []]));
  for (const s of scores) porJogo.get(s.game_id)?.push(s);

  const games = jogos.map(j => ({
    endedAt: dataOuNull(j.ended_at),
    teamType: TIPOS_DE_TIME[Number(j.team_type)] ?? 'head-to-head',
    scores: porJogo.get(j.id)
      .sort((a, b) => Number(a.slot) - Number(b.slot))
      .map(s => ({
        userId: Number(s.user_id),
        username: s.name ?? null,
        team: TIMES[Number(s.team)] ?? 'none',
        // O bitmask do bancho liga o bit do DT junto do NC; o Bancho manda só
        // "NC". Sem o corte, a mesma play contaria como combinação diferente
        // conforme o servidor.
        mods: stripImpliedDT(decodeMods(Number(s.mods) || 0)),
        score: Number(s.score) || 0,
      })),
  }));

  const avatarsPorId = {};
  if (avatars) {
    for (const s of scores) avatarsPorId[Number(s.user_id)] = servers.avatarUrl(avatars, s.user_id);
  }

  return {
    id: Number(partida.id),
    name: partida.name ?? '',
    finished: partida.ended_at != null,
    games,
    avatars: avatarsPorId,
  };
}

module.exports = {
  buscarPartida,
  normalizarPartida,
  isConfigured: daycoreMysql.isConfigured,
  checkConnection: daycoreMysql.checkConnection,
  TIMES,
  TIPOS_DE_TIME,
};
