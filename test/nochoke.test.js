/**
 * O recálculo do /nochoke: trocar cada choke pelo PP de FC e reordenar.
 *
 * A parte que faz conta é a `unchoke`. Ela repete o truque de offset do
 * `/whatif` — o `weightedPP` só soma as 100 ponderadas, e o total do perfil
 * (bônus de playcount + cauda) volta como um desvio calculado uma vez. O que
 * este arquivo trava é: a reordenação, a contagem de chokes desfeitos, e que o
 * total resultante nunca cai abaixo do pp atual quando houve correção.
 */
const test = require('node:test');
const assert = require('node:assert');

const { unchoke, fcGrade } = require('../src/commands/nochoke');
const { weightedPP, WEIGHT } = require('../src/weightedPP');

// Referência independente da soma ponderada, para não comparar a peça com ela
// mesma.
const somaRef = plays =>
  plays.reduce((acc, p, i) => acc + p.pp * Math.pow(WEIGHT, i), 0);

test('reordena pelo FC pp e conta os chokes desfeitos', () => {
  const plays = [
    { pp: 300, id: 'a' },
    { pp: 250, id: 'b' },
    { pp: 200, id: 'c' },
  ];
  // b viraria 400 com FC (passa a ser a melhor); c não é choke.
  const fcpps = [null, 400, null];
  const profilePP = 1000;

  const r = unchoke(plays, fcpps, profilePP);

  assert.deepEqual(r.entries.map(e => e.play.id), ['b', 'a', 'c']);
  assert.deepEqual(r.entries.map(e => e.pp), [400, 300, 200]);
  assert.deepEqual(r.entries.map(e => e.unchoked), [true, false, false]);
  assert.equal(r.corrigidos, 1);
  // origIndex é a posição na ordem de pp da API (antes do sort): b era a #2.
  assert.deepEqual(r.entries.map(e => e.origIndex), [2, 1, 3]);
});

test('o offset do perfil é preservado no total novo', () => {
  const plays = [{ pp: 300 }, { pp: 250 }, { pp: 200 }];
  const fcpps = [null, 400, null];
  const profilePP = 1000;

  const antes  = somaRef(plays);
  const depois = somaRef([{ pp: 400 }, { pp: 300 }, { pp: 200 }]);
  const offset = profilePP - antes;

  const r = unchoke(plays, fcpps, profilePP);

  assert.ok(Math.abs(r.totalAntes  - profilePP) < 1e-9);
  assert.ok(Math.abs(r.totalDepois - (depois + offset)) < 1e-9);
  assert.ok(Math.abs(r.ganho - (depois - antes)) < 1e-9);
  assert.ok(r.totalDepois > r.totalAntes);
});

test('sem choke: ordem intacta, total igual ao do perfil, ganho zero', () => {
  const plays = [{ pp: 300, id: 'a' }, { pp: 250, id: 'b' }];
  const r = unchoke(plays, [null, null], 900);

  assert.deepEqual(r.entries.map(e => e.play.id), ['a', 'b']);
  assert.equal(r.corrigidos, 0);
  assert.ok(Math.abs(r.totalDepois - 900) < 1e-9);
  assert.ok(Math.abs(r.ganho) < 1e-9);
});

test('FC que pagaria menos não é correção', () => {
  const plays = [{ pp: 300 }, { pp: 250 }];
  const r = unchoke(plays, [null, 240], 900);

  assert.equal(r.corrigidos, 0);
  assert.deepEqual(r.entries.map(e => e.pp), [300, 250]);
});

test('play acima de 20 misses não é desfeita, mesmo com FC maior', () => {
  const plays = [
    { pp: 300, statistics: { count_miss: 5 } },
    { pp: 250, statistics: { count_miss: 21 } },
    { pp: 200, statistics: { count_miss: 20 } },
  ];
  // Todas teriam FC bem maior; só as de <=20 miss entram.
  const r = unchoke(plays, [800, 900, 700], 1000);

  assert.deepEqual(r.entries.map(e => e.unchoked).sort(), [false, true, true]);
  assert.equal(r.corrigidos, 2);
  // A de 21 miss ficou no pp real.
  assert.ok(r.entries.some(e => e.pp === 250 && !e.unchoked));
});

test('sem statistics na play, o limite de miss não barra (conta como 0)', () => {
  const r = unchoke([{ pp: 100 }], [400], 500);
  assert.equal(r.corrigidos, 1);
});

test('fcGrade: os misses viram 300 e a grade sobe', () => {
  // 950 de 1000 objetos em 300, 10 miss → com FC vira 960/1000 = 96% de 300 → S.
  const play = { mods: [], statistics: { count_300: 950, count_100: 40, count_50: 0, count_miss: 10 } };
  assert.equal(fcGrade(play), 'S');
});

test('fcGrade: HD/FL deixam o S e o SS pratas', () => {
  const s  = { mods: ['HD'], statistics: { count_300: 950, count_100: 40, count_50: 0, count_miss: 10 } };
  const ss = { mods: ['FL'], statistics: { count_300: 980, count_100: 0, count_50: 0, count_miss: 20 } };
  assert.equal(fcGrade(s), 'SH');
  assert.equal(fcGrade(ss), 'XH');
});

test('fcGrade: 82% de 300 no FC é A', () => {
  const play = { mods: [], statistics: { count_300: 800, count_100: 180, count_50: 0, count_miss: 20 } };
  assert.equal(fcGrade(play), 'A');
});

test('sem pp de perfil, o offset é zero (cai na soma ponderada)', () => {
  const plays = [{ pp: 300 }, { pp: 200 }];
  const fcpps = [null, 500];
  const r = unchoke(plays, fcpps, undefined);

  assert.ok(Math.abs(r.totalAntes - weightedPP(plays)) < 1e-9);
  assert.ok(Math.abs(r.totalDepois - weightedPP([{ pp: 500 }, { pp: 300 }])) < 1e-9);
});
