/**
 * multiplayer/daycore.js
 * Pedaços da partida do Daycore que o /matchcost e o /matchlive compartilham:
 * a numeração de times do bancho.py e a checagem "esta conta jogou nesta
 * partida?" (regra de partida privada). Mora aqui, fora de commands/, porque
 * o test/architecture proíbe um comando de importar de outro.
 */

const servers = require('../servers');

/**
 * O servidor cujas partidas estão no MySQL: o privado do `SERVERS` do `.env`,
 * que é o mesmo dono do DAYCORE_MYSQL_* (ver o `private` em servers.js).
 */
function chaveDoDaycore() {
  const key = servers.resolveKey('private');
  return key ? servers.rootKey(key) : null;
}

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

const SQL_JOIN_POR_ID =
  "SELECT 1 FROM `dc_match_events` WHERE `match_id` = ? AND `type` = 'join' AND `user_id` = ? LIMIT 1";

// Link antigo, gravado só com o nome: a conta sai do `users` pelo nome.
const SQL_JOIN_POR_NOME =
  'SELECT 1 FROM `dc_match_events` e JOIN `users` u ON u.`id` = e.`user_id` ' +
  "WHERE e.`match_id` = ? AND e.`type` = 'join' AND u.`name` = ? LIMIT 1";

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

module.exports = { TIMES, TIPOS_DE_TIME, jogouNela, chaveDoDaycore };
