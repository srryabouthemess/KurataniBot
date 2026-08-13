/**
 * Janela de verificação pós-publicação.
 *
 * O pub/sub não devolve resultado, então a confirmação é reler o estado — e
 * quanto o bancho demora depende de quantas dificuldades ele tem que buscar. A
 * janela fixa de antes servia para uma e fechava cedo demais para cem: o
 * `Hardtekk Jump Training` reportou 90/100 e a releitura seguinte mostrou
 * 100/100. Nada tinha falhado; a resposta é que chamava de parcial uma ação
 * inteira.
 *
 * O que estes casos travam: que a janela cresça com o set, que tenha teto (do
 * outro lado espera uma interação do Discord, que expira), e que sempre role ao
 * menos uma releitura.
 */
const test = require('node:test');
const assert = require('node:assert');

// Trocado antes do require do daycoreAdmin: ele resolve o osuClient no topo.
const clientPath = require.resolve('../src/osuClient');
const osuMock = {};
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true, exports: osuMock,
};

const daycore = require('../src/daycoreAdmin');

const RANKED = 2;

/** getServerMap que só devolve o status esperado a partir da enésima leitura. */
function confirmsAfter(reads, { status = RANKED } = {}) {
  const seen = {};
  return async id => {
    seen[id] = (seen[id] ?? 0) + 1;
    return { id, status: seen[id] >= reads ? status : 0 };
  };
}

test('a janela cresce com o número de dificuldades', () => {
  const uma = daycore.verifyBudget(1);
  const cem = daycore.verifyBudget(100);

  assert.ok(cem > uma, `${cem} deveria ser maior que ${uma}`);
  // Um set de 100 precisa de folga de verdade, não de um empurrãozinho.
  assert.ok(cem > uma * 5, `${cem} é pouco para 100 dificuldades`);
});

test('a janela tem teto', () => {
  // Sem teto, um set absurdo seguraria a interação do Discord até ela expirar.
  assert.equal(daycore.verifyBudget(10000), daycore.verifyBudget(1000000));
  assert.ok(daycore.verifyBudget(10000) <= 180000);
});

test('confirma o que chega no status esperado', async () => {
  osuMock.getServerMap = confirmsAfter(1);

  const r = await daycore.verifyMapStatus([1, 2, 3], RANKED, { delayMs: 0, budgetMs: 500 });
  assert.deepEqual(r.confirmed.sort(), [1, 2, 3]);
  assert.deepEqual(r.pending, []);
});

test('insiste até confirmar, em vez de desistir na primeira passada', async () => {
  // O caso do set grande: a primeira releitura pega o bancho no meio do
  // download, e a janela antiga fechava aí.
  osuMock.getServerMap = confirmsAfter(3);

  const r = await daycore.verifyMapStatus([7], RANKED, { delayMs: 0, budgetMs: 2000 });
  assert.deepEqual(r.confirmed, [7]);
  assert.deepEqual(r.pending, []);
});

test('desiste quando a janela fecha e reporta o que ficou', async () => {
  osuMock.getServerMap = async id => ({ id, status: 0 });

  const r = await daycore.verifyMapStatus([9], RANKED, { delayMs: 5, budgetMs: 40 });
  assert.deepEqual(r.confirmed, []);
  assert.deepEqual(r.pending, [9]);
});

test('sempre relê ao menos uma vez, mesmo sem janela', async () => {
  // Orçamento zero não pode virar "reportei tudo pendente sem olhar".
  let reads = 0;
  osuMock.getServerMap = async id => { reads++; return { id, status: RANKED }; };

  const r = await daycore.verifyMapStatus([5], RANKED, { delayMs: 0, budgetMs: 0 });
  assert.equal(reads, 1);
  assert.deepEqual(r.confirmed, [5]);
});

test('mapa que some da API conta como pendente, não derruba a verificação', async () => {
  osuMock.getServerMap = async () => { throw new Error('404'); };

  const r = await daycore.verifyMapStatus([4], RANKED, { delayMs: 0, budgetMs: 20 });
  assert.deepEqual(r.pending, [4]);
});
