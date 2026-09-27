/**
 * O akatsuki-pp numa thread separada.
 *
 * Os dois builds (vendor/akatsuki-pp-akatsuki e vendor/akatsuki-pp-daycore) são
 * o osuAkatsuki/akatsuki-pp-rs no commit de cada servidor. Conferidos fora da
 * suíte contra os números publicados: 200 top plays de RX e 150 de vanilla do
 * Akatsuki batem no centésimo, e 255 de 256 de RX do Daycore (ver
 * akatsukiWorkerThread.js).
 *
 * Aqui fica o que o bot assume do motor e o que a thread acrescenta a ele —
 * sem cravar número, pelo mesmo motivo do rosuWorker.test.js: um commit novo
 * do motor não pode quebrar a suíte sem nada estar errado. O "igual" é sempre
 * contra o próprio pacote chamado aqui no processo.
 *
 * Roda contra o motor de verdade, com um `.osu` sintético.
 */
const test = require('node:test');
const assert = require('node:assert');

const akatsuki = require('akatsuki-pp-akatsuki');

const wasmWorker = require('../src/pp/wasmWorker');
const { mapaSintetico } = require('./helpers');

const AKATSUKI = { pacote: 'akatsuki-pp-akatsuki', tipo: 'akatsuki' };
const DAYCORE  = { pacote: 'akatsuki-pp-daycore',  tipo: 'akatsuki' };

const RX = 128;
const DT = 64;
const NC = 512;
const HD = 8;

test.after(() => wasmWorker.close());

const MAPA = mapaSintetico(300);
const bytesDe = () => Promise.resolve(MAPA);

let proximoMapa = 12000;
const novoMapa = () => proximoMapa++;

/** O mesmo cálculo feito aqui, para comparar com o que a thread devolve. */
function noProcesso(...args) {
  const beatmap = new akatsuki.Beatmap(MAPA);
  try {
    const [pp, stars, maxCombo] = akatsuki.performance(beatmap, ...args);
    return { pp, stars, maxCombo };
  } finally {
    beatmap.free();
  }
}

test('o Relax sai de outro algoritmo que o vanilla', async () => {
  const mapa = novoMapa();
  const vanilla = await wasmWorker.calcular(AKATSUKI, 'difficulty', mapa, { mods: DT }, bytesDe);
  const relax   = await wasmWorker.calcular(AKATSUKI, 'difficulty', mapa, { mods: DT | RX }, bytesDe);

  assert.ok(Number.isFinite(vanilla?.stars) && Number.isFinite(relax?.stars));
  assert.notEqual(relax.stars, vanilla.stars, 'o bit do RX não mudou o algoritmo');
  assert.equal(relax.maxCombo, 300);
});

test('pela accuracy o número é o do motor com a accuracy dos hits', async () => {
  // É assim que o score-service do Akatsuki pede o PP: accuracy + misses, e o
  // motor redistribui 100s e 50s pela própria conta.
  const play = { mods: RX | HD, n300: 270, n100: 0, n50: 25, misses: 5, combo: 150 };
  const acc = (100 * (270 * 300 + 25 * 50)) / (300 * 300);

  const viaAcc = await wasmWorker.calcular(AKATSUKI, 'simulate', novoMapa(), { ...play, viaAcc: true }, bytesDe);
  const viaHits = await wasmWorker.calcular(AKATSUKI, 'simulate', novoMapa(), { ...play, viaAcc: false }, bytesDe);

  assert.equal(viaAcc.pp, noProcesso(RX | HD, undefined, undefined, undefined, 5, 150, acc).pp);
  assert.equal(viaHits.pp, noProcesso(RX | HD, 270, 0, 25, 5, 150, undefined).pp);
  assert.notEqual(viaAcc.pp, viaHits.pp, 'as duas entradas deram o mesmo número: o teste não distingue nada');
});

test('pela accuracy, sem o n300, ele sai do total de objetos', async () => {
  const comN300 = await wasmWorker.calcular(AKATSUKI, 'simulate', novoMapa(),
    { mods: RX, n300: 290, n100: 8, n50: 0, misses: 2, combo: 100, viaAcc: true }, bytesDe);
  const semN300 = await wasmWorker.calcular(AKATSUKI, 'simulate', novoMapa(),
    { mods: RX, n300: null, n100: 8, n50: 0, misses: 2, combo: 100, viaAcc: true }, bytesDe);

  assert.equal(semN300.pp, comN300.pp);
});

test('o NC sozinho calcula como DT', async () => {
  // O motor lê a velocidade só do bit do DT (ver akatsukiWorkerThread.js).
  const mapa = novoMapa();
  const nc   = await wasmWorker.calcular(AKATSUKI, 'difficulty', mapa, { mods: RX | NC }, bytesDe);
  const dtnc = await wasmWorker.calcular(AKATSUKI, 'difficulty', mapa, { mods: RX | DT | NC }, bytesDe);
  const nada = await wasmWorker.calcular(AKATSUKI, 'difficulty', mapa, { mods: RX }, bytesDe);

  assert.equal(nc.stars, dtnc.stars);
  assert.notEqual(nc.stars, nada.stars);
});

test('o FC troca os misses por 300 e assume o combo cheio', async () => {
  for (const viaAcc of [true, false]) {
    const mapa = novoMapa();
    const fc = await wasmWorker.calcular(AKATSUKI, 'fc', mapa,
      { mods: RX, n300: 280, n100: 10, n50: 0, misses: 10, viaAcc }, bytesDe);
    const ss = await wasmWorker.calcular(AKATSUKI, 'simulate', mapa,
      { mods: RX, n300: 290, n100: 10, n50: 0, misses: 0, combo: -1, viaAcc }, bytesDe);

    assert.ok(Number.isFinite(fc?.pp));
    assert.equal(fc.pp, ss.pp);
  }
});

test('os dois builds concordam numa play completa', async () => {
  // Entre os dois commits só muda o `passed_objects` do osu_2019, que play
  // completa não usa. Divergir aqui quer dizer que um build foi trocado.
  const play = { mods: RX | DT, n300: 280, n100: 15, n50: 2, misses: 3, combo: 120, viaAcc: false };
  const a = await wasmWorker.calcular(AKATSUKI, 'simulate', novoMapa(), play, bytesDe);
  const d = await wasmWorker.calcular(DAYCORE,  'simulate', novoMapa(), play, bytesDe);

  assert.ok(Number.isFinite(d?.pp), 'o build do Daycore não calculou');
  assert.equal(d.pp, a.pp);
  assert.ok(wasmWorker.stats()['akatsuki-pp-daycore'].bytesEnviados > 0, 'o Daycore leu o mapa da thread do Akatsuki');
});

test('mapa ilegível responde erro e a thread continua', async () => {
  const ruim = await wasmWorker.calcular(AKATSUKI, 'difficulty', novoMapa(), { mods: RX },
    async () => Buffer.from('isto não é um beatmap'));
  // O akatsuki-pp pode recusar ou devolver um mapa vazio; o que não pode é
  // aparecer estrela de mapa com objeto.
  assert.ok(ruim === null || !ruim.maxCombo);

  const bom = await wasmWorker.calcular(AKATSUKI, 'difficulty', novoMapa(), { mods: RX }, bytesDe);
  assert.ok(Number.isFinite(bom?.stars), 'a thread deveria ter sobrevivido');
});
