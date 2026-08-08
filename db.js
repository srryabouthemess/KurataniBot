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
  // node:sqlite chegou no v22.5.0, mas até o v22.12 exigia a flag
  // --experimental-sqlite; só a partir do v22.13/v23.4 funciona sem flag.
  console.error(
    `❌ Este bot requer Node.js 22.13+ (módulo nativo "node:sqlite" indisponível).\n` +
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

// WAL melhora leitura concorrente e deixa a escrita mais barata; o bot lê o
// cache de mapas com muito mais frequência do que escreve.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

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

  -- Um link por CONTA, não por opção de servidor: 'private' (Daycore) e
  -- 'private_rx' (Daycore RX) são o mesmo cadastro no Daycore, mudando só o
  -- mode (0 vs 4). Guardar os dois separadamente obrigaria a pessoa a linkar
  -- o mesmo nick duas vezes.
  CREATE TABLE IF NOT EXISTS user_links (
    discord_id TEXT    NOT NULL,
    namespace  TEXT    NOT NULL,  -- 'official' | 'daycore'
    osu_user   TEXT    NOT NULL,
    osu_id     INTEGER,
    PRIMARY KEY (discord_id, namespace)
  );

  -- Conteúdo bruto dos arquivos .osu. Antes eram baixados de novo (≈50KB cada)
  -- a cada cálculo de PP — inclusive ao virar página no /topplays, que refaz o
  -- cálculo das mesmas 5 plays. Equivale à osu_map_file_content do BathBot.
  CREATE TABLE IF NOT EXISTS beatmap_files (
    map_id     INTEGER PRIMARY KEY,
    content    BLOB    NOT NULL,
    fetched_at INTEGER NOT NULL
  );

  -- Metadados de beatmap (max_combo, difficulty_rating, título, artista).
  -- Substitui o beatmap_cache.json, que reescrevia o arquivo inteiro a cada
  -- mapa novo e não tinha limite de tamanho.
  CREATE TABLE IF NOT EXISTS beatmap_meta (
    map_id    INTEGER PRIMARY KEY,
    data      TEXT    NOT NULL,
    cached_at INTEGER NOT NULL
  );

  -- Atributos de dificuldade já calculados, por combinação mapa+mods+mecânica.
  -- Espelha a osu_map_difficulty do BathBot (PRIMARY KEY (map_id, mods)) e
  -- elimina o POST em /beatmaps/{id}/attributes que o getAdjustedStars fazia
  -- a cada exibição.
  CREATE TABLE IF NOT EXISTS map_difficulty (
    map_id    INTEGER NOT NULL,
    mods_bits INTEGER NOT NULL,
    lazer     INTEGER NOT NULL,
    stars     REAL    NOT NULL,
    max_combo INTEGER,
    PRIMARY KEY (map_id, mods_bits, lazer)
  );

  -- Estado interno do bot (ex: hash do conjunto de slash commands já
  -- registrado no Discord).
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- ── Vínculo de staff do Daycore ────────────────────────────────────────────
  -- SEPARADA de user_links de propósito, e não é a mesma coisa.
  --
  -- user_links é auto-declarado: /link set só confere que a conta existe, não
  -- que você é dono dela. Isso é inofensivo no propósito original (os comandos
  -- de consulta só mostram dados públicos — fingir ser outro não dá nada), e
  -- seria desastroso como base de permissão: bastaria linkar o nick de um
  -- admin para herdar os poderes dele.
  --
  -- Aqui o vínculo só entra por quem tem Administrator no Discord do Daycore,
  -- que é uma autoridade real: aquele servidor é controlado por quem manda no
  -- Daycore. O priv continua sendo lido do Daycore a cada comando, então
  -- tirar o cargo de alguém lá revoga o acesso no bot na hora.
  CREATE TABLE IF NOT EXISTS staff_links (
    discord_id  TEXT    PRIMARY KEY,
    osu_id      INTEGER NOT NULL,
    osu_name    TEXT,
    added_by    TEXT    NOT NULL,
    added_at    INTEGER NOT NULL
  );

  -- ── Nomeação de mapas do Daycore ───────────────────────────────────────────
  -- O bancho.py-ex não tem conceito de "fila de nomeação": ele só sabe aplicar
  -- um status final num mapa. Todo o processo social (quem nomeou, quantos
  -- faltam, histórico) vive aqui, e o Daycore só é tocado na decisão final.
  --
  -- A chave inclui o status alvo para que nomear um set para "ranked" e para
  -- "loved" sejam filas independentes.
  CREATE TABLE IF NOT EXISTS map_nominations (
    set_id        INTEGER NOT NULL,
    target_status INTEGER NOT NULL,
    discord_id    TEXT    NOT NULL,
    osu_id        INTEGER NOT NULL,
    osu_name      TEXT,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (set_id, target_status, discord_id)
  );

  -- Cache do que o mapa é, para a fila poder ser listada sem uma chamada de
  -- API por linha.
  CREATE TABLE IF NOT EXISTS nomination_maps (
    set_id     INTEGER PRIMARY KEY,
    artist     TEXT,
    title      TEXT,
    creator    TEXT,
    diff_count INTEGER,
    cached_at  INTEGER NOT NULL
  );

  -- Log local de tudo que o bot mandou o Daycore fazer. O bancho tem o log de
  -- auditoria dele (e recebe o osu! ID de quem pediu), mas ele não sabe que a
  -- ação veio do Discord nem de qual conta do Discord — isso só existe aqui.
  CREATE TABLE IF NOT EXISTS admin_actions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    action            TEXT    NOT NULL,  -- 'rank' | 'restrict' | 'unrestrict'
    target            TEXT    NOT NULL,  -- set_id ou osu_id do alvo
    detail            TEXT,
    actor_discord_id  TEXT    NOT NULL,
    actor_osu_id      INTEGER NOT NULL,
    actor_osu_name    TEXT,
    created_at        INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions (created_at DESC);
`);

// ─── Migração de schema: users.osu_id ─────────────────────────────────────────
// O link guardava só o nome do jogador, então quem trocasse de nick no osu!
// tinha o link quebrado silenciosamente (aparecia como "jogador não
// encontrado"). O ID nunca muda — passamos a guardá-lo e a usá-lo como fonte
// da verdade, mantendo o nome só para exibição.
// SQLite não tem ADD COLUMN IF NOT EXISTS, então checamos antes.
{
  const columns = db.prepare('PRAGMA table_info(users)').all();
  if (!columns.some(c => c.name === 'osu_id')) {
    db.exec('ALTER TABLE users ADD COLUMN osu_id INTEGER');
  }
  // Servidor usado quando o comando não especifica um. Guarda o valor
  // completo ('official' | 'private' | 'private_rx') para lembrar a
  // preferência entre Daycore vanilla e RX, que compartilham a mesma conta.
  if (!columns.some(c => c.name === 'preferred_server')) {
    db.exec('ALTER TABLE users ADD COLUMN preferred_server TEXT');
  }
}

// Marca de último uso, para a evicção do cache de .osu ser LRU e não FIFO —
// sem ela um mapa popular baixado há muito tempo seria descartado antes de um
// mapa recente que ninguém mais consulta.
{
  const columns = db.prepare('PRAGMA table_info(beatmap_files)').all();
  if (columns.length > 0 && !columns.some(c => c.name === 'last_used')) {
    db.exec('ALTER TABLE beatmap_files ADD COLUMN last_used INTEGER');
    db.exec('UPDATE beatmap_files SET last_used = fetched_at WHERE last_used IS NULL');
  }
}

/**
 * Namespace de conta a que um servidor pertence.
 * Daycore vanilla e RX são a mesma conta, então compartilham o link.
 */
function linkNamespace(server) {
  return server === 'official' ? 'official' : 'daycore';
}

// ─── Migração: link único → link por conta ────────────────────────────────────
// O modelo antigo guardava um só link em users(osu_user, osu_server, osu_id),
// então linkar o Daycore apagava o link do Bancho. Move o link existente para
// user_links e adota o servidor dele como preferido.
{
  const alreadyMigrated = db.prepare("SELECT value FROM meta WHERE key = 'links_migrated'").get();
  if (!alreadyMigrated) {
    const rows = db
      .prepare('SELECT discord_id, osu_user, osu_server, osu_id FROM users WHERE osu_user IS NOT NULL')
      .all();

    const insert = db.prepare(`
      INSERT INTO user_links (discord_id, namespace, osu_user, osu_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(discord_id, namespace) DO NOTHING
    `);
    const setPreferred = db.prepare('UPDATE users SET preferred_server = ? WHERE discord_id = ?');

    for (const row of rows) {
      const server = row.osu_server ?? 'official';
      insert.run(row.discord_id, linkNamespace(server), row.osu_user, row.osu_id ?? null);
      setPreferred.run(server, row.discord_id);
    }

    db.prepare("INSERT INTO meta (key, value) VALUES ('links_migrated', ?)").run(String(Date.now()));
    if (rows.length > 0) {
      console.log(`[db] Migrados ${rows.length} link(s) para o modelo por conta (user_links).`);
    }
  }
}

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
      .run(remaining ? (remaining.namespace === 'official' ? 'official' : 'private') : null, discordId);
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
  return db.prepare('SELECT preferred_server FROM users WHERE discord_id = ?').get(discordId)?.preferred_server ?? null;
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

// ─── Cache: arquivos .osu ─────────────────────────────────────────────────────

// Mapas ranked não mudam; os que mudam (loved/graveyard reupload) são raros o
// bastante para um TTL longo resolver sem precisar de checksum.
const MAP_FILE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

/**
 * Teto de mapas em cache. Cada .osu costuma ter ~50KB (mapas longos passam de
 * 300KB), então 1500 ≈ 75–150MB.
 *
 * Sem teto, qualquer pessoa com acesso ao bot podia encher o disco: basta
 * chamar /simulate com IDs de mapa diferentes em sequência, e cada um grava um
 * arquivo novo permanentemente. O cooldown limita a taxa, não o total.
 */
const MAP_FILE_MAX_ROWS = Number(process.env.BEATMAP_CACHE_MAX || 1500);

// Só reescreve last_used se a marca estiver velha, para um mapa lido em loop
// (ex: virar página no /topplays) não gerar uma escrita por leitura.
const LAST_USED_REFRESH_MS = 60 * 60 * 1000; // 1 hora

/** @returns {Uint8Array|null} */
function getBeatmapFile(mapId) {
  const row = db
    .prepare('SELECT content, fetched_at, last_used FROM beatmap_files WHERE map_id = ?')
    .get(mapId);
  if (!row) return null;

  const now = Date.now();
  if (now - row.fetched_at > MAP_FILE_TTL_MS) {
    db.prepare('DELETE FROM beatmap_files WHERE map_id = ?').run(mapId);
    return null;
  }

  if (now - (row.last_used ?? 0) > LAST_USED_REFRESH_MS) {
    db.prepare('UPDATE beatmap_files SET last_used = ? WHERE map_id = ?').run(now, mapId);
  }

  return row.content;
}

function setBeatmapFile(mapId, bytes) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO beatmap_files (map_id, content, fetched_at, last_used) VALUES (?, ?, ?, ?)
    ON CONFLICT(map_id) DO UPDATE SET
      content = excluded.content, fetched_at = excluded.fetched_at, last_used = excluded.last_used
  `).run(mapId, bytes, now, now);

  evictBeatmapFilesIfNeeded();
}

