/**
 * Teste de fumaça dos COMANDOS: chama o `execute` de cada um com uma interação
 * simulada, contra as APIs de verdade.
 *
 * O `smoke.js` ao lado exercita a camada de cliente (osuClient) — se o servidor
 * responde e o adaptador entende. Este vai um degrau acima: é o mesmo caminho
 * que o Discord dispararia, incluindo resolução de link, cooldown, i18n,
 * enriquecimento, cálculo de PP e montagem do embed.
 *
 * ── O que ele NÃO cobre ───────────────────────────────────────────────────────
 * O que é do Discord continua sendo do Discord: validação de opção, permissão
 * por cargo/canal, renderização do embed, e o clique nos botões de paginação
 * (aqui o coletor é um stub — a primeira página é montada, as outras não).
 *
 * ── Comandos administrativos ──────────────────────────────────────────────────
 * Rodam, mas só para provar que RECUSAM. Eles publicam no Redis do servidor de
 * jogo do amigo, e disparar de verdade daqui mudaria o servidor dele. Sem
 * DAYCORE_GUILD_ID no `.env`, o staffGuard recusa antes de qualquer publicação —
 * e é isso que se confere.
 *
 * Fica FORA do `npm test`, como o smoke.js: depende de rede, de credencial e de
 * os servidores estarem no ar, então uma falha aqui não quer dizer que o código
 * regrediu. Rode com `npm run smoke:commands`.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const servers = require('../src/servers');
const pp = require('../src/pp');
const db = require('../src/db');

// Um Discord id que não é de ninguém: os comandos que leem link vão achar vazio
// e cair no caminho "sem link", que é o que queremos exercitar sem mexer no
// cadastro real de quem roda isto.
const USER_ID = '900000000000000001';

// Por NAMESPACE, e não por chave de servidor: a variante RX compartilha a conta
// com o servidor pai (ver servers.js), então herda o jogador automaticamente.
// Chaveado por servidor, `akatsuki_rx` caía no default e procurava um jogador do
// Daycore no Akatsuki — o mesmo defeito que o smoke.js tinha.
const PLAYERS = { official: 'kuratani', akatsuki: '47379', daycore: 'pudim2' };
const jogadorDe = (server) => PLAYERS[servers.namespace(server.key)] ?? 'pudim2';
const MAPA = 1103981;

/** Os comandos registrados, como o index.js os monta — o /help confere contra isto. */
function comandosRegistrados() {
  const dir = path.join(__dirname, '..', 'src', 'commands');
  const nomes = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .map(f => require(path.join(dir, f)).data.name);
  return new Map(nomes.map(n => [n, true]));
}

