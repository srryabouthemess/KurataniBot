/**
 * Comandos por texto, pelo caminho real: `register()` num client falso, com os
 * comandos de verdade (specs autênticas) e o `execute` stubado.
 */
process.env.COMMAND_PREFIX = 'k!';

const test = require('node:test');
const assert = require('node:assert');
const { MessageFlags } = require('discord.js');
const { fakeMessage, firstReply, drain } = require('./helpers');

const prefixCommands = require('../src/prefixCommands');

const NAMES = [
  'recent', 'rs', 'score', 'c', 'simulate', 'pp',
  'link', 'language', 'staff', 'whatif', 'nominate',
];

let captured = null;
const commands = new Map();
for (const name of NAMES) {
  const real = require(`../src/commands/${name}`);
  commands.set(name, {
    data: real.data,
    prefix: real.prefix,
    execute: async context => { captured = context; },
  });
}

const client = { commands, on(_event, handler) { this.handler = handler; } };
prefixCommands.register(client);

/** Manda uma mensagem pelo dispatcher e devolve o que aconteceu. */
async function run(content, options = {}) {
  captured = null;
  const sent = [];
  client.handler(fakeMessage(content, { ...options, sent }));
  await drain();
  return { context: captured, sent, reply: firstReply(sent) };
}

test('estilos de argumento', async t => {
  await t.test('posicional', async () => {
    const { context } = await run('k!rs mrekk');
    assert.equal(context.options.getString('player'), 'mrekk');
  });

  await t.test('nomeado, com choice pelo rótulo', async () => {
    const { context } = await run('k!rs player:mrekk server:daycore');
    assert.equal(context.options.getString('player'), 'mrekk');
    assert.equal(context.options.getString('server'), 'daycore');
  });

  await t.test('choice pelo valor interno', async () => {
    const { context } = await run('k!rs server:daycore_rx');
    assert.equal(context.options.getString('server'), 'daycore_rx');
  });

  await t.test('flag com hífen, em qualquer posição', async () => {
    const a = await run('k!rs pudim2 -daycore');
    assert.equal(a.context.options.getString('player'), 'pudim2');
    assert.equal(a.context.options.getString('server'), 'daycore');

    const b = await run('k!rs -daycorerx pudim2');
    assert.equal(b.context.options.getString('player'), 'pudim2');
    assert.equal(b.context.options.getString('server'), 'daycore_rx');
  });

  await t.test('flag booleana, com e sem hífen', async () => {
    const a = await run('k!pp 10000 -randomize');
    assert.equal(a.context.options.getBoolean('randomize'), true);

    const b = await run('k!pp 10000 randomize');
    assert.equal(b.context.options.getBoolean('randomize'), true);

    const c = await run('k!pp 10000 avg:700 randomize:sim');
    assert.equal(c.context.options.getBoolean('randomize'), true);
  });

  await t.test('flag de opção que não é servidor', async () => {
    const { context } = await run('k!nominate add 123 -love');
    assert.equal(context.options.getString('status'), 'love');
  });

  await t.test('aspas, inclusive as do teclado do celular', async () => {
    const a = await run('k!rs "Some Player"');
    assert.equal(a.context.options.getString('player'), 'Some Player');

    const b = await run('k!rs “Some Player”');
    assert.equal(b.context.options.getString('player'), 'Some Player');
  });

  await t.test('link não é confundido com argumento nomeado', async () => {
    const url = 'https://osu.ppy.sh/beatmapsets/1100333#osu/2298847';
    const { context } = await run(`k!score ${url}`);
    assert.equal(context.options.getString('map'), url);
  });

  await t.test('mistura de estilos numa linha só', async () => {
    const { context } = await run('k!simulate 2298847 DT 5 0 1 combo:300');
    assert.equal(context.options.getString('map'), '2298847');
    assert.equal(context.options.getString('mods'), 'DT');
    assert.equal(context.options.getInteger('n100'), 5);
    assert.equal(context.options.getInteger('miss'), 1);
    assert.equal(context.options.getInteger('combo'), 300);
  });

  await t.test('subcomando', async () => {
    const { context } = await run('k!link set desgracadogames server:Daycore');
    assert.equal(context.options.getSubcommand(), 'set');
    assert.equal(context.options.getString('player'), 'desgracadogames');
    assert.equal(context.options.getString('server'), 'daycore');
  });

  await t.test('menção de usuário', async () => {
    const { context } = await run('k!staff register <@123456789012345678> fulano');
    assert.equal(context.options.getUser('member').id, '123456789012345678');
    assert.equal(context.options.getString('player'), 'fulano');
  });
});

