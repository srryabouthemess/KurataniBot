/** Contexto de mapa: link no chat, reply, histórico e prioridade entre eles. */
const test = require('node:test');
const assert = require('node:assert');

const mapContext = require('../src/mapContext');

const BOT = { id: 'bot-1' };
const message = (content, { embeds = [], author = { id: 'u1' }, channelId = 'c1', age = 0 } = {}) => ({
  content, embeds, author, channelId,
  createdTimestamp: Date.now() - age,
  client: { user: BOT },
});

test('encontrar o mapa numa mensagem', async t => {
  await t.test('link do osu! oficial', () => {
    const found = mapContext.fromMessage(message('https://osu.ppy.sh/beatmapsets/2291108#osu/5036232'));
    assert.equal(found.mapId, 5036232);
    assert.equal(found.mode, 'official');
  });

  await t.test('link no meio de um texto', () => {
    assert.equal(mapContext.fromMessage(message('olha esse https://osu.ppy.sh/b/2298847 é foda')).mapId, 2298847);
  });

  await t.test('link de servidor configurado traz a chave dele', () => {
    const found = mapContext.fromMessage(message('https://daycore.org/b/456'));
    assert.equal(found.mapId, 456);
    assert.equal(found.mode, 'daycore');
  });

  await t.test('link entre <> (preview suprimido)', () => {
    assert.equal(mapContext.fromMessage(message('<https://osu.ppy.sh/beatmapsets/1#osu/999>')).mapId, 999);
  });

  await t.test('com dois links, vale o último', () => {
    assert.equal(
      mapContext.fromMessage(message('a https://osu.ppy.sh/b/111 e https://osu.ppy.sh/b/222')).mapId,
      222,
    );
  });

  await t.test('embed do bot (título linkado)', () => {
    const found = mapContext.fromMessage(message('', {
      embeds: [{ url: 'https://osu.ppy.sh/beatmapsets/1100333#osu/2298847' }],
    }));
    assert.equal(found.mapId, 2298847);
  });

  await t.test('host desconhecido é ignorado', () => {
    // Sem isso, qualquer `algumsite.com/b/12` da conversa viraria "mapa".
    assert.equal(mapContext.fromMessage(message('olha https://sitequalquer.com/b/12345')), null);
  });

  await t.test('conversa normal e link de perfil não viram mapa', () => {
    assert.equal(mapContext.fromMessage(message('bora jogar hoje?')), null);
    assert.equal(mapContext.fromMessage(message('https://osu.ppy.sh/users/12345')), null);
  });
});

test('memória do canal', async t => {
  await t.test('link no chat vira contexto', async () => {
    mapContext.watch(message('https://osu.ppy.sh/b/777', { channelId: 'c2' }));
    assert.equal((await mapContext.recall({ channelId: 'c2' })).mapId, 777);
  });

  await t.test('mensagem do próprio bot é ignorada pelo watch', async () => {
    // Os comandos do bot já chamam remember() com o servidor certo.
    mapContext.watch(message('https://osu.ppy.sh/b/888', { channelId: 'c3', author: BOT }));
    assert.equal(await mapContext.recall({ channelId: 'c3' }), null);
  });

  await t.test('canal sem nada devolve null', async () => {
    assert.equal(await mapContext.recall({ channelId: 'canal-vazio' }), null);
  });
});

test('prioridade do reply sobre o canal', async t => {
  await t.test('o mapa da mensagem respondida ganha', async () => {
    const found = await mapContext.recall({
      channelId: 'c2',
      fetchRepliedMessage: async () => message('https://osu.ppy.sh/b/999'),
    });
    assert.equal(found.mapId, 999);
  });

  await t.test('reply sem mapa cai no contexto do canal', async () => {
    const found = await mapContext.recall({
      channelId: 'c2',
      fetchRepliedMessage: async () => message('kkkkk'),
    });
    assert.equal(found.mapId, 777);
  });

  await t.test('interação de slash (sem reply) segue funcionando', async () => {
    assert.equal((await mapContext.recall({ channelId: 'c2' })).mapId, 777);
  });
});

test('varredura do histórico quando não há memória', async t => {
  const channelWith = list => ({
    id: `hist-${Math.random()}`,
    client: { user: BOT },
    messages: { fetch: async () => new Map(list.map((m, i) => [String(i), m])) },
  });

  await t.test('acha link postado antes de o bot subir', async () => {
    const channel = channelWith([
      message('opa'),
      message('https://osu.ppy.sh/beatmapsets/2291108#osu/5036232'),
    ]);
    const found = await mapContext.recall({ channelId: channel.id, channel });
    assert.equal(found.mapId, 5036232);
  });

  await t.test('link de exemplo do próprio bot é ignorado', async () => {
    // A resposta de erro do bot traz um link de exemplo no texto; sem essa
    // regra ele acharia o próprio exemplo e responderia sobre o mapa 456.
    const channel = channelWith([
      message('❌ Use o ID ou um link (ex: https://osu.ppy.sh/beatmapsets/123#osu/456).', { author: BOT }),
      message('bora jogar'),
    ]);
    assert.equal(await mapContext.recall({ channelId: channel.id, channel }), null);
  });

  await t.test('mas o embed de play do bot vale', async () => {
    const channel = channelWith([
      message('', { author: BOT, embeds: [{ url: 'https://osu.ppy.sh/b/2298847' }] }),
    ]);
    assert.equal((await mapContext.recall({ channelId: channel.id, channel })).mapId, 2298847);
  });

  await t.test('link velho (7h) não conta', async () => {
    const channel = channelWith([message('https://osu.ppy.sh/b/555', { age: 7 * 60 * 60 * 1000 })]);
    assert.equal(await mapContext.recall({ channelId: channel.id, channel }), null);
  });

  await t.test('o que foi achado fica memorizado', async () => {
    const channel = channelWith([message('https://osu.ppy.sh/b/4242')]);
    await mapContext.recall({ channelId: channel.id, channel });
    // segunda chamada sem histórico: só passa se a primeira memorizou
    assert.equal((await mapContext.recall({ channelId: channel.id })).mapId, 4242);
  });

  await t.test('sem permissão de ler histórico não quebra', async () => {
    const channel = {
      id: 'sem-permissao',
      client: { user: BOT },
      messages: { fetch: async () => { throw new Error('Missing Access'); } },
    };
    assert.equal(await mapContext.recall({ channelId: channel.id, channel }), null);
  });
});
