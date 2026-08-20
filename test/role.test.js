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
const role = require('../src/commands/role');

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

test('privNames lista todos os cargos; o privLabel devolve só o topo (o mais alto)', () => {
  const priv = daycore.Privileges.UNRESTRICTED
    | daycore.Privileges.NOMINATOR
    | daycore.Privileges.WHITELISTED;

  assert.equal(daycore.privLabel(priv), 'Nominator');
  assert.deepEqual(daycore.privNames(priv), ['Nominator', 'Whitelisted']);
});

test('privLabel de WHITELISTED (sem staff) devolve "Whitelisted", não "Player"', () => {
  // O antecessor colapsava tudo abaixo de NOMINATOR em "Player", perdendo
  // o cargo real. Agora privLabel devolve o topo verdadeiro de privNames.
  const priv = daycore.Privileges.UNRESTRICTED | daycore.Privileges.WHITELISTED;
  assert.equal(daycore.privLabel(priv), 'Whitelisted');
});

test('privLabel de uma conta comum (UNRESTRICTED | VERIFIED) continua sendo "Player"', () => {
  // UNRESTRICTED sozinho não é conta nenhuma: o bancho.py liga VERIFIED no
  // primeiro login, e toda conta ativa tem os dois. Testar só UNRESTRICTED
  // dava falsa segurança — não pegaria o caso em que privLabel esquecesse de
  // filtrar VERIFIED e mostrasse "Verified" para todo jogador comum.
  const priv = daycore.Privileges.UNRESTRICTED | daycore.Privileges.VERIFIED;
  assert.equal(daycore.privLabel(priv), 'Player');
});

test('privNames da MESMA conta comum inclui Verified — a assimetria que privLabel esconde de propósito', () => {
  // privLabel filtra VERIFIED (é estado, não cargo — mesmo motivo de
  // UNRESTRICTED). privNames não filtra: o /role liga e desliga VERIFIED, e o
  // /moderate check precisa continuar mostrando essa mudança.
  const priv = daycore.Privileges.UNRESTRICTED | daycore.Privileges.VERIFIED;
  assert.deepEqual(daycore.privNames(priv), ['Verified']);
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

test('as choices do comando batem com a tabela', () => {
  // Cargo oferecido no Discord que o publish não sabe mandar viraria um
  // `Invalid privilege` silencioso; cargo na tabela que o Discord não oferece é
  // função morta.
  const json  = role.data.toJSON();
  const give  = json.options.find(o => o.name === 'give');
  const opcao = give.options.find(o => o.name === 'role');

  assert.deepEqual(
    opcao.choices.map(c => c.value).sort(),
    Object.keys(daycore.ROLES).sort(),
  );
  assert.equal(opcao.required, true);
});

test('fica fora do modo texto', () => {
  // A resposta expõe o privilégio de terceiro; em texto a flag de efêmero some
  // e isso vira mensagem no canal (ver prefix/spec.js).
  assert.equal(role.prefix?.slashOnly, true);
});

test('o privilégio exigido vem do cargo escolhido, não de um valor fixo', () => {
  // Se esta linha travar num Privileges.* fixo (o mais provável seria
  // ADMINISTRATOR, que já basta para a maioria dos cargos), um Administrator
  // passaria a poder conceder `developer` a um cúmplice — o auto-refuso
  // (mod_cannot_self) só barra a própria conta dele, não a de outra pessoa.
  // Mesmo idioma de test/wipe.test.js, primeiro teste do arquivo.
  const fonte = require('fs').readFileSync(require.resolve('../src/commands/role'), 'utf8');
  assert.match(fonte, /resolveStaff\(interaction, role\.requires/);
  assert.doesNotMatch(fonte, /resolveStaff\(interaction, daycore\.Privileges\./);
});

test('o /moderate check lista todos os cargos, não só o topo', () => {
  // Quem acabou de receber `whitelisted` sem ter mais nada aparecia como
  // "Player": o comando que serve para conferir a concessão não mostrava a
  // concessão.
  const fonte = require('fs').readFileSync(require.resolve('../src/commands/moderate'), 'utf8');
  assert.match(fonte, /privNames\(target\.priv\)/);
});
