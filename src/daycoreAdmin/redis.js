/**
 * daycoreAdmin/redis.js
 * A conexão de ESCRITA com o Redis do servidor, e o `publish` por onde passa
 * toda ação administrativa. A assinatura de eventos (leitura) é outra conexão,
 * em daycoreEvents.js: um client em modo subscribe não publica.
 */

// Desestruturado no require, e os testes contam com isso: eles trocam o
// `createClient` do pacote antes de carregar este módulo.
const { createClient } = require('redis');
const { logError } = require('../lib/logger');
const config = require('../config');

// ─── Conexão com o Redis ──────────────────────────────────────────────────────
// Lazy e opcional: o bot precisa subir normalmente numa máquina de
// desenvolvimento sem Redis nenhum — só os comandos administrativos ficam
// indisponíveis, com mensagem clara, em vez de derrubar o processo no boot.

let _client     = null;
let _connecting = null;

function isConfigured() {
  return config.redis !== null;
}

async function getRedis() {
  if (!isConfigured()) return null;
  if (_client?.isOpen) return _client;
  if (_connecting) return _connecting;

  _connecting = (async () => {
    // Credenciais em campos separados, nunca numa URL — ver config.redis.
    const { host, port, ...auth } = config.redis;
    const client = createClient({
      socket: {
        host,
        port,
        connectTimeout: 5000,
        // Sem isso o client tenta reconectar para sempre e cada comando fica
        // pendurado; três tentativas e falha com erro que o comando trata.
        reconnectStrategy: (retries) => (retries > 3 ? false : Math.min(retries * 200, 1000)),
      },
      ...auth,
    });

    // O client emite 'error' em queda de conexão; sem listener o Node derruba
    // o processo inteiro com unhandled 'error' event.
    client.on('error', (err) => logError('daycoreAdmin:redis', err));

    await client.connect();
    _client = client;
    return client;
  })();

  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

async function closeRedis() {
  if (_client?.isOpen) await _client.quit();
  _client = null;
}

/**
 * Testa se dá para falar com o Redis agora.
 * @returns {Promise<{ok: true} | {ok: false, reason: 'unconfigured'|'unreachable', error?: string}>}
 */
async function checkConnection() {
  if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
  try {
    const client = await getRedis();
    await client.ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'unreachable', error: err.message };
  }
}

async function publish(channel, payload) {
  const client = await getRedis();
  if (!client) throw new Error('Redis não configurado (defina REDIS_HOST no .env).');
  // O bancho faz orjson.loads(message["data"]) — precisa ser JSON puro.
  await client.publish(channel, JSON.stringify(payload));
}

module.exports = {
  isConfigured,
  getRedis,
  closeRedis,
  checkConnection,
  publish,
};
