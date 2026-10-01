/**
 * O layout do embed do /recent como ele é guardado e lido.
 *
 * O que se trava aqui é a fronteira com o banco: ler NUNCA lança (um valor
 * estragado vale como o padrão, e o /recent de quem o tem continua
 * respondendo), e gravar NUNCA aceita o que a leitura recusaria — senão a
 * escolha da pessoa sumiria calada na leitura seguinte.
 */
const test = require('node:test');
const assert = require('node:assert');

const embedLayout = require('../src/embedLayout');
const { dbWorkspace } = require('./helpers');

const { CHAVES } = embedLayout;

// ─── parse ────────────────────────────────────────────────────────────────────

test('parse: lista válida vira o conjunto das chaves ligadas', () => {
  assert.deepEqual([...embedLayout.parse('["pp","combo"]')], ['pp', 'combo']);
  assert.deepEqual([...embedLayout.parse(JSON.stringify(CHAVES))], CHAVES);
});

test('parse: lista vazia é "tudo desligado", não o padrão', () => {
  // A diferença é o motivo de o formato ser JSON: uma escolha legítima não
  // pode ser lida como "nunca escolheu".
  const layout = embedLayout.parse('[]');
  assert.ok(layout instanceof Set);
  assert.equal(layout.size, 0);
});

test('parse: ausente, inválido ou vazio vale o padrão (null), sem lançar', () => {
  for (const bruto of [null, undefined, '', '   ', 'lixo', '{', '{"pp":true}', '"pp"', '42', 'null', 'true', 42, {}]) {
    assert.equal(embedLayout.parse(bruto), null, `parse(${JSON.stringify(bruto)})`);
  }
});

test('parse: chave desconhecida, ou que não é texto, derruba o layout inteiro para o padrão', () => {
  for (const bruto of ['["pp","cor"]', '["PP"]', '[1]', '[null]', '[["pp"]]', '["pp",{"x":1}]']) {
    assert.equal(embedLayout.parse(bruto), null, bruto);
  }
});

test('parse: chave repetida conta uma vez', () => {
  assert.deepEqual([...embedLayout.parse('["pp","pp"]')], ['pp']);
});

// ─── serialize ────────────────────────────────────────────────────────────────

test('serialize: na ordem das chaves, seja qual for a ordem de entrada', () => {
  assert.equal(embedLayout.serialize(['combo', 'pb']), '["pb","combo"]');
  assert.equal(embedLayout.serialize(new Set(['map', 'hits', 'map'])), '["hits","map"]');
});

test('serialize: nada ligado grava [] e tudo ligado grava NULL', () => {
  assert.equal(embedLayout.serialize([]), '[]');
  assert.equal(embedLayout.serialize(CHAVES), null);
  assert.equal(embedLayout.serialize([...CHAVES].reverse()), null);
  assert.equal(embedLayout.serialize(null), null);
});

test('serialize: chave desconhecida lança, em vez de gravar o que a leitura jogaria fora', () => {
  assert.throws(() => embedLayout.serialize(['pp', 'cor']), /desconhecida/);
});

test('o que serialize grava, parse lê de volta', () => {
  for (const chaves of [[], ['pb'], ['thumbnail', 'pp'], CHAVES.slice(1)]) {
    const lido = embedLayout.parse(embedLayout.serialize(chaves));
    assert.deepEqual([...lido].sort(), [...chaves].sort());
  }
});

test('liga: null é tudo ligado; conjunto liga só o que tem', () => {
  for (const chave of CHAVES) assert.equal(embedLayout.liga(null, chave), true);
  assert.equal(embedLayout.liga(new Set(['pp']), 'pp'), true);
  assert.equal(embedLayout.liga(new Set(['pp']), 'combo'), false);
  assert.equal(embedLayout.liga(new Set(), 'pp'), false);
});

// ─── No banco ─────────────────────────────────────────────────────────────────

test('getter, setter e reset', t => {
  const { load } = dbWorkspace(t);
  const db = load();

  assert.equal(db.getEmbedLayout('1'), null);

  db.setEmbedLayout('1', ['pp', 'hits']);
  assert.deepEqual([...db.getEmbedLayout('1')], ['pp', 'hits']);

  db.setEmbedLayout('1', []);
  assert.equal(db.getEmbedLayout('1').size, 0, 'tudo desligado sobrevive ao banco');

  db.setEmbedLayout('1', CHAVES);
  assert.equal(db.getEmbedLayout('1'), null, 'tudo ligado é o padrão');

  db.setEmbedLayout('1', ['map']);
  db.resetEmbedLayout('1');
  assert.equal(db.getEmbedLayout('1'), null);

  // Reset de quem nunca teve linha não cria uma nem lança.
  db.resetEmbedLayout('2');
  assert.equal(db.getEmbedLayout('2'), null);
});

test('valor estragado no banco é lido como o padrão', t => {
  const { load } = dbWorkspace(t);
  const db = load();

  db.setScoreFormat('1', 'classic');  // cria a linha
  const { db: conexao } = require('../src/db/connection');
  for (const bruto of ['lixo', '["pp","cor"]', '', '{"pp":1}']) {
    conexao.prepare('UPDATE users SET embed_layout = ? WHERE discord_id = ?').run(bruto, '1');
    assert.equal(db.getEmbedLayout('1'), null, bruto);
  }
});

test('setter com chave desconhecida lança e não mexe no que estava', t => {
  const { load } = dbWorkspace(t);
  const db = load();

  db.setEmbedLayout('1', ['pp']);
  assert.throws(() => db.setEmbedLayout('1', ['pp', 'cor']));
  assert.deepEqual([...db.getEmbedLayout('1')], ['pp']);
});
