/**
 * beatmapCache.js
 * Cache de metadados de beatmap (max_combo, difficulty_rating, título, artista).
 *
 * Evita bater na API do osu! toda vez que um comando precisa desses dados —
 * o mesmo mapa aparece repetidamente entre comandos/jogadores, e sem cache
 * isso gera rajadas de requisições paralelas que estouram o rate limit da API
 * (resultando em max_combo faltando aleatoriamente em /topplays e /recent).
 *
 * O armazenamento vive em cache.db (tabela beatmap_meta). Antes era um
 * beatmap_cache.json reescrito por inteiro (JSON.stringify do objeto todo) a
 * cada mapa novo, sem limite de tamanho nem evicção — tudo bem com 15 mapas,
 * caro com alguns milhares. Este módulo continua existindo como fachada para
 * não espalhar chamadas de db.* pelo osuClient.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

// Na raiz, não em src/: é dado de uma versão antiga do bot (ver paths.js).
const OLD_CACHE_PATH = path.join(require('./paths').ROOT, 'beatmap_cache.json');

// ─── Migração única do JSON antigo ────────────────────────────────────────────
function migrateFromJsonIfNeeded() {
  if (!fs.existsSync(OLD_CACHE_PATH)) return;

  let old;
  try {
    old = JSON.parse(fs.readFileSync(OLD_CACHE_PATH, 'utf8'));
  } catch {
    // Arquivo corrompido: não vale a pena migrar, o cache se reconstrói sozinho
    fs.renameSync(OLD_CACHE_PATH, `${OLD_CACHE_PATH}.corrupt`);
    return;
  }

  let migrated = 0;
  for (const [mapId, entry] of Object.entries(old)) {
    // O formato antigo era { data, cachedAt }; só migra o que ainda tem dado.
    if (entry?.data) {
      db.setBeatmapMeta(Number(mapId), entry.data);
      migrated++;
    }
  }

  // Renomeia em vez de apagar — fica como backup, igual à migração do db.js.
  fs.renameSync(OLD_CACHE_PATH, `${OLD_CACHE_PATH}.migrated`);
  console.log(`[beatmapCache] Migrados ${migrated} beatmap(s) de beatmap_cache.json para bot.db.`);
}

migrateFromJsonIfNeeded();

const get = (beatmapId) => db.getBeatmapMeta(beatmapId);
const set = (beatmapId, data) => db.setBeatmapMeta(beatmapId, data);

module.exports = { get, set };
