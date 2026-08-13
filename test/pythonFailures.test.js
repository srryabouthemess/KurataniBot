/**
 * Registro de falhas do cálculo de PP em Python.
 *
 * O PP do Relax é opcional, e quem não instalou a lib tem sempre o mesmo erro —
 * como isto é chamado uma vez por play, um /topplays de RX viraria cinco
 * tracebacks idênticos por página. Daí o conjunto de causas já vistas.
 *
 * Só que ele nunca descartava nada. Basta a mensagem do script variar por mapa
 * ("stdin vazio para o mapa X") para virar uma entrada de até 2000 caracteres
 * por mapa que falhou, num processo que fica semanas no ar.
 */
const test = require('node:test');
const assert = require('node:assert');

const { reportPythonFailure } = require('../src/pp');

/** Roda capturando o console, e diz se a causa chegou a ser logada. */
function logou(detalhe) {
  const original = console.error;
  let saiu = false;
  console.error = () => { saiu = true; };
  try {
    reportPythonFailure('teste', detalhe);
  } finally {
    console.error = original;
  }
  return saiu;
}

test('a mesma causa só é logada uma vez', () => {
  const causa = `akatsuki-pp-py nao instalado ${Math.random()}`;

  assert.equal(logou(causa), true, 'a primeira vez sai');
  assert.equal(logou(causa), false, 'a repetição fica calada');
});

test('causa vazia não ocupa espaço nem loga', () => {
  assert.equal(logou(''), false);
  assert.equal(logou(null), false);
  assert.equal(logou(undefined), false);
});

test('causas distintas ainda passam — o silêncio é por causa, não geral', () => {
  // Um booleano só deixaria passar a primeira e calaria todas as seguintes,
  // inclusive um problema novo que aparecesse depois.
  const marca = Math.random();
  assert.equal(logou(`falha A ${marca}`), true);
  assert.equal(logou(`falha B ${marca}`), true);
});

test('o registro tem teto: causa antiga sai e pode voltar a ser logada', () => {
  const marca = Math.random();
  const primeira = `stdin vazio para o mapa 0 ${marca}`;

  assert.equal(logou(primeira), true);
  assert.equal(logou(primeira), false, 'ainda está no conjunto');

  // Enche bem acima do teto interno, com causas todas distintas.
  for (let i = 1; i <= 200; i++) logou(`stdin vazio para o mapa ${i} ${marca}`);

  // Se o conjunto crescesse sem limite, esta continuaria dentro e ficaria muda.
  assert.equal(logou(primeira), true, 'a causa mais antiga foi descartada');
});
