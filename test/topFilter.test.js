/**
 * Ordenação e filtro do /topplays.
 *
 * O que este arquivo protege é a leitura das DUAS formas de score. A lista de
 * top plays chega crua, e cru quer dizer coisas diferentes conforme o servidor:
 * o oficial e o Ripple normalizam no adaptador (acurácia de 0 a 1, mods como
 * acrônimos), o bancho.py não (acurácia de 0 a 100, mods em bitmask).
 *
 * Uma diferença de escala aqui não quebra nada visivelmente — a lista sai
 * ordenada, só que errada, com todas as plays de um formato antes das do outro.
 * É o tipo de defeito que só aparece para quem conferir play por play.
 */
const test = require('node:test');
const assert = require('node:assert');

const topFilter = require('../src/topFilter');

/** Score como o oficial e o Ripple entregam: já normalizado. */
const normalizado = ({ pp, acc, combo, mods = [], misses = 0, data = '2026-08-01T00:00:00Z' }) => ({
  pp,
  accuracy: acc / 100,
  max_combo: combo,
  mods,
  statistics: { count_miss: misses },
  created_at: data,
});

/** Score como o bancho.py entrega antes do enrichScores: cru. */
const cru = ({ pp, acc, combo, mods = 0, misses = 0, data = '2026-08-01 00:00:00' }) => ({
  pp,
  acc,
  max_combo: combo,
  mods,
  nmiss: misses,
  play_time: data,
});

// ─── As duas formas, na mesma escala ──────────────────────────────────────────

test('a acurácia sai de 0 a 100 nas duas formas', () => {
  assert.strictEqual(topFilter.accOf(normalizado({ acc: 98.44 })), 98.44);
  assert.strictEqual(topFilter.accOf(cru({ acc: 98.44 })), 98.44);
});

test('ordenar por acc não separa as formas em dois blocos', () => {
  // O defeito que este teste existe para pegar: sem converter a escala, os
  // 0,9844 do normalizado perdem para qualquer 95 do cru.
  const scores = [
    normalizado({ pp: 100, acc: 98.44 }),
    cru({ pp: 200, acc: 95.00 }),
    normalizado({ pp: 300, acc: 99.10 }),
  ];

  const ordem = topFilter.arrange(scores, { sort: 'acc' }).map(item => item.posicao);
  assert.deepStrictEqual(ordem, [3, 1, 2]);
});

test('os mods saem como acrônimos, venham eles como lista ou bitmask', () => {
  assert.deepStrictEqual(topFilter.modsOf(normalizado({ mods: ['HD', 'DT'] })), ['HD', 'DT']);
  // 72 = HD (8) + DT (64)
  assert.deepStrictEqual(topFilter.modsOf(cru({ mods: 72 })), ['HD', 'DT']);
});

test('a data é lida nos três formatos, e o desconhecido não vira "agora"', () => {
  const iso = topFilter.dateOf({ created_at: '2026-08-01T00:00:00Z' });
  const sql = topFilter.dateOf({ play_time: '2026-08-01 00:00:00' });
  assert.strictEqual(iso, sql, 'ISO e datetime de SQL deveriam dar o mesmo instante');

  assert.strictEqual(topFilter.dateOf({ play_time: 1754006400 }), 1754006400 * 1000);
  // null, e não Date.now(): "não sei quando foi" não pode virar "foi agora", que
  // jogaria a play para o topo de uma ordenação por data.
  assert.strictEqual(topFilter.dateOf({ created_at: 'ontem de tarde' }), null);
});

// ─── Filtro de mods ───────────────────────────────────────────────────────────

test('texto sem mod reconhecível não vira filtro vazio', () => {
  // Sem isto, `mods:XY` devolveria a lista inteira e quem pediu leria isso como
  // "não tenho play com XY".
  assert.strictEqual(topFilter.parseModFilter('XY'), null);
  assert.strictEqual(topFilter.parseModFilter(''), null);
  assert.deepStrictEqual(topFilter.parseModFilter('hddt'), { mods: ['HD', 'DT'] });
  assert.deepStrictEqual(topFilter.parseModFilter('NM'), { nomod: true });
  assert.deepStrictEqual(topFilter.parseModFilter('nomod'), { nomod: true });
});

test('pedir um mod traz quem o tem, com ou sem outros junto', () => {
  const filtro = topFilter.parseModFilter('HD');

  assert.ok(topFilter.matchesMods(normalizado({ mods: ['HD', 'DT'] }), filtro));
  assert.ok(topFilter.matchesMods(normalizado({ mods: ['HD'] }), filtro));
  assert.ok(!topFilter.matchesMods(normalizado({ mods: ['DT'] }), filtro));
});

