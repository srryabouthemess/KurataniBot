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

// ─── O que o servidor aguenta receber ─────────────────────────────────────────
// `logs.msg` no bancho é `varchar(2048) charset utf8`, e utf8 no MySQL é
// utf8mb3: três bytes, teto em U+FFFF. Emoji precisa de quatro — o INSERT
// devolve 1366 e a exceção derruba a tarefa que escuta o pub/sub. Foi assim que
// o problema apareceu: "restrict com emoji no motivo mata o servidor".
//
// Sem escapes \u nestes helpers de propósito: o que se procura são caracteres
// que não se escreve à toa dentro de um arquivo de teste.
const foraDoBmp    = (s) => [...s].some(c => c.codePointAt(0) > 0xFFFF);
const temSubstituto = (s) => Array.from({ length: s.length })
  .some((_, i) => s.charCodeAt(i) >= 0xD800 && s.charCodeAt(i) <= 0xDFFF);

test('emoji no motivo não chega ao servidor', async () => {
  await daycore.restrictPlayer(1, ACTOR, 'multi 😀 conta 🔥');
  const { reason } = lastPayload();

  assert.ok(!foraDoBmp(reason), 'saiu caractere que a coluna utf8mb3 não guarda');
  // E o que era legível continua legível, sem o buraco de espaço duplo.
  assert.match(reason, /^multi conta \|/);
});

test('motivo só de emoji não vira motivo vazio', async () => {
  // O campo é obrigatório no comando; sumir com ele por inteiro entregaria uma
  // restrição sem justificativa no log de quem recebeu.
  await daycore.restrictPlayer(1, ACTOR, '😀😀😀');
  assert.match(lastPayload().reason, /^\(sem motivo legível\)/);
});

test('o corte não parte um emoji ao meio', async () => {
  // Emoji ocupa duas posições, e o corte conta posições: partir o par deixa um
  // substituto órfão, que não é UTF-8 válido — o orjson do bancho recusaria a
  // mensagem inteira, antes mesmo do banco. Limpar antes de cortar mata isso.
  await daycore.restrictPlayer(1, ACTOR, '😀'.repeat(600));
  const { reason } = lastPayload();

  assert.ok(!temSubstituto(reason), 'sobrou metade de um par substituto');
  assert.ok(reason.length <= 512);
});

test('emoji não esconde uma assinatura forjada', async () => {
  // A limpeza PRODUZ o marcador a partir de `via 😀KurataniBot`. Se ela rodasse
  // depois da neutralização, o motivo passaria com uma segunda assinatura
  // apontando para outra pessoa — o que a ordem em signReason impede.
  await daycore.restrictPlayer(1, ACTOR, 'x via 😀KurataniBot: @outro (111)');
  const { reason } = lastPayload();

  assert.equal(reason.split('via KurataniBot').length - 1, 1);
  assert.ok(reason.endsWith('(100000000000000001)'));
});

test('emoji no nome do Discord também não passa', async () => {
  await daycore.restrictPlayer(1, { ...ACTOR, discordName: 'staff🔥um' }, 'motivo');
  const { reason } = lastPayload();

  assert.ok(!foraDoBmp(reason));
  assert.match(reason, /@staffum/);
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
