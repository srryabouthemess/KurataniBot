/**
 * O `.osu` de mapa ranked, approved ou loved não vence: o osu! não aceita
 * reupload nesses status. O de mapa que ainda pode mudar continua com o prazo.
 *
 * Roda contra bancos descartáveis (KURATANI_DATA_DIR), definidos ANTES de
 * qualquer require de src/ — mesmo motivo do fcPpCache.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kuratani-mapfile-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;

const db = require('../src/db');
const { db: conn } = require('../src/db/connection');

test.after(() => {
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const BYTES = new Uint8Array([1, 2, 3]);
const VELHO = Date.now() - 31 * 24 * 60 * 60 * 1000;

/** Grava o arquivo como se tivesse sido baixado há 31 dias. */
function arquivoVelho(mapId) {
  db.setBeatmapFile(mapId, BYTES);
  conn.prepare('UPDATE cache.beatmap_files SET fetched_at = ? WHERE map_id = ?').run(VELHO, mapId);
}

test('arquivo vencido de mapa ranked, approved ou loved continua no cache', () => {
  for (const [mapId, status] of [[101, 'ranked'], [102, 'approved'], [103, 'loved']]) {
    db.setBeatmapMeta(mapId, { id: mapId, status });
    arquivoVelho(mapId);
    assert.deepEqual([...db.getBeatmapFile(mapId)], [...BYTES], status);
  }
});

test('meta vencida ainda vale para o status', () => {
  db.setBeatmapMeta(104, { id: 104, status: 'ranked' });
  conn.prepare('UPDATE cache.beatmap_meta SET cached_at = ? WHERE map_id = ?').run(VELHO, 104);
  arquivoVelho(104);
  assert.ok(db.getBeatmapFile(104));
});

test('arquivo vencido de mapa que pode mudar sai do cache', () => {
  db.setBeatmapMeta(201, { id: 201, status: 'qualified' });
  arquivoVelho(201);
  assert.equal(db.getBeatmapFile(201), null);

  db.setBeatmapMeta(202, { id: 202, status: 'graveyard' });
  arquivoVelho(202);
  assert.equal(db.getBeatmapFile(202), null);
});

test('sem meta guardada, vale o prazo', () => {
  arquivoVelho(301);
  assert.equal(db.getBeatmapFile(301), null);
});

test('arquivo dentro do prazo é lido normalmente', () => {
  db.setBeatmapFile(401, BYTES);
  assert.ok(db.getBeatmapFile(401));
});