test('pedir dois mods exige os dois', () => {
  const filtro = topFilter.parseModFilter('HDDT');

  assert.ok(topFilter.matchesMods(normalizado({ mods: ['HD', 'DT', 'HR'] }), filtro));
  assert.ok(!topFilter.matchesMods(normalizado({ mods: ['HD'] }), filtro));
});

test('o CL não conta como mod no filtro', () => {
  // Quase todo score de stable chega com CL. Se ele contasse, `mods:NM` não
  // devolveria uma play sequer do Bancho.
  const semMods = normalizado({ mods: ['CL'] });

  assert.ok(topFilter.matchesMods(semMods, topFilter.parseModFilter('NM')));
  assert.ok(!topFilter.matchesMods(normalizado({ mods: ['HD', 'CL'] }), topFilter.parseModFilter('NM')));
  assert.ok(topFilter.matchesMods(normalizado({ mods: ['HD', 'CL'] }), topFilter.parseModFilter('HD')));
});

// ─── A posição exibida ────────────────────────────────────────────────────────

test('a posição é a do top original, e sobrevive ao filtro', () => {
  const scores = [
    normalizado({ pp: 500, acc: 99, mods: ['DT'] }),
    normalizado({ pp: 400, acc: 98, mods: ['HD'] }),
    normalizado({ pp: 300, acc: 97, mods: ['HD', 'DT'] }),
  ];

  const resultado = topFilter.arrange(scores, { mods: topFilter.parseModFilter('HD') });

  // #2 e #3, e não #1 e #2: renumerar faria a primeira linha passar por melhor
  // play do jogador quando ela é só a melhor COM HD.
  assert.deepStrictEqual(resultado.map(item => item.posicao), [2, 3]);
});

test('ordenar por pp não reordena: a ordem do servidor é a fonte', () => {
  // Chega já ordenada por pp, e é essa ordem que decide o peso de cada play no
  // total ponderado — desempatar por conta própria seria discordar da fonte.
  const scores = [
    normalizado({ pp: 500, acc: 90 }),
    normalizado({ pp: 500, acc: 99 }),
    normalizado({ pp: 400, acc: 95 }),
  ];

  assert.deepStrictEqual(
    topFilter.arrange(scores, { sort: 'pp' }).map(item => item.posicao),
    [1, 2, 3],
  );
});

// ─── Sem valor ────────────────────────────────────────────────────────────────

test('play sem o dado ordenado fica no fim — inclusive de trás para frente', () => {
  const scores = [
    normalizado({ pp: 300, acc: 98, combo: 500 }),
    normalizado({ pp: 200, acc: 97, combo: null }),   // servidor que não manda combo
    normalizado({ pp: 100, acc: 96, combo: 800 }),
  ];

  assert.deepStrictEqual(
    topFilter.arrange(scores, { sort: 'combo' }).map(item => item.posicao),
    [3, 1, 2],
  );

  // Invertido, o 500 vem antes do 800 — mas a play sem combo continua por
  // último, em vez de abrir a lista com uma linha vazia.
  assert.deepStrictEqual(
    topFilter.arrange(scores, { sort: 'combo', reverse: true }).map(item => item.posicao),
    [1, 3, 2],
  );
});

test('miss ausente é zero, e não "sem valor"', () => {
  // Um FC não traz o campo de miss no formato novo da API oficial (o
  // `statistics` é esparso). Tratá-lo como desconhecido mandaria justamente as
  // plays limpas para o fim de uma ordenação por miss.
  const fc = { pp: 300, accuracy: 0.99, mods: [], statistics: {} };
  const choke = normalizado({ pp: 200, acc: 97, misses: 5 });

  const ordem = topFilter.arrange([fc, choke], { sort: 'misses' }).map(item => item.posicao);
  assert.deepStrictEqual(ordem, [2, 1]);
});

test('a lista de entrada não é modificada', () => {
  // O getBestScores entrega a lista do cache POR REFERÊNCIA (ver o comentário do
  // _bestCache em osuClient.js). Ordenar no lugar deixaria o cache com a ordem
  // do último filtro, e o próximo /topplays sem filtro nenhum a herdaria.
  const scores = [
    normalizado({ pp: 300, acc: 90 }),
    normalizado({ pp: 200, acc: 99 }),
  ];
  const antes = [...scores];

  topFilter.arrange(scores, { sort: 'acc', reverse: true });

  assert.deepStrictEqual(scores, antes);
});

test('lista vazia não estoura', () => {
  assert.deepStrictEqual(topFilter.arrange([], { sort: 'acc' }), []);
  assert.deepStrictEqual(topFilter.arrange(undefined), []);
});
