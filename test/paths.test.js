/**
 * Os dados moram em data/ — e o bot se recusa a subir quando eles ficaram na
 * raiz, em vez de criar um bot.db vazio e parecer que funcionou.
 *
 * O sistema de arquivos é simulado (`existe`): o que se testa é a decisão, e
 * não dá para depender do bot.db de verdade de quem roda a suíte.
 */
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const paths = require('../src/paths');

const ROOT = '/bot';
const DATA = path.join(ROOT, 'data');

/** Um disco com exatamente estes arquivos. */
const disco = (...arquivos) => f => arquivos.map(a => path.join(ROOT, a)).includes(f);

const checar = (existe, extra = {}) =>
  paths.dadosEsquecidosNaRaiz({ explicito: false, dataDir: DATA, root: ROOT, existe, ...extra });

test('o padrão é data/, dentro do projeto', () => {
  // (Nos testes o KURATANI_DATA_DIR vem do setup.js, então confere-se a regra.)
  assert.equal(path.basename(path.join(paths.ROOT, 'data')), 'data');
  assert.ok(paths.BOT_DB.startsWith(paths.DATA_DIR));
});

test('instalação nova: nada em lugar nenhum, nada a reclamar', () => {
  assert.deepEqual(checar(disco()), []);
});

test('já migrado: bot.db em data/, e a raiz não importa', () => {
  // Inclusive com sobra na raiz (um backup, um arquivo esquecido): o que manda
  // é o banco em uso estar no lugar certo.
  assert.deepEqual(checar(disco('data/bot.db', 'bot.db')), []);
});

test('atualizou sem mover: aponta o que ficou na raiz', () => {
  assert.deepEqual(checar(disco('bot.db', 'cache.db')), ['bot.db', 'cache.db']);
});

test('JSON de antes do SQLite na raiz também conta', () => {
  assert.deepEqual(checar(disco('links.json')), ['links.json']);
});

test('backup e .migrated na raiz não contam', () => {
  assert.deepEqual(checar(disco('bot.db.antes-20260814', 'links.json.migrated')), []);
});

test('KURATANI_DATA_DIR definido: a escolha é de quem configurou', () => {
  // É o caso dos testes: a pasta temporária está vazia, e o bot.db da raiz de
  // quem roda a suíte não tem nada a ver com ela.
  assert.deepEqual(checar(disco('bot.db'), { explicito: true }), []);
});
