/**
 * prefix/coerce.js
 * Texto cru → o valor que `options.getX()` devolveria.
 *
 * É aqui que as validações do slash command são repetidas: choices, faixa
 * numérica, tamanho. Sem isso o modo texto seria um caminho para driblá-las.
 */

const { ApplicationCommandOptionType: OptionType } = require('discord.js');

const TRUTHY = new Set(['true', 'sim', 's', 'yes', 'y', '1', 'on']);
const FALSY  = new Set(['false', 'nao', 'n\u00E3o', 'n', 'no', '0', 'off']);

function describeRange(def) {
  const { min_value: min, max_value: max } = def;
  if (min != null && max != null) return `${min} – ${max}`;
  if (min != null) return `≥ ${min}`;
  return `≤ ${max}`;
}

function matchChoice(def, raw) {
  const wanted = raw.toLowerCase();
  const squash = str => String(str).toLowerCase().replace(/\s+/g, '');

  return def.choices.find(choice =>
    String(choice.value).toLowerCase() === wanted ||
    choice.name.toLowerCase() === wanted ||
    // "daycorerx" para a choice "Daycore RX": quem digita não usa espaço.
    squash(choice.name) === squash(raw)
  );
}

/**
 * Resolve uma flag `-alguma-coisa`.
 *
 * A flag não diz qual opção está sendo preenchida, e sim o valor: `-daycore`
 * acha sozinho que quem tem essa escolha é o `server`. Funciona porque as
 * opções de lista fechada do bot têm valores distintos entre si — e é o que
 * deixa escrever `k!rs pudim2 -daycore` sem repetir "server".
 *
 * @returns {{def: object, value: any}|null}
 */
function resolveFlag(defs, word) {
  for (const def of defs) {
    if (!def.choices?.length) continue;
    const choice = matchChoice(def, word);
    if (choice) return { def, value: choice.value };
  }

  for (const def of defs) {
    if (def.type === OptionType.Boolean && def.name.toLowerCase() === word.toLowerCase()) {
      return { def, value: true };
    }
  }

  return null;
}

/** Flags que o comando aceita, para a mensagem de erro. */
function listFlags(defs) {
  const flags = [];
  for (const def of defs) {
    if (def.choices?.length) {
      flags.push(...def.choices.map(c => `\`-${c.name.toLowerCase().replace(/\s+/g, '')}\``));
    } else if (def.type === OptionType.Boolean) {
      flags.push(`\`-${def.name}\``);
    }
  }
  return flags;
}

/**
 * Converte o texto cru no valor que `options.getX()` devolveria.
 * @returns {Promise<{value: any} | {error: string}>} erro já traduzido
 */
async function coerce(def, raw, message, s) {
  if (def.choices?.length) {
    const choice = matchChoice(def, raw);
    if (!choice) {
      const accepted = def.choices.map(c => `\`${c.value}\``).join(', ');
      return { error: s.prefix_invalid_choice(def.name, accepted) };
    }
    return { value: choice.value };
  }

  switch (def.type) {
    case OptionType.Integer: {
      if (!/^[+-]?\d+$/.test(raw)) return { error: s.prefix_invalid_integer(def.name) };
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) return { error: s.prefix_invalid_integer(def.name) };
      if ((def.min_value != null && value < def.min_value) ||
          (def.max_value != null && value > def.max_value)) {
        return { error: s.prefix_out_of_range(def.name, describeRange(def)) };
      }
      return { value };
    }

    case OptionType.Number: {
      const texto = raw.trim().replace(',', '.');
      // O teste de vazio é separado, e não é redundante: `Number('')` é **0**, e
      // `Number.isFinite(0)` é verdadeiro. Sem ele, `k!pp target:` (ou um token
      // de aspas vazias) vira o número zero em vez de erro — o mesmo `Number('')`
      // que o `num()` do topFilter já guarda pelo mesmo motivo. O ramo Integer
      // aqui do lado nunca teve o furo, porque a regex dele recusa vazio.
      //
      // Hoje as três opções numéricas do bot têm `min_value: 1`, então o zero
      // cai no teste de faixa logo abaixo e não chega a virar um cálculo — mas
      // quem digitou lê "fora do intervalo (≥ 1)" para um campo que ficou EM
      // BRANCO, e a próxima opção sem mínimo aceitaria o zero calada.
      if (!texto) return { error: s.prefix_invalid_number(def.name) };

      const value = Number(texto);
      if (!Number.isFinite(value)) return { error: s.prefix_invalid_number(def.name) };
      if ((def.min_value != null && value < def.min_value) ||
          (def.max_value != null && value > def.max_value)) {
        return { error: s.prefix_out_of_range(def.name, describeRange(def)) };
      }
      return { value };
    }

    case OptionType.Boolean: {
      const lowered = raw.toLowerCase();
      if (TRUTHY.has(lowered)) return { value: true };
      if (FALSY.has(lowered))  return { value: false };
      return { error: s.prefix_invalid_boolean(def.name) };
    }

    case OptionType.User: {
      const id = raw.match(/^<@!?(\d{17,20})>$/)?.[1] ?? raw.match(/^\d{17,20}$/)?.[0];
      if (!id) return { error: s.prefix_user_not_found(def.name) };

      // A menção já vem resolvida na mensagem; o fetch é só para quando a
      // pessoa colou o ID puro.
      const user = message.mentions.users.get(id)
        ?? await message.client.users.fetch(id).catch(() => null);
      if (!user) return { error: s.prefix_user_not_found(def.name) };
      return { value: user };
    }

    default: {
      if (def.max_length != null && raw.length > def.max_length) {
        return { error: s.prefix_too_long(def.name, def.max_length) };
      }
      if (def.min_length != null && raw.length < def.min_length) {
        return { error: s.prefix_too_short(def.name, def.min_length) };
      }
      return { value: raw };
    }
  }
}

module.exports = { coerce, matchChoice, resolveFlag, listFlags };
