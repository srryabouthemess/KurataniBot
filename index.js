require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client, Collection, GatewayIntentBits, REST, Routes, MessageFlags } = require('discord.js');
const { logError } = require('./logger');
const { t } = require('./i18n');
const db = require('./db');
const cooldowns = require('./cooldowns');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  client.commands.set(command.data.name, command);
}

/**
 * Hash estável do conjunto de comandos. Ordena por nome porque index.js e
 * deploy-commands.js montam a lista de formas diferentes — sem ordenar, os
 * dois poderiam gerar hashes distintos para o mesmo conjunto.
 */
function hashCommands(payload) {
  const sorted = [...payload].sort((a, b) => a.name.localeCompare(b.name));
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Registra os slash commands na API do Discord, mas só quando o conjunto
 * mudou de verdade.
 *
 * Antes isso era manual (`node deploy-commands.js`) e era fácil esquecer
 * depois de alterar um comando — o bot rodava com a assinatura antiga no
 * Discord. Registrar a cada boot resolveria, mas gastaria uma chamada de API
 * em todo restart, então comparamos um hash do payload com o último
 * registrado (guardado em bot.db).
 *
 * deploy-commands.js continua funcionando para forçar um registro manual.
 */
async function syncCommandsIfChanged() {
  const payload = [...client.commands.values()].map(c => c.data.toJSON());
  const hash = hashCommands(payload);

  if (db.getMeta('commands_hash') === hash) return;

  console.log('[deploy] Conjunto de comandos mudou, registrando...');
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: payload });
  db.setMeta('commands_hash', hash);
  console.log(`[deploy] ${payload.length} comandos registrados globalmente.`);
}

client.once('clientReady', async () => {
  console.log(`Bot online como ${client.user.tag}`);

  try {
    await syncCommandsIfChanged();
  } catch (error) {
    // Falhar aqui não deve impedir o bot de atender: os comandos antigos
    // continuam registrados no Discord e funcionando.
    logError('deploy', error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Cooldown por usuário: o rate limiter global protege a API do osu!, mas não
  // impede uma pessoa de monopolizar a fila e atrasar todo mundo.
  const wait = cooldowns.check(interaction.user.id, interaction.commandName);
  if (wait > 0) {
    const s = t(interaction);
    return interaction
      .reply({ content: s.cooldown_wait(wait), flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logError(`command:${interaction.commandName}`, error);

    // A interação já pode ter sido respondida/deferida dentro do próprio
    // comando antes de falhar — usar reply() nesse caso lança
    // InteractionAlreadyReplied, e como isso roda sem outro catch por perto
    // vira uma unhandled rejection que derruba o processo (Node 15+). O
    // .catch(() => {}) no fim é a rede de segurança final caso a própria
    // interação já tenha expirado (token > 15min).
    const payload = { content: 'Erro ao executar o comando.', flags: MessageFlags.Ephemeral };
    const send = interaction.deferred || interaction.replied
      ? interaction.followUp(payload)
      : interaction.reply(payload);
    await send.catch(() => {});
  }
});

// ─── Robustez do processo ─────────────────────────────────────────────────────
// Sem estes handlers, uma promise rejeitada fora do try/catch de comando
// derrubava o processo inteiro (Node 15+) e o bot ficava fora do ar até alguém
// perceber. Logamos e seguimos: uma falha isolada não deve matar o bot.
process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason);
});

process.on('uncaughtException', (error) => {
  logError('uncaughtException', error);
});

// ─── Encerramento gracioso ────────────────────────────────────────────────────
let shuttingDown = false;

async function shutdown(signal) {
  // Segundo sinal força a saída, como no BathBot.
  if (shuttingDown) {
    console.log(`\n[shutdown] ${signal} recebido de novo, forçando saída.`);
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`\n[shutdown] ${signal} recebido, encerrando...`);

  try {
    // Desconecta do gateway antes de fechar o banco, para não atender uma
    // interação com o db já fechado.
    await client.destroy();
    db.close();
    console.log('[shutdown] Concluído.');
  } catch (error) {
    logError('shutdown', error);
  } finally {
    process.exit(0);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

client.login(process.env.DISCORD_TOKEN);
