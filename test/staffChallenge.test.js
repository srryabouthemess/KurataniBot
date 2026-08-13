/**
 * Prova de posse da conta de jogo antes de vincular.
 *
 * O `/staff register` nasceu auto-declarado: bastava ter Administrator no
 * Discord para apontar o próprio Discord ao nick de outro staff e herdar o
 * privilégio dele. Enquanto o pior caso era uma restrição reversível, a
 * assinatura no motivo bastava como mitigação. Com o `/wipe`, que apaga scores
 * sem volta, deixou de bastar.
 *
 * O desafio quebra a cadeia num ponto específico: o `userpage_content` só é
 * editável por quem entra na conta, então quem não controla a conta não
 * consegue plantar o código lá — e o vínculo não sai.
 *
 * Roda contra um bot.db descartável, no mesmo desenho do nominations.test.js: os
 * módulos vão para um diretório temporário que reproduz o layout do projeto,
 * porque o caminho do banco é resolvido a partir de `src/`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const PROJECT = path.join(__dirname, '..');
const SRC     = path.join(PROJECT, 'src');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-chal-'));
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir);

  for (const file of ['db.js', 'servers.js', 'paths.js']) {
    fs.copyFileSync(path.join(SRC, file), path.join(srcDir, file));
  }
  fs.symlinkSync(path.join(PROJECT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');

  delete require.cache[require.resolve(path.join(srcDir, 'db.js'))];
  const db = require(path.join(srcDir, 'db.js'));

  // Handle fechado antes de apagar a pasta: no Windows um banco aberto trava o
  // arquivo e o rmSync falha com EPERM.
  t.after(() => {
    try { db.close(); } catch { /* já fechado */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return db;
}

const DESAFIO = {
  discordId: '100000000000000001',
  osuId: 6,
  osuName: 'kyou',
  code: 'KB-ABC12345',
  requestedBy: '100000000000000002',
  ttlMs: 30 * 60 * 1000,
};

test('o desafio guardado é lido de volta', t => {
  const db = workspace(t);
  db.setStaffChallenge(DESAFIO);

  const lido = db.getStaffChallenge(DESAFIO.discordId);
  assert.equal(lido.osu_id, 6);
  assert.equal(lido.code, 'KB-ABC12345');
  assert.equal(lido.requested_by, DESAFIO.requestedBy);
});

test('emitir de novo substitui, em vez de acumular', t => {
  const db = workspace(t);
  db.setStaffChallenge(DESAFIO);
  db.setStaffChallenge({ ...DESAFIO, osuId: 3, osuName: 'nunca', code: 'KB-ZZZ99999' });

  // Dois códigos válidos ao mesmo tempo, apontando para contas diferentes,
  // deixariam o antigo servir para vincular a conta errada.
  const lido = db.getStaffChallenge(DESAFIO.discordId);
  assert.equal(lido.osu_id, 3);
  assert.equal(lido.code, 'KB-ZZZ99999');
});

test('desafio expirado é o mesmo que inexistente', t => {
  const db = workspace(t);
  db.setStaffChallenge({ ...DESAFIO, ttlMs: -1 });

  assert.equal(db.getStaffChallenge(DESAFIO.discordId), null);
  // E some do banco na leitura, em vez de ficar esperando alguém tentar usar.
  assert.equal(db.clearStaffChallenge(DESAFIO.discordId), false);
});

test('cada Discord tem o seu, sem vazar para o outro', t => {
  const db = workspace(t);
  db.setStaffChallenge(DESAFIO);

  assert.equal(db.getStaffChallenge('999999999999999999'), null);
});

test('o desafio sozinho não vincula nada', t => {
  const db = workspace(t);
  db.setStaffChallenge(DESAFIO);

  // É o ponto da mudança: emitir o código não concede acesso. Só o confirm,
  // depois de conferir o perfil, chama o setStaffLink.
  assert.equal(db.getStaffLink(DESAFIO.discordId), null);
});

test('o código não usa caracteres que se confundem na digitação', () => {
  const { CODE_ALPHABET } = require('../src/commands/staff');

  // Quem lê da tela e digita no site erra justamente nestes, e um código
  // recusado por engano manda a pessoa refazer tudo.
  for (const char of '01OIL') {
    assert.ok(!CODE_ALPHABET.includes(char), `${char} não deveria estar no alfabeto`);
  }
});

test('o código tem forma estável e não se repete', () => {
  const { generateCode, CODE_ALPHABET } = require('../src/commands/staff');
  const forma = new RegExp(`^KB-[${CODE_ALPHABET}]{8}$`);

  const vistos = new Set();
  for (let i = 0; i < 500; i++) {
    const code = generateCode();
    assert.match(code, forma);
    vistos.add(code);
  }

  // 31^8 combinações: repetir em 500 sorteios indicaria gerador degenerado —
  // o caso em que "prova de posse" vira "chute".
  assert.equal(vistos.size, 500, 'houve código repetido em 500 sorteios');
});

