/**
 * Manda os embeds dos comandos para um canal do Discord, para conferir como
 * eles FICAM — o que nenhum teste automatizado responde.
 *
 * ── O que isto é, e o que não é ───────────────────────────────────────────────
 * NÃO é o Discord executando o comando. Fazer isso exigiria automatizar a conta
 * de usuário de alguém, o que viola o ToS do Discord e põe a conta em risco.
 *
 * O que roda é o `execute` de verdade de cada comando — mesma resolução de link,
 * cooldown, i18n, enriquecimento e cálculo de PP —, com um adaptador de interação
 * cujo `reply`/`editReply` **envia ao canal** em vez de guardar em memória. O
 * embed é montado pelo código de produção e renderizado pelo Discord de verdade;
 * o que é simulado é só quem clicou.
 *
 * É o mesmo desenho do `prefixCommands`, que já embrulha uma `Message` com a
 * superfície de interação para reaproveitar os comandos sem reescrevê-los.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────────
 *   node test/postEmbeds.js <canalId>              → só relata o canal, não envia
 *   node test/postEmbeds.js <canalId> --enviar     → envia
 *   node test/postEmbeds.js <canalId> --enviar --so=topplays,recent
 *   node test/postEmbeds.js <canalId> --enviar --dono=<seuDiscordId>
 *
 * O `--enviar` é obrigatório de propósito: sem ele o script não escreve nada.
 * Mandar duas dezenas de mensagens no canal errado é fácil e chato de desfazer.
 *
 * O `--dono` faz os botões ◀️ ▶️ funcionarem para aquele Discord: a paginação só
 * aceita clique de quem "rodou" o comando. Sem ele os botões aparecem, e
 * ignoram todo mundo.
 *
 * Comandos administrativos ficam FORA: eles escrevem no servidor de jogo.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');

const servers = require('../src/servers');
const pp = require('../src/pp');
const db = require('../src/db');

const [canalId, ...flags] = process.argv.slice(2);
const ENVIAR = flags.includes('--enviar');
const DONO   = (flags.find(f => f.startsWith('--dono=')) ?? '').split('=')[1] || null;
const FILTRO = (flags.find(f => f.startsWith('--so=')) ?? '').split('=')[1]?.split(',') ?? null;

if (!canalId) {
  console.error('uso: node test/postEmbeds.js <canalId> [--enviar] [--dono=<id>] [--so=a,b]');
  process.exit(1);
}

const PLAYERS = { official: 'kuratani', akatsuki: '47379', daycore: 'pudim2' };
const jogadorDe = (s) => PLAYERS[servers.namespace(s.key)] ?? 'pudim2';
const MAPA = 1103981;

const casos = [];
const caso = (nome, arquivo, opcoes, extra) => casos.push({ nome, arquivo, opcoes, extra });

for (const server of servers.all()) {
  const player = jogadorDe(server);
  caso(`profile ${server.key}`,  'profile.js',  { player, server: server.key });
  caso(`topplays ${server.key}`, 'topplays.js', { player, server: server.key });
  caso(`recent ${server.key}`,   'recent.js',   { player, server: server.key });
  caso(`leaderboard ${server.key}`, 'leaderboard.js', { server: server.key });
}
caso('pp',       'pp.js',       { player: PLAYERS.official, target: 6000 });
caso('simulate', 'simulate.js', { map: String(MAPA), mods: 'HDDT', acc: 99 });
caso('whatif',   'whatif.js',   { player: PLAYERS.official, pp: 500 });
caso('score',    'score.js',    { player: PLAYERS.official, map: String(MAPA) });
caso('compare',  'compare.js',  { user1: PLAYERS.official, user2: 'mrekk' });
caso('help',     'help.js',     {});
caso('diag',     'diag.js',     {});

/**
 * Interação que responde NO CANAL.
 *
 * `flags` é descartado: efêmero só existe dentro de interação, e mandá-lo para
 * um `channel.send` faz o Discord recusar a mensagem inteira. É a mesma decisão
 * do adaptador do prefixo (ver prefix/MessageCommand.js).
 */