/** Uma interação com o que os comandos de fato tocam. */
function fakeInteraction(opcoes = {}, { subcommand = null, guildId = '111' } = {}) {
  const enviado = [];

  const mensagem = {
    // A paginação cria um coletor sobre a mensagem devolvida pelo editReply.
    // Sem clique nenhum, a primeira página é o que se consegue verificar aqui.
    createMessageComponentCollector: () => ({ on: () => {} }),
  };

  const get = (nome) => opcoes[nome] ?? null;

  const interaction = {
    id: '1',
    user: { id: USER_ID, username: 'smoke' },
    guildId,
    channelId: '222',
    commandName: 'smoke',
    deferred: false,
    replied: false,
    memberPermissions: { has: () => false },
    client: {
      // URL de verdade: o EmbedBuilder valida, e string vazia num setThumbnail
      // faz o /help estourar com "Received one or more errors".
      user: { id: '2', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' },
      users: { fetch: async (id) => ({ id }) },
      // O /help confere o catálogo contra o que está registrado de verdade.
      commands: comandosRegistrados(),
    },

    options: {
      getString:  get,
      getInteger: get,
      getNumber:  get,
      getBoolean: get,
      getUser:    get,
      getSubcommand: () => subcommand,
    },

    async deferReply() { interaction.deferred = true; },
    async reply(p)     { interaction.replied = true; enviado.push(p); return mensagem; },
    async editReply(p) { enviado.push(p); return mensagem; },
    async followUp(p)  { enviado.push(p); return mensagem; },
  };

  return { interaction, enviado };
}

/** Resume o que o comando respondeu, numa linha. */
function resumir(enviado) {
  if (enviado.length === 0) return '(nada respondido)';

  const p = enviado[enviado.length - 1];
  if (typeof p === 'string') return p.replace(/\s+/g, ' ').slice(0, 90);

  const embed = p.embeds?.[0];
  if (embed) {
    const j = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
    const titulo = j.title ?? j.author?.name ?? '(sem título)';
    const corpo  = (j.description ?? j.fields?.map(f => f.value).join(' ') ?? '').replace(/\s+/g, ' ');
    return `${titulo} | ${corpo.slice(0, 70)}`;
  }

  return String(p.content ?? JSON.stringify(p)).replace(/\s+/g, ' ').slice(0, 90);
}

const casos = [];
const caso = (nome, arquivo, opcoes, extra) => casos.push({ nome, arquivo, opcoes, extra });

// ── Consulta: uma vez por servidor configurado ────────────────────────────────
for (const server of servers.all()) {
  const player = jogadorDe(server);
  caso(`/profile  ${server.label}`, 'profile.js', { player, server: server.key });
  caso(`/topplays ${server.label}`, 'topplays.js', { player, server: server.key });
  caso(`/recent   ${server.label}`, 'recent.js', { player, server: server.key });
  // Este não depende de jogador, mas depende do servidor: é o único comando que
  // chama `leaderboard` no adaptador, e cada tipo o serve de um endpoint
  // diferente (ver osu/).
  caso(`/leaderboard ${server.label}`, 'leaderboard.js', { server: server.key });
  // Nos servidores que não são bancho.py o esperado é a recusa explicando por
  // quê — e ela também precisa continuar saindo.
  caso(`/topscores ${server.label}`, 'topscores.js', { server: server.key });
}

// ── Cálculo: não dependem de jogador ──────────────────────────────────────────
caso('/pp',       'pp.js',       { map: String(MAPA), acc: 98 });
caso('/simulate', 'simulate.js', { map: String(MAPA), mods: 'HDDT', acc: 99 });
caso('/whatif',   'whatif.js',   { player: PLAYERS.official, pp: 500 });
caso('/score',    'score.js',    { player: PLAYERS.official, map: String(MAPA) });
caso('/compare',  'compare.js',  { player: PLAYERS.official, map: String(MAPA) });

// ── Sem rede ──────────────────────────────────────────────────────────────────
caso('/help',     'help.js',     {});
caso('/diag',     'diag.js',     {});
caso('/language', 'language.js', {}, { subcommand: 'status' });
caso('/link',     'link.js',     {}, { subcommand: 'status' });

// ── Administrativos: só para conferir que RECUSAM ─────────────────────────────
caso('/nominate (recusa)', 'nominate.js', { map: '1' }, { subcommand: 'queue', esperaRecusa: true });
caso('/moderate (recusa)', 'moderate.js', { player: '1' }, { subcommand: 'log', esperaRecusa: true });
caso('/staff    (recusa)', 'staff.js',    {}, { subcommand: 'list', esperaRecusa: true });
caso('/wipe     (recusa)', 'wipe.js',     { player: '1', mode: '0', reason: 'x' }, { esperaRecusa: true });

(async () => {
  let falhas = 0;

  for (const { nome, arquivo, opcoes, extra = {} } of casos) {
    const comando = require(path.join(__dirname, '..', 'src', 'commands', arquivo));
    const { interaction, enviado } = fakeInteraction(opcoes, extra);

    const inicio = Date.now();
    let erro = null;
    try {
      await comando.execute(interaction);
    } catch (e) {
      erro = e;
    }
    const ms = Date.now() - inicio;

    const resumo = resumir(enviado);
    const recusou = /❌|apenas|somente|not configured|não está configurado|no configurad/i.test(resumo);

    let marca;
    if (erro) {
      marca = 'ERRO ';
      falhas++;
    } else if (extra.esperaRecusa) {
      // Aqui recusar é o resultado CERTO: significa que a trava agiu antes de
      // qualquer escrita no servidor de jogo.
      marca = recusou ? 'ok   ' : 'ALERTA';
      if (!recusou) falhas++;
    } else if (enviado.length === 0) {
      marca = 'ALERTA';
      falhas++;
    } else {
      marca = 'ok   ';
    }

    console.log(`${marca} ${nome.padEnd(26)} ${String(ms).padStart(5)}ms  ${erro ? erro.message : resumo}`);
  }

  console.log(`\n${casos.length} comandos exercitados, ${falhas} problema(s).`);

  // Os dois motores de PP são de vida longa; sem fechá-los o processo não sai.
  pp.closePythonWorker();
  pp.closeRosuWorker();
  db.close();
  process.exit(falhas === 0 ? 0 : 1);
})();
