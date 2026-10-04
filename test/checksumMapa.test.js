/**
 * O `.osu` guardado conferido contra o md5 que o score traz.
 *
 * O checksum de um mapa no osu! é o md5 do arquivo `.osu` — conferido nos 228
 * mapas do cache.db que tinham metadados, todos batendo. A API oficial manda
 * esse md5 em `beatmap.checksum` (best e recent) e o bancho.py em `map_md5`.
 * Com ele, dá para saber de graça se o arquivo guardado ainda é o do mapa, como
 * o Bathbot faz (manager/osu_map.rs, `ChecksumMismatch`).
 *
 * Mapa não travado (pending, WIP, graveyard) pode ser reenviado, e até agora o
 * arquivo velho valia por 30 dias — e a estrela e o FC pp calculados em cima
 * dele valiam para sempre, porque essas tabelas não têm prazo. Trocar só o
 * arquivo não basta: tudo que saiu dele tem de ir junto, inclusive o mapa
 * parseado que a thread guarda.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const db = require('../src/db');
const pp = require('../src/pp');
const wasmWorker = require('../src/pp/wasmWorker');
const officialApi = require('../src/osu/officialApi');
const osu = require('../src/osuClient');
const { mapaSintetico } = require('./helpers');

test.after(() => wasmWorker.close());

const md5 = (bytes) => crypto.createHash('md5').update(bytes).digest('hex');
const BANCHO = { pacote: 'rosu-pp-bancho', tipo: 'rosu' };

/** Arquivo, metadados, estrela e FC pp guardados para o mapa. */
function guardarTudo(mapId, bytes) {
  db.setBeatmapFile(mapId, bytes);
  db.setBeatmapMeta(mapId, { id: mapId, max_combo: 200, difficulty_rating: 4, status: 'pending' });
  db.setMapDifficulty(mapId, 'CL', 'rosu', 4.2, 200);
  db.setCachedFCpp({ mapId, mods: 'CL', engine: 'rosu', n300: 200, n100: 0, n50: 0 }, 123.4);
}

function sobrou(mapId) {
  return {
    arquivo:     db.getBeatmapFile(mapId) !== null,
    meta:        Boolean(db.getBeatmapMeta(mapId)),
    dificuldade: Boolean(db.getMapDifficulty(mapId, 'CL', 'rosu')),
    fcPp:        db.getCachedFCpp({ mapId, mods: 'CL', engine: 'rosu', n300: 200, n100: 0, n50: 0 }) !== null,
  };
}

const TUDO   = { arquivo: true, meta: true, dificuldade: true, fcPp: true };
const NADA   = { arquivo: false, meta: false, dificuldade: false, fcPp: false };

// ─── Banco ────────────────────────────────────────────────────────────────────

test('o md5 do arquivo guardado é o dos bytes; sem arquivo, nulo', () => {
  const bytes = mapaSintetico(50);
  db.setBeatmapFile(74_000_001, bytes);

  assert.equal(db.md5DoArquivoGuardado(74_000_001), md5(bytes));
  assert.equal(db.md5DoArquivoGuardado(74_000_002), null);
});

test('arquivo trocado muda o md5, mesmo com o anterior já calculado', () => {
  db.setBeatmapFile(74_000_011, mapaSintetico(50));
  db.md5DoArquivoGuardado(74_000_011);
  const novo = mapaSintetico(60);
  db.setBeatmapFile(74_000_011, novo);

  assert.equal(db.md5DoArquivoGuardado(74_000_011), md5(novo));
});

test('esquecerMapa apaga arquivo, metadados, estrela e FC pp — daquele mapa só', () => {
  guardarTudo(74_000_021, mapaSintetico(50));
  guardarTudo(74_000_022, mapaSintetico(50));

  db.esquecerMapa(74_000_021);

  assert.deepEqual(sobrou(74_000_021), NADA);
  assert.deepEqual(sobrou(74_000_022), TUDO);
});

// ─── Thread ───────────────────────────────────────────────────────────────────

test('a thread esquece o mapa parseado: o próximo cálculo pede os bytes de novo', async () => {
  const id = 74_000_031;
  const antes = await wasmWorker.calcular(BANCHO, 'difficulty', id, { mods: ['CL'] }, async () => mapaSintetico(200));

  await wasmWorker.esquecerMapa(id);

  let pediu = false;
  const depois = await wasmWorker.calcular(BANCHO, 'difficulty', id, { mods: ['CL'] }, async () => {
    pediu = true;
    return mapaSintetico(300);
  });

  assert.equal(pediu, true);
  assert.equal(antes.maxCombo, 200);
  assert.equal(depois.maxCombo, 300, 'o número saiu do mapa velho, ou de atributos dele');
});

