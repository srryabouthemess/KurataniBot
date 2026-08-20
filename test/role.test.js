/**
 * /role — dá e tira cargo do Daycore.
 *
 * O `addpriv`/`removepriv` do bancho (app/api/utils.py) só checa se o alvo
 * existe e se o cargo não é DONATOR. Ele NÃO olha quem publicou — ao contrário
 * do `restrict`, que recusa sozinho um não-Developer mexendo em staff. Como no
 * /wipe, o que o bot decidir é o que acontece, e o que estes casos travam é a
 * tranca inteira.
 */
const test = require('node:test');
const assert = require('node:assert');

// Stub do redis antes de carregar o daycoreAdmin, que desestrutura o
// createClient no require.
process.env.REDIS_HOST = '127.0.0.1';
const published = [];
const redis = require('redis');
redis.createClient = () => ({
  isOpen: true,
  on() {},
  async connect() {},
  async publish(channel, payload) { published.push([channel, JSON.parse(payload)]); },
});

const daycore = require('../src/daycoreAdmin');

const ACTOR = { osuId: 3, discordId: '100000000000000002', discordName: 'staff-dois' };

test('conceder bit de staff exige DEVELOPER', () => {
  // Conceder `developer` dá controle total do servidor. Se ADMINISTRATOR
  // bastasse, um administrador obteria por procuração o que o bancho não lhe dá.
  for (const chave of ['mod', 'admin', 'developer']) {
    assert.equal(daycore.ROLES[chave].requires, daycore.Privileges.DEVELOPER, chave);
  }
});

test('os cargos sem poder sobre contas param em ADMINISTRATOR', () => {
  // Travá-los em DEVELOPER faria o dono virar gargalo para dar nominator a um
  // mapper novo, que é tarefa de rotina.
  for (const chave of ['verified', 'whitelisted', 'alumni', 'tournament', 'nominator']) {
    assert.equal(daycore.ROLES[chave].requires, daycore.Privileges.ADMINISTRATOR, chave);
  }
});

test('a chave de MODERATOR é "mod", e não "moderator"', () => {
  // O bancho.py-ex tem dois str_priv_dict e eles divergem. Quem atende o
  // pub/sub é o de app/api/utils.py, onde MODERATOR é "mod". Publicar
  // "moderator" devolve `Invalid privilege` no console do bancho — e pub/sub
  // não responde a quem publica, então o sintoma aqui seria um "não
  // confirmado" seco.
  assert.equal(daycore.ROLES.mod.bit, daycore.Privileges.MODERATOR);
  assert.equal(daycore.ROLES.moderator, undefined);
});

test('supporter, premium e normal ficam de fora da tabela', () => {
  // Os dois primeiros o bancho recusa (`return "use givedonor."`). O terceiro é
  // o bit UNRESTRICTED: tirá-lo por aqui bane sem passar pelo
  // Player.restrict(), ou seja, sem registro de restrição e sem sair das
  // leaderboards.
  for (const chave of ['supporter', 'premium', 'normal']) {
    assert.equal(daycore.ROLES[chave], undefined, chave);
  }
});

test('addPrivilege publica o formato exato que o receptor lê', async () => {
  published.length = 0;
  await daycore.addPrivilege(1234, 'nominator', ACTOR);

  assert.deepEqual(published, [['addpriv', { id: 1234, privs: ['nominator'], userId: 3 }]]);
});

test('removePrivilege publica no canal removepriv', async () => {
  published.length = 0;
  await daycore.removePrivilege(1234, 'nominator', ACTOR);

  assert.deepEqual(published, [['removepriv', { id: 1234, privs: ['nominator'], userId: 3 }]]);
});

test('cargo fora da tabela não chega a ser publicado', async () => {
  // O bancho responderia `Invalid privilege` para o console dele, e não para
  // cá. Recusar antes de publicar é o que transforma isso em erro visível.
  published.length = 0;
  await assert.rejects(() => daycore.addPrivilege(1234, 'moderator', ACTOR), /moderator/);
  assert.equal(published.length, 0);
});

test('privNames lista todos os cargos; o privLabel continua só com o topo', () => {
  const priv = daycore.Privileges.UNRESTRICTED
    | daycore.Privileges.NOMINATOR
    | daycore.Privileges.WHITELISTED;

  assert.equal(daycore.privLabel(priv), 'Nominator');
  assert.deepEqual(daycore.privNames(priv), ['Nominator', 'Whitelisted']);
});

test('privNames devolve Player quando não há cargo nenhum', () => {
  assert.deepEqual(daycore.privNames(daycore.Privileges.UNRESTRICTED), ['Player']);
});

test('verifyPriv confirma pela releitura, e desiste quando o bit não aparece', async () => {
  const osuClient = require('../src/osuClient');
  const original = osuClient.getServerPlayerRaw;
  try {
    osuClient.getServerPlayerRaw = async () => ({
      id: 1234,
      name: 'alvo',
      priv: daycore.Privileges.UNRESTRICTED | daycore.Privileges.NOMINATOR,
    });

    const rapido = { attempts: 2, delayMs: 1 };
    assert.equal(await daycore.verifyPriv(1234, daycore.Privileges.NOMINATOR, true,  rapido), true);
    assert.equal(await daycore.verifyPriv(1234, daycore.Privileges.MODERATOR, true,  rapido), false);
    assert.equal(await daycore.verifyPriv(1234, daycore.Privileges.MODERATOR, false, rapido), true);
  } finally {
    osuClient.getServerPlayerRaw = original;
  }
});
