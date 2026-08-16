/**
 * Tradução entre as três formas de mod (bitmask, acrônimo, texto digitado).
 *
 * O que este arquivo protege é o tipo de defeito que não quebra nada: um bit
 * ausente da tabela SOME na decodificação, sem erro nenhum — o score é exibido,
 * o pp é calculado, e só o mod é que não está lá. Foi o que aconteceu com o TD
 * e o AP, e ninguém tinha como notar pela tela: `+NM` numa play de touch é uma
 * resposta perfeitamente plausível.
 *
 * De que lado do `difficultyMods` cada mod cai é medido contra o motor de
 * verdade, no lazerWorker.test.js — aqui ficam só as consequências da decisão.
 */
const test = require('node:test');
const assert = require('node:assert');

const mods = require('../src/mods');

test('bit conhecido não some na decodificação', () => {
  assert.deepStrictEqual(mods.decodeMods(4), ['TD']);
  assert.deepStrictEqual(mods.decodeMods(8192), ['AP']);
  // O caso real que motivou: touch + hidden, que saía como só ['HD'].
  assert.deepStrictEqual(mods.decodeMods(4 | 8), ['TD', 'HD']);
  // Sem mod nenhum continua sendo lista vazia, e não um mod inventado.
  assert.deepStrictEqual(mods.decodeMods(0), []);
});

test('acrônimo e bitmask fecham nos dois sentidos', () => {
  for (const [nome, bit] of Object.entries(mods.MOD_BITS)) {
    assert.equal(mods.modsToBits([nome]), bit, `${nome} não vira o próprio bit`);
    assert.deepStrictEqual(mods.decodeMods(bit), [nome], `${bit} não volta a ser ${nome}`);
  }
});

test('TD é cosmético e AP não é', () => {
  // As estrelas que sustentam isto estão medidas no lazerWorker.test.js. Aqui
  // o que se trava é a consequência: com o AP na lista de cosméticos, o bot
  // exibiria a estrela SEM mods como se fosse a da play.
  assert.deepStrictEqual(mods.difficultyMods(['TD']), []);
  assert.deepStrictEqual(mods.difficultyMods(['AP']), ['AP']);
  assert.deepStrictEqual(mods.difficultyMods(['TD', 'DT']), ['DT']);
});

test('o texto digitado separa o que foi entendido do que não foi', () => {
  assert.deepStrictEqual(mods.parseModTokens('hddt'), { mods: ['HD', 'DT'], unknown: [] });
  assert.deepStrictEqual(mods.parseModTokens('xyhd'), { mods: ['HD'], unknown: ['XY'] });
  assert.deepStrictEqual(mods.parseModTokens(''), { mods: [], unknown: [] });
  // Repetido não vira dois, e separador não conta como caractere.
  assert.deepStrictEqual(mods.parseModTokens('hd, hd dt'), { mods: ['HD', 'DT'], unknown: [] });
});

test('o parseModsString continua tolerante, que é o que o score precisa', () => {
  // Quem lê um score não pode falhar por causa de um token estranho: a play
  // inteira sumiria da lista por causa de um mod que ninguém reconheceu.
  assert.deepStrictEqual(mods.parseModsString('xyhd'), ['HD']);
  assert.deepStrictEqual(mods.parseModsString(null), []);
});

test('a chave de cache não depende da ordem em que os mods chegaram', () => {
  // A API não garante ordem, e sem a forma canônica o mesmo cálculo ocuparia
  // duas linhas do cache — nenhuma delas acertando de forma confiável.
  assert.equal(mods.canonicalMods(['DT', 'HD']), mods.canonicalMods(['HD', 'DT']));
  assert.equal(mods.canonicalMods(['HD', 'HD']), 'HD');
  assert.equal(mods.canonicalMods([]), '');
});