test('guarda do /score: mapa ou jogador', async t => {
  // No slash o `map` é a primeira opção; escrevendo, `k!c fulano` é o uso comum.
  await t.test('nome não cai no map', async () => {
    const { context } = await run('k!c nunca -bancho');
    assert.equal(context.options.getString('player'), 'nunca');
    assert.equal(context.options.getString('map'), null);
    assert.equal(context.options.getString('server'), 'official');
  });

  await t.test('id de mapa ainda vai para o map', async () => {
    const { context } = await run('k!c 2298847');
    assert.equal(context.options.getString('map'), '2298847');
    assert.equal(context.options.getString('player'), null);
  });

  await t.test('mapa e jogador juntos', async () => {
    const { context } = await run('k!c 2298847 nunca');
    assert.equal(context.options.getString('map'), '2298847');
    assert.equal(context.options.getString('player'), 'nunca');
  });

  await t.test('map: explícito não é desviado', async () => {
    const { context } = await run('k!c map:nunca');
    assert.equal(context.options.getString('map'), 'nunca');
  });
});

test('erros de sintaxe explicam o que fazer', async t => {
  await t.test('subcomando faltando lista as opções', async () => {
    const { context, reply } = await run('k!link');
    assert.equal(context, null);
    assert.match(reply, /set\|remove\|status\|default/);
  });

  await t.test('opção obrigatória faltando mostra o uso', async () => {
    const { context, reply } = await run('k!simulate');
    assert.equal(context, null);
    assert.match(reply, /map/);
  });

  await t.test('fora da faixa numérica', async () => {
    assert.match((await run('k!pp 0')).reply, /limite/);
    assert.match((await run('k!whatif 99999')).reply, /limite/);
  });

  await t.test('inteiro inválido', async () => {
    assert.match((await run('k!simulate 123 DT abc')).reply, /inteiro/);
  });

  await t.test('choice inválida lista as aceitas', async () => {
    assert.match((await run('k!language set xx')).reply, /pt/);
  });

  await t.test('flag desconhecida lista as aceitas', async () => {
    assert.match((await run('k!rs pudim2 -banch')).reply, /-daycorerx/);
  });

  await t.test('número negativo não é lido como flag', async () => {
    assert.match((await run('k!whatif -500')).reply, /limite/);
  });

  await t.test('nome com espaço sem aspas sugere as aspas', async () => {
    assert.match((await run('k!recent nome do cara')).reply, /aspas/);
  });

  await t.test('choice posicional válida ainda casa', async () => {
    const { context } = await run('k!rs mrekk daycore');
    assert.equal(context.options.getString('server'), 'daycore');
  });
});

test('travas de contexto e permissão', async t => {
  await t.test('comando de servidor é recusado em DM', async () => {
    const { context, reply } = await run('k!staff list', { guildId: null });
    assert.equal(context, null);
    assert.match(reply, /servidor/);
  });

  await t.test('comando comum funciona em DM', async () => {
    const { context } = await run('k!rs mrekk', { guildId: null });
    assert.ok(context);
  });

  // O Discord aplica setDefaultMemberPermissions só no slash; aqui é o
  // dispatcher que precisa repetir a conferência.
  await t.test('comando de admin é recusado para não-admin', async () => {
    const { context, reply } = await run('k!staff list', { admin: false });
    assert.equal(context, null);
    assert.match(reply, /permissão/);
  });

  await t.test('admin passa pela mesma porta', async () => {
    assert.ok((await run('k!staff list', { admin: true })).context);
  });

  await t.test('comando sem exigência não é afetado', async () => {
    assert.ok((await run('k!rs mrekk', { admin: false })).context);
  });
});

test('prefixo sozinho convida a começar', async t => {
  // O contraste com o silêncio de `k!naoexiste` (logo abaixo) é o ponto: a
  // exceção vale para o prefixo exato, não para tudo que começa com ele.
  await t.test('responde com o caminho das pedras', async () => {
    const { context, reply } = await run('k!');
    assert.equal(context, null);
    assert.match(reply, /\/link set/);
    assert.match(reply, /\/help/);
  });

  await t.test('espaço sobrando não muda nada', async () => {
    assert.match((await run('k!   ')).reply, /\/help/);
  });

  await t.test('sugere o modo texto com o prefixo configurado', async () => {
    assert.match((await run('k!')).reply, /k!help/);
  });
});

test('o que o bot deve ignorar', async t => {
  await t.test('texto normal', async () => {
    const { context, sent } = await run('bom dia pessoal');
    assert.equal(context, null);
    assert.equal(sent.length, 0);
  });

  await t.test('comando que não existe, em silêncio', async () => {
    const { context, sent } = await run('k!naoexiste');
    assert.equal(context, null);
    assert.equal(sent.length, 0);
  });
});

test('adaptador de resposta', async t => {
  await t.test('defer cria a mensagem e as seguintes editam ela', async () => {
    const { context, sent } = await run('k!rs mrekk');

    await context.deferReply();
    await context.editReply({ embeds: ['E'], flags: MessageFlags.Ephemeral });
    await context.editReply({ components: [] });

    assert.equal(sent[0][0], 'reply');
    assert.equal(sent[1][0], 'edit');
    // Ephemeral não existe em mensagem comum: mandar a flag seria erro da API.
    assert.equal(sent[0][1].flags, undefined);
  });
});
