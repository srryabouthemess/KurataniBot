/**
 * O log de erro não pode ser o problema.
 *
 * Duas coisas se cruzam aqui. A primeira é a razão de o módulo existir: um
 * AxiosError carrega `.config` com os headers da requisição, e imprimir o erro
 * cru põe o `Authorization: Bearer <token>` no log.
 *
 * A segunda é o tamanho. O corpo da resposta ia inteiro para o console — um 502
 * de proxy devolve página HTML, e o download de `.osu` usa responseType
 * arraybuffer, cujo Buffer no JSON.stringify vira um número por byte. Vezes as
 * tentativas do retry, uma queda da API escrevia megabytes por comando.
 */
const test = require('node:test');
const assert = require('node:assert');

const { logError, BODY_MAX } = require('../src/logger');

/** Roda o logError capturando o que ele mandaria para o console. */
function capture(context, error) {
  const original = console.error;
  const lines = [];
  console.error = (...parts) => lines.push(parts.join(' '));
  try {
    logError(context, error);
  } finally {
    console.error = original;
  }
  return lines.join('\n');
}

/** AxiosError com o que ele carrega de verdade, incluindo o header do token. */
function axiosError(data, { status = 500 } = {}) {
  return Object.assign(new Error('Request failed with status code ' + status), {
    config:   { headers: { Authorization: 'Bearer TOKEN_SUPER_SECRETO' } },
    response: { status, data },
  });
}

test('a credencial nunca aparece', () => {
  const out = capture('teste', axiosError({ error: 'nope' }));
  assert.doesNotMatch(out, /TOKEN_SUPER_SECRETO/);
  assert.doesNotMatch(out, /Authorization/);
});

test('corpo de texto longo é cortado', () => {
  const html = '<html>' + 'x'.repeat(50_000) + '</html>';
  const out  = capture('teste', axiosError(html));

  assert.ok(out.length < BODY_MAX + 300, `saiu com ${out.length} caracteres`);
  assert.match(out, /caracteres\)$/);
});

test('corpo binário vira só o tamanho', () => {
  // O caso do download de .osu: sem isto, um Buffer de 50KB vira um array JSON
  // com 50 mil números.
  const out = capture('teste', axiosError(Buffer.alloc(50_000)));

  assert.match(out, /<50000 bytes>/);
  assert.doesNotMatch(out, /"type":"Buffer"/);
});

test('corpo curto passa inteiro', () => {
  const out = capture('teste', axiosError({ error: 'map not found' }));
  assert.match(out, /map not found/);
});

test('erro sem resposta HTTP ainda loga a mensagem', () => {
  const out = capture('redis', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
  assert.match(out, /\[redis\]/);
  assert.match(out, /ECONNREFUSED/);
});

test('corpo que não serializa não derruba o log', () => {
  const circular = {};
  circular.self = circular;

  // Antes de existir o try/catch, o JSON.stringify estourava aqui — dentro do
  // tratamento de outro erro, que é o pior lugar para uma segunda exceção.
  assert.doesNotThrow(() => capture('teste', axiosError(circular)));
});