test('esquecer mapa que a thread não tem não quebra nada', async () => {
  await wasmWorker.esquecerMapa(74_000_041);
  const r = await wasmWorker.calcular(BANCHO, 'difficulty', 74_000_041, { mods: ['CL'] }, async () => mapaSintetico(10));
  assert.equal(r.maxCombo, 10);
});

// ─── conferirChecksum ─────────────────────────────────────────────────────────

test('md5 igual ao do arquivo: nada muda', async () => {
  const bytes = mapaSintetico(50);
  guardarTudo(74_000_051, bytes);

  assert.equal(await pp.conferirChecksum(74_000_051, md5(bytes)), false);
  assert.deepEqual(sobrou(74_000_051), TUDO);
});

test('md5 diferente: o mapa mudou, e tudo que saiu do arquivo velho vai junto', async () => {
  const id = 74_000_061;
  guardarTudo(id, mapaSintetico(200));
  await wasmWorker.calcular(BANCHO, 'difficulty', id, { mods: ['CL'] }, async () => mapaSintetico(200));

  const novo = mapaSintetico(300);
  assert.equal(await pp.conferirChecksum(id, md5(novo).toUpperCase()), true);
  assert.deepEqual(sobrou(id), NADA);

  // E a thread também largou o mapa velho.
  const r = await wasmWorker.calcular(BANCHO, 'difficulty', id, { mods: ['CL'] }, async () => novo);
  assert.equal(r.maxCombo, 300);
});

test('o mesmo md5 que não bate não derruba o mapa duas vezes', async () => {
  // Score feito numa versão antiga do mapa: baixar de novo traz o arquivo atual,
  // que continua sem bater. Sem a memória, cada exibição baixaria outra vez.
  const id = 74_000_071;
  const antigo = md5(mapaSintetico(1));
  guardarTudo(id, mapaSintetico(50));

  assert.equal(await pp.conferirChecksum(id, antigo), true);
  guardarTudo(id, mapaSintetico(50));   // o download novo
  assert.equal(await pp.conferirChecksum(id, antigo), false);
  assert.deepEqual(sobrou(id), TUDO);
});

test('sem arquivo guardado, ou sem md5 que preste, não faz nada', async () => {
  db.setBeatmapMeta(74_000_081, { id: 74_000_081, max_combo: 1, difficulty_rating: 1 });

  assert.equal(await pp.conferirChecksum(74_000_081, md5(mapaSintetico(1))), false);
  assert.ok(db.getBeatmapMeta(74_000_081), 'apagou metadados de um mapa sem arquivo');

  guardarTudo(74_000_082, mapaSintetico(50));
  for (const lixo of [null, undefined, '', 'abc', 'z'.repeat(32)]) {
    assert.equal(await pp.conferirChecksum(74_000_082, lixo), false);
  }
  assert.deepEqual(sobrou(74_000_082), TUDO);
});

// ─── Onde é conferido ─────────────────────────────────────────────────────────

test('o enriquecimento confere o md5 de cada score, nos dois formatos', async t => {
  const original = officialApi.officialGet;
  officialApi.officialGet = async (_p, { params }) => ({
    beatmaps: params.ids.map(id => ({ id, max_combo: 9, difficulty_rating: 1, beatmapset: {} })),
  });
  t.after(() => { officialApi.officialGet = original; });

  guardarTudo(74_000_091, mapaSintetico(50));   // oficial: beatmap.checksum
  guardarTudo(74_000_092, mapaSintetico(50));   // bancho.py: map_md5
  guardarTudo(74_000_093, mapaSintetico(50));   // bate: fica
  const outro = md5(mapaSintetico(77));

  await osu.enrichBeatmapData([
    { beatmap: { id: 74_000_091, checksum: outro }, beatmapset: {} },
    { beatmap: { id: 74_000_092 }, map_md5: outro, beatmapset: {} },
    { beatmap: { id: 74_000_093, checksum: md5(mapaSintetico(50)) }, beatmapset: {} },
  ]);

  assert.equal(db.getBeatmapFile(74_000_091), null);
  assert.equal(db.getBeatmapFile(74_000_092), null);
  assert.notEqual(db.getBeatmapFile(74_000_093), null);
});

test('a linha do mapa (CS/AR/BPM/objetos) também esquece o arquivo velho', async () => {
  const id = 74_000_101;
  db.setBeatmapFile(id, mapaSintetico(200));
  assert.equal((await pp.getMapAttrs(id, [])).objects, 200);

  assert.equal(await pp.conferirChecksum(id, md5(mapaSintetico(300))), true);
  db.setBeatmapFile(id, mapaSintetico(300));   // o download novo

  assert.equal((await pp.getMapAttrs(id, [])).objects, 300);
});
