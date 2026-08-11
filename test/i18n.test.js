/**
 * Paridade entre os idiomas.
 *
 * Com um arquivo por idioma, o erro fácil é acrescentar uma chave só num deles:
 * o bot então responde `undefined` para quem estiver nos outros. Isto trava
 * esse caso — e vale para toda chave nova, sem precisar lembrar do teste.
 */
const test = require('node:test');
const assert = require('node:assert');

const LANGS = ['pt', 'en', 'ru'];
const load = lang => require(`../i18n/${lang}`)({ ADMIN: 'Servidor' });

test('todos os idiomas têm as mesmas chaves', () => {
  const [first, ...rest] = LANGS;
  const expected = Object.keys(load(first)).sort();

  for (const lang of rest) {
    assert.deepEqual(
      Object.keys(load(lang)).sort(),
      expected,
      `as chaves de ${lang} divergem de ${first}`,
    );
  }
});

test('o tipo de cada chave bate entre os idiomas', () => {
  // Uma virar função (ou deixar de ser) em um idioma só quebra na hora da
  // chamada, e só para quem usa aquele idioma.
  const base = load(LANGS[0]);

  for (const lang of LANGS.slice(1)) {
    const other = load(lang);
    for (const key of Object.keys(base)) {
      assert.equal(
        typeof other[key], typeof base[key],
        `${key}: ${lang} é ${typeof other[key]}, ${LANGS[0]} é ${typeof base[key]}`,
      );
    }
  }
});

test('funções aceitam a mesma quantidade de argumentos', () => {
  const base = load(LANGS[0]);

  for (const lang of LANGS.slice(1)) {
    const other = load(lang);
    for (const [key, value] of Object.entries(base)) {
      if (typeof value !== 'function') continue;
      assert.equal(
        other[key].length, value.length,
        `${key}: ${lang} recebe ${other[key].length} argumento(s), ${LANGS[0]} recebe ${value.length}`,
      );
    }
  }
});

test('o rótulo do servidor administrado é interpolado', () => {
  // Se alguém trocar o template literal por aspas simples, o ${ADMIN} sai cru.
  for (const lang of LANGS) {
    const strings = load(lang);
    assert.match(strings.admin_wrong_guild, /Servidor/);
    assert.doesNotMatch(strings.admin_wrong_guild, /\$\{/);
  }
});
