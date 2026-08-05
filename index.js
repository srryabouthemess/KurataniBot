require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { logError } = require('./logger');

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

// O registro dos slash commands junto à API do Discord é feito por
// deploy-commands.js (rode `node deploy-commands.js` após adicionar/alterar
// comandos) — o bot em si só precisa carregar os handlers acima e conectar.

client.once('clientReady', () => {
  console.log(`Bot online como ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

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
    const payload = { content: 'Erro ao executar o comando.', ephemeral: true };
    const send = interaction.deferred || interaction.replied
      ? interaction.followUp(payload)
      : interaction.reply(payload);
    await send.catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
