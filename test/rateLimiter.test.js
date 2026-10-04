/**
 * O balde do rate limiter: rajada e vazão separadas, e o pico por minuto.
 *
 * As duas eram o mesmo número, e por isso não dava para chegar ao que os termos
 * da API do osu! pedem — 60 por minuto contínuos, com o primeiro comando sem
 * fila. O pico é o que o /diag mostra para escolher esse número com dado, e
 * não com chute (ver docs/investigacoes/2026-10-04-termos-api-osu.md).
 */
const test = require('node:test');
const assert = require('node:assert');

const metrics = require('../src/lib/metrics');
const { LeakyBucket, BUCKETS } = require('../src/rateLimiter');

test.beforeEach(() => metrics.reset());

async function cronometrar(fn) {
  const inicio = Date.now();
  await fn();
  return Date.now() - inicio;
}

test('com o balde cheio, a rajada inteira sai sem espera', async () => {
  const balde = new LeakyBucket('teste', { porSegundo: 1, rajada: 5 });

  const ms = await cronometrar(() => Promise.all(Array.from({ length: 5 }, () => balde.acquire())));

  assert.ok(ms < 100, `a rajada esperou ${ms}ms`);
  assert.equal(metrics.get('limiter.teste.waitMs'), 0);
});

test('passada a rajada, a próxima espera pela vazão e não pela rajada', async () => {
  // 20/s = um token a cada 50ms. Com rajada igual à vazão, como era antes, a
  // quarta sairia na hora; aqui ela tem que esperar o token seguinte.
  const balde = new LeakyBucket('teste', { porSegundo: 20, rajada: 3 });
  await Promise.all([balde.acquire(), balde.acquire(), balde.acquire()]);

  const ms = await cronometrar(() => balde.acquire());

  assert.ok(ms >= 40, `a quarta saiu em ${ms}ms, antes do token seguinte`);
  assert.ok(metrics.get('limiter.teste.waitMs') > 0);
});

test('o pico guarda o maior minuto, e não soma minutos', async () => {
  const balde = new LeakyBucket('teste', { porSegundo: 100, rajada: 100 });

  for (let i = 0; i < 7; i++) await balde.acquire();
  assert.equal(metrics.get('limiter.teste.peakMin'), 7);

  // Minuto novo: a contagem recomeça, e um minuto menor não baixa o pico.
  balde.minuto -= 1;
  for (let i = 0; i < 2; i++) await balde.acquire();
  assert.equal(metrics.get('limiter.teste.peakMin'), 7);
  assert.equal(metrics.get('limiter.teste.calls'), 9);
});

test('BUCKETS aceita número ou {porSegundo, rajada}', () => {
  for (const [nome, limite] of Object.entries(BUCKETS)) {
    const ok = typeof limite === 'number'
      ? limite > 0
      : limite.porSegundo > 0 && limite.rajada >= 1;
    assert.ok(ok, `limite inválido em ${nome}: ${JSON.stringify(limite)}`);
  }
});
