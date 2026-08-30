/**
 * /scorewipe — apaga UM score, em vez do perfil inteiro que o /wipe apaga.
 *
 * O `wipe_score` do bancho não faz DELETE: ele estaciona o score no status -1 e
 * reescreve a linha de `stats` sem a play. Isso o torna reversível, e é a única
 * diferença de fundo para o /wipe — as travas continuam as mesmas, porque o
 * `channel_scorewipe_reciever` também aceita qualquer publish sem conferir
 * privilégio. O que estes casos travam é, de novo, a tranca inteira.
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
const scorewipe = require('../src/commands/scorewipe');

const ACTOR = { osuId: 3, discordId: '100000000000000002', discordName: 'staff-dois' };

const fonte = require('fs').readFileSync(require.resolve('../src/commands/scorewipe'), 'utf8');

test('exige DEVELOPER, e não ADMINISTRATOR', () => {
  // Mesma razão do /wipe: o receptor do canal não confere privilégio nenhum, só
  // se o score existe. Se esta linha cair para ADMINISTRATOR, um administrador
  // comum apaga score alheio sem que o servidor recuse.
  assert.match(fonte, /resolveStaff\(interaction, daycore\.Privileges\.DEVELOPER/);
  assert.doesNotMatch(fonte, /resolveStaff\(interaction, daycore\.Privileges\.ADMINISTRATOR/);
});

test('fica fora do modo texto', () => {
  // Em texto a flag de efêmero some, e a confirmação de um comando destrutivo é
  // o último lugar onde se quer perder a privacidade.
  assert.equal(scorewipe.prefix?.slashOnly, true);
});

test('jogador, modo e motivo são obrigatórios; o id do score não', () => {
  // O id é o caminho de exceção: quem administra não tem de onde tirar um id de
  // score, então o normal é escolher na lista. Já o jogador e o modo são
  // obrigatórios NOS DOIS caminhos, porque no caminho do id eles são a
  // conferência que impede apagar a play de outra pessoa por engano.
  const json = scorewipe.data.toJSON();
  const por = nome => json.options.find(o => o.name === nome);

  assert.equal(por('player').required, true);
  assert.equal(por('mode').required, true);
  assert.equal(por('reason').required, true);
  assert.ok(!por('score').required, 'o id do score é opcional');
  assert.ok(por('mode').choices.length >= 4, 'os modos do bancho viram choices');
});

test('o id digitado é conferido contra o jogador e o modo', () => {
  // Sem estas duas conferências, um id errado apagaria a play de outra pessoa e
  // nada na tela denunciaria a troca: o embed de confirmação mostraria o mapa
  // certo do score errado.
  assert.match(fonte, /alvo\.userId !== target\.id/);
  assert.match(fonte, /alvo\.mode !== modeNum/);
});

test('publica no canal scorewipe com o formato que o receptor lê', async () => {
  published.length = 0;
  await daycore.wipeScore(90210, ACTOR, 'score de cheat');

  const [canal, payload] = published[0];
  assert.equal(canal, 'scorewipe');
  // O receptor lê `id` (o score, não o jogador) e `adminId`. Errar o nome aqui
  // faz o log do servidor registrar Admin(0) como autor — ou, no caso do `id`,
  // a mensagem inteira morrer com KeyError.
  assert.equal(payload.id, 90210);
  assert.equal(payload.adminId, 3);
  assert.equal(payload.reason.startsWith('score de cheat'), true);
});

test('o motivo publicado leva a assinatura do Discord', async () => {
  published.length = 0;
  await daycore.wipeScore(90210, ACTOR, 'limpeza');

  const { reason } = published[published.length - 1][1];
  assert.match(reason, /via KurataniBot/);
  assert.match(reason, /100000000000000002/);
});

test('o publish NÃO leva o jogador nem o modo', async () => {
  // Os dois são conferência do lado do bot: o servidor descobre dono e modo
  // pela própria linha do score. Mandá-los daria a impressão de que o receptor
  // os confere, e ele não confere nada.
  published.length = 0;
  await daycore.wipeScore(90210, ACTOR, 'motivo');

  const payload = published[0][1];
  assert.equal(payload.mode, undefined);
  assert.equal(payload.userId, undefined);
});

test('o status de score apagado bate com o do bancho', () => {
  // Espelha o `WIPED_SCORE_STATUS` de app/api/utils.py. Divergir aqui faz o
  // `verifyScoreWiped` nunca confirmar um wipe que funcionou — e o comando
  // responder "não confirmei" para todo mundo.
  assert.equal(daycore.WIPED_SCORE_STATUS, -1);
  // E não 0: 0 é FAILED, e `plays` conta score falhado.
  assert.notEqual(daycore.WIPED_SCORE_STATUS, 0);
});
