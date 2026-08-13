/**
 * Anúncio de mudança de status.
 *
 * O bancho.py-ex não avisa o Discord quando um mapa muda de status, então quem
 * anuncia é o bot. Duas coisas importam mais que o conteúdo do embed:
 *
 *  - **desligado por padrão**, porque o alvo é um canal público e o erro caro
 *    não é ficar calado, é falar no lugar errado;
 *  - **nunca derrubar o comando**, porque quando o anúncio sai a ação no
 *    Daycore já aconteceu — deixar uma falha do Discord virar "ocorreu um erro"
 *    mentiria sobre o que houve no servidor.
 */
const test = require('node:test');
const assert = require('node:assert');

const announce = require('../src/announce');
const s = require('../src/i18n/pt')({ ADMIN: 'Daycore' });

const INFO = {
  setId: 2158809,
  diffs: [{ id: 4551343 }],
  status: 2,
  statusLabel: 'ranked',
  label: 'KAQRIYOTERROR - BWG (Cut Ver.) (Yomitagami)',
  actorName: 'pudim2',
  confirmed: 1,
};

/** Client mínimo: registra o que foi enviado, ou explode se mandarem. */
function fakeClient({ sent = [], channel } = {}) {
  const canal = channel ?? {
    isTextBased: () => true,
    guild: null,
    send: async payload => { sent.push(payload); },
  };
  return { channels: { fetch: async () => canal } };
}

test.beforeEach(() => { delete process.env.DAYCORE_ANNOUNCE_CHANNEL_ID; });

test('sem canal configurado, não anuncia', async () => {
  const sent = [];
  assert.equal(announce.isConfigured(), false);

  const ok = await announce.announceStatus(fakeClient({ sent }), INFO, s);
  assert.equal(ok, false);
  assert.equal(sent.length, 0);
});

test('com canal configurado, manda o embed', async () => {
  process.env.DAYCORE_ANNOUNCE_CHANNEL_ID = '123';
  const sent = [];

  const ok = await announce.announceStatus(fakeClient({ sent }), INFO, s);
  assert.equal(ok, true);
  assert.equal(sent.length, 1);

  const embed = sent[0].embeds[0].data;
  assert.match(embed.title, /ranked/);
  assert.match(embed.description, /BWG \(Cut Ver\.\)/);
  assert.match(embed.description, /pudim2/);
  // Link e capa apontam para o set certo.
  assert.match(embed.image.url, /2158809/);
});

test('canal que não é de texto não derruba nada', async () => {
  process.env.DAYCORE_ANNOUNCE_CHANNEL_ID = '123';

  const client = fakeClient({ channel: { isTextBased: () => false } });
  assert.equal(await announce.announceStatus(client, INFO, s), false);
});

test('falha do Discord vira false, não exceção', async () => {
  // O caso real: canal apagado ou permissão retirada depois de configurado. A
  // nomeação já valeu — quem chamou não pode receber um throw por isso.
  process.env.DAYCORE_ANNOUNCE_CHANNEL_ID = '123';

  const client = { channels: { fetch: async () => { throw new Error('Unknown Channel'); } } };
  assert.equal(await announce.announceStatus(client, INFO, s), false);
});

test('erro ao enviar também é contido', async () => {
  process.env.DAYCORE_ANNOUNCE_CHANNEL_ID = '123';

  const client = fakeClient({
    channel: {
      isTextBased: () => true,
      guild: null,
      send: async () => { throw new Error('Missing Permissions'); },
    },
  });
  assert.equal(await announce.announceStatus(client, INFO, s), false);
});

test('a capa sai do set id, não do beatmap id', () => {
  // Trocar os dois dá uma imagem de outro mapa — erro silencioso, porque o
  // Discord mostra a capa errada sem reclamar de nada.
  assert.match(announce.coverUrl(2158809), /beatmaps\/2158809\/covers/);
});
