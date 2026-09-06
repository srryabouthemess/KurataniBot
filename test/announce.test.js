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
  // O rótulo do mapa passa pelo escape (ver markdown.js): este embed vai para um
  // canal público, e o nome do mapa é texto de terceiro em posição de link. Mas
  // parêntese não é escapável no Discord — a contrabarra apareceria na tela, que
  // foi o defeito visto no canal de anúncios. Nome sem colchete sai intacto.
  assert.match(embed.description, /BWG \(Cut Ver\.\) \(Yomitagami\)/);
  assert.ok(!embed.description.includes('\\('), 'contrabarra visível no nome do mapa');
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
  assert.match(announce.coverUrl(2158809, null), /beatmaps\/2158809\/covers/);
});

test('mapa do servidor privado tira a capa do espelho, não do assets.ppy.sh', () => {
  // O set id de mapa registrado aqui está na faixa privada e não existe no CDN
  // do osu!: pedir a capa lá devolve 404 e o embed sai sem imagem. O espelho
  // extrai a capa do próprio .osz, e redireciona para o assets.ppy.sh quando o
  // id é oficial — então serve para os dois casos.
  assert.equal(
    announce.coverUrl(100000006, 'https://osu.daycore.org/mirror-cover'),
    'https://osu.daycore.org/mirror-cover/100000006',
  );
});

/**
 * Log de cargo mexido dentro do jogo.
 *
 * Vale o mesmo dos anúncios de mapa — desligado por padrão, nunca derruba quem
 * chamou —, mais uma regra que só existe aqui: o canal é OUTRO. O `/role` e o
 * admin panel já viram embed pelo webhook de auditoria do próprio servidor, e
 * só o caminho in-game passa por este arquivo.
 */
const PRIV = {
  type: 'addpriv',
  targetId: 42,
  targetName: 'fulano',
  privs: ['nominator'],
  authorId: 7,
  authorName: 'sicrano',
};

test.beforeEach(() => { delete process.env.DAYCORE_ROLE_LOG_CHANNEL_ID; });

test('sem canal de log de cargo, não anuncia', async () => {
  const sent = [];
  assert.equal(announce.isPrivLogConfigured(), false);

  assert.equal(await announce.announcePrivChange(fakeClient({ sent }), PRIV, s), false);
  assert.equal(sent.length, 0);
});

test('o canal do mapa não liga o log de cargo', async () => {
  // São dois canais de propósito: o de mapa é vitrine, o de cargo é registro de
  // staff. Configurar um não pode publicar o outro no lugar errado.
  process.env.DAYCORE_ANNOUNCE_CHANNEL_ID = '123';
  const sent = [];

  assert.equal(await announce.announcePrivChange(fakeClient({ sent }), PRIV, s), false);
  assert.equal(sent.length, 0);
  delete process.env.DAYCORE_ANNOUNCE_CHANNEL_ID;
});

