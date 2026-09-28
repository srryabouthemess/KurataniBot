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

/**
 * Ao reaproveitar a resposta de um comando anterior (a mensagem foi editada,
 * ver prefixCommands.js), a primeira escrita SUBSTITUI tudo o que havia nela.
 * Sem isto, um `edit` só com embed deixaria para trás o texto de erro da
 * resposta antiga, e os botões dela.
 */
const EM_BRANCO = { content: null, embeds: [], components: [], attachments: [] };

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
  // A resposta veio de um comando anterior e ainda não foi reescrita.
  #herdada = false;
  #superada = false;
  #aoSerSuperada = [];

  /**
   * @param {object} [opts]
   * @param {object|null} [opts.previousReply] resposta de uma execução anterior
   *   do mesmo comando, para ser editada em vez de mandar outra mensagem
   */
  constructor(message, commandName, parsed, { previousReply = null } = {}) {
    this.message     = message;
    this.commandName = commandName;
    this.deferred    = false;
    this.replied     = false;
    this.options     = buildOptionAccessors(parsed);
    this.#replyMessage = previousReply;
    this.#herdada      = previousReply !== null;
  }

  /** A mensagem com que o bot respondeu, quando já respondeu. */
  get replyMessage() { return this.#replyMessage; }

  /**
   * A mensagem do comando foi editada e uma execução nova assumiu a resposta.
   *
   * A partir daqui esta execução não escreve mais nada — nem o resultado que
   * ainda estava buscando, nem o "expirou" de um coletor — e quem registrou um
   * `onSuperseded` (a paginação) larga os botões para a execução nova.
   */
  supersede() {
    if (this.#superada) return;
    this.#superada = true;
    for (const fn of this.#aoSerSuperada.splice(0)) {
      try { fn(); } catch { /* quem registrou cuida do próprio erro */ }
    }
  }

  get superseded() { return this.#superada; }

  /** Chamado quando uma execução nova assume a resposta (ver `supersede`). */
  onSuperseded(fn) {
    if (this.#superada) fn();
    else this.#aoSerSuperada.push(fn);
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
    if (this.#superada) return this.#replyMessage;

    if (this.#herdada) {
      this.#herdada = false;
      const reescrita = await this.#replyMessage
        .edit({ ...EM_BRANCO, ...toMessagePayload(payload) })
        .catch(() => null);
      // Apagaram a resposta antiga: responde de novo, como se fosse a primeira.
      if (reescrita) {
        this.replied = true;
        return this.#replyMessage;
      }
    }

    this.#replyMessage = await this.message.reply(toMessagePayload(payload));
    this.replied = true;
    return this.#replyMessage;
  }

  async editReply(payload) {
    if (this.#superada) return this.#replyMessage;
    if (!this.#replyMessage || this.#herdada) return this.reply(payload);
    // Como no `editReply` de interação, campos não informados ficam como
    // estão — é o que faz `editReply({ components: [] })` limpar os botões
    // sem apagar o embed.
    return this.#replyMessage.edit(toMessagePayload(payload));
  }

  async followUp(payload) {
    if (this.#superada) return null;
    return this.message.channel.send(toMessagePayload(payload));
  }

  async fetchReply() {
    return this.#replyMessage;
  }

  async deleteReply() {
    if (this.#superada) return;
    await this.#replyMessage?.delete().catch(() => {});
    this.#replyMessage = null;
  }
}

module.exports = { MessageCommand, buildOptionAccessors };
