/**
 * /nominate: a papelada local não pode negar o que o servidor já aplicou.
 *
 * O comando publica o status, relê para confirmar, e só então mexe no banco
 * daqui: esvazia a fila de nomeação e registra a ação. Enquanto essas duas
 * escritas ficavam soltas dentro do `try` do execute, um erro de SQLite caía no
 * `catch` da publicação e a resposta virava `admin_action_failed` — "nada foi
 * confirmado" — para um set que acabou de ser rankeado. Quem lesse isso
 * rankearia de novo.
 *
 * É o mesmo defeito de /role, /moderate e /wipe (ver adminLog.test.js), com um
 * segundo ponto de escrita que aqueles não têm: o descarte da fila.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Banco descartável para o arquivo inteiro, montado antes de qualquer require de
// `src/`: o staffGuard desestrutura o `getStaffLink` no require.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-nomlog-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;
process.env.DAYCORE_GUILD_ID  = '900000000000000001';

// O daycoreAdmin inteiro é de mentira, como em applyStatus.test.js: assim nada
// aqui depende de Redis nem da API v2, e o que sobra no caminho é o do comando.
const STAFF_OSU  = 7;
const ADMIN_PRIV = 8192;

const daycorePath = require.resolve('../src/daycoreAdmin');
const daycoreMock = {
  RankedStatus:  { UNRANK: 0, RANK: 2, LOVE: 5 },
  STATUS_LABELS: { 0: 'unranked', 2: 'ranked', 5: 'loved' },
  Privileges:    { NOMINATOR: 2048, ADMINISTRATOR: ADMIN_PRIV },
  hasPriv:       (priv, flag) => (priv & flag) === flag,
  privLabel:     () => 'Administrator',
  adminServerLabel: () => 'Servidor',
  getPlayerPrivileges: async () => ({ id: STAFF_OSU, name: 'staff-sete', priv: ADMIN_PRIV }),
  checkConnection: async () => ({ ok: true }),
  rankBeatmap: async () => {},
  verifyMapStatus: async ids => ({ confirmed: [...ids], pending: [] }),
};
require.cache[daycorePath] = {
  id: daycorePath, filename: daycorePath, loaded: true, exports: daycoreMock,
};

const db = require('../src/db');
const osu = require('../src/osuClient');
const nominate = require('../src/commands/nominate');

test.after(() => {
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const STAFF_DISCORD = '900000000000000003';
const SET_ID = 12345;
const DIFF_ID = 111;
const RANKED = 2;

db.setStaffLink(STAFF_DISCORD, STAFF_OSU, 'staff-sete', 'teste', 'self');
osu.getServerMapsBySet = async () => [
  { id: DIFF_ID, set_id: SET_ID, artist: 'artista', title: 'titulo', creator: 'mapper' },
];

/** Interação de `/nominate force`, guardando o que foi respondido. */
function fakeInteraction() {
  const enviado = [];
  // Link de set: resolveSet fecha o ID por aí e não precisa da API do osu!.
  const opcoes = { map: `https://osu.ppy.sh/beatmapsets/${SET_ID}`, status: 'rank' };

  return {
    enviado,
    interaction: {
      id: '1',
      user: { id: STAFF_DISCORD, username: 'staff-sete' },
      guildId: process.env.DAYCORE_GUILD_ID,
      channelId: '222',
      client: { channels: { fetch: async () => null } },
      options: {
        getSubcommand: () => 'force',
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
 * Roda o comando com `quebrar` fora do ar no banco.
 * @param {string|null} quebrar nome do método de db que deve lançar
 */
async function rodar(quebrar) {
  const original = quebrar ? db[quebrar] : null;
  const originalErr = console.error;

  if (quebrar) db[quebrar] = () => { throw new Error('SQLITE_FULL: database or disk is full'); };
  console.error = () => {};

  try {
    const fake = fakeInteraction();
    await nominate.execute(fake.interaction);

    const payload = fake.enviado[fake.enviado.length - 1];
    const embed = payload?.embeds?.[0]?.data;
    // Sem embed a resposta foi texto puro — é o `admin_action_failed` do
    // defeito. Cair para o texto aqui faz a falha do teste mostrar a mensagem
    // errada que o comando deu, em vez de um `undefined`.
    return {
      payload,
      descricao: embed?.description ?? String(payload?.content ?? payload ?? ''),
      cor: embed?.color,
    };
  } finally {
    if (quebrar) db[quebrar] = original;
    console.error = originalErr;
  }
}

test('o registro de auditoria falha e a resposta continua sendo o resultado real', async () => {
  // Antes: `admin_action_failed`, para um set que o servidor acabou de rankear.
  const { descricao, cor } = await rodar('logAdminAction');

  assert.match(descricao, /Confirmado em \*\*1\*\*/, 'a resposta precisa dizer o que aconteceu');
  assert.match(descricao, /log de auditoria/, 'com o aviso de que o registro se perdeu');
  assert.equal(cor, 0xffcc66, 'sem registro, a resposta não é verde');
});

test('a limpeza da fila falha e a resposta continua sendo o resultado real', async () => {
  // O segundo ponto de escrita, que /role, /moderate e /wipe não têm: ele roda
  // ANTES do registro, então sozinho já derrubava o comando inteiro.
  db.addNomination(SET_ID, RANKED, STAFF_DISCORD, STAFF_OSU, 'staff-sete');

  const { descricao, cor } = await rodar('clearNominations');

  assert.match(descricao, /Confirmado em \*\*1\*\*/);
  assert.match(descricao, /fila de nomeação/, 'com o aviso de que a fila ficou para trás');
  assert.doesNotMatch(descricao, /log de auditoria/, 'o registro em si funcionou');
  assert.equal(cor, 0xffcc66);

  // E o aviso é verdade: a fila continua lá, que é o custo aceito para não
  // mentir sobre o servidor.
  assert.equal(db.getNominations(SET_ID, RANKED).length, 1);
});

test('com o banco são: verde, sem aviso, fila vazia e ação registrada', async () => {
  db.addNomination(SET_ID, RANKED, STAFF_DISCORD, STAFF_OSU, 'staff-sete');

  const { descricao, cor } = await rodar(null);

  assert.doesNotMatch(descricao, /log de auditoria/);
  assert.doesNotMatch(descricao, /fila de nomeação/);
  assert.equal(cor, 0x99ff99);

  assert.equal(db.getNominations(SET_ID, RANKED).length, 0, 'a fila foi descartada');
  const [linha] = db.listAdminActions(1);
  assert.equal(linha.action, 'force');
  assert.equal(linha.target, String(SET_ID));
});
