/**
 * prefix/spec.js
 * O que o parser precisa saber sobre um comando, tirado do próprio
 * `data.toJSON()` dele.
 *
 * Derivar em vez de declarar à mão é o que impede os dois modos de divergirem:
 * mudar uma opção no SlashCommandBuilder e esquecer daqui deixaria o comando
 * escrito aceitando algo que o slash já não aceita.
 */

const { ApplicationCommandOptionType: OptionType } = require('discord.js');
const { PREFIX } = require('./config');

// ─── Especificação de cada comando ────────────────────────────────────────────

/**
 * Converte o JSON do slash command no que o parser precisa.
 * Devolve null para comandos que o modo texto não sabe representar.
 */
function buildSpec(command) {
  const json    = command.data.toJSON();
  const options = json.options ?? [];

  // Comando que responde em efêmero não pode existir em texto.
  //
  // Efêmero só existe dentro de interação: o adaptador precisa tirar a flag
  // (ver toMessagePayload), e aí a resposta que só o autor veria vira mensagem
  // no canal. A trava de privilégio continua valendo, então não é escalada —
  // é o log de moderação, com alvo e motivo, aparecendo para quem estiver
  // lendo o canal. Quem declara é o próprio comando, porque só ele sabe como
  // responde.
  if (command.prefix?.slashOnly) return null;

  // Grupos de subcomando (`/cmd grupo sub opções`) ninguém usa hoje. Em vez de
  // fingir que entende e resolver errado, o comando simplesmente não ganha
  // versão em texto — e o aviso no boot conta o porquê.
  if (options.some(o => o.type === OptionType.SubcommandGroup)) return null;

  const subs = options.filter(o => o.type === OptionType.Subcommand);

  return {
    name: json.name,
    contexts: json.contexts ?? null,
    // Bitfield que o Discord exige para o slash command aparecer. Aqui ele
    // precisa ser conferido na mão (ver allowedByPermissions).
    defaultMemberPermissions: json.default_member_permissions ?? null,
    // Guardas declaradas pelo próprio comando (ver `prefix.guards` no score.js).
    guards: command.prefix?.guards ?? null,
    subcommands: subs.length > 0
      ? new Map(subs.map(sub => [sub.name, sub.options ?? []]))
      : null,
    options: subs.length > 0 ? null : options,
  };
}

function optionsOf(spec, subcommand) {
  return spec.subcommands ? (spec.subcommands.get(subcommand) ?? []) : spec.options;
}

/** Linha de uso, no formato `k!link set <player> [server]`. */
function usageFor(spec, subcommand) {
  const head = `${PREFIX}${spec.name}`;

  if (spec.subcommands && !subcommand) {
    return `${head} <${[...spec.subcommands.keys()].join('|')}>`;
  }

  const parts = [head];
  if (subcommand) parts.push(subcommand);
  for (const def of optionsOf(spec, subcommand)) {
    parts.push(def.required ? `<${def.name}>` : `[${def.name}]`);
  }
  return parts.join(' ');
}

module.exports = { buildSpec, optionsOf, usageFor };
