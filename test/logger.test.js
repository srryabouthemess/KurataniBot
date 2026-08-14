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

const { logError, logErrorOnce, BODY_MAX, CAUSAS_MAX } = require('../src/logger');

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

// ─── Stack trace ──────────────────────────────────────────────────────────────
// O módulo nasceu para não imprimir o erro cru, e tinha corrigido demais: sobrava
// só `error.message`. Um TypeError dentro de um comando virava uma linha sem
// arquivo nem função, o que em produção não dá para depurar.

test('erro de programação leva o stack junto', () => {
  function funcaoComNomeReconhecivel() { return null.propriedade; }

  let erro;
  try { funcaoComNomeReconhecivel(); } catch (e) { erro = e; }

  const saida = capture('comando:teste', erro);
  assert.match(saida, /TypeError|Cannot read/);
  assert.match(saida, /funcaoComNomeReconhecivel/, 'o stack deveria apontar onde quebrou');
});

test('resposta HTTP não arrasta stack para o log', () => {
  // 404 da API é resposta esperada; stack aqui seria ruído em log que já enche
  // sozinho durante uma queda.
  const erro = new Error('Request failed with status code 404');
  erro.response = { status: 404, data: 'not found' };

  const saida = capture('osu', erro);
  assert.match(saida, /status=404/);
  assert.doesNotMatch(saida, /at .*logger\.test/);
});

test('valor rejeitado que não é Error não quebra o log', () => {
  // unhandledRejection pode entregar qualquer coisa, inclusive string.
  assert.match(capture('unhandledRejection', 'algo deu errado'), /algo deu errado/);
  assert.doesNotThrow(() => capture('unhandledRejection', undefined));
});

test('o stack não carrega header de autorização', () => {
  // A razão de o módulo existir continua valendo depois da mudança.
  const erro = new Error('socket hang up');
  erro.config = { headers: { Authorization: 'Bearer segredo-do-bot' } };

  const saida = capture('rede', erro);
  assert.doesNotMatch(saida, /segredo-do-bot/);
  assert.doesNotMatch(saida, /Authorization/);
});

// ─── Uma causa, um log ────────────────────────────────────────────────────────
// Os cálculos de PP rodam uma vez por play: um /topplays com cinco plays do
// mesmo mapa problemático viraria cinco linhas idênticas por página, e a mesma
// falha volta a cada renderização. Logar tudo enche o disco de quem já está com
// problema — que é o pior momento para isso.

/** Roda o logErrorOnce calado, devolvendo se ele chegou a logar. */
function logouUmaVez(context, error) {
  const original = console.error;
  console.error = () => {};
  try {
    return logErrorOnce(context, error);
  } finally {
    console.error = original;
  }
}

test('a mesma causa só sai uma vez', () => {
  const erro = new Error(`falha repetida ${Math.random()}`);

  assert.equal(logouUmaVez('pp:fc', erro), true, 'a primeira deveria sair');
  assert.equal(logouUmaVez('pp:fc', erro), false, 'a repetição deveria ficar calada');
});

test('o mesmo texto em contextos diferentes são causas diferentes', () => {
  // Um download que falha no caminho das estrelas e no do FC pp são dois
  // problemas, mesmo com a mensagem idêntica — calar o segundo esconderia
  // metade do estrago.
  const texto = `timeout ${Math.random()}`;

  assert.equal(logouUmaVez('pp:difficulty', new Error(texto)), true);
  assert.equal(logouUmaVez('pp:fc',         new Error(texto)), true);
});

test('causa vazia não ocupa espaço nem loga', () => {
  assert.equal(logouUmaVez('pp:fc', new Error('')), false);
  assert.equal(logouUmaVez('pp:fc', null), false);
  assert.equal(logouUmaVez('pp:fc', undefined), false);
});

test('o registro tem teto: causa antiga sai e pode voltar a ser logada', () => {
  // Sem teto a estrutura só cresce: basta a mensagem variar por mapa
  // ("mapa 123 não encontrado") para virar uma entrada por mapa, num processo
  // que fica semanas no ar.
  const marca = Math.random();
  const primeira = new Error(`mapa 0 ${marca}`);

  assert.equal(logouUmaVez('pp:difficulty', primeira), true);
  assert.equal(logouUmaVez('pp:difficulty', primeira), false, 'ainda está no conjunto');

  for (let i = 1; i <= CAUSAS_MAX * 2; i++) {
    logouUmaVez('pp:difficulty', new Error(`mapa ${i} ${marca}`));
  }

  assert.equal(
    logouUmaVez('pp:difficulty', primeira), true,
    'a causa mais antiga deveria ter sido descartada',
  );
});
