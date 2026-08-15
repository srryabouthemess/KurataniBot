/**
 * De quem é o balde de vazão de um servidor privado.
 *
 * O limite existe para não afogar a MÁQUINA do servidor. A chave era a do
 * servidor no registro, e a variante RX é uma entrada própria (`daycore_rx`) do
 * mesmo cadastro no mesmo host — então `daycore` e `daycore_rx` tinham baldes
 * separados, e o teto real contra a máquina era o dobro do configurado. Um balde
 * que não sabe quantos clientes dele existem não é um limite.
 *
 * A troca é de uma palavra (`key` → `namespace`) e some no diff. É por isso que
 * ela tem teste: nada na tela muda quando alguém a desfizer.
 */
const test = require('node:test');
const assert = require('node:assert');

const pedidos = [];

/** Servidor e variante RX como o registro os monta: chaves distintas, host um só. */
const REGISTRO = {
  daycore:    { key: 'daycore',    namespace: 'daycore', gameMode: 0, banchoV1: 'http://exemplo/v1', banchoV2: 'http://exemplo/v2', webApi: 'http://exemplo/api/v1' },
  daycore_rx: { key: 'daycore_rx', namespace: 'daycore', gameMode: 4, banchoV1: 'http://exemplo/v1', banchoV2: 'http://exemplo/v2', webApi: 'http://exemplo/api/v1' },
  akatsuki:    { key: 'akatsuki',    namespace: 'akatsuki', rx: 0, webUrl: 'http://aka' },
  akatsuki_rx: { key: 'akatsuki_rx', namespace: 'akatsuki', rx: 1, webUrl: 'http://aka' },
};

const stubs = {
  '../src/rateLimiter': { acquire: async (nome) => { pedidos.push(nome); }, BUCKETS: {} },
  '../src/servers': {
    get: (chave) => REGISTRO[chave] ?? REGISTRO.daycore,
    resolveKey: () => 'daycore',
    defaultKey: () => 'daycore',
    isOfficial: () => false,
    label: () => 'Daycore',
    all: () => Object.values(REGISTRO),
    namespace: (chave) => (REGISTRO[chave] ?? REGISTRO.daycore).namespace,
    OFFICIAL_KEY: 'official',
  },
  axios: { get: async () => ({ data: { data: {} } }) },
};

for (const [caminho, exports] of Object.entries(stubs)) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

const banchoPy = require('../src/osu/banchoPyApi');
const ripple = require('../src/osu/rippleApi');

test.beforeEach(() => { pedidos.length = 0; });

test('bancho.py: a variante RX divide o balde com o servidor pai', async () => {
  await banchoPy.getServerMap(1, 'daycore');
  await banchoPy.getServerMap(1, 'daycore_rx');

  assert.deepEqual(
    pedidos, ['server:daycore', 'server:daycore'],
    'a variante RX abriu um balde próprio contra a mesma máquina',
  );
});

test('Ripple: idem — o Akatsuki e o Akatsuki RX são um host só', async () => {
  await ripple.bestScores(1, 5, 'akatsuki').catch(() => {});
  await ripple.bestScores(1, 5, 'akatsuki_rx').catch(() => {});

  assert.deepEqual(pedidos, ['server:akatsuki', 'server:akatsuki']);
});

test('servidores distintos continuam com baldes distintos', async () => {
  // O limite é por máquina: um servidor lento não pode segurar a fila do outro.
  await banchoPy.getServerMap(1, 'daycore');
  await ripple.bestScores(1, 5, 'akatsuki').catch(() => {});

  assert.deepEqual(pedidos, ['server:daycore', 'server:akatsuki']);
});
