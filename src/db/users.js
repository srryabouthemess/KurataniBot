/**
 * db/users.js
 * Links de conta osu!, servidor preferido e idioma.
 *
 * O que estas três coisas têm em comum: são preferências de uma pessoa, e o
 * bot as lê em praticamente todo comando.
 */

const servers = require('../servers');
const { db } = require('./connection');

/**
 * Namespace de conta a que um servidor pertence.
 * Vanilla e RX do mesmo servidor são a mesma conta, então compartilham o link.
 */
function linkNamespace(server) {
  return servers.namespace(server);
}

// ─── Links osu! ───────────────────────────────────────────────────────────────

/**
 * Cria ou atualiza o link do usuário para a conta do servidor indicado e
 * adota esse servidor como preferido (o último linkado vira o padrão).
 */
function setLink(discordId, server, osuUser, osuId = null) {
  db.prepare(`
    INSERT INTO user_links (discord_id, namespace, osu_user, osu_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id, namespace) DO UPDATE SET
      osu_user = excluded.osu_user, osu_id = excluded.osu_id
  `).run(discordId, linkNamespace(server), osuUser, osuId);

  setPreferredServer(discordId, server);
}

/** Link do usuário para a conta do servidor indicado, ou null. */
function getLink(discordId, server) {
  const row = db
    .prepare('SELECT osu_user, osu_id FROM user_links WHERE discord_id = ? AND namespace = ?')
    .get(discordId, linkNamespace(server));
  if (!row) return null;
  return { osu_user: row.osu_user, osu_id: row.osu_id ?? null };
}

/** Todos os links do usuário: [{ namespace, osu_user, osu_id }] */
function getAllLinks(discordId) {
  return db
    .prepare('SELECT namespace, osu_user, osu_id FROM user_links WHERE discord_id = ? ORDER BY namespace')
    .all(discordId);
}

/**
 * Remove o link de um servidor, ou todos se `server` for null.
 * @returns {number} quantos links foram removidos
 */
function removeLink(discordId, server = null) {
  if (server === null) {
    const result = db.prepare('DELETE FROM user_links WHERE discord_id = ?').run(discordId);
    db.prepare('UPDATE users SET preferred_server = NULL WHERE discord_id = ?').run(discordId);
    return result.changes;
  }

  const namespace = linkNamespace(server);
  const result = db
    .prepare('DELETE FROM user_links WHERE discord_id = ? AND namespace = ?')
    .run(discordId, namespace);

  // Se o preferido apontava para a conta removida, cai para o que sobrou.
  const preferred = getPreferredServer(discordId);
  if (preferred && linkNamespace(preferred) === namespace) {
    const remaining = getAllLinks(discordId)[0];
    db.prepare('UPDATE users SET preferred_server = ? WHERE discord_id = ?')
      .run(remaining ? servers.keyForNamespace(remaining.namespace) : null, discordId);
  }

  return result.changes;
}

// ─── Servidor preferido ───────────────────────────────────────────────────────

function setPreferredServer(discordId, server) {
  db.prepare(`
    INSERT INTO users (discord_id, preferred_server) VALUES (?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET preferred_server = excluded.preferred_server
  `).run(discordId, server);
}

function getPreferredServer(discordId) {
  return db.prepare('SELECT preferred_server FROM users WHERE discord_id = ?')
    .get(discordId)?.preferred_server ?? null;
}

// ─── Idioma do usuário ────────────────────────────────────────────────────────

function setUserLang(discordId, lang) {
  db.prepare(`
    INSERT INTO users (discord_id, lang) VALUES (?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET lang = excluded.lang
  `).run(discordId, lang);
}

function getUserLang(discordId) {
  return db.prepare('SELECT lang FROM users WHERE discord_id = ?').get(discordId)?.lang ?? null;
}

function removeUserLang(discordId) {
  if (!getUserLang(discordId)) return false;
  db.prepare('UPDATE users SET lang = NULL WHERE discord_id = ?').run(discordId);
  return true;
}

// ─── Idioma do servidor ───────────────────────────────────────────────────────

function setServerLang(guildId, lang) {
  if (lang === null) return removeServerLang(guildId);
  db.prepare(`
    INSERT INTO guild_settings (guild_id, lang) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET lang = excluded.lang
  `).run(guildId, lang);
}

function getServerLang(guildId) {
  return db.prepare('SELECT lang FROM guild_settings WHERE guild_id = ?').get(guildId)?.lang ?? null;
}

function removeServerLang(guildId) {
  return db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId).changes > 0;
}

module.exports = {
  linkNamespace,
  setLink, getLink, getAllLinks, removeLink,
  setPreferredServer, getPreferredServer,
  setUserLang, getUserLang, removeUserLang,
  setServerLang, getServerLang, removeServerLang,
};
