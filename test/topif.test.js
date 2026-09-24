/**
 * O recálculo do /topif: aplicar um modificador de mods em cada top play e
 * reordenar pelo pp novo.
 *
 * Três peças puras, testadas em isolamento:
 * - `parseModAction` lê o texto digitado (`+HD`, `+HDHR!`, `-HD!`).
 * - `applyModAction` aplica esse modificador nos mods de UMA play.
 * - `buildTopIf` reordena a lista e refaz a conta do total, com o mesmo truque
 *   de offset do `/nochoke` e do `/whatif`.
 */
const test = require('node:test');
const assert = require('node:assert');

const { parseModAction, applyModAction, buildTopIf, adjustGradeForMods } = require('../src/commands/osu/topif/logic');
const { weightedPP, WEIGHT } = require('../src/weightedPP');

const somaRef = plays =>
  plays.reduce((acc, p, i) => acc + p.pp * Math.pow(WEIGHT, i), 0);

// ─── parseModAction ───────────────────────────────────────────────────────────

test('parseModAction: "+HD" insere', () => {
  assert.deepEqual(parseModAction('+HD'), { type: 'insert', mods: ['HD'] });
});

test('parseModAction: "+HDHR!" substitui por exato', () => {
  assert.deepEqual(parseModAction('+HDHR!'), { type: 'exact', mods: ['HD', 'HR'] });
});

test('parseModAction: "-HD!" remove', () => {
  assert.deepEqual(parseModAction('-HD!'), { type: 'exclude', mods: ['HD'] });
});

test('parseModAction: aceita taxa, tipo "+DT1.4!"', () => {
  assert.deepEqual(parseModAction('+DT1.4!'), {
    type: 'exact',
    mods: [{ acronym: 'DT', settings: { speed_change: 1.4 } }],
  });
});

test('parseModAction: ignora espaço e caixa', () => {
  assert.deepEqual(parseModAction('  +hd  '), { type: 'insert', mods: ['HD'] });
});

test('parseModAction: sem sinal é inválido', () => {
  assert.equal(parseModAction('HD'), null);
});

test('parseModAction: mod desconhecido é inválido', () => {
  assert.equal(parseModAction('+XY'), null);
});

test('parseModAction: sem mod nenhum é inválido', () => {
  assert.equal(parseModAction('+!'), null);
});

test('parseModAction: excluir sem "!" é inválido', () => {
  assert.equal(parseModAction('-HD'), null);
});

// ─── applyModAction ───────────────────────────────────────────────────────────

test('applyModAction: insert acrescenta mod que faltava', () => {
  const result = applyModAction(['HD'], { type: 'insert', mods: ['DT'] });
  assert.deepEqual(result, ['HD', 'DT']);
});

test('applyModAction: insert não duplica mod que já está lá', () => {
  const result = applyModAction(['DT'], { type: 'insert', mods: ['DT'] });
  assert.deepEqual(result, ['DT']);
});

test('applyModAction: insert de DT remove HT (incompatíveis)', () => {
  const result = applyModAction(['HT'], { type: 'insert', mods: ['DT'] });
  assert.deepEqual(result, ['DT']);
});

test('applyModAction: insert de HR remove EZ (incompatíveis)', () => {
  const result = applyModAction(['EZ'], { type: 'insert', mods: ['HR'] });
  assert.deepEqual(result, ['HR']);
});

test('applyModAction: exact substitui a lista inteira', () => {
  const result = applyModAction(['HD', 'HR'], { type: 'exact', mods: ['DT'] });
  assert.deepEqual(result, ['DT']);
});

test('applyModAction: exclude tira só o mod pedido', () => {
  const result = applyModAction(['HD', 'DT'], { type: 'exclude', mods: ['HD'] });
  assert.deepEqual(result, ['DT']);
});

test('applyModAction: exclude de mod ausente não muda nada', () => {
  const result = applyModAction(['DT'], { type: 'exclude', mods: ['HD'] });
  assert.deepEqual(result, ['DT']);
});

