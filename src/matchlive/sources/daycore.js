/**
 * matchlive/sources/daycore.js
 * A partida do Daycore como o /matchlive precisa: o que mudou desde o último
 * evento visto, os jogos e o resultado dos jogos que terminaram.
 *
 * Mesmas tabelas do /matchcost (ver commands/osu/matchcost/daycore.js, que
 * explica cada coluna). Diferença que importa aqui: o `dc_match_scores` só é
 * gravado no FIM do mapa — os score frames ficam na memória do bancho até o
 * MATCH_COMPLETE. Placar parcial precisa de um patch novo (`dc_match_live`);
 * até lá, `live()` responde null e o mapa em andamento mostra só quem joga.
 *
 * A regra de partida privada NÃO mora aqui: quem decide se o track pode
 * começar é o comando (que sabe quem chamou). O poller só segue o que já foi
 * autorizado.
 */

const daycoreMysql = require('../../daycoreMysql');
const { decodeMods, stripImpliedDT } = require('../../mods');

// Cópia dos mapas do commands/osu/matchcost/daycore.js: o test/architecture
// proíbe importar de dentro de commands/, então ficam duplicados aqui.
const TIMES = { 0: 'none', 1: 'blue', 2: 'red' };
const TIPOS_DE_TIME = { 0: 'head-to-head', 1: 'tag-coop', 2: 'team-vs', 3: 'tag-team-vs' };

const SQL_PARTIDA = 'SELECT `id`, `name`, `private`, `ended_at` FROM `dc_matches` WHERE `id` = ?';
const SQL_EVENTOS =
  'SELECT e.`id`, e.`type`, e.`user_id`, e.`game_id`, e.`created_at`, u.`name` ' +
  'FROM `dc_match_events` e LEFT JOIN `users` u ON u.`id` = e.`user_id` ' +
  'WHERE e.`match_id` = ? AND e.`id` > ? ORDER BY e.`id`';
const SQL_ULTIMO_EVENTO = 'SELECT MAX(`id`) AS n FROM `dc_match_events` WHERE `match_id` = ?';
const SQL_JOGOS =
  'SELECT `id`, `map_id`, `map_name`, `mode`, `mods`, `freemods`, `team_type`, `started_at`, `ended_at` ' +
  'FROM `dc_match_games` WHERE `match_id` = ? ORDER BY `started_at`, `id`';
const SQL_SCORES =
  'SELECT s.*, u.`name` FROM `dc_match_scores` s ' +
  'JOIN `dc_match_games` g ON g.`id` = s.`game_id` ' +
  'LEFT JOIN `users` u ON u.`id` = s.`user_id` ' +
  'WHERE g.`match_id` = ? ORDER BY s.`game_id`, s.`slot`';

const iso = v => (v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString());
const mods = bits => stripImpliedDT(decodeMods(Number(bits) || 0));

function pool() {
  const p = daycoreMysql.getPool();
  if (!p) throw new Error('MySQL do Daycore não configurado (defina DAYCORE_MYSQL_HOST no .env).');
  return p;
}

async function snapshot(matchId, lastEventId) {
  const p = pool();
  const [[partida]] = await p.execute(SQL_PARTIDA, [matchId]);
  if (!partida) return null;

  const [eventos] = await p.execute(SQL_EVENTOS, [matchId, lastEventId]);
  const [jogos] = await p.execute(SQL_JOGOS, [matchId]);
  const algumTerminado = jogos.some(j => j.ended_at != null);
  const [scores] = algumTerminado ? await p.execute(SQL_SCORES, [matchId]) : [[]];

  const porJogo = new Map(jogos.map(j => [Number(j.id), []]));
  for (const s of scores) porJogo.get(Number(s.game_id))?.push({
    userId: Number(s.user_id),
    username: s.name ?? null,
    slot: Number(s.slot),
    team: TIMES[Number(s.team)] ?? 'none',
    mods: mods(s.mods),
    score: Number(s.score) || 0,
    maxCombo: Number(s.max_combo) || 0,
    n300: Number(s.n300) || 0, n100: Number(s.n100) || 0, n50: Number(s.n50) || 0,
    nmiss: Number(s.nmiss) || 0, ngeki: Number(s.ngeki) || 0, nkatu: Number(s.nkatu) || 0,
    passed: Boolean(Number(s.passed)),
    perfect: Boolean(Number(s.perfect)),
  });

  return {
    match: { id: Number(partida.id), name: partida.name ?? '', private: Boolean(Number(partida.private)), endedAt: iso(partida.ended_at) },
    events: eventos.map(e => ({
      id: Number(e.id), type: e.type, userId: e.user_id == null ? null : Number(e.user_id),
      username: e.name ?? null, gameId: e.game_id == null ? null : Number(e.game_id), at: iso(e.created_at),
    })),
    games: jogos.map(j => ({
      id: Number(j.id), mapId: Number(j.map_id), mapName: j.map_name, mode: Number(j.mode),
      mods: mods(j.mods), freemods: Boolean(Number(j.freemods)),
      teamType: TIPOS_DE_TIME[Number(j.team_type)] ?? 'head-to-head',
      startedAt: iso(j.started_at), endedAt: iso(j.ended_at),
      scores: j.ended_at == null ? [] : porJogo.get(Number(j.id)),
    })),
  };
}

async function lastEventIdOf(matchId) {
  const [[r]] = await pool().execute(SQL_ULTIMO_EVENTO, [matchId]);
  return Number(r?.n) || 0;
}

/** Placar parcial: depende do patch `dc_match_live`, que ainda não existe. */
async function live() { return null; }

module.exports = { snapshot, lastEventIdOf, live };
