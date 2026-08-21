/**
 * db/mapCache.js
 * Os quatro caches de mapa, todos no cache.db.
 *
 * O que eles têm em comum, e que os separa do resto do banco: **tudo aqui é
 * regenerável**. Apagar o cache.db inteiro custa algumas requisições e alguns
 * cálculos; apagar o bot.db custa os links e os vínculos de staff de todo mundo.
 * É por isso que são dois arquivos (ver connection.js).
 *
 * Cada um tem o seu jeito de não crescer para sempre, e a escolha entre eles não
 * é gosto:
 *
 *   beatmap_files   TTL + teto por LRU  — são BLOBs de ~50KB, o que pesa é o
 *                                         disco, e a leitura já toca a linha
 *   beatmap_meta    TTL                 — pequeno, e some sozinho ao vencer
 *   map_difficulty  nenhum              — função pura do arquivo do mapa
 *   fc_pp           teto por idade      — cresce por SCORE, não por mapa
 */

const metrics = require('../metrics');
const { db } = require('./connection');

// ─── Arquivos .osu ────────────────────────────────────────────────────────────

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
    .prepare('SELECT content, fetched_at, last_used FROM cache.beatmap_files WHERE map_id = ?')
    .get(mapId);
  if (!row) {
    metrics.cache('beatmapFile', false);
    return null;
  }

  const now = Date.now();
  if (now - row.fetched_at > MAP_FILE_TTL_MS) {
    db.prepare('DELETE FROM cache.beatmap_files WHERE map_id = ?').run(mapId);
    metrics.cache('beatmapFile', false);
    return null;
  }

  metrics.cache('beatmapFile', true);

  if (now - (row.last_used ?? 0) > LAST_USED_REFRESH_MS) {
    db.prepare('UPDATE cache.beatmap_files SET last_used = ? WHERE map_id = ?').run(now, mapId);
  }

  return row.content;
}