function interacaoNoCanal(canal, client, opcoes, { subcommand = null } = {}) {
  const get = (nome) => opcoes[nome] ?? null;
  const limpar = (p) => {
    const payload = typeof p === 'string' ? { content: p } : { ...p };
    delete payload.flags;
    return payload;
  };

  let ultima = null;

  const interaction = {
    id: '1',
    // O dono decide de quem a paginação aceita clique.
    user: { id: DONO ?? client.user.id, username: 'smoke' },
    guildId: canal.guild?.id ?? null,
    channelId: canal.id,
    channel: canal,
    client,
    commandName: 'post',
    deferred: false,
    replied: false,
    memberPermissions: { has: () => false },

    options: {
      getString: get, getInteger: get, getNumber: get,
      getBoolean: get, getUser: get,
      getSubcommand: () => subcommand,
    },

    async deferReply() { interaction.deferred = true; },

    async reply(p) {
      interaction.replied = true;
      ultima = await canal.send(limpar(p));
      return ultima;
    },

    // O primeiro editReply cria a mensagem; os seguintes editam a mesma, que é
    // o que faz a paginação funcionar de verdade aqui.
    async editReply(p) {
      ultima = ultima ? await ultima.edit(limpar(p)) : await canal.send(limpar(p));
      return ultima;
    },

    async followUp(p) { return canal.send(limpar(p)); },
  };

  return interaction;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// O /help confere o catálogo contra `client.commands`, que o index.js monta no
// boot. Aqui o Client é cru, então a coleção precisa ser montada do mesmo jeito
// — sem ela o comando estoura em `available.has(...)`.
client.commands = new Collection();
for (const arquivo of fs.readdirSync(path.join(__dirname, '..', 'src', 'commands')).filter(f => f.endsWith('.js'))) {
  const comando = require(path.join(__dirname, '..', 'src', 'commands', arquivo));
  if (comando?.data?.name) client.commands.set(comando.data.name, comando);
}

client.once('clientReady', async () => {
  console.log(`bot: ${client.user.tag}\n`);

  let canal;
  try {
    canal = await client.channels.fetch(canalId);
  } catch (e) {
    console.error(`não consegui acessar o canal ${canalId}: ${e.message}`);
    return encerrar(1);
  }

  const eu = canal.guild ? await canal.guild.members.fetchMe() : null;
  const perms = eu ? canal.permissionsFor(eu) : null;

  console.log(`canal:    #${canal.name} (${canal.id})`);
  console.log(`servidor: ${canal.guild?.name ?? '(DM)'} (${canal.guild?.id ?? '-'})`);
  if (perms) {
    console.log(`permissão: escrever=${perms.has(PermissionFlagsBits.SendMessages)} embed=${perms.has(PermissionFlagsBits.EmbedLinks)}`);
  }

  const lista = FILTRO ? casos.filter(c => FILTRO.some(f => c.nome.startsWith(f))) : casos;

  if (!ENVIAR) {
    console.log(`\n${lista.length} comandos seriam enviados:`);
    for (const c of lista) console.log(`  /${c.nome}`);
    console.log('\n(nada foi enviado — passe --enviar para valer)');
    return encerrar(0);
  }

  console.log(`\nenviando ${lista.length} comandos...\n`);
  let falhas = 0;

  for (const { nome, arquivo, opcoes, extra = {} } of lista) {
    const comando = require(`../src/commands/${arquivo}`);
    const interaction = interacaoNoCanal(canal, client, opcoes, extra);

    try {
      // Um cabeçalho antes de cada um, senão vira uma parede de embeds sem
      // saber qual comando produziu qual.
      await canal.send(`\`/${nome}\``);
      await comando.execute(interaction);
      console.log(`ok    /${nome}`);
    } catch (e) {
      falhas++;
      console.log(`ERRO  /${nome}: ${e.message}`);
    }

    // O Discord limita 5 mensagens por 5s por canal; sem folga, as últimas
    // tomariam 429 e sumiriam.
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n${lista.length} enviados, ${falhas} falha(s).`);
  // A paginação fica viva 2 min; sem esta espera o processo morre antes e os
  // botões não respondem a clique nenhum.
  if (DONO) {
    console.log('botões ativos por 2 min (--dono informado); Ctrl+C encerra antes.');
    await new Promise(r => setTimeout(r, 125000));
  }
  encerrar(falhas === 0 ? 0 : 1);
});

async function encerrar(codigo) {
  await client.destroy();
  pp.closePythonWorker();
  pp.closeRosuWorker();
  db.close();
  process.exit(codigo);
}

client.login(process.env.DISCORD_TOKEN);
