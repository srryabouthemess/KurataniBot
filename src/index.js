require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client, Collection, GatewayIntentBits, REST, Routes, MessageFlags } = require('discord.js');
const { logError } = require('./logger');
const { t } = require('./i18n');
const db = require('./db');
const pp = require('./pp');
const cooldowns = require('./cooldowns');
const prefixCommands = require('./prefixCommands');
const mapContext = require('./mapContext');
const emojis = require('./emojis');
const daycoreAdmin = require('./daycoreAdmin');
const daycoreEvents = require('./daycoreEvents');
const announce = require('./announce');
const { forGuild } = require('./i18n');

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

// Cada arquivo é validado antes de entrar: um helper solto nesta pasta, ou um
// comando com erro de sintaxe, fazia `command.data.name` estourar aqui e o
// processo morrer ANTES do login. Sob supervisor isso não é uma falha visível —
// é loop de restart, e o bot fica fora do ar até alguém ler o log. Perder um
// comando é bem melhor do que perder o bot inteiro por causa dele.
for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);

  let command;
  try {
    command = require(filePath);
  } catch (error) {
    logError(`commands:${file}`, error);
    continue;
  }

  if (!command?.data?.name || typeof command.execute !== 'function') {
    console.warn(`[commands] ${file} ignorado: não exporta data.name e execute.`);
    continue;
  }

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

/**
 * Anuncia o que foi rankeado dentro do jogo.
 *
 * Sem interação por trás: o idioma vem do servidor administrado, e não da
 * preferência de alguém — ninguém rodou comando nenhum aqui.
 */
async function announceGameRank(client, evento) {
  const s = forGuild(process.env.DAYCORE_GUILD_ID);
  await announce.announceGameStatus(client, evento, s);
}

/**
 * Anuncia o cargo que foi dado ou tirado dentro do jogo.
 *
 * Mesmo idioma e mesmo motivo do anúncio de mapa: não há interação por trás.
 */
async function announceGamePriv(client, evento) {
  const s = forGuild(process.env.DAYCORE_GUILD_ID);
  await announce.announcePrivChange(client, evento, s);
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

  // Mapa rankeado PELO JOGO (`!map`) também vira anúncio. O bancho já publica
  // esse evento; até aqui ninguém escutava, e ele se perdia.
  //
  // Cargo mexido pelo jogo (`!addpriv`/`!rmpriv`) segue o mesmo caminho, e por
  // um motivo mais forte: esses dois não passam por receptor nenhum no
  // servidor, então nem a auditoria dele registra — ver announce.js.
  try {
    await daycoreEvents.listen({
      onStatusChange: evento => announceGameRank(client, evento),
      onPrivChange:   evento => announceGamePriv(client, evento),
    });
  } catch (error) {
    // Extra: sem isto o bot segue inteiro, só não anuncia o que foi feito
    // in-game — o que passa pelo /nominate continua saindo normalmente.
    logError('daycoreEvents', error);
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

  // Cada peça é fechada por conta própria, e a falha de uma NÃO cancela as
  // seguintes. Num try só, uma exceção no `client.destroy()` pulava tudo que
  // vinha depois — os três motores ficavam órfãos e o banco fechava só pelo
  // `process.exit`, sem checkpoint. Justamente no caminho em que algo já deu
  // errado é que o resto mais precisa acontecer.
  //
  // A ORDEM continua importando, e é por isso que são etapas em sequência e não
  // um Promise.all: o gateway sai primeiro, para não atender uma interação com o
  // banco já fechado, e o banco fecha por último.
  //
  // Os três motores de cálculo são recursos de vida longa — dois processos
  // (Python e lazer-calculator) e um worker thread (rosu-pp). Sem fechá-los
  // aqui, ficariam órfãos a cada restart.
  //
  // O do lazer-calculator termina em segfault por dentro, sempre: é o runtime
  // .NET dele que não descarrega, e foi por isso que ele virou processo em vez
  // de thread (ver lazerWorkerChild.js). Como filho, ele leva o próprio
  // estrago — o `db.close()` do fim continua acontecendo, que era exatamente o
  // que a versão em thread impedia.
  const etapas = [
    ['gateway',      () => client.destroy()],
    ['eventos',      () => daycoreEvents.close()],
    ['redis',        () => daycoreAdmin.closeRedis()],
    ['python',       () => pp.closePythonWorker()],
    ['rosu',         () => pp.closeRosuWorker()],
    ['lazer',        () => pp.closeLazerWorker()],
    ['banco',        () => db.close()],
  ];

  for (const [nome, fechar] of etapas) {
    try {
      await fechar();
    } catch (error) {
      logError(`shutdown:${nome}`, error);
    }
  }

  console.log('[shutdown] Concluído.');
  process.exit(0);
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
