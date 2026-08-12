/**
 * prefixCommands.js
 * Comandos por texto: `k!rs mrekk` faz exatamente o que `/rs player:mrekk` faz.
 *
 * A ideia é NÃO ter uma segunda implementação de cada comando. Eles continuam
 * escritos para uma interação de slash command; um adaptador embrulha a
 * `Message` com a mesma superfície (ver prefix/MessageCommand.js) e o
 * dispatcher chama o mesmo `execute`. Comando novo passa a funcionar nos dois
 * modos sem tocar aqui.
 *
 * Este arquivo é só a ponta: configuração, travas de acesso e despacho. Ler a
 * linha, entender as opções e imitar a interação são responsabilidades
 * separadas, em `prefix/`.
 *
 * Desligado por padrão: ler o texto das mensagens exige o intent privilegiado
 * MESSAGE CONTENT, e pedir um intent não habilitado no Developer Portal faz o
 * `login()` falhar — o bot inteiro não subiria. Só liga com `COMMAND_PREFIX`
 * preenchido no `.env`.
 */

const { GatewayIntentBits, InteractionContextType, PermissionFlagsBits } = require('discord.js');

const { t } = require('./i18n');
const cooldowns = require('./cooldowns');
const { logError } = require('./logger');
const { PREFIX, ENABLED } = require('./prefix/config');
const { tokenize } = require('./prefix/tokenize');
const { buildSpec } = require('./prefix/spec');
const { parseArgs } = require('./prefix/parseArgs');
const { MessageCommand, buildOptionAccessors } = require('./prefix/MessageCommand');

/**
 * Intents extras necessários para ler mensagens. Ficam vazios quando o modo
 * texto está desligado, para o bot não pedir um intent privilegiado à toa.
 */
const INTENTS = ENABLED
  ? [
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ]
  : [];

// ─── Travas de acesso ─────────────────────────────────────────────────────────
// O Discord aplica estas duas ao slash command sozinho. No modo texto não
// existe equivalente, então elas precisam ser repetidas aqui — senão o prefixo
// vira o caminho de fora.

/** O comando pode rodar neste lugar (servidor, DM, grupo)? */
function allowedInContext(spec, message) {
  if (message.guildId) return true;
  if (!spec.contexts) return true;

  return spec.contexts.includes(InteractionContextType.BotDM)
      || spec.contexts.includes(InteractionContextType.PrivateChannel);
}

/**
 * Quem mandou tem a permissão que o comando declara?
 *
 * Isto NÃO substitui a checagem dentro do comando: as regras por canal e por
 * cargo que o dono do servidor configura em Integrações continuam invisíveis
 * para o modo texto, e o `execute` é quem tem a palavra final.
 */
function allowedByPermissions(spec, message) {
  const required = spec.defaultMemberPermissions;
  if (required === null || required === undefined) return true;

  // Fora de servidor não há permissão de membro para conferir; o contexto já
  // foi checado antes.
  if (!message.guildId) return true;

  const bits = BigInt(required);
  // "0" no Discord quer dizer "ninguém, exceto quem administra o servidor" — e
  // não "todo mundo", que é o que um `.has(0n)` responderia.
  const needed = bits === 0n ? PermissionFlagsBits.Administrator : bits;

  return message.member?.permissions?.has(needed) ?? false;
}

// ─── Despacho ─────────────────────────────────────────────────────────────────

/**
 * @returns {{command: object, spec: object, args: string[]}|null} null quando a
 *   mensagem não é um comando conhecido — e aí o bot fica em silêncio, porque
 *   `k!` é curto e vai colidir com conversa normal. A única exceção é o
 *   prefixo sozinho, tratada no `handleMessage` (ver isBarePrefix).
 */
function resolveCommand(client, specs, content) {
  if (!content.startsWith(PREFIX)) return null;

  const tokens = tokenize(content.slice(PREFIX.length));
  const name   = tokens.shift()?.toLowerCase();
  if (!name) return null;

  const command = client.commands.get(name);
  const spec    = specs.get(name);
  if (!command || !spec) return null;

  return { command, spec, args: tokens, name };
}

/**
 * Só o prefixo, nada mais: `k!`.
 *
 * É o único caso em que vale quebrar o silêncio da `resolveCommand`. Quem
 * manda o prefixo sozinho está tateando o bot, e não existe conversa normal
 * que seja exatamente isso. `k!qualquercoisa` continua calado de propósito:
 * ali o texto pode ser qualquer frase que por acaso comece com o prefixo, e
 * responder a cada uma viraria ruído no canal.
 */
function isBarePrefix(content) {
  return content.trim() === PREFIX;
}

/** Por onde começar, para quem acabou de descobrir que o bot existe. */
async function welcome(message) {
  const context = new MessageCommand(message, 'help', { values: new Map(), subcommand: null });

  // Mesmo balde do /help. Em cooldown fica em silêncio em vez de responder
  // "espere Xs": ninguém pediu para executar nada, e trocar o convite por um
  // erro seria pior do que não responder.
  if (cooldowns.check(message.author.id, 'help') > 0) return;

  await context.reply(t(context).prefix_welcome(PREFIX)).catch(() => {});
}

async function handleMessage(client, specs, message) {
  if (message.author.bot || message.webhookId) return;

  const resolved = resolveCommand(client, specs, message.content);
  if (!resolved) {
    if (isBarePrefix(message.content)) await welcome(message);
    return;
  }

  const { command, spec, args, name } = resolved;

  const context = new MessageCommand(message, name, { values: new Map(), subcommand: null });
  const s = t(context);
  const refuse = reason => context.reply(reason).catch(() => {});

  if (!allowedInContext(spec, message))     return refuse(s.prefix_guild_only);
  if (!allowedByPermissions(spec, message)) return refuse(s.prefix_no_permission);

  const wait = cooldowns.check(message.author.id, name);
  if (wait > 0) return refuse(s.cooldown_wait(wait));

  const parsed = await parseArgs(spec, args, message, s);
  if (parsed.error) return refuse(parsed.error);

  context.options = buildOptionAccessors(parsed);

  try {
    await command.execute(context);
  } catch (error) {
    logError(`prefix:${name}`, error);
    await refuse(s.error_generic);
  }
}

/**
 * Liga o modo texto no client. Sem `COMMAND_PREFIX` não faz nada — nem o
 * listener é registrado.
 */
function register(client) {
  if (!ENABLED) return;

  const specs = new Map();
  for (const [name, command] of client.commands) {
    const spec = buildSpec(command);
    if (spec) specs.set(name, spec);
    else console.warn(`[prefix] ${name} usa grupo de subcomando e ficou só no slash.`);
  }

  client.on('messageCreate', message => {
    handleMessage(client, specs, message).catch(error => logError('prefix', error));
  });

  console.log(`[prefix] Modo texto ativo com "${PREFIX}" em ${specs.size} comandos.`);
}

module.exports = { register, INTENTS, PREFIX, ENABLED };
