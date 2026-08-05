/**
 * beatmapCache.js
 * Cache de metadados de beatmap (max_combo, difficulty_rating, título, artista).
 *
 * Evita bater na API do osu! toda vez que um comando precisa desses dados —
 * o mesmo mapa aparece repetidamente entre comandos/jogadores, e sem cache
 * isso gera rajadas de requisições paralelas que estouram o rate limit da API
 * (resultando em max_combo faltando aleatoriamente em /topplays e /recent).
 *
 * Persistido em disco (beatmap_cache.json) e mantido em memória durante a execução.
 * TTL longo (30 dias) — esses dados praticamente não mudam para mapas ranked.
 */

const fs   = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, 'beatmap_cache.json');
const TTL_MS      = 30 * 24 * 60 * 60 * 1000; // 30 dias

let cache = {};
try {
  cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
} catch {
  cache = {};
}

// Debounce da escrita em disco — evita I/O a cada mapa individual quando
// vários chegam juntos (ex: página de topplays com 5 mapas novos).
let saveTimeout = null;
function persist() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    fs.writeFile(CACHE_PATH, JSON.stringify(cache), () => {});
  }, 500);
}

function get(beatmapId) {
  const entry = cache[beatmapId];
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    delete cache[beatmapId];
    return null;
  }
  return entry.data;
}

function set(beatmapId, data) {
  cache[beatmapId] = { data, cachedAt: Date.now() };
  persist();
}

module.exports = { get, set };
