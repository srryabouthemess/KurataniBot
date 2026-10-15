/**
 * /matchlive — acompanha uma partida multiplayer ao vivo num canal.
 *
 * Este arquivo só decide se o track pode começar (permissão, servidor,
 * limites, partida privada) e grava no SQLite; quem posta no canal é o poller
 * único de src/matchlive/poller.js, ligado no boot pelo `iniciar` daqui.
 *
 * O `iniciar` mora no comando, e não no index.js, porque o test/architecture
 * não deixa o i18n fora de commands/ nem o index.js importar um comando: o
 * index.js acha este pelo Map do loadCommands.
 *
 * Fase 1: só o servidor com as partidas no MySQL (o Daycore). O Bancho
 * responde "em breve" em vez de "não suportado", porque vai chegar.
 */

const {
  SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const servers = require('../../../servers');
const db = require('../../../db');
const daycoreMysql = require('../../../daycoreMysql');
const { resolveServer } = require('../../../userLink');
const { t, forGuild } = require('../../../i18n');
const { logError } = require('../../../lib/logger');
const { safeEditReply } = require('../../../replies');
const { exigirSubcomando } = require('../../../subcommands');
const { parseMatchInput, podeVerPartida } = require('../../../multiplayer/logic');
const { jogouNela } = require('../../../multiplayer/daycore');
const matchlive = require('../../../matchlive');
const osu = require('../../../osuClient');
const emojis = require('../../../emojis');

function opcaoMatch(sub, obrigatoria = true) {
  return sub.addStringOption(option =>
    option
      .setName('match')
      .setDescription('Match link or id')
      .setDescriptionLocalizations({ 'pt-BR': 'Link ou id da partida' })
      .setRequired(obrigatoria)
      .setMaxLength(200)
  );
}

const efemero = content => ({ content, flags: MessageFlags.Ephemeral });

/** Capa e duração do mapa pela API do osu!; null em mapa custom/desconhecido. */
async function infoDoMapa(mapId) {
  const bm = await osu.getBeatmap(mapId);
  if (!bm) return null;
  return {
    setId: bm.beatmapset_id ?? bm.beatmapset?.id ?? null,
    segundos: Number.isFinite(bm.total_length) ? bm.total_length : null,
  };
}

/**
 * `/matchlive untrack` sem `match`: para a única partida do canal. Com zero ou
 * mais de uma, pede o id.
 */
function untrackSemId(interaction, s) {
  const tracks = db.listTracksByChannel(interaction.channelId);
  if (tracks.length !== 1) return interaction.reply(efemero(s.matchlive_untrack_need_id));
  const [tr] = tracks;
  db.removeTrack(tr.channelId, tr.server, tr.matchId);
  return interaction.reply(efemero(s.matchlive_untracked(tr.matchId)));
}

/**
 * O estado inicial com o histórico, como o Bathbot ao começar: até
 * LIMITE_HISTORICO mensagens, uma delas o log do passado (as últimas
 * MAX_LINHAS_LOG entradas) e o resto os últimos mapas. `cortados` é quantos
 * mapas mais antigos ficaram de fora.
 */
function historicoInicial(snap) {
  const lastEventId = matchlive.inicioDoLog(snap.events, matchlive.MAX_LINHAS_LOG);
  const temLog = snap.events.some(e => e.id > lastEventId && matchlive.LOGAVEIS.has(e.type));
  const gameMessages = matchlive.gameMessagesIniciais(snap.games, matchlive.LIMITE_HISTORICO - (temLog ? 1 : 0));
  return { lastEventId, gameMessages, cortados: Object.keys(gameMessages).length };
}

function listar(interaction, s) {
  const tracks = db.listTracksByChannel(interaction.channelId);
  if (!tracks.length) return interaction.reply(efemero(s.matchlive_list_empty));

  const linhas = tracks.map(tr =>
    `• ${servers.get(tr.server)?.label ?? tr.server} \`${tr.matchId}\` — <t:${Math.floor(tr.createdAt / 1000)}:R>`
  );
  return interaction.reply(efemero(`**${s.matchlive_list_title}**\n${linhas.join('\n')}`));
}

/** Já acompanhada ou acima de um limite: a mensagem de recusa; senão null. */
function motivoDeRecusa(s, channelId, key, id) {
  if (db.getTrack(channelId, key, id)) return s.matchlive_already(id);
  if (db.listTracksByChannel(channelId).length >= matchlive.LIMITE_POR_CANAL) {
    return s.matchlive_channel_full(matchlive.LIMITE_POR_CANAL);
  }
  if (db.countTracks() >= matchlive.LIMITE_GLOBAL) return s.matchlive_global_full;
  return null;
}

/** O track pode começar? Responde o erro e devolve null; senão, o snapshot. */
async function partidaVisivel(interaction, s, fonte, key, id, label) {
  const check = await daycoreMysql.checkConnection();
  if (!check.ok) {
    logError('matchlive:mysql', new Error(check.error ?? check.reason));
    await interaction.editReply(s.matchlive_unreachable(label));
    return null;
  }

  const snap = await fonte.snapshot(id, 0);
  if (!snap) {
    await interaction.editReply(s.matchlive_not_found(id));
    return null;
  }

  if (snap.match.private) {
    // A mesma regra do /matchcost: quem jogou nela pode ver.
    const link = db.getLink(interaction.user.id, key);
    const quem = link ? { id: link.osu_id, name: link.osu_user } : null;
    const participou = await jogouNela(daycoreMysql.getPool(), id, quem);
    if (!podeVerPartida(snap.match, participou)) {
      await interaction.editReply(s.matchlive_not_found(id));
      return null;
    }
  }

  if (snap.match.endedAt) {
    await interaction.editReply(s.matchlive_ended(id));
    return null;
  }
  return snap;
}

module.exports = {
  // Os erros de validação saem em efêmero antes de qualquer defer (ver
  // bot/dispatch.js); só o track, que fala com o MySQL, adia a resposta.
  defer: false,

  data: new SlashCommandBuilder()
    .setName('matchlive')
    .setDescription('Follow a multiplayer match live in this channel')
    .setDescriptionLocalizations({ 'pt-BR': 'Acompanha uma partida multiplayer ao vivo neste canal' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(sub => opcaoMatch(sub
      .setName('track')
      .setDescription('Start following a match in this channel')
      .setDescriptionLocalizations({ 'pt-BR': 'Começa a acompanhar uma partida neste canal' })))
    .addSubcommand(sub => opcaoMatch(sub
      .setName('untrack')
      .setDescription('Stop following a match in this channel')
      .setDescriptionLocalizations({ 'pt-BR': 'Para de acompanhar uma partida neste canal' }), false))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Matches followed in this channel')
      .setDescriptionLocalizations({ 'pt-BR': 'Partidas acompanhadas neste canal' })),

  /**
   * Liga o poller no boot (chamado pelo index.js no `clientReady`). A API do
   * osu! e os emojis entram daqui porque src/matchlive/ não fala com eles.
   */
  iniciar(client) {
    matchlive.iniciar(client, guildId => forGuild(guildId), { infoDoMapa, rotuloDaGrade: emojis.rankLabel });
  },

  async execute(interaction) {
    const s = t(interaction);
    const sub = exigirSubcomando(module.exports, interaction);

    if (!interaction.guildId) return interaction.reply(efemero(s.matchlive_guild_only));
    if (sub === 'list') return listar(interaction, s);

    if (sub !== 'track' && sub !== 'untrack') {
      throw new Error(`/matchlive: subcomando declarado mas sem tratamento: "${sub}"`);
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply(efemero(s.matchlive_no_permission));
    }

    const entrada = interaction.options.getString('match');
    if (sub === 'untrack' && !entrada) return untrackSemId(interaction, s);

    const alvo = parseMatchInput(entrada, servers.all().filter(x => !x.relax));
    if (!alvo) return interaction.reply(efemero(s.matchlive_bad_input));

    // Link manda; id sozinho vai para o servidor preferido, como no /matchcost.
    const key = alvo.key ?? servers.rootKey(resolveServer(interaction, 'server', null));
    const label = servers.get(key)?.label ?? key;

    const { channelId } = interaction;
    const id = alvo.id;

    // Antes das checagens de fonte e de MySQL: parar um track tem que
    // funcionar mesmo com o .env sem DAYCORE_MYSQL_* ou o servidor fora.
    if (sub === 'untrack') {
      const removido = db.removeTrack(channelId, key, id);
      return interaction.reply(efemero(removido ? s.matchlive_untracked(id) : s.matchlive_not_tracked(id)));
    }

    if (key === servers.OFFICIAL_KEY) return interaction.reply(efemero(s.matchlive_bancho_soon));
    const fonte = matchlive.fontePara(key);
    if (!fonte) return interaction.reply(efemero(s.matchlive_unsupported(label)));
    if (!daycoreMysql.isConfigured()) return interaction.reply(efemero(s.matchlive_unconfigured(label)));

    const recusa = motivoDeRecusa(s, channelId, key, id);
    if (recusa) return interaction.reply(efemero(recusa));

    await interaction.deferReply();

    try {
      const snap = await partidaVisivel(interaction, s, fonte, key, id, label);
      if (!snap) return;
      const partida = snap.match;

      // O primeiro tick posta o histórico (ver historicoInicial).
      const { lastEventId, gameMessages, cortados } = historicoInicial(snap);

      // De novo, depois dos awaits: outro /matchlive track pode ter
      // gravado enquanto este esperava o MySQL. O SQLite é síncrono, então
      // entre esta conferência e o INSERT nada mais roda.
      const recusa = motivoDeRecusa(s, channelId, key, id);
      if (recusa) return interaction.editReply(recusa);

      db.addTrack({
        channelId,
        guildId: interaction.guildId,
        server: key,
        matchId: id,
        lastEventId,
        trackedBy: interaction.user.id,
        gameMessages,
      });
      const resposta = s.matchlive_tracking(id, partida.name);
      return interaction.editReply(cortados ? `${resposta}
${s.matchlive_history_truncated(cortados)}` : resposta);
    } catch (error) {
      logError('matchlive', error);
      return safeEditReply(interaction, s.error_generic);
    }
  },
};