// ─── Quando pedir a prova, e quando não pedir ────────────────────────────────
// A pergunta que motivou isto: um staff JÁ registrado, sendo registrado de novo
// pelo dono, precisa colocar o código no perfil outra vez? Não deve — seria
// provar de novo o que já foi provado, para recriar o que já está no banco.

test('conta livre pede a prova', () => {
  const { decideRegister } = require('../src/commands/staff');
  assert.equal(decideRegister(null, '111'), 'challenge');
});

test('vínculo idêntico não pede nada', () => {
  const { decideRegister } = require('../src/commands/staff');
  const existente = { discord_id: '111', osu_id: 6 };
  assert.equal(decideRegister(existente, '111'), 'unchanged');
});

test('conta de outro Discord é recusada, não sobrescrita', () => {
  // O caso que o furo original explorava: apontar o próprio Discord para a
  // conta de outro staff.
  const { decideRegister } = require('../src/commands/staff');
  const existente = { discord_id: '999', osu_id: 6 };
  assert.equal(decideRegister(existente, '111'), 'taken');
});

test('trocar de conta de jogo ainda pede a prova da nova', () => {
  // @X vinculado a osu 13 e sendo registrado em osu 6, que está livre: o
  // getStaffLinkByOsuId(6) devolve null, então a prova é exigida — a conta nova
  // nunca foi provada por ninguém.
  const { decideRegister } = require('../src/commands/staff');
  assert.equal(decideRegister(null, '111'), 'challenge');
});

// ─── Aval: quem dispensa o código, e quem não dispensa ───────────────────────
// Exigir o código de todo vínculo novo cobrava o preço no lugar errado: dar
// staff a alguém passava a depender de a pessoa estar online. Quem já provou a
// própria conta E é DEVELOPER no jogo cria o vínculo direto.
//
// O que a escalada usava era Administrator no Discord SEM privilégio no jogo, e
// é esse caso que precisa continuar recusado.

const daycorePath = require.resolve('../src/daycoreAdmin');
const dbPath      = require.resolve('../src/db');

/** Carrega o staff.js com db e daycoreAdmin trocados. */
function comMocks({ link, priv }) {
  const daycoreReal = require('../src/daycoreAdmin');

  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: { getStaffLink: () => link },
  };
  require.cache[daycorePath] = {
    id: daycorePath, filename: daycorePath, loaded: true,
    exports: {
      ...daycoreReal,
      getPlayerPrivileges: async () => (priv === null ? null : { id: 6, name: 'kyou', priv }),
    },
  };

  delete require.cache[require.resolve('../src/commands/staff')];
  return require('../src/commands/staff');
}

const P = require('../src/daycoreAdmin').Privileges;
const DEV   = P.UNRESTRICTED | P.VERIFIED | P.DEVELOPER;
const ADMIN = P.UNRESTRICTED | P.VERIFIED | P.ADMINISTRATOR;

test('DEVELOPER com vínculo provado avaliza', async () => {
  const staff = comMocks({ link: { osu_id: 6, proof: 'self' }, priv: DEV });
  assert.notEqual(await staff.resolveVoucher('111'), null);
});

test('vínculo legado não avaliza, mesmo sendo DEVELOPER', async () => {
  // Os vínculos do dono e do kyou são deste tipo. Aceitá-los deixaria quem
  // tivesse explorado o furo antes de ele ser fechado seguir com aquele poder.
  const staff = comMocks({ link: { osu_id: 6, proof: null }, priv: DEV });
  assert.equal(await staff.resolveVoucher('111'), null);
});

test('vínculo avalizado não avaliza outro', async () => {
  // Sem isto, uma identidade AFIRMADA viraria poder de afirmar, em cadeia.
  const staff = comMocks({ link: { osu_id: 6, proof: 'vouch' }, priv: DEV });
  assert.equal(await staff.resolveVoucher('111'), null);
});

test('provado mas sem DEVELOPER não avaliza', async () => {
  const staff = comMocks({ link: { osu_id: 6, proof: 'self' }, priv: ADMIN });
  assert.equal(await staff.resolveVoucher('111'), null);
});

test('quem não tem vínculo nenhum não avaliza', async () => {
  // O caso exato da escalada: Administrator no Discord, nada no jogo.
  const staff = comMocks({ link: null, priv: DEV });
  assert.equal(await staff.resolveVoucher('111'), null);
});

test('conta que sumiu do servidor não avaliza', async () => {
  const staff = comMocks({ link: { osu_id: 6, proof: 'self' }, priv: null });
  assert.equal(await staff.resolveVoucher('111'), null);
});
