/**
 * O catálogo do /help precisa bater com a realidade.
 *
 * São três formas de o help mentir, e nenhuma aparece rodando o bot:
 *
 *   1. citar um comando que não existe mais — o `execute` filtra pelo registro,
 *      então a linha some calada e o help fica menor sem ninguém perceber;
 *   2. faltar a descrição de um comando — vira `— undefined` na cara de quem
 *      usa aquele idioma. O teste de paridade do i18n não pega: ele compara os
 *      idiomas entre si, e a chave pode faltar nos três de uma vez;
 *   3. um comando novo nascer fora do catálogo — o bot passa a fazer algo que o
 *      help não conta.
 *
 * O terceiro é o motivo de a lista ser conferida nos dois sentidos.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const { catalog } = require('../src/commands/help');
const { GROUPS, ADMIN_GROUP, ALIASES } = catalog;

const LANGS = ['pt', 'en', 'ru'];
const load = lang => require(`../src/i18n/${lang}`)({ ADMIN: 'Servidor' });

/** Os nomes que o bot registra de fato, montados como no index.js. */
const registered = (() => {
  const dir = path.join(__dirname, '..', 'src', 'commands');
  const names = fs.readdirSync(dir)
    .filter(file => file.endsWith('.js'))
    .map(file => require(path.join(dir, file)).data.name);
  return new Set(names);
})();

const listed = [...GROUPS, ADMIN_GROUP].flatMap(group => group.commands);

test('todo comando citado existe', () => {
  for (const name of listed) {
    assert.ok(registered.has(name), `/help cita "${name}", que não é um comando registrado`);
  }
});

test('todo atalho citado existe e aponta para um comando citado', () => {
  for (const [name, aliases] of Object.entries(ALIASES)) {
    assert.ok(listed.includes(name), `ALIASES tem "${name}", que o /help não lista`);
    for (const alias of aliases) {
      assert.ok(registered.has(alias), `"${alias}" não é um comando registrado`);
    }
  }
});

test('nenhum comando aparece em dois grupos', () => {
  assert.equal(new Set(listed).size, listed.length, `há nome repetido em: ${listed.join(', ')}`);
});

test('comando registrado ou está no catálogo, ou é atalho/o próprio help', () => {
  // Impede que um comando novo nasça invisível: quem acrescentar um precisa
  // decidir em que grupo ele entra — ou dizer aqui por que fica de fora.
  //
  // `diag` fica de fora de propósito: é ferramenta de operador (taxa de acerto
  // dos caches, espera do rate limiter, motores de PP de pé ou não), exigindo
  // Administrator no servidor. O /help responde "o que dá para fazer com este
  // bot" para quem joga — uma linha sobre contadores de processo ali seria
  // ruído para todo mundo e ajuda para ninguém.
  const fora = new Set([...Object.values(ALIASES).flat(), 'help', 'diag']);

  for (const name of registered) {
    if (fora.has(name)) continue;
    assert.ok(listed.includes(name), `"${name}" não aparece no /help nem está na lista de exceções`);
  }
});

test('cada comando e grupo tem texto nos três idiomas', () => {
  const keys = [
    ...listed.map(name => `help_cmd_${name}`),
    ...[...GROUPS, ADMIN_GROUP].map(group => `help_group_${group.key}`),
    'help_title', 'help_intro', 'help_servers', 'help_prefix', 'help_footer',
  ];

  for (const lang of LANGS) {
    const strings = load(lang);
    for (const key of keys) {
      assert.equal(typeof strings[key], 'string', `${lang}: falta ${key}`);
      assert.ok(strings[key].length > 0, `${lang}: ${key} está vazio`);
    }
  }
});

test('o rótulo do servidor administrado é interpolado no grupo admin', () => {
  for (const lang of LANGS) {
    assert.match(load(lang).help_group_admin, /Servidor/);
  }
});
