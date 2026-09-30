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

const metrics = require('../src/lib/metrics');
const diag = require('../src/commands/admin/diag');

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

// ─── Tempo por comando ────────────────────────────────────────────────────────

test('percentis de amostras conhecidas', () => {
  // 1..100 fora de ordem: p50 é 50 e p95 é 95 pela posição mais próxima, sem
  // interpolação — o número mostrado sempre é um tempo que de fato ocorreu.
  const valores = Array.from({ length: 100 }, (_, i) => i + 1);
  for (const v of valores.reverse()) metrics.duration('rs', v);

  const { rs } = metrics.snapshot().comandos;
  assert.equal(rs.n, 100);
  assert.equal(rs.p50, 50);
  assert.equal(rs.p95, 95);
  assert.equal(rs.max, 100);
  assert.equal(rs.erros, 0);
});

test('uma amostra só é p50, p95 e máximo ao mesmo tempo', () => {
  metrics.duration('top', 0.25);

  const { top } = metrics.snapshot().comandos;
  assert.deepEqual(top, { n: 1, erros: 0, amostras: 1, p50: 0.25, p95: 0.25, max: 0.25 });
});

test('a janela não cresce, e os percentis seguem só as últimas amostras', () => {
  // Uma janela cheia de lentos, depois outra de rápidos: se a memória crescesse
  // (ou a mais antiga não saísse), o p95 continuaria em 10s.
  for (let i = 0; i < metrics.JANELA; i++) metrics.duration('nochoke', 10);
  for (let i = 0; i < metrics.JANELA; i++) metrics.duration('nochoke', 1);

  const { nochoke } = metrics.snapshot().comandos;
  assert.equal(nochoke.amostras, metrics.JANELA);
  assert.equal(nochoke.n, 2 * metrics.JANELA, 'a quantidade é do processo, não da janela');
  assert.equal(nochoke.p50, 1);
  assert.equal(nochoke.p95, 1);
  assert.equal(nochoke.max, 10, 'o máximo é do processo, não da janela');
});

test('timed conta o erro e relança o mesmo erro', async () => {
  const original = new Error('api fora');

  await assert.rejects(metrics.timed('profile', async () => { throw original; }), e => e === original);
  assert.equal(await metrics.timed('profile', async () => 'ok'), 'ok');

  const { profile } = metrics.snapshot().comandos;
  assert.equal(profile.n, 2);
  assert.equal(profile.erros, 1);
  assert.ok(profile.max >= 0);
});

test('timed mede o tempo de verdade', async () => {
  await metrics.timed('lento', () => new Promise(r => setTimeout(r, 30)));

  const { lento } = metrics.snapshot().comandos;
  // Margem folgada para baixo: timer do Node pode disparar um pouco antes.
  assert.ok(lento.max >= 0.02 && lento.max < 5, `mediu ${lento.max}s`);
});

test('reset limpa os tempos', () => {
  metrics.duration('rs', 1, true);
  metrics.reset();

  assert.deepEqual(metrics.snapshot().comandos, {});
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

test('o /diag mostra os comandos mais usados, com tempo e erros', async () => {
  for (let i = 0; i < 3; i++) metrics.duration('rs', 0.042);
  metrics.duration('nochoke', 1.83, true);

  const capturado = [];
  await diag.execute(fakeInteraction(capturado));

  const campos = capturado[0].embeds[0].toJSON().fields;
  const campo = campos.find(f => /rs/.test(f.value) && /nochoke/.test(f.value));
  assert.ok(campo, 'deveria haver um campo com os comandos');

  const [primeira, segunda] = campo.value.split('\n');
  assert.match(primeira, /rs.*3 · 42ms \/ 42ms \/ 42ms$/, 'o mais usado vem primeiro, sem erro');
  assert.match(segunda, /nochoke.*1 · 1\.8s \/ 1\.8s \/ 1\.8s · ✗1$/);
  assert.doesNotMatch(JSON.stringify(campos), /Nada registrado/);
});

test('o /diag mostra no máximo 10 comandos, e cabe no campo do embed', async () => {
  // Nome de 32 caracteres é o teto do Discord; com 15 deles o campo passaria
  // de 1024 se não houvesse corte.
  for (let i = 0; i < 15; i++) {
    const nome = `comando_${String(i).padStart(2, '0')}`.padEnd(32, 'x');
    for (let j = 0; j <= i; j++) metrics.duration(nome, 12345.6, true);
  }

  const capturado = [];
  await diag.execute(fakeInteraction(capturado));

  const campo = capturado[0].embeds[0].toJSON().fields.find(f => /comando_/.test(f.value));
  const linhas = campo.value.split('\n');
  assert.ok(linhas.length <= 10);
  assert.ok(campo.value.length <= 1024, `campo com ${campo.value.length} caracteres`);
  assert.match(linhas[0], /comando_14/, 'o mais usado vem primeiro');
});
