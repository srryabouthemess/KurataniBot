/**
 * db/nominations.js
 * A fila de nomeação de mapas, e o log do que o bot mandou o servidor fazer.
 *
 * O bancho.py-ex não tem conceito de fila: ele só sabe aplicar um status final
 * num mapa. Todo o processo social — quem nomeou, quantos faltam, o histórico —
 * existe só aqui.
 */

const { db } = require('./connection');

// ─── Nomeações ────────────────────────────────────────────────────────────────

/**
 * Registra a nomeação daquela CONTA DE JOGO. Nomear de novo (inclusive de outra
 * conta do Discord) atualiza a linha existente em vez de virar um segundo voto.
 */
function addNomination(setId, targetStatus, discordId, osuId, osuName) {
  db.prepare(`
    INSERT INTO map_nominations (set_id, target_status, osu_id, discord_id, osu_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(set_id, target_status, osu_id) DO UPDATE SET
      discord_id = excluded.discord_id, osu_name = excluded.osu_name
  `).run(setId, targetStatus, osuId, discordId, osuName ?? null, Date.now());
}

/**
 * Retira a nomeação da conta de jogo. É por osu_id, e não por Discord, para
 * quem nomeou de um Discord conseguir retirar de outro — é a mesma pessoa.
 */
function removeNomination(setId, targetStatus, osuId) {
  return db.prepare(`
    DELETE FROM map_nominations WHERE set_id = ? AND target_status = ? AND osu_id = ?
  `).run(setId, targetStatus, osuId).changes > 0;
}

function getNominations(setId, targetStatus) {
  return db.prepare(`
    SELECT osu_id, discord_id, osu_name, created_at
    FROM map_nominations
    WHERE set_id = ? AND target_status = ?
    ORDER BY created_at ASC
  `).all(setId, targetStatus);
}

/** Limpa a fila de um set — usado após aplicar, ou para descartar. */
function clearNominations(setId, targetStatus) {
  return db.prepare(`
    DELETE FROM map_nominations WHERE set_id = ? AND target_status = ?
  `).run(setId, targetStatus).changes;
}

/** Fila completa, agrupada por set + status alvo. */
function listPendingNominations(limit = 25) {
  return db.prepare(`
    SELECT n.set_id, n.target_status, COUNT(*) AS votes, MAX(n.created_at) AS last_at,
           m.artist, m.title, m.creator, m.diff_count
    FROM map_nominations n
    LEFT JOIN nomination_maps m ON m.set_id = n.set_id
    GROUP BY n.set_id, n.target_status
    ORDER BY last_at DESC
    LIMIT ?
  `).all(limit);
}

function cacheNominationMap(setId, { artist, title, creator, diffCount }) {
  db.prepare(`
    INSERT INTO nomination_maps (set_id, artist, title, creator, diff_count, cached_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(set_id) DO UPDATE SET
      artist = excluded.artist, title = excluded.title,
      creator = excluded.creator, diff_count = excluded.diff_count,
      cached_at = excluded.cached_at
  `).run(setId, artist ?? null, title ?? null, creator ?? null, diffCount ?? null, Date.now());
}

// ─── Log de ações administrativas ─────────────────────────────────────────────
// O bancho tem o log de auditoria dele, e recebe o osu! ID de quem pediu — mas
// não sabe que a ação veio do Discord nem de qual conta. Isso só existe aqui.

function logAdminAction({ action, target, detail, actorDiscordId, actorOsuId, actorOsuName }) {
  db.prepare(`
    INSERT INTO admin_actions
      (action, target, detail, actor_discord_id, actor_osu_id, actor_osu_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    action, String(target), detail ?? null,
    actorDiscordId, actorOsuId, actorOsuName ?? null, Date.now(),
  );
}

function listAdminActions(limit = 15) {
  return db.prepare(`
    SELECT action, target, detail, actor_osu_name, actor_discord_id, created_at
    FROM admin_actions ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

module.exports = {
  addNomination, removeNomination, getNominations, clearNominations,
  listPendingNominations, cacheNominationMap,
  logAdminAction, listAdminActions,
};