/** Descarta os menos usados recentemente até voltar ao teto. */
function evictBeatmapFilesIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM beatmap_files').get().c;
  if (count <= MAP_FILE_MAX_ROWS) return 0;

  const excess = count - MAP_FILE_MAX_ROWS;
  const result = db.prepare(`
    DELETE FROM beatmap_files WHERE map_id IN (
      SELECT map_id FROM beatmap_files
      ORDER BY COALESCE(last_used, fetched_at) ASC
      LIMIT ?
    )
  `).run(excess);

  return result.changes;
}

// ─── Cache: metadados de beatmap ──────────────────────────────────────────────

const MAP_META_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function getBeatmapMeta(mapId) {
  const row = db.prepare('SELECT data, cached_at FROM beatmap_meta WHERE map_id = ?').get(mapId);
  if (!row) return null;
  if (Date.now() - row.cached_at > MAP_META_TTL_MS) {
    db.prepare('DELETE FROM beatmap_meta WHERE map_id = ?').run(mapId);
    return null;
  }
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function setBeatmapMeta(mapId, data) {
  db.prepare(`
    INSERT INTO beatmap_meta (map_id, data, cached_at) VALUES (?, ?, ?)
    ON CONFLICT(map_id) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at
  `).run(mapId, JSON.stringify(data), Date.now());
}

// ─── Cache: atributos de dificuldade ──────────────────────────────────────────

/** @returns {{stars: number, maxCombo: number|null}|null} */
function getMapDifficulty(mapId, modsBits, lazer) {
  const row = db
    .prepare('SELECT stars, max_combo FROM map_difficulty WHERE map_id = ? AND mods_bits = ? AND lazer = ?')
    .get(mapId, modsBits, lazer ? 1 : 0);
  return row ? { stars: row.stars, maxCombo: row.max_combo ?? null } : null;
}

function setMapDifficulty(mapId, modsBits, lazer, stars, maxCombo) {
  db.prepare(`
    INSERT INTO map_difficulty (map_id, mods_bits, lazer, stars, max_combo) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(map_id, mods_bits, lazer) DO UPDATE SET
      stars = excluded.stars, max_combo = excluded.max_combo
  `).run(mapId, modsBits, lazer ? 1 : 0, stars, maxCombo ?? null);
}

// ─── Estado interno ───────────────────────────────────────────────────────────

function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

function setMeta(key, value) {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// ─── Vínculo de staff ─────────────────────────────────────────────────────────

function setStaffLink(discordId, osuId, osuName, addedBy) {
  db.prepare(`
    INSERT INTO staff_links (discord_id, osu_id, osu_name, added_by, added_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      osu_id = excluded.osu_id, osu_name = excluded.osu_name,
      added_by = excluded.added_by, added_at = excluded.added_at
  `).run(discordId, osuId, osuName ?? null, addedBy, Date.now());
}

function getStaffLink(discordId) {
  return db.prepare('SELECT * FROM staff_links WHERE discord_id = ?').get(discordId) ?? null;
}

function removeStaffLink(discordId) {
  return db.prepare('DELETE FROM staff_links WHERE discord_id = ?').run(discordId).changes > 0;
}

function listStaffLinks() {
  return db.prepare('SELECT * FROM staff_links ORDER BY added_at ASC').all();
}

// ─── Nomeação de mapas ────────────────────────────────────────────────────────

/** Registra (ou reafirma) a nomeação de um set por uma pessoa. */
function addNomination(setId, targetStatus, discordId, osuId, osuName) {
  db.prepare(`
    INSERT INTO map_nominations (set_id, target_status, discord_id, osu_id, osu_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(set_id, target_status, discord_id) DO UPDATE SET
      osu_id = excluded.osu_id, osu_name = excluded.osu_name
  `).run(setId, targetStatus, discordId, osuId, osuName ?? null, Date.now());
}

function removeNomination(setId, targetStatus, discordId) {
  const res = db.prepare(`
    DELETE FROM map_nominations WHERE set_id = ? AND target_status = ? AND discord_id = ?
  `).run(setId, targetStatus, discordId);
  return res.changes > 0;
}

function getNominations(setId, targetStatus) {
  return db.prepare(`
    SELECT discord_id, osu_id, osu_name, created_at
    FROM map_nominations
    WHERE set_id = ? AND target_status = ?
    ORDER BY created_at ASC
  `).all(setId, targetStatus);
}

/** Limpa a fila de um set — usado após aplicar, ou para descartar. */
function clearNominations(setId, targetStatus) {
  const res = db.prepare(`
    DELETE FROM map_nominations WHERE set_id = ? AND target_status = ?
  `).run(setId, targetStatus);
  return res.changes;
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

// ─── Encerramento ─────────────────────────────────────────────────────────────

function close() {
  try {
    db.close();
  } catch {
    // já fechado
  }
}

module.exports = {
  setLink, getLink, getAllLinks, removeLink, linkNamespace,
  setPreferredServer, getPreferredServer,
  setUserLang, getUserLang, removeUserLang,
  setServerLang, getServerLang, removeServerLang,
  getBeatmapFile, setBeatmapFile, evictBeatmapFilesIfNeeded,
  getBeatmapMeta, setBeatmapMeta,
  getMapDifficulty, setMapDifficulty,
  getMeta, setMeta,
  setStaffLink, getStaffLink, removeStaffLink, listStaffLinks,
  addNomination, removeNomination, getNominations, clearNominations,
  listPendingNominations, cacheNominationMap,
  logAdminAction, listAdminActions,
  close,
};