function setBeatmapFile(mapId, bytes) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO cache.beatmap_files (map_id, content, fetched_at, last_used) VALUES (?, ?, ?, ?)
    ON CONFLICT(map_id) DO UPDATE SET
      content = excluded.content, fetched_at = excluded.fetched_at, last_used = excluded.last_used
  `).run(mapId, bytes, now, now);

  evictBeatmapFilesIfNeeded();
}

/** Descarta os menos usados recentemente até voltar ao teto. */
function evictBeatmapFilesIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM cache.beatmap_files').get().c;
  if (count <= MAP_FILE_MAX_ROWS) return 0;

  return db.prepare(`
    DELETE FROM cache.beatmap_files WHERE map_id IN (
      SELECT map_id FROM cache.beatmap_files
      ORDER BY COALESCE(last_used, fetched_at) ASC
      LIMIT ?
    )
  `).run(count - MAP_FILE_MAX_ROWS).changes;
}

// ─── Metadados de beatmap ─────────────────────────────────────────────────────

const MAP_META_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function getBeatmapMeta(mapId) {
  const row = db.prepare('SELECT data, cached_at FROM cache.beatmap_meta WHERE map_id = ?').get(mapId);
  if (!row || Date.now() - row.cached_at > MAP_META_TTL_MS) {
    if (row) db.prepare('DELETE FROM cache.beatmap_meta WHERE map_id = ?').run(mapId);
    metrics.cache('beatmapMeta', false);
    return null;
  }

  try {
    const data = JSON.parse(row.data);
    metrics.cache('beatmapMeta', true);
    return data;
  } catch {
    metrics.cache('beatmapMeta', false);
    return null;
  }
}

function setBeatmapMeta(mapId, data) {
  db.prepare(`
    INSERT INTO cache.beatmap_meta (map_id, data, cached_at) VALUES (?, ?, ?)
    ON CONFLICT(map_id) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at
  `).run(mapId, JSON.stringify(data), Date.now());
}

// ─── Atributos de dificuldade ─────────────────────────────────────────────────

/**
 * @param {string} engine 'lazer' | 'akatsuki' — o mesmo eixo da fc_pp: o Relax
 *   é calculado por outro motor, e a estrela dele é outro número.
 * @returns {{stars: number, maxCombo: number|null}|null}
 */
function getMapDifficulty(mapId, mods, engine) {
  const row = db
    .prepare('SELECT stars, max_combo FROM cache.map_difficulty WHERE map_id = ? AND mods = ? AND engine = ?')
    .get(mapId, mods, engine);

  metrics.cache('mapDifficulty', Boolean(row));
  return row ? { stars: row.stars, maxCombo: row.max_combo ?? null } : null;
}

function setMapDifficulty(mapId, mods, engine, stars, maxCombo) {
  db.prepare(`
    INSERT INTO cache.map_difficulty (map_id, mods, engine, stars, max_combo) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(map_id, mods, engine) DO UPDATE SET
      stars = excluded.stars, max_combo = excluded.max_combo
  `).run(mapId, mods, engine, stars, maxCombo ?? null);
}

// ─── PP de FC ─────────────────────────────────────────────────────────────────

/**
 * Teto de entradas.
 *
 * Ao contrário das outras tabelas de cache, esta cresce por SCORE e não por
 * mapa: a chave inclui a distribuição de hits, então o mesmo mapa rende uma
 * linha por combinação distinta. Sem teto ela só aumenta — o mesmo cuidado que
 * o beatmap_files já toma, e pela mesma razão.
 *
 * Cada linha são algumas dezenas de bytes, então 20 mil ≈ 1–2MB: generoso o
 * bastante para o teto nunca ser sentido em uso normal.
 */
const FC_PP_MAX_ROWS = Number(process.env.FC_PP_CACHE_MAX || 20000);

/**
 * @param {{mapId: number, mods: string, engine: string,
 *          n300: number, n100: number, n50: number}} key
 * @returns {number|null}
 */
function getCachedFCpp({ mapId, mods, engine, n300, n100, n50 }) {
  const row = db.prepare(`
    SELECT pp FROM cache.fc_pp
    WHERE map_id = ? AND mods = ? AND engine = ? AND n300 = ? AND n100 = ? AND n50 = ?
  `).get(mapId, mods, engine, n300, n100, n50);

  metrics.cache('fcPP', Boolean(row));
  return row ? row.pp : null;
}

function setCachedFCpp({ mapId, mods, engine, n300, n100, n50 }, pp) {
  db.prepare(`
    INSERT INTO cache.fc_pp (map_id, mods, engine, n300, n100, n50, pp, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(map_id, mods, engine, n300, n100, n50) DO UPDATE SET
      pp = excluded.pp, cached_at = excluded.cached_at
  `).run(mapId, mods, engine, n300, n100, n50, pp, Date.now());

  evictFCppIfNeeded();
}

/**
 * Descarta as entradas mais antigas até voltar ao teto.
 *
 * Por idade de inserção, e não por último uso como no beatmap_files: aqui a
 * leitura não escreve nada (é uma consulta por score exibido, e marcar uso
 * transformaria toda página em escrita), então a idade é o único sinal
 * disponível — e ela ainda limita por quanto tempo um número pode ficar
 * desatualizado depois de um reupload.
 */
function evictFCppIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM cache.fc_pp').get().c;
  if (count <= FC_PP_MAX_ROWS) return 0;

  // O desempate por rowid não é detalhe: `cached_at` tem resolução de
  // milissegundo, e uma página de /topplays grava as 5 plays dentro do mesmo
  // milissegundo. Sem ele, o SQLite escolhe qualquer uma das empatadas — e a
  // evicção poderia comer a entrada recém-gravada em vez da antiga.
  return db.prepare(`
    DELETE FROM cache.fc_pp WHERE rowid IN (
      SELECT rowid FROM cache.fc_pp ORDER BY cached_at ASC, rowid ASC LIMIT ?
    )
  `).run(count - FC_PP_MAX_ROWS).changes;
}

module.exports = {
  getBeatmapFile, setBeatmapFile,
  getBeatmapMeta, setBeatmapMeta,
  getMapDifficulty, setMapDifficulty,
  getCachedFCpp, setCachedFCpp,
};
