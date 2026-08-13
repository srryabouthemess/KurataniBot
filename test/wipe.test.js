/**
 * /wipe — o único comando irreversível do bot.
 *
 * O `wipe_user` do bancho faz `DELETE FROM scores` e zera a linha de `stats`.
 * E, ao contrário do `restrict`, ele **não confere privilégio nenhum**: só checa
 * se o alvo existe. Nos outros comandos administrativos o servidor é uma segunda
 * tranca; aqui não existe segunda tranca, então o que estes casos travam é a
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
const wipe = require('../src/commands/wipe');

const ACTOR = { osuId: 3, discordId: '100000000000000002', discordName: 'staff-dois' };

test('exige DEVELOPER, e não ADMINISTRATOR', () => {
  // O /moderate restrict se contenta com ADMINISTRATOR porque o bancho recusa
  // sozinho o que passar indevidamente. Aqui não recusa — se esta linha cair
  // para ADMINISTRATOR, um administrador comum apaga scores sem volta.
  const fonte = require('fs').readFileSync(require.resolve('../src/commands/wipe'), 'utf8');
  assert.match(fonte, /resolveStaff\(interaction, daycore\.Privileges\.DEVELOPER/);
  assert.doesNotMatch(fonte, /resolveStaff\(interaction, daycore\.Privileges\.ADMINISTRATOR/);
});

test('fica fora do modo texto', () => {
  // Em texto a flag de efêmero some, e um comando destrutivo é o último que
  // deveria perder a privacidade da confirmação.
  assert.equal(wipe.prefix?.slashOnly, true);
});

test('o modo é obrigatório e sem padrão', () => {
  // Escolher um modo por omissão seria apagar o que ninguém pediu.
  const json = wipe.data.toJSON();
  const mode = json.options.find(o => o.name === 'mode');
  assert.equal(mode.required, true);
  assert.ok(mode.choices.length >= 4, 'os modos do bancho viram choices');
});

test('o motivo é obrigatório', () => {
  // Vai assinado para o log do servidor; um wipe sem motivo é um wipe sem dono.
  const json = wipe.data.toJSON();
  assert.equal(json.options.find(o => o.name === 'reason').required, true);
});

test('publica no canal wipe com o formato que o receptor lê', async () => {
  published.length = 0;
  await daycore.wipePlayer(16, 4, ACTOR, 'multiaccount');

  const [canal, payload] = published[0];
  assert.equal(canal, 'wipe');
  assert.equal(payload.id, 16);
  assert.equal(payload.mode, 4);
  // `adminId`, não `userId`: é o nome que o channel_wipe_reciever lê. Errar
  // aqui faz o log do servidor registrar Admin(0) como autor.
  assert.equal(payload.adminId, 3);
  assert.equal(payload.reason.startsWith('multiaccount'), true);
});

test('o motivo publicado leva a assinatura do Discord', async () => {
  published.length = 0;
  await daycore.wipePlayer(16, 0, ACTOR, 'limpeza');

  const { reason } = published[published.length - 1][1];
  assert.match(reason, /via KurataniBot/);
  assert.match(reason, /100000000000000002/);
});

test('os nomes de modo batem com os do bancho', () => {
  // Vêm do dicionário `mode_names` em app/api/utils.py. Se divergirem, o embed
  // de confirmação diz um modo e o servidor apaga outro.
  assert.equal(daycore.GameModes[0], 'vn!std');
  assert.equal(daycore.GameModes[4], 'rx!std');
  assert.equal(daycore.GameModes[8], 'ap!std');
});
