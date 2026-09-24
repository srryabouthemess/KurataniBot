/**
 * O loader é a única porta de entrada dos comandos (boot, deploy, smoke, post).
 *
 * O que ele precisa garantir, e que rodar o bot não mostra:
 *   - um comando quebrado não derruba os outros no modo tolerante, e aborta no
 *     estrito (o deploy registraria a lista sem ele e o apagaria do Discord);
 *   - alias herda TUDO do original — era o `prefix` esquecido em metade dos
 *     arquivos de alias que motivou a tabela;
 *   - pasta com index.js é um comando, pasta sem é agrupamento.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const { loadCommands, commandsPayload, hashCommands } = require('../src/bot/loadCommands');
const ALIASES = require('../src/bot/aliases');

/** Um comando mínimo, como texto de arquivo. */
const commandSource = (name, extra = '') => `
module.exports = {
  data: { name: '${name}', toJSON: () => ({ name: '${name}', description: '${name}!', options: [{ name: 'x', type: 3 }] }) },
  execute: async () => '${name}',
  ${extra}
};`;

/** Monta uma pasta de comandos de mentira: { 'a.js': '...', 'grupo/b.js': '...' }. */
function fakeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-commands-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('os comandos reais carregam sem falha, com todos os aliases', () => {
  const { commands, failures } = loadCommands({ strict: true });
  assert.equal(failures.length, 0);
  for (const alias of ALIASES) {
    assert.ok(commands.has(alias.name), `alias /${alias.name} não foi montado`);
  }
});

test('alias real repete o original, trocando só nome e descrição', () => {
  const { commands } = loadCommands({ strict: true });

  for (const alias of ALIASES) {
    const original = commands.get(alias.of);
    const atalho   = commands.get(alias.name);

    assert.equal(atalho.execute, original.execute, `/${alias.name}: execute diferente`);
    assert.equal(atalho.prefix, original.prefix, `/${alias.name}: prefix diferente`);

    const json = atalho.data.toJSON();
    assert.equal(json.name, alias.name);
    assert.equal(json.description, alias.description);
    assert.deepEqual(json.description_localizations, { 'pt-BR': alias.pt });

    const identidade = { name: json.name, description: json.description, description_localizations: json.description_localizations };
    assert.deepEqual(json, { ...original.data.toJSON(), ...identidade }, `/${alias.name}: opções divergem de /${alias.of}`);
  }
});

test('arquivo solto, pasta-comando e pasta-grupo', () => {
  const dir = fakeDir({
    'a.js':              commandSource('a'),
    'grupo/b.js':        commandSource('b'),
    'grupo/fundo/c.js':  commandSource('c'),
    'd/index.js':        commandSource('d'),
    // Ao lado de um index.js é peça do comando, não comando.
    'd/logica.js':       'module.exports = { soma: (x, y) => x + y };',
    'nota.txt':          'ignorado',
  });

  const { commands, failures } = loadCommands({ dir, aliases: [] });
  assert.deepEqual([...commands.keys()].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(failures.length, 0);
});

test('tolerante: comando quebrado é pulado e anotado, o resto carrega', () => {
  const dir = fakeDir({
    'bom.js':       commandSource('bom'),
    'sintaxe.js':   'module.exports = {',
    'semexport.js': 'module.exports = { helper() {} };',
  });

  const { commands, failures } = loadCommands({ dir, aliases: [] });
  assert.deepEqual([...commands.keys()], ['bom']);
  assert.deepEqual(failures.map(f => f.source).sort(), ['semexport.js', 'sintaxe.js']);
});

test('estrito: a primeira falha lança', () => {
  const dir = fakeDir({ 'bom.js': commandSource('bom'), 'ruim.js': 'module.exports = {};' });
  assert.throws(() => loadCommands({ dir, aliases: [], strict: true }), /não exporta/);
});

test('alias herda campos extras do original (prefix e o que vier depois)', () => {
  const dir = fakeDir({ 'orig.js': commandSource('orig', "prefix: { slashOnly: true }, outro: 42,") });
  const aliases = [{ name: 'o', of: 'orig', description: 'Alias', pt: 'Atalho' }];

  const { commands } = loadCommands({ dir, aliases });
  const atalho = commands.get('o');

  assert.deepEqual(atalho.prefix, { slashOnly: true });
  assert.equal(atalho.outro, 42);
  assert.equal(atalho.aliasOf, 'orig');
  assert.deepEqual(atalho.data.toJSON().options, [{ name: 'x', type: 3 }]);
});

test('alias sem original, alias de alias e nome repetido viram falha', () => {
  const dir = fakeDir({ 'orig.js': commandSource('orig'), 'dup.js': commandSource('dup') });
  const aliases = [
    { name: 'x',   of: 'naoexiste', description: '-', pt: '-' },
    { name: 'o',   of: 'orig',      description: '-', pt: '-' },
    { name: 'oo',  of: 'o',         description: '-', pt: '-' },
    { name: 'dup', of: 'orig',      description: '-', pt: '-' },
  ];

  const { commands, failures } = loadCommands({ dir, aliases });
  assert.deepEqual([...commands.keys()].sort(), ['dup', 'o', 'orig']);
  assert.deepEqual(failures.map(f => f.source), ['alias:x', 'alias:oo', 'alias:dup']);
  // O `dup` que ficou é o comando, não o alias que tentou tomar o nome.
  assert.equal(commands.get('dup').aliasOf, undefined);
});

test('o hash não depende da ordem de leitura', () => {
  const dir = fakeDir({ 'a.js': commandSource('a'), 'b.js': commandSource('b') });
  const payload = commandsPayload(loadCommands({ dir, aliases: [] }).commands);
  assert.equal(hashCommands(payload), hashCommands([...payload].reverse()));
});
