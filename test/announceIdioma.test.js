/**
 * O anúncio público fala o idioma do servidor, não o de quem clicou.
 *
 * O embed de `/nominate` e o do rank feito dentro do jogo caem no MESMO canal
 * público, mas nasciam de fontes diferentes: o in-game resolvia por `forGuild`
 * e o comando reaproveitava o `s` da interação, que começa na preferência
 * pessoal de quem rodou. Bastava um staff com o idioma dele diferente do
 * servidor para o canal receber dois anúncios iguais em línguas diferentes.
 *
 * Quem lê um canal público não escolheu nada — o idioma tem de ser o do
 * servidor nos dois caminhos.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Banco descartável antes de qualquer require de `src/`, como no nominateLog.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-annlang-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;
process.env.DAYCORE_GUILD_ID  = '900000000000000001';
process.env.DAYCORE_ANNOUNCE_CHANNEL_ID = '900000000000000009';

const STAFF_OSU  = 7;
const ADMIN_PRIV = 8192;

const daycorePath = require.resolve('../src/daycoreAdmin');
require.cache[daycorePath] = {
  id: daycorePath, filename: daycorePath, loaded: true,
  exports: {
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
  },
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

db.setStaffLink(STAFF_DISCORD, STAFF_OSU, 'staff-sete', 'teste', 'self');
osu.getServerMapsBySet = async () => [
  { id: DIFF_ID, set_id: SET_ID, artist: 'artista', title: 'titulo', creator: 'mapper' },
];

/** Roda `/nominate force` e devolve o embed que foi para o canal de anúncio. */
async function anunciar() {
  const anunciados = [];
  const interaction = {
    id: '1',
    user: { id: STAFF_DISCORD, username: 'staff-sete' },
    guildId: process.env.DAYCORE_GUILD_ID,
    channelId: '222',
    client: {
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          guild: null,
          send: async payload => { anunciados.push(payload); },
        }),
      },
    },
    options: {
      getSubcommand: () => 'force',
      getString: nome => ({ map: `https://osu.ppy.sh/beatmapsets/${SET_ID}`, status: 'rank' }[nome] ?? null),
      getInteger: () => null,
    },
    async deferReply() {},
    async reply() {},
    async editReply(p) { return p; },
  };

  await nominate.execute(interaction);
  // O anúncio não é aguardado por quem chama, de propósito: ele sai do caminho
  // crítico do comando. Uma volta do event loop basta para ele chegar.
  await new Promise(resolve => setImmediate(resolve));

  return anunciados[anunciados.length - 1]?.embeds?.[0]?.data;
}

test('anúncio de /nominate sai no idioma do servidor, não no de quem rodou', async () => {
  db.setServerLang(process.env.DAYCORE_GUILD_ID, 'en');
  db.setUserLang(STAFF_DISCORD, 'pt');

  const embed = await anunciar();

  assert.equal(embed?.title, 'Map is now ranked');
});

test('mudar o idioma do servidor muda o anúncio', async () => {
  db.setServerLang(process.env.DAYCORE_GUILD_ID, 'pt');
  db.setUserLang(STAFF_DISCORD, 'en');

  const embed = await anunciar();

  assert.equal(embed?.title, 'Mapa agora está ranked');
});
