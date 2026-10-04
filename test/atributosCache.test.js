/**
 * A dificuldade calculada uma vez por (mapa, mods), dentro da thread.
 *
 * O `Performance` do rosu-pp recalcula a dificuldade inteira quando recebe o
 * mapa — é a parte cara: medido no Wasm, 2,7–30 ms por mapa contra 0,04 ms do pp
 * a partir de atributos prontos. Uma play de servidor privado sem FC calculava a
 * mesma dificuldade três vezes na mesma thread (pp da play, FC pp e estrelas). O
 * Bathbot guarda os atributos e deriva deles todos os pp (`PpManager` em
 * manager/pp.rs); o cache daqui faz o mesmo.
 *
 * Conferido antes de trocar: 3032 cálculos sobre os 379 mapas do cache.db, nos
 * dois builds, com misses, combo, placar clássico, fins de slider e DT ajustado
 * — pp a partir dos atributos IGUAL bit a bit ao calculado a partir do mapa.
 */
const test = require('node:test');
const assert = require('node:assert');

const rosu = require('rosu-pp-bancho');
const { criarCacheAtributos } = require('../src/pp/atributosCache');
const { mapaSintetico } = require('./helpers');

/** Um "atributo" falso que sabe se foi liberado. */
const falso = (nome) => ({ nome, liberado: false, free() { this.liberado = true; } });

test('mesma chave e mesmo mapa: calcula uma vez só', () => {
  const cache = criarCacheAtributos();
  const mapa = {};
  let calculos = 0;
  const calcular = () => { calculos++; return falso('a'); };

  const primeiro = cache.obter('1|DT', mapa, calcular);
  const segundo  = cache.obter('1|DT', mapa, calcular);

  assert.equal(calculos, 1);
  assert.equal(segundo, primeiro);
});

test('outra chave (outros mods) calcula de novo', () => {
  const cache = criarCacheAtributos();
  const mapa = {};
  let calculos = 0;
  const calcular = () => { calculos++; return falso('a'); };

  cache.obter('1|DT', mapa, calcular);
  cache.obter('1|HR', mapa, calcular);

  assert.equal(calculos, 2);
});

test('mapa reparseado com a mesma chave: recalcula e libera o antigo', () => {
  // A thread reparseia quando o .osu muda (arquivo novo no cache em disco). Os
  // atributos do arquivo velho não servem ao novo, e a chave sozinha não vê isso.
  const cache = criarCacheAtributos();
  const velho = falso('velho');

  cache.obter('1|DT', {}, () => velho);
  const novo = cache.obter('1|DT', {}, () => falso('novo'));

  assert.equal(novo.nome, 'novo');
  assert.equal(velho.liberado, true);
});

test('no teto, sai o usado há mais tempo, e a memória dele é liberada', () => {
  const cache = criarCacheAtributos({ max: 2 });
  const mapa = {};
  const a = falso('a');
  const b = falso('b');

  cache.obter('a', mapa, () => a);
  cache.obter('b', mapa, () => b);
  cache.obter('a', mapa, () => assert.fail('o "a" ainda estava guardado'));   // renova o "a"
  cache.obter('c', mapa, () => falso('c'));

  assert.equal(b.liberado, true, 'o "b" era o mais antigo');
  assert.equal(a.liberado, false);
  assert.equal(cache.tamanho, 2);
});

test('o pp a partir dos atributos guardados é o mesmo do calculado pelo mapa', () => {
  const mapa = new rosu.Beatmap(mapaSintetico(200));
  const cache = criarCacheAtributos();
  const args = { mods: ['HD', 'CL'], lazer: false };
  const estado = { misses: 3, combo: 60, n100: 4 };

  const attrs = cache.obter('k', mapa, () => {
    const calc = new rosu.Difficulty(args);
    try { return calc.calculate(mapa); } finally { calc.free(); }
  });

  const pp = (alvo) => {
    const calc = new rosu.Performance({ ...args, ...estado });
    try {
      const r = calc.calculate(alvo);
      try { return r.pp; } finally { r.free(); }
    } finally { calc.free(); }
  };

  // Duas vezes com os mesmos atributos: o objeto guardado não é consumido.
  assert.equal(pp(attrs), pp(mapa));
  assert.equal(pp(attrs), pp(mapa));
  mapa.free();
});
