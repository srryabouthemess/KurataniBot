/**
 * Evento de mudança de status vindo do jogo.
 *
 * O bancho publica em `ex:map_status_change` a cada `!map rank/unrank/love`, e
 * ninguém assinava — o evento existia e se perdia. Mapa rankeado dentro do jogo
 * simplesmente não aparecia no Discord.
 *
 * O que estes casos travam é o filtro e o formato: o que vira anúncio, o que é
 * descartado, e o que fazer com um payload que não tem o autor (porque o campo
 * só existe se o fork tiver a alteração que o inclui).
 */
const test = require('node:test');
const assert = require('node:assert');

const { parseEvent, ANNOUNCED_TYPES } = require('../src/daycoreEvents');

const payload = (extra = {}) => JSON.stringify({
  map_ids: [111, 222], ranktype: 'set', type: 'rank', ...extra,
});

test('rank vira anúncio', () => {
  const e = parseEvent(payload());
  assert.deepEqual(e.mapIds, [111, 222]);
  assert.equal(e.status, 2);
  assert.equal(e.scope, 'set');
});

test('love também', () => {
  assert.equal(parseEvent(payload({ type: 'love' })).status, 5);
});

test('unrank é descartado', () => {
  // Decisão de produto: desqualificar é rotina de curadoria e encheria o canal.
  // Quem acompanha quer saber o que ENTROU.
  assert.equal(parseEvent(payload({ type: 'unrank' })), null);
  assert.equal(ANNOUNCED_TYPES.has('unrank'), false);
});

test('o autor é opcional', () => {
  // O campo só existe se o fork tiver a alteração que o inclui. Sem ele o
  // anúncio sai sem "aplicado por", em vez de sair errado ou não sair.
  assert.equal(parseEvent(payload()).authorName, null);
  assert.equal(parseEvent(payload()).authorId, null);

  const comAutor = parseEvent(payload({ author_id: 3, author_name: 'nunca' }));
  assert.equal(comAutor.authorId, 3);
  assert.equal(comAutor.authorName, 'nunca');

  // Ausente e explicitamente nulo precisam dar no mesmo. `Number(null)` é 0 e
  // `Number.isFinite(0)` é verdadeiro, então o campo opcional vinha como o
  // jogador 0 — e "não sei quem foi" virava um id de jogador válido.
  assert.equal(parseEvent(payload({ author_id: null })).authorId, null);
  assert.equal(parseEvent(payload({ author_id: '' })).authorId, null);
  assert.equal(parseEvent(payload({ author_id: 0 })).authorId, null);
  // Id vem como string em JSON de fork que serializa assim.
  assert.equal(parseEvent(payload({ author_id: '42' })).authorId, 42);
});

test('payload quebrado não derruba nada', () => {
  // Vem da rede, de outro processo: tem que ser tratado como entrada hostil.
  assert.equal(parseEvent('isso não é json'), null);
  assert.equal(parseEvent('null'), null);
  assert.equal(parseEvent(''), null);
});

test('evento sem mapa nenhum é descartado', () => {
  assert.equal(parseEvent(payload({ map_ids: [] })), null);
  assert.equal(parseEvent(payload({ map_ids: 'nada disso' })), null);
});

test('ids não numéricos são filtrados, não propagados', () => {
  // Iriam parar numa URL de API; o idSegment recusaria, mas depois de já ter
  // custado a requisição.
  const e = parseEvent(payload({ map_ids: [111, 'abc', null, 222] }));
  assert.deepEqual(e.mapIds, [111, 222]);
});
