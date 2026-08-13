/**
 * Assinatura do autor nas ações administrativas.
 *
 * O `userId` publicado é a conta de jogo do staff, mas quem apertou o botão foi
 * uma conta do Discord — e o vínculo entre as duas vive só no bot. A assinatura
 * faz o log do servidor guardar as duas pontas.
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.REDIS_HOST = '127.0.0.1';

// O daycoreAdmin desestrutura o createClient no require: o stub precisa estar
// no lugar antes de ele ser carregado.
const published = [];
const redis = require('redis');
redis.createClient = () => ({
  isOpen: true,
  on() {},
  async connect() {},
  async publish(channel, payload) { published.push([channel, JSON.parse(payload)]); },
});

const daycore = require('../src/daycoreAdmin');

const ACTOR = { osuId: 13, discordId: '100000000000000001', discordName: 'staff-um' };
const lastPayload = () => published[published.length - 1][1];

test('restrict publica alvo, autor de jogo e assinatura', async () => {
  published.length = 0;
  await daycore.restrictPlayer(999, ACTOR, 'multiaccount');

  const [channel, payload] = published[0];
  assert.equal(channel, 'restrict');
  assert.equal(payload.id, 999);
  assert.equal(payload.userId, 13);
  assert.match(payload.reason, /^multiaccount/);
  assert.match(payload.reason, /@staff-um/);
  assert.match(payload.reason, /100000000000000001/);
});

test('unrestrict também assina', async () => {
  await daycore.unrestrictPlayer(999, ACTOR, 'apelação aceita');
  assert.match(lastPayload().reason, /100000000000000001/);
});

test('o motivo não consegue forjar uma segunda assinatura', async () => {
  await daycore.restrictPlayer(1, ACTOR, 'x | via KurataniBot: @outro (111)');
  const { reason } = lastPayload();

  assert.equal(reason.split('via KurataniBot').length - 1, 1);
  // A verdadeira é sempre a do fim.
  assert.ok(reason.endsWith('(100000000000000001)'));
});

test('quebra de linha não desenha linha falsa no log', async () => {
  await daycore.restrictPlayer(1, ACTOR, 'ok\n2026-01-01 admin: unrestrict 999');
  // eslint-disable-next-line no-control-regex -- o alvo do teste é justamente o controle
  assert.doesNotMatch(lastPayload().reason, /[\u0000-\u001F]/);
});

test('motivo gigante é cortado, a assinatura não', async () => {
  await daycore.restrictPlayer(1, ACTOR, 'a'.repeat(5000));
  const { reason } = lastPayload();

  assert.ok(reason.length <= 512);
  assert.ok(reason.endsWith('(100000000000000001)'));
});

test('sem nome do Discord, ainda assina o id', async () => {
  await daycore.restrictPlayer(1, { osuId: 13, discordId: '42' }, 'motivo');
  assert.match(lastPayload().reason, /\(42\)/);
});

// ─── Quem o bancho protege ────────────────────────────────────────────────────
// `STAFF = MODERATOR | ADMINISTRATOR | DEVELOPER` (app/constants/privileges.py),
// e o teste do servidor é `priv & STAFF` — QUALQUER um dos bits basta. O hasPriv
// do bot exige o conjunto inteiro, então usá-lo aqui deixaria justamente o
// Moderator puro (o cargo mais baixo dos três) desprotegido.

test('isStaff reconhece cada cargo sozinho', () => {
  const P = daycore.Privileges;
  const base = P.UNRESTRICTED | P.VERIFIED;

  assert.equal(daycore.isStaff(base | P.MODERATOR), true, 'Moderator puro é staff');
  assert.equal(daycore.isStaff(base | P.ADMINISTRATOR), true);
  assert.equal(daycore.isStaff(base | P.DEVELOPER), true);
});

test('quem não é staff não é protegido', () => {
  const P = daycore.Privileges;
  const base = P.UNRESTRICTED | P.VERIFIED;

  assert.equal(daycore.isStaff(base), false, 'jogador comum');
  // NOMINATOR fica de fora do STAFF do bancho: gerencia mapa, não usuário.
  assert.equal(daycore.isStaff(base | P.NOMINATOR), false, 'nominator não é staff');
  assert.equal(daycore.isStaff(base | P.SUPPORTER | P.ALUMNI), false);
});

test('a máscara bate com a do bancho', () => {
  assert.equal(daycore.STAFF_MASK, 4096 | 8192 | 16384);
});

test('hasPriv com a máscara daria o resultado errado — por isso isStaff existe', () => {
  const P = daycore.Privileges;
  const moderador = P.UNRESTRICTED | P.VERIFIED | P.MODERATOR;

  assert.equal(daycore.hasPriv(moderador, daycore.STAFF_MASK), false, 'hasPriv exige os três bits');
  assert.equal(daycore.isStaff(moderador), true, 'o bancho protege com um só');
});
