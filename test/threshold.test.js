/** Limiar de nomeação: padrão 1, e o que o .env consegue mudar. */
const test = require('node:test');
const assert = require('node:assert');

const { threshold } = require('../src/commands/nominate');

const CASES = [
  ['vazio',            '',        1],
  ['ausente',          undefined, 1],
  ['dois',             '2',       2],
  ['cinco',            '5',       5],
  ['zero vira 1',      '0',       1],
  ['negativo vira 1',  '-3',      1],
  ['lixo vira 1',      'abc',     1],
  ['decimal usa piso', '2.9',     2],
];

test('leitura do NOMINATION_THRESHOLD', async t => {
  for (const [label, value, expected] of CASES) {
    await t.test(label, () => {
      if (value === undefined) delete process.env.NOMINATION_THRESHOLD;
      else process.env.NOMINATION_THRESHOLD = value;
      assert.equal(threshold(), expected);
    });
  }
});
