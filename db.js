/**
 * db.js
 * Gerencia links Discord <-> osu! e preferências de idioma em arquivos JSON.
 *
 * links.json   → { discord_id: { osu_user, server } }
 * langs.json   → { users: { discord_id: lang }, servers: { guild_id: lang } }
 */

const fs   = require('fs');
const path = require('path');

const LINKS_PATH = path.join(__dirname, 'links.json');
const LANGS_PATH = path.join(__dirname, 'langs.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadFile(filePath, defaultValue = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function saveFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Links ────────────────────────────────────────────────────────────────────

function setLink(discordId, osuUser, server) {
  const data = loadFile(LINKS_PATH);
  data[discordId] = { osu_user: osuUser, server };
  saveFile(LINKS_PATH, data);
}

function getLink(discordId) {
  return loadFile(LINKS_PATH)[discordId] ?? null;
}

function removeLink(discordId) {
  const data = loadFile(LINKS_PATH);
  if (!data[discordId]) return false;
  delete data[discordId];
  saveFile(LINKS_PATH, data);
  return true;
}

// ─── Idiomas ──────────────────────────────────────────────────────────────────

function setUserLang(discordId, lang) {
  const data = loadFile(LANGS_PATH, { users: {}, servers: {} });
  data.users = data.users ?? {};
  data.users[discordId] = lang;
  saveFile(LANGS_PATH, data);
}

function getUserLang(discordId) {
  return loadFile(LANGS_PATH, { users: {}, servers: {} }).users?.[discordId] ?? null;
}

function removeUserLang(discordId) {
  const data = loadFile(LANGS_PATH, { users: {}, servers: {} });
  if (!data.users?.[discordId]) return false;
  delete data.users[discordId];
  saveFile(LANGS_PATH, data);
  return true;
}

function setServerLang(guildId, lang) {
  const data = loadFile(LANGS_PATH, { users: {}, servers: {} });
  data.servers = data.servers ?? {};
  data.servers[guildId] = lang;
  saveFile(LANGS_PATH, data);
}

function getServerLang(guildId) {
  return loadFile(LANGS_PATH, { users: {}, servers: {} }).servers?.[guildId] ?? null;
}

function removeServerLang(guildId) {
  const data = loadFile(LANGS_PATH, { users: {}, servers: {} });
  if (!data.servers?.[guildId]) return false;
  delete data.servers[guildId];
  saveFile(LANGS_PATH, data);
  return true;
}

module.exports = {
  setLink, getLink, removeLink,
  setUserLang, getUserLang, removeUserLang,
  setServerLang, getServerLang, removeServerLang,
};
