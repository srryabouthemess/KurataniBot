/**
 * prefix/MessageCommand.js
 * Faz uma `Message` se passar pela interação que os comandos esperam.
 *
 * É o que permite não haver uma segunda implementação de cada comando: eles
 * continuam escritos para o slash command, e o adaptador cobre a superfície que
 * eles usam (`options.getX`, `reply`, `deferReply`, `editReply`, `user`,
 * `guildId`, `channelId`, `memberPermissions`).
 */

const { MessageFlags } = require('discord.js');

// ─── Adaptador Message → interação ────────────────────────────────────────────

/** Ephemeral não existe fora de interação; mandar a flag mesmo assim é erro. */
function toMessagePayload(payload) {
  const data = typeof payload === 'string' ? { content: payload } : { ...payload };

  if (typeof data.flags === 'number') {
    const flags = data.flags & ~MessageFlags.Ephemeral;
    if (flags === 0) delete data.flags;
    else data.flags = flags;
  } else if (data.flags != null) {
    delete data.flags;
  }

  return data;
}

/** Espelha `interaction.options`: ausente devolve null, como no discord.js. */
function buildOptionAccessors({ values, subcommand }) {
  const get = name => (values.has(name) ? values.get(name) : null);

  return {
    getSubcommand(required = true) {
      if (subcommand === null && required) {
        throw new TypeError('Nenhum subcomando informado.');
      }
      return subcommand;
    },
    getSubcommandGroup() { return null; },
    getString:  get,
    getInteger: get,
    getNumber:  get,
    getBoolean: get,
    getUser:    get,
    getMember:  () => null,
    get,
  };
}

/**
 * Faz uma `Message` se passar pela interação que os comandos esperam.
 *
 * A parte que exige cuidado é o ciclo defer → edit: numa interação o Discord
 * segura um "pensando..." e o `editReply` preenche depois. Aqui não existe
 * esse estado, então o `deferReply` só mostra o "digitando..." e a primeira
 * resposta de verdade — venha de `reply` ou de `editReply` — é que cria a
 * mensagem. As seguintes editam essa mesma mensagem, que é o que mantém a
 * paginação por botões funcionando igual.
 */
class MessageCommand {
  #replyMessage = null;

  constructor(message, commandName, parsed) {
    this.message     = message;
    this.commandName = commandName;
    this.deferred    = false;
    this.replied     = false;
    this.options     = buildOptionAccessors(parsed);
  }

  get client()            { return this.message.client; }
  get user()              { return this.message.author; }
  get member()            { return this.message.member; }
  get guild()             { return this.message.guild; }
  get guildId()           { return this.message.guildId; }
  get channel()           { return this.message.channel; }
  get channelId()         { return this.message.channelId; }
  get memberPermissions() { return this.message.member?.permissions ?? null; }
  get locale()            { return this.message.guild?.preferredLocale ?? null; }

  isChatInputCommand() { return true; }

  /**
   * Mensagem que o comando respondeu, se ele foi um reply.
   *
   * Não existe equivalente no slash command — daí o nome próprio em vez de
   * fingir mais um campo de interação. Quem usa (o mapContext) checa se o
   * método existe antes de chamar.
   */
  async fetchRepliedMessage() {
    if (!this.message.reference?.messageId) return null;
    return this.message.fetchReference().catch(() => null);
  }

  async deferReply() {
    this.deferred = true;
    await this.message.channel.sendTyping().catch(() => {});
  }

  async reply(payload) {
    this.#replyMessage = await this.message.reply(toMessagePayload(payload));
    this.replied = true;
    return this.#replyMessage;
  }

  async editReply(payload) {
    if (!this.#replyMessage) return this.reply(payload);
    // Como no `editReply` de interação, campos não informados ficam como
    // estão — é o que faz `editReply({ components: [] })` limpar os botões
    // sem apagar o embed.
    return this.#replyMessage.edit(toMessagePayload(payload));
  }

  async followUp(payload) {
    return this.message.channel.send(toMessagePayload(payload));
  }

  async fetchReply() {
    return this.#replyMessage;
  }

  async deleteReply() {
    await this.#replyMessage?.delete().catch(() => {});
    this.#replyMessage = null;
  }
}

module.exports = { MessageCommand, buildOptionAccessors };
