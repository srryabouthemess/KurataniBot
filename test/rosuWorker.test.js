/**
 * O rosu-pp numa thread separada.
 *
 * Depois que estrelas e PP passaram para o lazer-calculator (ver
 * lazerWorker.test.js), o que sobrou para o rosu-pp é a única coisa que o motor
 * novo não expõe: CS/AR/OD/HP ajustados por mod, BPM e contagem de objetos.
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
const { mapaSintetico } = require('./helpers');

test.after(() => rosuWorker.close());

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

test('os atributos do mapa saem já ajustados pelos mods', async () => {
  // A conta de AR/OD com mod de velocidade não é multiplicação: a janela de
  // tempo é que muda. É o motivo de o cálculo ficar do lado do rosu-pp em vez
  // de virar uma segunda implementação em JS — o mapa sintético tem AR 9 e
  // OD 7, e nenhum dos dois vira 13.5 nem 10.5 no DT.
  const semMods = await rosuWorker.calcular('attributes', 9001, { mods: 0 }, bytesDe);
  const comDT   = await rosuWorker.calcular('attributes', 9001, { mods: 64 }, bytesDe);

  const esperado = noProcesso(bm =>
    new rosu.BeatmapAttributesBuilder({ map: bm, mods: 64 }).build()
  );

  assert.equal(semMods.ar, 9);
  assert.equal(semMods.od, 7);
  assert.equal(comDT.ar, esperado.ar);
  assert.equal(comDT.od, esperado.od);
  assert.equal(comDT.clockRate, 1.5);

  // BPM e contagem de objetos vêm do mesmo mapa parseado: é o que evita uma
  // requisição a mais só para a linha de informação do embed. São também os dois
  // únicos valores que o lazer-calculator não sabe dar, e a razão de esta thread
  // continuar existindo.
  assert.equal(comDT.bpm, semMods.bpm * 1.5);
  assert.equal(comDT.objects, 200);
});

test('o rate ajustado chega como número, porque no bit ele não cabe', async () => {
  // Um DT a 1,4x é play diferente de um DT comum, e é aqui que a diferença
  // aparece na tela: BPM e AR/OD. O bitmask não tem onde guardar o ajuste, então
  // ele viaja ao lado — e o resultado tem de bater com o do rosu-pp recebendo os
  // mods como objeto, que é o caminho que NÃO se usa (ver rosuWorkerThread.js).
  const dtCheio    = await rosuWorker.calcular('attributes', 9005, { mods: 64 }, bytesDe);
  const dtAjustado = await rosuWorker.calcular(
    'attributes', 9005, { mods: 64, clockRate: 1.4 }, bytesDe,
  );

  const esperado = noProcesso(bm =>
    new rosu.BeatmapAttributesBuilder({
      map: bm, mods: [{ acronym: 'DT', settings: { speed_change: 1.4 } }],
    }).build()
  );

  assert.equal(dtAjustado.clockRate, 1.4);
  assert.equal(dtAjustado.ar, esperado.ar);
  assert.equal(dtAjustado.od, esperado.od);
  assert.equal(dtAjustado.bpm, 120 * 1.4);

  // E não é o mesmo mapa que o DT sem ajuste: se empatar, o ajuste se perdeu no
  // caminho e a linha do embed voltou a mentir em silêncio.
  assert.ok(dtAjustado.ar < dtCheio.ar, `AR ${dtAjustado.ar} deveria ficar abaixo de ${dtCheio.ar}`);
});

test('sem rate informado, quem manda continua sendo o bitmask', async () => {
  // O `clockRate` nulo é o "deduza dos mods" do rosu-pp. Se ele virasse 1 por
  // engano, todo score de DT passaria a exibir o mapa em velocidade normal.
  const semRate = await rosuWorker.calcular('attributes', 9006, { mods: 64 }, bytesDe);
  const nulo    = await rosuWorker.calcular('attributes', 9006, { mods: 64, clockRate: null }, bytesDe);

  assert.equal(semRate.clockRate, 1.5);
  assert.equal(nulo.clockRate, 1.5);
});

test('o mapa viaja uma vez só, não a cada cálculo', async () => {
  // O .osu tem 50–300KB. Mandá-lo em todo cálculo trocaria o custo de CPU por
  // um de cópia — a thread guarda o mapa já parseado justamente para evitar
  // isso, e só pede os bytes quando não o tem.
  const mapId = 9002;

  await rosuWorker.calcular('attributes', mapId, { mods: 0 }, bytesDe);
  const depoisDoPrimeiro = rosuWorker.stats().bytesEnviados;

  for (const mods of [64, 16, 8, 2]) {
    await rosuWorker.calcular('attributes', mapId, { mods }, bytesDe);
  }

  assert.equal(
    rosuWorker.stats().bytesEnviados, depoisDoPrimeiro,
    'o mapa foi reenviado em cálculos seguintes',
  );
});

test('mapa ilegível não derruba a thread', async () => {
  const antes = rosuWorker.stats().spawns;

  // ATENÇÃO ao que o rosu-pp faz aqui: ele NÃO recusa entrada corrompida. Com
  // lixo puro ele parseia o que der e devolve um mapa degenerado — sem objeto
  // nenhum e sem erro. É por isso que o getMapAttrs trata `objects` zerado como
  // "não sei", em vez de confiar no que voltou.
  const ruim = await rosuWorker.calcular(
    'attributes', 9003, { mods: 0 },
    async () => Buffer.from('isto não é um beatmap'),
  );

  assert.equal(ruim.objects, 0, 'o mapa degenerado deveria vir sem objetos');

  // A play seguinte da mesma página precisa continuar funcionando.
  const bom = await rosuWorker.calcular('attributes', 9004, { mods: 0 }, bytesDe);
  assert.ok(bom && bom.objects > 0, 'a thread deveria ter sobrevivido');
  assert.equal(rosuWorker.stats().spawns - antes, 0, 'a thread foi reiniciada à toa');
});

test('operação desconhecida não derruba a thread', async () => {
  const antes = rosuWorker.stats().spawns;

  const resposta = await rosuWorker.calcular('inventada', 9001, { mods: 0 }, bytesDe);
  assert.equal(resposta, null);

  const bom = await rosuWorker.calcular('attributes', 9001, { mods: 0 }, bytesDe);
  assert.ok(bom, 'a thread deveria ter sobrevivido');
  assert.equal(rosuWorker.stats().spawns - antes, 0);
});
