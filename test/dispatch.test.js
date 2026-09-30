/**
 * O defer padrão do despacho (bot/dispatch.js).
 *
 * O que ele precisa garantir, e que rodar o bot não mostra até alguém ver "O
 * aplicativo não respondeu":
 *   - sem declaração, o comando recebe a interação já deferida, em público;
 *   - `defer: 'ephemeral'` defere efêmero, e `defer: false` não defere nada;
 *   - defer que falha não roda o `execute` e sobe para o catch de quem
 *     despacha, como subia quando era o comando que deferia;
 *   - nenhum comando real com o defer do despacho chama `reply` ou
 *     `deferReply` na interação — os dois lançam depois de um defer.
 */
const test = require('node:test');
const assert = require('node:assert');
const { MessageFlags } = require('discord.js');

const { executar, deferValido } = require('../src/bot/dispatch');
const { loadCommands } = require('../src/bot/loadCommands');
const { MessageCommand } = require('../src/prefix/MessageCommand');
const { fakeMessage, commandSource } = require('./helpers');

/**
 * Interação que anota a ordem das chamadas e, como a do discord.js, recusa
 * responder de novo o que já foi respondido.
 */
function fakeInteraction({ deferFalha = null } = {}) {
  const chamadas = [];

  const interaction = {
    chamadas,
    deferred: false,
    replied: false,
    async deferReply(opcoes) {
      chamadas.push(['deferReply', opcoes]);
      if (deferFalha) throw deferFalha;
      if (this.deferred || this.replied) throw new Error('InteractionAlreadyReplied');
      this.deferred = true;
    },
    async reply(payload) {
      chamadas.push(['reply', payload]);
      if (this.deferred || this.replied) throw new Error('InteractionAlreadyReplied');
      this.replied = true;
    },
    async editReply(payload) {
      chamadas.push(['editReply', payload]);
      if (!this.deferred && !this.replied) throw new Error('InteractionNotReplied');
    },
  };

  return interaction;
}

/** Comando falso que registra em que estado recebeu a interação. */
function fakeCommand(extra = {}, responder = i => i.editReply('ok')) {
  const recebido = [];
  return {
    recebido,
    data: { name: 'falso' },
    ...extra,
    async execute(interaction) {
      recebido.push({ deferred: interaction.deferred });
      return responder(interaction);
    },
  };
}

test('sem declaração: defer público antes do execute', async () => {
  const command = fakeCommand();
  const interaction = fakeInteraction();

  await executar(command, interaction);

  assert.deepEqual(interaction.chamadas.map(([nome]) => nome), ['deferReply', 'editReply']);
  // Sem flag nenhuma: `{ flags: undefined }` seria igual para o discord.js,
  // mas conferir que não há objeto deixa claro que não é efêmero por acidente.
  assert.equal(interaction.chamadas[0][1], undefined);
  assert.deepEqual(command.recebido, [{ deferred: true }]);
});

test('defer: true é o mesmo que não declarar', async () => {
  const interaction = fakeInteraction();
  await executar(fakeCommand({ defer: true }), interaction);
  assert.deepEqual(interaction.chamadas[0], ['deferReply', undefined]);
});

test("defer: 'ephemeral' defere com a flag de efêmero", async () => {
  const command = fakeCommand({ defer: 'ephemeral' });
  const interaction = fakeInteraction();

  await executar(command, interaction);

  assert.deepEqual(interaction.chamadas[0], ['deferReply', { flags: MessageFlags.Ephemeral }]);
  assert.deepEqual(command.recebido, [{ deferred: true }]);
});

test('defer: false não defere, e o comando responde direto', async () => {
  const command = fakeCommand(
    { defer: false },
    i => i.reply({ content: 'direto', flags: MessageFlags.Ephemeral }),
  );
  const interaction = fakeInteraction();

  await executar(command, interaction);

  assert.deepEqual(interaction.chamadas.map(([nome]) => nome), ['reply']);
  assert.deepEqual(command.recebido, [{ deferred: false }]);
});

test('defer: false deixa o comando fazer o próprio defer', async () => {
  const command = fakeCommand({ defer: false }, async i => {
    await i.deferReply();
    return i.editReply('depois');
  });
  const interaction = fakeInteraction();

  await executar(command, interaction);

  // Um só defer: o do despacho somado ao do comando lançaria.
  assert.deepEqual(interaction.chamadas.map(([nome]) => nome), ['deferReply', 'editReply']);
});