// ─── buildTopIf ───────────────────────────────────────────────────────────────

test('buildTopIf: reordena pelo pp novo e marca quem mudou', () => {
  const plays = [
    { pp: 300, mods: ['HD'], id: 'a' },
    { pp: 250, mods: [],     id: 'b' },
    { pp: 200, mods: ['DT'], id: 'c' },
  ];
  // b ganha DT e passa a valer 400 (a melhor); c perde o DT e cai para 150;
  // a fica intocado (o modificador não mexe em HD).
  const newMods = [['HD'], ['DT'], []];
  const newPPs  = [null, 400, 150];

  const r = buildTopIf(plays, newMods, newPPs, 1000);

  assert.deepEqual(r.entries.map(e => e.play.id), ['b', 'a', 'c']);
  assert.deepEqual(r.entries.map(e => e.pp), [400, 300, 150]);
  assert.deepEqual(r.entries.map(e => e.changed), [true, false, true]);
  assert.deepEqual(r.entries.map(e => e.origIndex), [2, 1, 3]);
  assert.equal(r.alterados, 2);
});

test('buildTopIf: mods que caem no mesmo conjunto (só reordenados) não contam como mudança', () => {
  const plays = [{ pp: 300, mods: ['HD', 'DT'] }];
  // Mesmo conjunto, ordem diferente — não é mudança de verdade.
  const r = buildTopIf(plays, [['DT', 'HD']], [999], 300);

  assert.equal(r.entries[0].changed, false);
  assert.equal(r.entries[0].pp, 300);
});

test('buildTopIf: cálculo indisponível (newPP null) mantém o pp real mesmo com mods mudados', () => {
  const plays = [{ pp: 300, mods: [] }];
  const r = buildTopIf(plays, [['HD']], [null], 300);

  assert.equal(r.entries[0].changed, true);
  assert.equal(r.entries[0].pp, 300);
});

test('buildTopIf: offset do perfil é preservado no total novo', () => {
  const plays = [{ pp: 300, mods: [] }, { pp: 250, mods: [] }, { pp: 200, mods: [] }];
  const newMods = [['HD'], ['HD'], ['HD']];
  const newPPs = [400, 300, 200];
  const profilePP = 1000;

  const antes  = somaRef(plays);
  const depois = somaRef([{ pp: 400 }, { pp: 300 }, { pp: 200 }]);
  const offset = profilePP - antes;

  const r = buildTopIf(plays, newMods, newPPs, profilePP);

  assert.ok(Math.abs(r.totalAntes  - profilePP) < 1e-9);
  assert.ok(Math.abs(r.totalDepois - (depois + offset)) < 1e-9);
  assert.ok(Math.abs(r.ganho - (depois - antes)) < 1e-9);
});

test('buildTopIf: sem pp de perfil, o offset é zero (cai na soma ponderada)', () => {
  const plays = [{ pp: 300, mods: [] }, { pp: 200, mods: [] }];
  const r = buildTopIf(plays, [['HD'], ['HD']], [null, 500], undefined);

  assert.ok(Math.abs(r.totalAntes - weightedPP(plays)) < 1e-9);
  assert.ok(Math.abs(r.totalDepois - weightedPP([{ pp: 500 }, { pp: 300 }])) < 1e-9);
});

// ─── adjustGradeForMods ───────────────────────────────────────────────────────

test('adjustGradeForMods: ganhar HD deixa o S prata', () => {
  assert.equal(adjustGradeForMods('S', ['HD']), 'SH');
});

test('adjustGradeForMods: perder HD/FL deixa o SH ouro', () => {
  assert.equal(adjustGradeForMods('SH', ['DT']), 'S');
});

test('adjustGradeForMods: FL também deixa o X prata', () => {
  assert.equal(adjustGradeForMods('X', ['FL']), 'XH');
});

test('adjustGradeForMods: A não tem par prata, fica intocado', () => {
  assert.equal(adjustGradeForMods('A', ['HD']), 'A');
});
