/**
 * bot/loadCommands.js
 * A única forma de montar a lista de comandos do bot.
 *
 * Antes eram quatro: o index.js, o deploy-commands.js, o smokeCommands.js e o
 * postEmbeds.js liam a pasta cada um do seu jeito, com validações diferentes —
 * e o hash que decide se o registro no Discord mudou era calculado duas vezes.
 * Um comando que carregasse num caminho e não no outro era questão de tempo.
 *
 * O que entra:
 *   - `commands/x.js`          um comando;
 *   - `commands/x/index.js`    um comando que virou pasta (lógica e embed ao lado);
 *   - `commands/grupo/...`     pasta sem index.js é agrupamento, e é percorrida;
 *   - os atalhos de `aliases.js`, montados a partir do comando de origem.
 *
 * Dois modos, porque errar tem custos diferentes em cada lugar:
 *
 *   - tolerante (padrão, o boot): um comando quebrado é pulado e anotado em
 *     `failures`. Perder um comando é bem melhor do que o processo morrer antes
 *     do login e virar loop de restart no supervisor;
 *   - `strict` (o deploy manual): qualquer falha lança. Registrar no Discord uma
 *     lista sem o comando quebrado APAGARIA ele globalmente.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { logError } = require('../lib/logger');
const ALIASES = require('./aliases');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');

/** Os arquivos de comando, em ordem estável (a do nome). */
function commandFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const index = path.join(full, 'index.js');
      if (fs.existsSync(index)) files.push(index);
      else files.push(...commandFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }

  return files;
}

/** O comando de um alias: tudo do original, trocando só nome e descrição. */
function buildAlias(alias, target) {
  const data = {
    ...target.data.toJSON(),
    name: alias.name,
    description: alias.description,
    description_localizations: { 'pt-BR': alias.pt },
  };

  return {
    ...target,
    data: { name: data.name, toJSON: () => data },
    aliasOf: alias.of,
  };
}

/**
 * @param {object}  [options]
 * @param {string}  [options.dir]      pasta dos comandos (outra só em teste)
 * @param {Array}   [options.aliases]  tabela de atalhos (outra só em teste)
 * @param {boolean} [options.strict]   lança na primeira falha em vez de pular
 * @returns {{ commands: Map<string, object>, failures: Array<{ source: string, error: Error }> }}
 */
function loadCommands({ dir = COMMANDS_DIR, aliases = ALIASES, strict = false } = {}) {
  const commands = new Map();
  const failures = [];

  const fail = (source, error) => {
    if (strict) throw error;
    failures.push({ source, error });
    logError(`commands:${source}`, error);
  };

  const add = (source, command) => {
    if (commands.has(command.data.name)) {
      return fail(source, new Error(`nome "${command.data.name}" repetido`));
    }
    commands.set(command.data.name, command);
  };

  for (const file of commandFiles(dir)) {
    const source = path.relative(dir, file);

    let command;
    try {
      command = require(file);
    } catch (error) {
      fail(source, error);
      continue;
    }

    if (!command?.data?.name || typeof command.execute !== 'function') {
      fail(source, new Error(`${source} não exporta data.name e execute`));
      continue;
    }

    add(source, command);
  }

  for (const alias of aliases) {
    const source = `alias:${alias.name}`;
    const target = commands.get(alias.of);

    // Original fora do ar: o atalho cai junto, e a falha já anotada do
    // original é o que explica.
    if (!target) {
      fail(source, new Error(`alias /${alias.name} aponta para /${alias.of}, que não foi carregado`));
      continue;
    }

    if (target.aliasOf) {
      fail(source, new Error(`alias /${alias.name} aponta para outro alias (/${alias.of}); aponte para /${target.aliasOf}`));
      continue;
    }

    add(source, buildAlias(alias, target));
  }

  return { commands, failures };
}

/** O que vai para a API do Discord. */
function commandsPayload(commands) {
  return [...commands.values()].map(command => command.data.toJSON());
}

/**
 * Hash estável do conjunto de comandos. Ordena por nome para não depender da
 * ordem de leitura da pasta — o mesmo conjunto dá sempre o mesmo hash.
 */
function hashCommands(payload) {
  const sorted = [...payload].sort((a, b) => a.name.localeCompare(b.name));
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

module.exports = {
  COMMANDS_DIR,
  loadCommands,
  commandsPayload,
  hashCommands,
};
