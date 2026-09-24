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
 *
 * (A importação daquele JSON morava aqui e saiu: é cache, e o que não foi
 * importado se refaz sozinho na primeira consulta de cada mapa.)
 */

const db = require('./db');

const get = (beatmapId) => db.getBeatmapMeta(beatmapId);
const set = (beatmapId, data) => db.setBeatmapMeta(beatmapId, data);

module.exports = { get, set };
