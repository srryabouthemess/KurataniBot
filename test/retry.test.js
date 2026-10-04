/**
 * O retry respeita o `Retry-After` quando o servidor manda.
 *
 * Sem ele o backoff próprio é chute: curto demais gasta a tentativa batendo no
 * mesmo 429, longo demais segura a resposta à toa.
 */
const test = require('node:test');
const assert = require('node:assert');

const { withRetry, retryAfterMs } = require('../src/lib/retry');

function erro429(retryAfter) {
  const e = new Error('429');
  e.response = { status: 429, headers: retryAfter == null ? {} : { 'retry-after': retryAfter } };
  return e;
}

test('Retry-After em segundos e em data HTTP', () => {
  assert.equal(retryAfterMs(erro429('2')), 2000);
  assert.equal(retryAfterMs(erro429('0')), 0);

  const agora = Date.parse('2026-10-04T12:00:00Z');
  assert.equal(retryAfterMs(erro429('Sun, 04 Oct 2026 12:00:05 GMT'), agora), 5000);
  // Data no passado: pode tentar já.
  assert.equal(retryAfterMs(erro429('Sun, 04 Oct 2026 11:00:00 GMT'), agora), 0);
});

test('sem header, ou com lixo, cai no backoff próprio', () => {
  assert.equal(retryAfterMs(erro429(null)), null);
  assert.equal(retryAfterMs(erro429('')), null);
  assert.equal(retryAfterMs(erro429('amanhã')), null);
  assert.equal(retryAfterMs(erro429('-3')), null);
  assert.equal(retryAfterMs(new Error('rede')), null);
});

test('espera o que o servidor pediu e tenta de novo', async () => {
  let chamadas = 0;
  const inicio = Date.now();

  const r = await withRetry(async () => {
    chamadas += 1;
    if (chamadas === 1) throw erro429('0.1');
    return 'ok';
  }, { baseMs: 5000 });

  const ms = Date.now() - inicio;
  assert.equal(r, 'ok');
  assert.equal(chamadas, 2);
  // Esperou os 100ms pedidos, e não os 5s do backoff.
  assert.ok(ms >= 90 && ms < 1000, `esperou ${ms}ms`);
});

test('Retry-After acima do teto desiste na hora', async () => {
  let chamadas = 0;
  const inicio = Date.now();

  await assert.rejects(withRetry(async () => {
    chamadas += 1;
    throw erro429('120');
  }, { maxRetryAfterMs: 30_000 }));

  assert.equal(chamadas, 1);
  assert.ok(Date.now() - inicio < 500);
});
