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

/**
 * Cargo mexido dentro do jogo (`ex:priv_change`).
 *
 * Este canal só existe porque `!addpriv`/`!rmpriv` não passam por receptor
 * nenhum no servidor — o `/role` e o admin panel publicam em `addpriv`/
 * `removepriv`, e quem atende esses canais já manda embed para o webhook de
 * auditoria. O que os casos abaixo travam é o filtro: o que vira anúncio, e o
 * que um payload forjado consegue colocar dentro de um embed público.
 */
const { parsePrivEvent } = require('../src/daycoreEvents');

const priv = (extra = {}) => JSON.stringify({
  target_id: 42, target_name: 'fulano', privs: ['nominator'], type: 'addpriv', ...extra,
});

test('addpriv e rmpriv viram anúncio', () => {
  const dado = parsePrivEvent(priv());
  assert.equal(dado.type, 'addpriv');
  assert.equal(dado.targetId, 42);
  assert.equal(dado.targetName, 'fulano');
  assert.deepEqual(dado.privs, ['nominator']);

  assert.equal(parsePrivEvent(priv({ type: 'rmpriv' })).type, 'rmpriv');
});

test('tipo que não é de cargo é descartado', () => {
  // O canal é só dos dois comandos in-game; qualquer outro tipo é payload de
  // outra coisa (ou forjado) e não tem embed correspondente.
  assert.equal(parsePrivEvent(priv({ type: 'rank' })), null);
  assert.equal(parsePrivEvent(priv({ type: '' })), null);
});

test('alvo inválido não vira anúncio', () => {
  // Mesmo motivo dos `map_ids`: `Number(null)` é 0, e um alvo 0 anunciaria
  // cargo de um jogador que não existe.
  assert.equal(parsePrivEvent(priv({ target_id: null })), null);
  assert.equal(parsePrivEvent(priv({ target_id: 0 })), null);
  assert.equal(parsePrivEvent(priv({ target_id: 'abc' })), null);
  // Id como string é forma legítima de fork que serializa assim.
  assert.equal(parsePrivEvent(priv({ target_id: '42' })).targetId, 42);
});

test('o nome do alvo é opcional', () => {
  // Sem ele o anúncio cai no `#id`, que ainda identifica a conta.
  assert.equal(parsePrivEvent(priv({ target_name: null })).targetName, null);
});

test('o autor é opcional, como no anúncio de mapa', () => {
  assert.equal(parsePrivEvent(priv()).authorId, null);
  assert.equal(parsePrivEvent(priv()).authorName, null);

  const comAutor = parsePrivEvent(priv({ author_id: 7, author_name: 'sicrano' }));
  assert.equal(comAutor.authorId, 7);
  assert.equal(comAutor.authorName, 'sicrano');

  assert.equal(parsePrivEvent(priv({ author_id: 0 })).authorId, null);
});

test('cargo vem normalizado, sem repetição', () => {
  // O bancho valida o nome antes de aplicar, mas não a caixa nem a repetição:
  // `!addpriv fulano Mod mod` é aceito e aplicado.
  const dado = parsePrivEvent(priv({ privs: ['Mod', 'mod', ' NOMINATOR '] }));
  assert.deepEqual(dado.privs, ['mod', 'nominator']);
});

test('evento sem cargo nenhum é descartado', () => {
  assert.equal(parsePrivEvent(priv({ privs: [] })), null);
  assert.equal(parsePrivEvent(priv({ privs: 'nominator' })), null);
  assert.equal(parsePrivEvent(priv({ privs: [null, 3, '  '] })), null);
});

test('payload forjado não vira parede de texto no canal', () => {
  // Isto sai num embed público: sem teto, quem alcançasse o Redis mandaria mil
  // cargos de 10 mil caracteres cada.
  const dado = parsePrivEvent(priv({
    privs: [...Array(50).keys()].map(i => `cargo${i}`).concat('x'.repeat(500)),
  }));
  assert.equal(dado.privs.length, 16);
  assert.ok(dado.privs.every(p => p.length <= 32));
});

test('payload quebrado no canal de cargo também não derruba nada', () => {
  assert.equal(parsePrivEvent('isso não é json'), null);
  assert.equal(parsePrivEvent('null'), null);
  assert.equal(parsePrivEvent(''), null);
});