test('com canal configurado, manda o embed de cargo', async () => {
  process.env.DAYCORE_ROLE_LOG_CHANNEL_ID = '456';
  const sent = [];

  assert.equal(await announce.announcePrivChange(fakeClient({ sent }), PRIV, s), true);
  assert.equal(sent.length, 1);

  const embed = sent[0].embeds[0].data;
  assert.match(embed.title, /concedido/i);
  // O nome do cargo sai do rótulo, não do que foi digitado no jogo.
  assert.match(embed.description, /Nominator/);
  assert.match(embed.description, /fulano/);
  assert.match(embed.description, /#42/);
  assert.match(embed.description, /sicrano/);
  // Avatar do ALVO: é dele que o cargo mudou.
  assert.match(embed.thumbnail.url, /42$/);
});

test('remoção sai com título próprio', async () => {
  process.env.DAYCORE_ROLE_LOG_CHANNEL_ID = '456';
  const sent = [];

  await announce.announcePrivChange(fakeClient({ sent }), { ...PRIV, type: 'rmpriv' }, s);
  assert.match(sent[0].embeds[0].data.title, /removido/i);
});

test('nick de terceiro passa pelo escape', async () => {
  // O nome vai em posição de link num canal público: sem escape, um nick com
  // `](url)` faz o bot publicar link forjado (ver markdown.js).
  process.env.DAYCORE_ROLE_LOG_CHANNEL_ID = '456';
  const sent = [];

  await announce.announcePrivChange(
    fakeClient({ sent }),
    { ...PRIV, targetName: '[a](https://evil.example)' },
    s,
  );
  // O colchete escapado quebra o par `](` que fecharia o link do bot: a URL
  // continua no texto, mas como texto, e não como destino de um rótulo forjado.
  // Escapado, o nick não fecha o rótulo do link: o par `](` do original
  // deixa de existir, e a URL vira texto em vez de destino.
  assert.ok(!sent[0].embeds[0].data.description.includes('[a](https://evil.example)'));
});

test('sem quem aplicou, o embed ainda sai', async () => {
  // O campo só existe se o fork publicar o autor — mesma regra do anúncio de
  // mapa: sai como "aplicado in-game", não deixa de sair.
  process.env.DAYCORE_ROLE_LOG_CHANNEL_ID = '456';
  const sent = [];

  await announce.announcePrivChange(
    fakeClient({ sent }), { ...PRIV, authorId: null, authorName: null }, s,
  );
  assert.match(sent[0].embeds[0].data.description, /in-game/);
});

test('vários cargos saem numa linha só', async () => {
  process.env.DAYCORE_ROLE_LOG_CHANNEL_ID = '456';
  const sent = [];

  await announce.announcePrivChange(
    fakeClient({ sent }), { ...PRIV, privs: ['mod', 'nominator'] }, s,
  );
  assert.match(sent[0].embeds[0].data.description, /Moderator, Nominator/);
});

test('falha do Discord no log de cargo vira false, não exceção', async () => {
  // A mudança de cargo no servidor já valeu quando o anúncio sai.
  process.env.DAYCORE_ROLE_LOG_CHANNEL_ID = '456';

  const client = { channels: { fetch: async () => { throw new Error('Unknown Channel'); } } };
  assert.equal(await announce.announcePrivChange(client, PRIV, s), false);
});

const CUSTOM_MAP = {
  type: 'uploaded', source: 'editor', setId: 100000001,
  beatmapIds: [100000002, 100000003], artist: 'Camellia',
  title: 'Test Map', creator: 'mapper', status: 0,
  actorId: 42, actorName: 'mapper', removed: null,
};

test.beforeEach(() => { delete process.env.DAYCORE_CUSTOM_MAP_CHANNEL_ID; });

test('evento de mapa customizado usa canal separado', async () => {
  process.env.DAYCORE_CUSTOM_MAP_CHANNEL_ID = '789';
  const sent = [];

  assert.equal(await announce.announceCustomMap(fakeClient({ sent }), CUSTOM_MAP, s), true);
  const embed = sent[0].embeds[0].data;
  assert.match(embed.title, /enviado/i);
  assert.match(embed.description, /Camellia/);
  assert.match(embed.description, /2 dificuldades/);
  assert.match(embed.description, /editor/i);
  assert.match(embed.description, /mapper/);
  assert.match(embed.image.url, /100000001/);
});

test('remoção de mapa customizado não inventa metadados apagados', async () => {
  process.env.DAYCORE_CUSTOM_MAP_CHANNEL_ID = '789';
  const sent = [];

  await announce.announceCustomMap(fakeClient({ sent }), {
    ...CUSTOM_MAP, type: 'deleted', source: 'web', beatmapIds: [],
    artist: null, title: null, creator: null, removed: 2,
  }, s);
  const embed = sent[0].embeds[0].data;
  assert.match(embed.title, /removido/i);
  assert.match(embed.description, /100000001/);
  assert.match(embed.description, /2 dificuldades/);
  assert.equal(embed.image, undefined);
});

test('falha do Discord no mapa customizado não afeta a operação concluída', async () => {
  process.env.DAYCORE_CUSTOM_MAP_CHANNEL_ID = '789';
  const client = { channels: { fetch: async () => { throw new Error('Unknown Channel'); } } };
  assert.equal(await announce.announceCustomMap(client, CUSTOM_MAP, s), false);
});
