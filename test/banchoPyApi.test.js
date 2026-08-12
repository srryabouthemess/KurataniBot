/**
 * Normalização do bancho.py: os formatos em que um campo pode chegar.
 *
 * O `play_time` já derrubou uma página inteira do /topplays. A expressão
 * testava o valor convertido (`String(raw).includes('T')`) mas convertia o
 * valor cru (`raw.replace(...)`), então um epoch numérico estourava com
 * "replace is not a function" — e como o catch do enrichScores chama a mesma
 * normalização de novo, a segunda exceção escapava do try e levava junto as
 * outras plays da página, não só a problemática.
 *
 * Cada caso aqui é um formato que a API pode responder conforme o endpoint.
 */
const test = require('node:test');
const assert = require('node:assert');

const { parsePlayTime } = require('../src/osu/banchoPyApi');

test('formatos de texto', async t => {
  await t.test('datetime do SQL, com espaço, entendido como UTC', () => {
    assert.equal(
      parsePlayTime('2026-08-12 14:30:00').toISOString(),
      '2026-08-12T14:30:00.000Z',
    );
  });

  await t.test('ISO com T e Z', () => {
    assert.equal(
      parsePlayTime('2026-08-12T14:30:00Z').toISOString(),
      '2026-08-12T14:30:00.000Z',
    );
  });
});

test('epoch em segundos', async t => {
  // O bancho.py usa segundos em creation_time e latest_activity; o play_time
  // vem assim em parte dos endpoints.
  const EPOCH_SECONDS = 1786000000;

  await t.test('como número — o caso que estourava', () => {
    const parsed = parsePlayTime(EPOCH_SECONDS);
    assert.ok(parsed instanceof Date);
    assert.equal(parsed.getTime(), EPOCH_SECONDS * 1000);
  });

  await t.test('como string de dígitos', () => {
    assert.equal(parsePlayTime(String(EPOCH_SECONDS)).getTime(), EPOCH_SECONDS * 1000);
  });
});

test('ausente ou ilegível vira "agora", nunca Invalid Date', async t => {
  // Um Invalid Date não estoura aqui: estoura adiante, no toISOString() da
  // normalização, longe da causa.
  for (const input of [null, undefined, '', 'não é data nenhuma']) {
    await t.test(String(input), () => {
      assert.ok(!Number.isNaN(parsePlayTime(input).getTime()), 'devolveu Invalid Date');
    });
  }
});
