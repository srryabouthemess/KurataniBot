require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client, Collection, GatewayIntentBits, REST, Routes, MessageFlags } = require('discord.js');
const { logError } = require('./logger');
const { t } = require('./i18n');
const db = require('./db');
const cooldowns = require('./cooldowns');
const prefixCommands = require('./prefixCommands');
const mapContext = require('./mapContext');
const emojis = require('./emojis');
const daycoreAdmin = require('./daycoreAdmin');

const client = new Client({
  // INTENTS vem vazio quando o modo texto (`k!comando`) está desligado: ler o
  // conteúdo das mensagens é intent privilegiado, e pedir um intent não
  // habilitado no Developer Portal derruba o login do bot inteiro.
  intents: [GatewayIntentBits.Guilds, ...prefixCommands.INTENTS],
  // O bot nunca precisa mencionar ninguém: as respostas são embeds e texto.
  // Sem isso, qualquer texto de terceiro que o bot ecoe (nome de jogador,
  // metadados de mapa, motivo de moderação) poderia disparar @everyone se um
  // dia passasse por `content` em vez de embed. Barrar na origem é mais
  // seguro do que confiar que todo call site futuro use embed.
  //
  // `repliedUser: false` porque o modo texto responde à mensagem de quem
  // chamou: sem isso, cada comando vira uma notificação para a pessoa.
  allowedMentions: { parse: [], repliedUser: false },
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  client.commands.set(command.data.name, command);
}

// Mesmos comandos, também por texto (`k!rs mrekk`). Não faz nada sem
// COMMAND_PREFIX no .env.
prefixCommands.register(client);

// Link de mapa colado na conversa também vira contexto do canal, para o
// `/score` sem argumento achá-lo. Depende do mesmo intent privilegiado dos
// comandos por texto, então só é ligado junto com eles.
if (prefixCommands.ENABLED) {
  client.on('messageCreate', message => mapContext.watch(message));
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

  try {
    await emojis.sync(client);
  } catch (error) {
    // Sem emoji o bot mostra a grade em texto, então não vale travar o boot.
    logError('emojis', error);
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

    // O texto vem do i18n, como em todo o resto — o caminho do prefixo já
    // respondia traduzido a esta mesma falha, e só o slash saía em português
    // cru para quem usa /language en ou ru.
    //
    // Resolver o idioma lê o banco, e o banco pode ser exatamente o que
    // quebrou (ou já ter sido fechado por um shutdown em curso). Aqui, no
    // último catch antes do usuário, uma segunda exceção significaria não
    // responder nada: daí o fallback.
    let content = 'Erro ao executar o comando.';
    try { content = t(interaction).error_generic; } catch { /* fica o fallback */ }

    // A interação já pode ter sido respondida/deferida dentro do próprio
    // comando antes de falhar — usar reply() nesse caso lança
    // InteractionAlreadyReplied, e como isso roda sem outro catch por perto
    // vira uma unhandled rejection que derruba o processo (Node 15+). O
    // .catch(() => {}) no fim é a rede de segurança final caso a própria
    // interação já tenha expirado (token > 15min).
    const payload = { content, flags: MessageFlags.Ephemeral };
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

// ATENÇÃO à troca embutida aqui: depois de uma exceção não capturada o estado
// do processo é indefinido (conexão meio-fechada, escrita pela metade), e
// seguir rodando pode significar operar sobre estado inconsistente — inclusive
// nos comandos que publicam no servidor de jogo. O correto é sair com código 1
// e deixar um supervisor (systemd, pm2, Docker com restart) subir de novo.
//
// Só que sair SEM supervisor deixa o bot fora do ar até alguém perceber, que é
// exatamente o que este handler foi criado para evitar. Os dois lados têm razão,
// e qual vale depende de uma coisa que o código não tem como saber: se existe
// alguém para reiniciar. Por isso a escolha é de quem hospeda.
//
// O padrão continua sendo seguir rodando, porque é o certo para quem roda o bot
// na própria máquina. Com systemd/pm2/Docker configurado, ligue
// EXIT_ON_UNCAUGHT no .env e o processo passa a sair para ser reiniciado limpo.
const EXIT_ON_UNCAUGHT = /^(1|true|yes|sim)$/i.test((process.env.EXIT_ON_UNCAUGHT ?? '').trim());

process.on('uncaughtException', (error) => {
  logError('uncaughtException', error);

  if (EXIT_ON_UNCAUGHT) {
    console.error('[uncaughtException] EXIT_ON_UNCAUGHT ativo: saindo com código 1 para o supervisor reiniciar.');
    process.exit(1);
  }
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
    await daycoreAdmin.closeRedis().catch(() => {});
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

client.login(process.env.DISCORD_TOKEN).catch(error => {
  // O intent de conteúdo de mensagem é privilegiado: pedir sem habilitar no
  // Developer Portal faz o gateway recusar a conexão inteira, e a mensagem
  // padrão ("Used disallowed intents") não diz o que fazer.
  if (prefixCommands.ENABLED && /disallowed intents/i.test(String(error?.message))) {
    console.error(
      '[login] O Discord recusou os intents. Como o COMMAND_PREFIX está definido,\n' +
      '        o bot pede MESSAGE CONTENT INTENT — habilite em\n' +
      '        Developer Portal > seu app > Bot > Privileged Gateway Intents,\n' +
      '        ou apague o COMMAND_PREFIX do .env para voltar ao modo só slash.'
    );
  }
  logError('login', error);
  process.exit(1);
});