test('defer que falha não roda o execute e sobe para quem despacha', async () => {
  // O erro que o discord.js lança quando o token passou dos 3s: é o caso real
  // (fila do rate limiter, event loop travado), e o catch do index.js é quem
  // loga e tenta avisar — como fazia quando o defer era do comando.
  const expirada = Object.assign(new Error('Unknown interaction'), { code: 10062 });
  const command = fakeCommand();
  const interaction = fakeInteraction({ deferFalha: expirada });

  await assert.rejects(() => executar(command, interaction), erro => erro === expirada);

  assert.deepEqual(command.recebido, [], 'execute rodou com a interação morta');
  assert.equal(interaction.deferred, false);
});

test('defer de interação já respondida também sobe, sem rodar o execute', async () => {
  const command = fakeCommand();
  const interaction = fakeInteraction();
  interaction.replied = true;

  await assert.rejects(() => executar(command, interaction), /InteractionAlreadyReplied/);
  assert.deepEqual(command.recebido, []);
});

test('erro do execute sai intacto, com a interação já deferida', async () => {
  // É o `interaction.deferred` que faz o catch do index.js escolher followUp
  // em vez de reply.
  const falha = new Error('execute quebrou');
  const interaction = fakeInteraction();

  await assert.rejects(
    () => executar(fakeCommand({}, () => { throw falha; }), interaction),
    erro => erro === falha,
  );
  assert.equal(interaction.deferred, true);
});

test('modo texto: a mesma declaração vira "digitando..." ou nada', async t => {
  const contexto = () => {
    const message = fakeMessage('k!falso');
    let digitando = 0;
    message.channel.sendTyping = async () => { digitando++; };
    const context = new MessageCommand(message, 'falso', { values: new Map(), subcommand: null });
    return { context, digitando: () => digitando };
  };

  for (const defer of [undefined, 'ephemeral']) {
    await t.test(`defer: ${defer}`, async () => {
      const { context, digitando } = contexto();
      await executar(fakeCommand({ defer }), context);
      assert.equal(digitando(), 1);
      assert.equal(context.deferred, true);
    });
  }

  await t.test('defer: false', async () => {
    const { context, digitando } = contexto();
    await executar(fakeCommand({ defer: false }, i => i.reply('direto')), context);
    assert.equal(digitando(), 0);
    assert.equal(context.deferred, false);
  });
});

test('deferValido aceita só o que o despacho entende', () => {
  for (const defer of [undefined, true, false, 'ephemeral']) {
    assert.ok(deferValido({ defer }), `${defer} deveria valer`);
  }
  for (const defer of ['efemero', 'Ephemeral', 'public', 1, 0, null, {}]) {
    assert.ok(!deferValido({ defer }), `${JSON.stringify(defer)} não deveria valer`);
  }
});

// ─── Os comandos reais ────────────────────────────────────────────────────────

const { commands } = loadCommands({ strict: true });

/** Pasta ou arquivo do comando, a partir de `src/commands`. */
const ORIGEM = {
  compare: 'osu/compare', leaderboard: 'osu/leaderboard', map: 'osu/map',
  pp: 'osu/pp', profile: 'osu/profile', recent: 'osu/recent', score: 'osu/score',
  simulate: 'osu/simulate', topplays: 'osu/topplays', topscores: 'osu/topscores',
  whatif: 'osu/whatif', matchcost: 'osu/matchcost', nochoke: 'osu/nochoke',
  topif: 'osu/topif', help: 'user/help', language: 'user/language', link: 'user/link',
  diag: 'admin/diag', invitecode: 'admin/invitecode', moderate: 'admin/moderate',
  nominate: 'admin/nominate', role: 'admin/role', scorewipe: 'admin/scorewipe',
  staff: 'admin/staff', wipe: 'admin/wipe',
};

test('todo comando real tem origem conhecida (senão a guarda abaixo não o vê)', () => {
  for (const [name, command] of commands) {
    if (command.aliasOf) continue;
    assert.ok(ORIGEM[name], `/${name} é novo: acrescente em ORIGEM`);
  }
});

test('comando com o defer do despacho não chama reply nem deferReply', () => {
  // Depois do defer, os dois lançam InteractionAlreadyReplied — e só no
  // caminho em que são chamados, que costuma ser o de erro, o menos testado.
  // Quem precisa deles declara `defer: false`.
  for (const [name, origem] of Object.entries(ORIGEM)) {
    const command = commands.get(name);
    if (command.defer === false) continue;

    const fonte = commandSource(origem);
    assert.doesNotMatch(fonte, /\binteraction\.reply\(/, `/${name}: reply depois do defer do despacho`);
    assert.doesNotMatch(fonte, /\binteraction\.deferReply\(/, `/${name}: segundo defer`);
  }
});

test('os efêmeros migrados continuam efêmeros', () => {
  for (const name of ['role', 'wipe', 'scorewipe', 'moderate', 'invitecode']) {
    assert.equal(commands.get(name).defer, 'ephemeral', `/${name}`);
  }
});
