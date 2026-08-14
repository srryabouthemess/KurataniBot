/**
 * Os contadores de diagnóstico, e o /diag que os mostra.
 *
 * Todo ajuste de desempenho deste bot foi medido com script de bancada, o que
 * serve para DECIDIR uma mudança e não serve para nada depois dela: em produção
 * não havia como saber se o cache está acertando, se algum balde do rate limiter
 * virou fila, ou se a thread do rosu está de pé.
 */
const test = require('node:test');
const assert = require('node:assert');

const metrics = require('../src/metrics');
const diag = require('../src/commands/diag');

test.beforeEach(() => metrics.reset());

test('contador soma, e começa em zero', () => {
  assert.equal(metrics.get('qualquer.coisa'), 0);

  metrics.count('api.chamadas');
  metrics.count('api.chamadas', 4);

  assert.equal(metrics.get('api.chamadas'), 5);
});

test('acerto e erro de cache viram taxa', () => {
  for (let i = 0; i < 3; i++) metrics.cache('fcPP', true);
  metrics.cache('fcPP', false);

  const { caches } = metrics.snapshot();
  assert.deepEqual(caches.fcPP, { hit: 3, miss: 1, total: 4, taxa: 0.75 });
});

test('cache nunca consultado não aparece', () => {
  // Zero de zero não é 0% nem 100%: é "não sei". Mostrar uma linha zerada faria
  // parecer que o cache está falhando quando ele só não foi consultado ainda.
  metrics.cache('usado', true);

  const { caches } = metrics.snapshot();
  assert.ok(caches.usado, 'o que foi consultado deveria aparecer');
  assert.equal(caches.naoUsado, undefined);
});

test('só erro é 0%, e não "não sei"', () => {
  // A distinção importa no /diag: 0% com 40 consultas é um cache que não está
  // servindo para nada, e merece ser visto.
  for (let i = 0; i < 40; i++) metrics.cache('frio', false);

  const { caches } = metrics.snapshot();
  assert.equal(caches.frio.taxa, 0);
  assert.equal(caches.frio.total, 40);
});

test('o snapshot separa contador de cache', () => {
  metrics.count('limiter.osuApi.calls', 7);
  metrics.cache('usuario', true);

  const { contadores, caches } = metrics.snapshot();
  assert.equal(contadores['limiter.osuApi.calls'], 7);
  assert.equal(contadores['cache.usuario.hit'], undefined, 'cache não deveria vazar para contadores');
  assert.equal(caches.usuario.hit, 1);
});

// ─── O comando ────────────────────────────────────────────────────────────────

/** Uma interação com o mínimo que o /diag toca. */
function fakeInteraction(capturado) {
  return {
    user:    { id: '1' },
    guildId: '2',
    reply:   async (payload) => { capturado.push(payload); },
  };
}

test('o /diag responde em efêmero, e fica fora do modo texto', async () => {
  // Efêmero só existe dentro de interação: no modo texto a flag some e a
  // resposta viraria mensagem no canal.
  assert.equal(diag.prefix?.slashOnly, true);

  const capturado = [];
  await diag.execute(fakeInteraction(capturado));

  assert.equal(capturado.length, 1);
  assert.ok(capturado[0].flags, 'deveria responder em efêmero');
  assert.ok(capturado[0].embeds?.[0], 'deveria responder com embed');
});

test('o /diag mostra os números que foram contados', async () => {
  metrics.cache('fcPP', true);
  metrics.cache('fcPP', true);
  metrics.cache('fcPP', false);
  metrics.count('limiter.osuMapFile.calls', 12);
  metrics.count('limiter.osuMapFile.waitMs', 3400);

  const capturado = [];
  await diag.execute(fakeInteraction(capturado));

  const texto = JSON.stringify(capturado[0].embeds[0].toJSON());
  assert.match(texto, /fcPP/);
  assert.match(texto, /67%/, 'a taxa de acerto deveria aparecer');
  assert.match(texto, /osuMapFile/);
  assert.match(texto, /3\.4s/, 'a espera acumulada deveria aparecer em segundos');
});

test('bot recém-subido não mostra tabela vazia', async () => {
  // Sem nada contado, uma tabela de zeros parece defeito. A mensagem diz o que
  // está acontecendo.
  const capturado = [];
  await diag.execute(fakeInteraction(capturado));

  const texto = JSON.stringify(capturado[0].embeds[0].toJSON());
  assert.match(texto, /Nada registrado|Nothing recorded|ничего не записано/i);
});
