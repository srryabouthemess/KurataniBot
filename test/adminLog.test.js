/**
 * Falha ao GRAVAR o log não pode virar "nada aconteceu".
 *
 * Os três comandos administrativos publicam no Redis, releem o servidor para
 * confirmar o efeito e só então registram a ação. Enquanto essa última linha
 * ficava dentro do `try` do `execute`, um erro de SQLite caía no mesmo `catch`
 * da publicação e a resposta virava `admin_action_failed` — "nada foi
 * confirmado, verifique o estado antes de tentar de novo" — para uma ação que
 * JÁ tinha sido aplicada e JÁ tinha sido confirmada pela releitura.
 *
 * Quem lesse isso tentaria de novo. No /wipe, que não tem volta, o conselho é o
 * pior possível: seria apagar de novo o que já foi apagado, e o registro que se
 * perdeu era a única cópia dos números destruídos.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Um banco descartável para o arquivo inteiro, montado ANTES de qualquer require
// de `src/`: o staffGuard desestrutura o `getStaffLink` no require, então trocar
// o banco depois o deixaria apontando para outra conexão.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-adminlog-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;
process.env.DAYCORE_GUILD_ID  = '900000000000000001';

// O daycoreAdmin desestrutura o createClient no require: o stub precisa estar no
// lugar antes de ele ser carregado.
process.env.REDIS_HOST = '127.0.0.1';
const published = [];
// O cargo que o "servidor" concedeu. Mora aqui fora porque o daycoreAdmin guarda
// o client depois da primeira conexão: trocar o createClient entre casos deixa o
// publish caindo no stub do caso anterior.
let concedido = false;

const redis = require('redis');
redis.createClient = () => ({
  isOpen: true,
  on() {},
  async connect() {},
  async ping() { return 'PONG'; },
  async publish(channel, payload) {
    published.push([channel, JSON.parse(payload)]);
    if (channel === 'addpriv') concedido = true;
  },
});

const db = require('../src/db');
const osu = require('../src/osuClient');
const daycore = require('../src/daycoreAdmin');
const { registrarAcao } = require('../src/adminLog');
const role = require('../src/commands/role');

test.after(() => {
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const LINHA = {
  action: 'wipe',
  target: 1234,
  detail: 'alvo | vn!std | limpeza | antes: 3076pp, 679 plays',
  actorDiscordId: '900000000000000002',
  actorOsuId: 3,
  actorOsuName: 'staff-dois',
};

/** Roda `fn` com o `logAdminAction` quebrado, e devolve o que foi para o console. */
function comBancoQuebrado(fn) {
  const originalLog = db.logAdminAction;
  const originalErr = console.error;
  const impresso = [];

  db.logAdminAction = () => { throw new Error('SQLITE_FULL: database or disk is full'); };
  console.error = (...args) => impresso.push(args.join(' '));

  try {
    return { resultado: fn(), impresso };
  } finally {
    db.logAdminAction = originalLog;
    console.error = originalErr;
  }
}

// ─── O registro em si ─────────────────────────────────────────────────────────

test('registrarAcao grava a linha e diz que gravou', () => {
  assert.equal(registrarAcao('wipe', LINHA), true);

  const [linha] = db.listAdminActions(1);
  assert.equal(linha.action, 'wipe');
  assert.equal(linha.target, '1234');
  assert.match(linha.detail, /3076pp/);
});

test('falha de escrita não lança — devolve false para o comando avisar', () => {
  // Este é o ponto inteiro: lançar aqui levava o `catch` do execute a negar uma
  // ação que já tinha acontecido no servidor de jogo.
  const { resultado } = comBancoQuebrado(() => registrarAcao('wipe', LINHA));
  assert.equal(resultado, false);
});

test('a linha perdida vai para o log do processo, não só a causa', () => {
  // O que se perde num /wipe são os números lidos antes do DELETE: depois dele
  // não existem em mais lugar nenhum. Logar só "SQLITE_FULL" jogaria fora a
  // única cópia que ainda dava para salvar.
  const { impresso } = comBancoQuebrado(() => registrarAcao('wipe', LINHA));
  const tudo = impresso.join('\n');

  assert.match(tudo, /SQLITE_FULL/, 'a causa precisa aparecer');
  assert.match(tudo, /3076pp, 679 plays/, 'o conteúdo da linha precisa aparecer junto');
  assert.match(tudo, /900000000000000002/, 'e quem fez também');
});

// ─── O caminho real de um comando ─────────────────────────────────────────────

const STAFF_DISCORD = '900000000000000002';
const STAFF_OSU     = 3;
const ALVO_OSU      = 1234;

const P = daycore.Privileges;

