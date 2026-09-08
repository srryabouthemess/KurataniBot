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

const { unchoke } = require('../src/commands/nochoke');
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

test('sem pp de perfil, o offset é zero (cai na soma ponderada)', () => {
  const plays = [{ pp: 300 }, { pp: 200 }];
  const fcpps = [null, 500];
  const r = unchoke(plays, fcpps, undefined);

  assert.ok(Math.abs(r.totalAntes - weightedPP(plays)) < 1e-9);
  assert.ok(Math.abs(r.totalDepois - weightedPP([{ pp: 500 }, { pp: 300 }])) < 1e-9);
});
