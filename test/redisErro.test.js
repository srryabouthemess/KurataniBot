/**
 * O que a falha de Redis conta para quem está do outro lado da tela.
 *
 * A mensagem do cliente Redis costuma trazer host e porta da infraestrutura, e
 * ela ia inteira para o Discord. Quem lê a resposta não faz nada com isso; quem
 * diagnostica tem o log. É o mesmo princípio que o logger.js já aplica ao não
 * imprimir o `.config` do axios, que carrega o header Authorization.
 *
 * O caso existe para que um "melhoramento" futuro não devolva o detalhe à tela
 * achando que ajuda.
 */
const test = require('node:test');
const assert = require('node:assert');

const DETALHE = 'connect ECONNREFUSED 10.0.0.7:6379';

const logado = [];

for (const [caminho, exports] of Object.entries({
  '../src/db': { getStaffLink: () => null },
  '../src/daycoreAdmin': {
    checkConnection: async () => ({ ok: false, reason: 'unreachable', error: DETALHE }),
  },
  '../src/logger': {
    logError: (contexto, erro) => { logado.push(`${contexto}: ${erro?.message}`); },
    logErrorOnce: () => {},
  },
})) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

const { checkRedisOrError } = require('../src/staffGuard');
const s = require('../src/i18n/pt')({ ADMIN: 'Daycore' });

test('o detalhe do Redis vai para o log, não para o Discord', async () => {
  logado.length = 0;
  const resposta = await checkRedisOrError(s);

  assert.ok(resposta, 'deveria ter recusado');
  assert.ok(!resposta.includes('6379'), 'a porta vazou na resposta ao usuário');
  assert.ok(!resposta.includes('10.0.0.7'), 'o host vazou na resposta ao usuário');
  assert.ok(!resposta.includes('ECONNREFUSED'), 'o erro cru vazou na resposta ao usuário');

  // E a pessoa ainda precisa entender o que houve, e que nada foi alterado.
  assert.match(resposta, /Redis inacessível/);
  assert.match(resposta, /Nada foi alterado/);

  assert.deepEqual(logado, [`staffGuard:redis: ${DETALHE}`], 'o detalhe sumiu também do log');
});

test('sem configuração, a mensagem é outra e nada é logado', async () => {
  // "Não está configurado" é orientação, não incidente: logar aqui só encheria
  // o log de quem ainda não terminou de configurar o bot.
  const daycore = require('../src/daycoreAdmin');
  daycore.checkConnection = async () => ({ ok: false, reason: 'unconfigured' });

  logado.length = 0;
  const resposta = await checkRedisOrError(s);

  assert.equal(resposta, s.admin_redis_unconfigured);
  assert.deepEqual(logado, []);
});

test('com o Redis de pé, não há erro nenhum', async () => {
  const daycore = require('../src/daycoreAdmin');
  daycore.checkConnection = async () => ({ ok: true });

  assert.equal(await checkRedisOrError(s), null);
});