/** Interação de `/role give` mínima, guardando o que foi respondido. */
function fakeInteraction() {
  const enviado = [];
  const opcoes = { player: String(ALVO_OSU), role: 'nominator', reason: 'mapper novo' };

  return {
    enviado,
    interaction: {
      id: '1',
      user: { id: STAFF_DISCORD, username: 'staff-dois' },
      guildId: process.env.DAYCORE_GUILD_ID,
      channelId: '222',
      options: {
        getSubcommand: () => 'give',
        getString: (nome) => opcoes[nome] ?? null,
        getInteger: () => null,
      },
      async deferReply() {},
      async reply(p)     { enviado.push(p); },
      async editReply(p) { enviado.push(p); return p; },
    },
  };
}

/**
 * Servidor de jogo de mentira: o alvo GANHA o cargo quando o publish sai, que é
 * o que faz a releitura do comando confirmar de verdade.
 */
function stubServidor() {
  const originais = { raw: osu.getServerPlayerRaw, resolve: osu.resolvePlayerId };
  concedido = false;

  osu.resolvePlayerId = async () => ALVO_OSU;
  osu.getServerPlayerRaw = async (id) => {
    if (Number(id) === STAFF_OSU) {
      // ADMINISTRATOR junto do DEVELOPER porque o `nominator` exige aquele bit
      // e o hasPriv cobra o bit exato — DEVELOPER sozinho não vale por ele.
      return {
        id: STAFF_OSU,
        name: 'staff-dois',
        priv: P.UNRESTRICTED | P.VERIFIED | P.ADMINISTRATOR | P.DEVELOPER,
      };
    }
    return {
      id: ALVO_OSU,
      name: 'alvo',
      priv: P.UNRESTRICTED | P.VERIFIED | (concedido ? P.NOMINATOR : 0),
    };
  };

  return () => {
    osu.getServerPlayerRaw = originais.raw;
    osu.resolvePlayerId    = originais.resolve;
  };
}

/** Descrição e cor do embed que o comando respondeu. */
function embedRespondido(enviado) {
  const payload = enviado[enviado.length - 1];
  const embed = payload.embeds[0].data;
  return { descricao: embed.description, cor: embed.color, payload };
}

test('/role: o banco recusa a escrita e a resposta continua descrevendo o que aconteceu', async () => {
  db.setStaffLink(STAFF_DISCORD, STAFF_OSU, 'staff-dois', 'teste', 'self');
  const restaurar = stubServidor();

  const originalLog = db.logAdminAction;
  const originalErr = console.error;
  db.logAdminAction = () => { throw new Error('SQLITE_FULL: database or disk is full'); };
  console.error = () => {};

  let enviado;
  try {
    const fake = fakeInteraction();
    await role.execute(fake.interaction);
    enviado = fake.enviado;
  } finally {
    db.logAdminAction = originalLog;
    console.error = originalErr;
    restaurar();
  }

  const { descricao, cor } = embedRespondido(enviado);

  // O que estava errado: aqui vinha `admin_action_failed` — "nada foi
  // confirmado" — para um cargo que o servidor já tinha concedido.
  assert.match(descricao, /Confirmado/, 'a resposta precisa dizer o que de fato aconteceu');
  assert.match(descricao, /mapper novo/, 'e continuar mostrando o motivo e o alvo');
  assert.match(descricao, /log de auditoria/, 'com o aviso de que o registro se perdeu');
  assert.equal(cor, 0xffcc66, 'sem registro, a resposta não é verde');

  // E a ação chegou mesmo a sair: o teste não passa por não ter publicado nada.
  assert.equal(published[published.length - 1][0], 'addpriv');
});

test('/role: com o banco são, a resposta não traz aviso nenhum', async () => {
  db.setStaffLink(STAFF_DISCORD, STAFF_OSU, 'staff-dois', 'teste', 'self');
  const restaurar = stubServidor();

  let enviado;
  try {
    const fake = fakeInteraction();
    await role.execute(fake.interaction);
    enviado = fake.enviado;
  } finally {
    restaurar();
  }

  const { descricao, cor } = embedRespondido(enviado);

  assert.doesNotMatch(descricao, /log de auditoria/, 'aviso só quando a gravação falha');
  assert.equal(cor, 0x99ff99);

  const [linha] = db.listAdminActions(1);
  assert.equal(linha.action, 'addpriv');
  assert.equal(linha.target, String(ALVO_OSU));
});

// ─── Os três, do mesmo jeito ──────────────────────────────────────────────────

const fonteDe = (nome) =>
  fs.readFileSync(require.resolve(`../src/commands/${nome}`), 'utf8');

for (const nome of ['role', 'moderate', 'wipe', 'nominate']) {
  test(`/${nome} registra pelo adminLog, e não pelo db dentro do try`, () => {
    // `db.logAdminAction` direto dentro do `try` do execute é exatamente o
    // defeito: a falha de escrita cai no catch da publicação e nega uma ação
    // que aconteceu.
    const fonte = fonteDe(nome);

    assert.match(fonte, /registrarAcao\(/, `/${nome} deveria passar pelo adminLog`);
    assert.doesNotMatch(fonte, /db\.logAdminAction\(/, `/${nome} ainda grava direto no banco`);
    assert.match(fonte, /admin_log_failed/, `/${nome} deveria avisar quando o registro falha`);
  });
}
