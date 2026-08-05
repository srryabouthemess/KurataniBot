/**
 * db.js
 * Persistência do bot em SQLite (node:sqlite, nativo do Node — sem dependência
 * externa nem build nativo).
 *
 * Antes disso o bot usava dois arquivos JSON separados (links.json e
 * languages.json), escritos com fs.writeFileSync sem nenhuma garantia de
 * atomicidade entre requisições concorrentes. O SQLite resolve isso e também
 * deixa todas as preferências do usuário (link osu! + idioma, e no futuro
 * outras) numa tabela só.
 *
 * Tabelas:
 *   users           → discord_id (PK), osu_user, osu_server, lang
 *   guild_settings  → guild_id (PK), lang
 */

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(
    `❌ Este bot requer Node.js 22.5+ (módulo nativo "node:sqlite" indisponível).\n` +
    `   Versão atual: ${process.version}. Atualize o Node.js e tente novamente.`
  );
  process.exit(1);
}

const fs   = require('fs');
const path = require('path');

const DB_PATH       = path.join(__dirname, 'bot.db');
const OLD_LINKS_PATH = path.join(__dirname, 'links.json');
const OLD_LANGS_PATH = path.join(__dirname, 'languages.json');

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    discord_id  TEXT PRIMARY KEY,
    osu_user    TEXT,
    osu_server  TEXT,
    lang        TEXT
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    lang     TEXT
  );
`);

// ─── Migração única dos arquivos JSON antigos ─────────────────────────────────
// Só roda se ainda houver arquivos antigos no disco e a tabela estiver vazia
// (evita reimportar toda vez que o bot sobe).
function migrateFromJsonIfNeeded() {
  const usersEmpty = db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0;
  if (!usersEmpty) return;

  const hasOldFiles = fs.existsSync(OLD_LINKS_PATH) || fs.existsSync(OLD_LANGS_PATH);
  if (!hasOldFiles) return;

  console.log('[db] Migrando links.json / languages.json antigos para bot.db...');

  const links = fs.existsSync(OLD_LINKS_PATH)
    ? JSON.parse(fs.readFileSync(OLD_LINKS_PATH, 'utf8'))
    : {};
  const langs = fs.existsSync(OLD_LANGS_PATH)
    ? JSON.parse(fs.readFileSync(OLD_LANGS_PATH, 'utf8'))
    : { users: {}, servers: {} };

  const discordIds = new Set([
    ...Object.keys(links),
    ...Object.keys(langs.users ?? {}),
  ]);

  const upsertUser = db.prepare(`
    INSERT INTO users (discord_id, osu_user, osu_server, lang)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      osu_user = excluded.osu_user, osu_server = excluded.osu_server, lang = excluded.lang
  `);
  for (const id of discordIds) {
    const link = links[id];
    const lang = langs.users?.[id] ?? null;
    upsertUser.run(id, link?.osu_user ?? null, link?.server ?? null, lang);
  }

  const upsertGuild = db.prepare(`
    INSERT INTO guild_settings (guild_id, lang) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET lang = excluded.lang
  `);
  for (const [guildId, lang] of Object.entries(langs.servers ?? {})) {
    upsertGuild.run(guildId, lang);
  }

  // Renomeia os arquivos antigos em vez de apagar — fica como backup.
  for (const p of [OLD_LINKS_PATH, OLD_LANGS_PATH]) {
    if (fs.existsSync(p)) fs.renameSync(p, `${p}.migrated`);
  }

  console.log(`[db] Migração concluída: ${discordIds.size} usuário(s), ${Object.keys(langs.servers ?? {}).length} servidor(es).`);
}

migrateFromJsonIfNeeded();

// ─── Links osu! ────────────────────────────────────────────────────────────────

function setLink(discordId, osuUser, server) {
  db.prepare(`
    INSERT INTO users (discord_id, osu_user, osu_server) VALUES (?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET osu_user = excluded.osu_user, osu_server = excluded.osu_server
  `).run(discordId, osuUser, server);
}

function getLink(discordId) {
  const row = db.prepare('SELECT osu_user, osu_server FROM users WHERE discord_id = ?').get(discordId);
  if (!row || !row.osu_user) return null;
  return { osu_user: row.osu_user, server: row.osu_server };
}

function removeLink(discordId) {
  const existing = getLink(discordId);
  if (!existing) return false;
  db.prepare('UPDATE users SET osu_user = NULL, osu_server = NULL WHERE discord_id = ?').run(discordId);
  return true;
}

// ─── Idioma do usuário ──────────────────────────────────────────────────────────

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

// ─── Idioma do servidor ─────────────────────────────────────────────────────────

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
  const result = db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
  return result.changes > 0;
}

module.exports = {
  setLink, getLink, removeLink,
  setUserLang, getUserLang, removeUserLang,
  setServerLang, getServerLang, removeServerLang,
};
