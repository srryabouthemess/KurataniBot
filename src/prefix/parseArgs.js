/**
 * prefix/parseArgs.js
 * Casa os tokens com as opções declaradas no comando.
 *
 * Três estilos, combináveis na mesma linha:
 *
 *   k!rs pudim2 -daycore     flag: o valor sozinho, sem dizer a opção
 *   k!rs player:pudim2       nomeado, igual ao que se digita no slash
 *   k!rs pudim2              posicional, na ordem em que foram declaradas
 */

const { ApplicationCommandOptionType: OptionType } = require('discord.js');
const { optionsOf, usageFor } = require('./spec');
const { coerce, matchChoice, resolveFlag, listFlags } = require('./coerce');

/**
 * Casa os tokens com as opções declaradas no slash command.
 *
 * Aceita os dois estilos, misturados: nomeado (`player:mrekk`, igual ao que se
 * digita no Discord) e posicional na ordem em que as opções foram declaradas
 * (`k!rs mrekk`). O nomeado tem prioridade — ele é explícito.
 *
 * @returns {Promise<{values: Map, subcommand: string|null} | {error: string}>}
 */
async function parseArgs(spec, tokens, message, s) {
  let subcommand = null;
  let rest = tokens;

  if (spec.subcommands) {
    const wanted = tokens[0]?.toLowerCase();
    if (!wanted || !spec.subcommands.has(wanted)) {
      return { error: s.prefix_usage(usageFor(spec, null)) };
    }
    subcommand = wanted;
    rest = tokens.slice(1);
  }

  const defs   = optionsOf(spec, subcommand);
  const byName = new Map(defs.map(def => [def.name.toLowerCase(), def]));
  const values = new Map();
  const positional = [];

  for (const token of rest) {
    const separator = token.indexOf(':');
    const maybeName = separator > 0 ? token.slice(0, separator).toLowerCase() : null;

    // Só é argumento nomeado se o que vem antes dos dois-pontos for mesmo uma
    // opção — senão um link (`https://osu.ppy.sh/...`) viraria `https:`.
    if (maybeName && byName.has(maybeName)) {
      const def = byName.get(maybeName);
      const result = await coerce(def, token.slice(separator + 1), message, s);
      if (result.error) return { error: result.error };
      values.set(def.name, result.value);
      continue;
    }

    // Flag com hífen: `-daycore`, `-rank`, `-randomize`. O `-\d` de fora é para
    // um número negativo não ser lido como flag.
    if (token.length > 1 && token.startsWith('-') && !/^-[\d.]/.test(token)) {
      const flag = resolveFlag(defs, token.slice(1));
      if (!flag) {
        const accepted = listFlags(defs);
        return {
          error: accepted.length > 0
            ? s.prefix_unknown_flag(token, accepted.join(', '))
            : s.prefix_no_flags(token, usageFor(spec, subcommand)),
        };
      }
      values.set(flag.def.name, flag.value);
      continue;
    }

    // Mesma coisa sem o hífen: `k!pp 10000 randomize` liga o booleano.
    const asFlag = byName.get(token.toLowerCase());
    if (asFlag?.type === OptionType.Boolean) {
      values.set(asFlag.name, true);
      continue;
    }

    positional.push(token);
  }

  for (const def of defs) {
    if (positional.length === 0) break;
    if (values.has(def.name)) continue;

    const raw = positional[0];

    // Uma opção OPCIONAL pode recusar o token e deixar passar para a próxima.
    // Vale para lista fechada (`server`, `status`) e para o que o comando
    // declarar em `prefix.guards` (o `map` do /score).
    //
    // É o que faz `k!c nunca` entender "nunca" como jogador: no slash o `map`
    // vem primeiro, então sem isso ele engoliria o nome e o bot responderia
    // "não consegui identificar o mapa". E `k!rs nome do cara` reclama das
    // aspas em vez de dizer que "do" é um servidor inválido.
    //
    // Sendo obrigatória, a opção consome assim mesmo: aí o erro sobre o valor
    // inválido é justamente o que a pessoa precisa ler.
    if (!def.required) {
      if (def.choices?.length && !matchChoice(def, raw)) continue;

      const guard = spec.guards?.[def.name];
      if (guard && !guard(raw)) continue;
    }

    positional.shift();
    const result = await coerce(def, raw, message, s);
    if (result.error) return { error: result.error };
    values.set(def.name, result.value);
  }

  if (positional.length > 0) {
    return { error: s.prefix_extra_args(usageFor(spec, subcommand)) };
  }

  for (const def of defs) {
    if (def.required && !values.has(def.name)) {
      return { error: s.prefix_missing_option(def.name, usageFor(spec, subcommand)) };
    }
  }

  return { values, subcommand };
}

module.exports = { parseArgs };
