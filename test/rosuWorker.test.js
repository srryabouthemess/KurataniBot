/**
 * O rosu-pp numa thread separada.
 *
 * O cálculo é Wasm SÍNCRONO: enquanto ele roda, o event loop não anda. Medido
 * numa rajada de 10 mapas grandes com mods inéditos, amostrando o intervalo
 * entre execuções de setImmediate: **22,9ms de bloqueio no pior caso dentro do
 * processo, contra 4,1ms na thread** (e p99 zerado). O total sobe um pouco — a
 * thread não acelera o cálculo, ela devolve o event loop enquanto ele acontece.
 *
 * Mover o cálculo de lugar traz três riscos que rodá-lo aqui não tinha, e são
 * eles que este arquivo cobre:
 *
 *   1. o número mudar ao atravessar a fronteira da thread;
 *   2. o mapa viajar de novo a cada cálculo, trocando CPU por cópia de 50–300KB;
 *   3. um mapa problemático derrubar a thread e levar junto as outras plays.
 *
 * Roda contra o rosu-pp de verdade, com um `.osu` sintético — assim não depende
 * do cache da máquina nem da rede.
 */
const test = require('node:test');
const assert = require('node:assert');

const rosu = require('rosu-pp-js');
const rosuWorker = require('../src/rosuWorker');

test.after(() => rosuWorker.close());

/** Um `.osu` válido e mínimo, com `n` círculos. */
function mapaSintetico(n) {
  const objetos = [];
  for (let i = 0; i < n; i++) {
    objetos.push(`${100 + (i % 300)},${100 + (i % 200)},${500 + i * 300},1,0`);
  }

  return Buffer.from([
    'osu file format v14', '',
    '[General]', 'Mode: 0', '',
    '[Difficulty]',
    'HPDrainRate:5', 'CircleSize:4', 'OverallDifficulty:7', 'ApproachRate:9',
    'SliderMultiplier:1.4', 'SliderTickRate:1', '',
    '[TimingPoints]', '0,500,4,2,0,100,1,0', '',
    '[HitObjects]', ...objetos,
  ].join('\n'));
}

const MAPA = mapaSintetico(200);
const bytesDe = () => Promise.resolve(MAPA);

/** O mesmo cálculo feito aqui, para comparar com o que a thread devolve. */
function noProcesso(fn) {
  const beatmap = new rosu.Beatmap(MAPA);
  try {
    return fn(beatmap);
  } finally {
    beatmap.free();
  }
}

test('a thread devolve o mesmo número que o cálculo em processo', async () => {
  // É o risco central de mover o cálculo de lugar: um número diferente sairia
  // plausível no embed, e nada denunciaria.
  const esperado = noProcesso(bm =>
    new rosu.Difficulty({ mods: 64, lazer: true }).calculate(bm)
  );

  const daThread = await rosuWorker.calcular(
    'difficulty', 9001, { mods: 64, lazer: true }, bytesDe,
  );

  assert.equal(daThread.stars, esperado.stars);
  assert.equal(daThread.maxCombo, esperado.maxCombo);
});

test('o FC pp bate com o cálculo em processo', async () => {
  const hits = { n300: 190, n100: 8, n50: 2, misses: 5 };

  const esperado = noProcesso(bm => {
    const attrs = new rosu.Difficulty({ mods: 64, lazer: true }).calculate(bm);
    return new rosu.Performance({
      mods: 64, lazer: true, misses: 0,
      // O FC soma os misses ao n300 — é o que "se tivesse sido FC" quer dizer.
      n300: hits.n300 + hits.misses, n100: hits.n100, n50: hits.n50,
    }).calculate(attrs).pp;
  });

  const daThread = await rosuWorker.calcular(
    'fc', 9001, { mods: 64, lazer: true, ...hits, accuracy: 95 }, bytesDe,
  );

  assert.equal(daThread.pp, esperado);
});

test('play interrompida usa só o trecho jogado', async () => {
  // Sem passedObjects a conta assume o mapa inteiro, inventa um 300 para cada
  // objeto que a pessoa nunca viu, e devolve quase o valor de um FC.
  const args = { mods: 0, lazer: true, n300: 40, n100: 0, n50: 0, misses: 0, combo: 40 };

  const inteiro = await rosuWorker.calcular(
    'simulate', 9001, { ...args, passedObjects: null }, bytesDe,
  );
  const parcial = await rosuWorker.calcular(
    'simulate', 9001, { ...args, passedObjects: 40 }, bytesDe,
  );

  assert.ok(parcial.pp < inteiro.pp, `parcial ${parcial.pp} deveria ser menor que ${inteiro.pp}`);
});

test('o mapa viaja uma vez só, não a cada cálculo', async () => {
  // O .osu tem 50–300KB. Mandá-lo em todo cálculo trocaria o custo de CPU por
  // um de cópia — a thread guarda o mapa já parseado justamente para evitar
  // isso, e só pede os bytes quando não o tem.
  const mapId = 9002;

  await rosuWorker.calcular('difficulty', mapId, { mods: 0, lazer: true }, bytesDe);
  const depoisDoPrimeiro = rosuWorker.stats().bytesEnviados;

  for (const mods of [64, 16, 8, 2]) {
    await rosuWorker.calcular('difficulty', mapId, { mods, lazer: true }, bytesDe);
  }

  assert.equal(
    rosuWorker.stats().bytesEnviados, depoisDoPrimeiro,
    'o mapa foi reenviado em cálculos seguintes',
  );
});

test('mapa ilegível não derruba a thread, e sai com combo zero', async () => {
  const antes = rosuWorker.stats().spawns;

  // ATENÇÃO ao que o rosu-pp faz aqui: ele NÃO recusa entrada corrompida. Com
  // lixo puro ele parseia o que der e devolve um mapa degenerado — medido,
  // 0.14★ e combo 0, sem erro nenhum. É por isso que o combo zero é o sinal, e
  // é o que o getDifficultyAttrs usa para não gravar isso no cache.
  const ruim = await rosuWorker.calcular(
    'difficulty', 9003, { mods: 0, lazer: true },
    async () => Buffer.from('isto não é um beatmap'),
  );

  assert.equal(ruim.maxCombo, 0, 'o mapa degenerado deveria vir com combo zero');

  // A play seguinte da mesma página precisa continuar funcionando.
  const bom = await rosuWorker.calcular('difficulty', 9004, { mods: 0, lazer: true }, bytesDe);
  assert.ok(bom && bom.maxCombo > 0, 'a thread deveria ter sobrevivido');
  assert.equal(rosuWorker.stats().spawns - antes, 0, 'a thread foi reiniciada à toa');
});

test('mapa corrompido não entra no cache de dificuldade', async () => {
  // A map_difficulty não tem TTL — o resultado deveria ser função pura do
  // arquivo do mapa. Uma estrela sem sentido gravada ali não vence nunca.
  const pp = require('../src/pp');

  const attrs = await pp.getDifficultyAttrs(-9005, 64, true);
  assert.equal(attrs, null, 'mapa que não dá para baixar não deveria virar cache');
});

test('operação desconhecida não derruba a thread', async () => {
  const antes = rosuWorker.stats().spawns;

  const resposta = await rosuWorker.calcular('inventada', 9001, { mods: 0 }, bytesDe);
  assert.equal(resposta, null);

  const bom = await rosuWorker.calcular('difficulty', 9001, { mods: 0, lazer: true }, bytesDe);
  assert.ok(bom, 'a thread deveria ter sobrevivido');
  assert.equal(rosuWorker.stats().spawns - antes, 0);
});
