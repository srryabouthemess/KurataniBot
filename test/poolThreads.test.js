/**
 * Mais de uma thread por motor.
 *
 * Era uma thread por build: duas pessoas ao mesmo tempo, ou as 100 plays de um
 * /nochoke frio, entravam todas na mesma fila. No Bathbot o cálculo roda em
 * todas as threads do runtime do tokio. Aqui são `PP_THREADS` por build, e o
 * mapa escolhe a thread (`mapId % N`): o mesmo mapa cai sempre na mesma, que é
 * onde estão o mapa parseado e os atributos de dificuldade dele.
 */
process.env.PP_THREADS = '2';

const test = require('node:test');
const assert = require('node:assert');

const wasmWorker = require('../src/pp/wasmWorker');
const { mapaSintetico } = require('./helpers');

test.after(() => wasmWorker.close());

const BANCHO  = { pacote: 'rosu-pp-bancho',  tipo: 'rosu' };
const DAYCORE = { pacote: 'rosu-pp-daycore', tipo: 'rosu' };

/** Bytes que contam quantas vezes foram pedidos. */
function contador(n = 100) {
  const pedidos = new Map();
  const bytesDe = (mapId) => async () => {
    pedidos.set(mapId, (pedidos.get(mapId) ?? 0) + 1);
    return mapaSintetico(n);
  };
  return { pedidos, bytesDe };
}

test('mapas de ids com restos diferentes sobem threads diferentes', async () => {
  const { bytesDe } = contador();
  await wasmWorker.calcular(BANCHO, 'difficulty', 75_000_000, { mods: [] }, bytesDe(75_000_000));
  await wasmWorker.calcular(BANCHO, 'difficulty', 75_000_001, { mods: [] }, bytesDe(75_000_001));

  assert.equal(wasmWorker.stats()['rosu-pp-bancho'].threads, 2);
});

test('o mesmo mapa cai sempre na mesma thread: os bytes viajam uma vez', async () => {
  const { pedidos, bytesDe } = contador();
  for (const id of [75_000_010, 75_000_011, 75_000_010, 75_000_011, 75_000_010]) {
    const r = await wasmWorker.calcular(BANCHO, 'difficulty', id, { mods: [] }, bytesDe(id));
    assert.equal(r.maxCombo, 100);
  }

  assert.deepEqual([...pedidos.values()], [1, 1]);
});

test('esquecerMapa chega à thread que tem o mapa', async () => {
  const id = 75_000_021;
  const { pedidos, bytesDe } = contador();
  await wasmWorker.calcular(BANCHO, 'difficulty', id, { mods: [] }, bytesDe(id));

  await wasmWorker.esquecerMapa(id);
  await wasmWorker.calcular(BANCHO, 'difficulty', id, { mods: [] }, bytesDe(id));

  assert.equal(pedidos.get(id), 2);
});

test('com PP_THREADS=1, uma thread só', async t => {
  // Lido quando o build recebe o primeiro pedido: o do Daycore ainda não recebeu.
  process.env.PP_THREADS = '1';
  t.after(() => { process.env.PP_THREADS = '2'; });

  const { bytesDe } = contador();
  await wasmWorker.calcular(DAYCORE, 'difficulty', 75_000_030, { mods: [] }, bytesDe(75_000_030));
  await wasmWorker.calcular(DAYCORE, 'difficulty', 75_000_031, { mods: [] }, bytesDe(75_000_031));

  assert.equal(wasmWorker.stats()['rosu-pp-daycore'].threads, 1);
});
