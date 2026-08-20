const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const recentMerge = require('../recentMerge');
const { resolvePlayer, fetchPlayer } = require('../userLink');
const mapContext = require('../mapContext');
const playEmbed = require('../embeds/play');
const { md } = require('../markdown');
const { paginate } = require('../pagination');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const FETCH_LIMIT = 50;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recent')
    .setDescription("Show a player's most recent plays (including fails)")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as últimas plays (incluindo falhas) de um jogador' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(option =>
      option
        .setName('player')
        .setDescription('Player name (optional if /link is set)')
        .setDescriptionLocalizations({ 'pt-BR': 'Nome do jogador (opcional se tiver /link)' })
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('server')
        .setDescription('Which server to use? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(...servers.choices())
    )
    .addStringOption(option =>
      option
        .setName('modo')
        .setDescription('Filter VN/RX when the server has both (default: combined)')
        .setDescriptionLocalizations({ 'pt-BR': 'Filtra VN/RX quando o servidor tem os dois (padrão: combinado)' })
        .setRequired(false)
        .addChoices(
          { name: 'VN only', value: 'vn', name_localizations: { 'pt-BR': 'Só VN' } },
          { name: 'RX only', value: 'rx', name_localizations: { 'pt-BR': 'Só RX' } },
        )
    ),

  async execute(interaction) {
    const s        = t(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const { mode } = resolved;
    const modoOption = interaction.options.getString('modo'); // 'vn' | 'rx' | null
    const pair = recentMerge.pairFor(mode);
    const keys = recentMerge.keysToFetch(pair, modoOption);
    await interaction.deferReply();

    try {
      // Perfil e plays na mesma viagem quando o link já deu o id (ver userLink).
      // Com par VN/RX, "as plays" pode vir de mais de uma chave — fetchEach
      // busca as duas em paralelo e tolera uma falhando; mergeRecent junta e
      // corta no FETCH_LIMIT, marcando cada play com o `_mode` de onde veio.
      const { user, scores: recents } = await fetchPlayer(
        resolved,
        async id => {
          const porModo = await recentMerge.fetchEach(
            keys,
            key => osu.getRecentScores(id, FETCH_LIMIT, key),
          );
          return recentMerge.mergeRecent(porModo, FETCH_LIMIT);
        },
      );
      if (!user) return interaction.editReply(s.player_not_found);
      // O nick vai numa mensagem que renderiza markdown (ver markdown.js).
      if (recents.length === 0) return interaction.editReply(s.recent_none(md(user.username)));

      const totalPages = recents.length;

      // Mapa de cada página já montada, para o /score conseguir responder à
      // play que está sendo exibida agora (ver mapContext.js). Fica fora do
      // buildEmbed porque o embed é memoizado: voltar para uma página antiga
      // não passa por lá de novo, mas ainda precisa atualizar o contexto.
      const pageMapId = new Map();

      async function buildEmbed(page) {
        // Enriquece só a play exibida agora, não as 50 buscadas de uma vez —
        // evita rajada de requisições/rate limit na API do osu!
        const rawPlay      = recents[page];
        const playMode     = rawPlay._mode; // de qual chave (VN ou RX) essa play veio
        const [scoredPlay] = await osu.enrichScores([rawPlay], playMode);
        const [recent]     = await osu.enrichBeatmapData([scoredPlay]);

        pageMapId.set(page, recent.beatmap.id);

        // Todo o desenho da play mora no embeds/play.js — é o mesmo em todo
        // comando. O que sobra aqui é a moldura: quem jogou, e onde a play
        // está na lista de páginas.
        const bloco = await playEmbed.single(recent, { mode: playMode, s });

        return new EmbedBuilder()
          // Link de perfil: mesmo em VN e RX (ver banchoPyApi/rippleApi
          // userUrl), então continua no modo do COMANDO, não da play. O
          // author() também renderiza pp e rank global do perfil buscado
          // nesse modo — então numa lista combinada, uma play de RX aparece
          // com o pp/rank de VN no cabeçalho. É de propósito: um cabeçalho
          // estável para a lista inteira, em vez de um que pisca a cada
          // página conforme a play vem de VN ou de RX.
          .setAuthor(playEmbed.author(user, mode, s))
          .setTitle(bloco.title)
          .setURL(bloco.url)
          .setColor(bloco.color)
          .setThumbnail(bloco.thumbnail)
          .setDescription(bloco.description)
          .setFooter({
            // Status do mapa (ranked, loved, graveyard...) e mapper só existem
            // pela API oficial; no bancho.py o rodapé sai sem eles, em vez de
            // afirmar o que não dá para saber. O rótulo agora é o da PLAY: com
            // as duas listas juntas, uma página pode ser Daycore e a seguinte
            // Daycore RX.
            text: s.recent_footer(
              page + 1,
              totalPages,
              osu.getModeLabel(playMode),
              bloco.status,
              bloco.creator,
            ),
          });
      }

      await paginate(interaction, {
        id: 'recent',
        totalPages,
        buildEmbed,
        strings: s,
        // O contexto do canal acompanha a página em que os botões pararam —
        // no modo da PLAY, pro /score sem argumento procurar no leaderboard
        // certo (ver mapContext.js).
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), recents[page]?._mode ?? mode),
        // Mesma ordem do /topplays: primeiro o enriquecimento (uma requisição
        // por play em servidor privado), depois o arquivo do mapa.
        prefetch: async (page) => {
          const proxima = recents[page];
          if (!proxima) return;

          const [scored] = await osu.enrichScores([proxima], proxima._mode);
          const [cheia]  = await osu.enrichBeatmapData([scored]);
          if (cheia?.beatmap?.id) await osu.getBeatmapFile(cheia.beatmap.id);
        },
      });
    } catch (error) {
      logError('recent', error);
      return safeEditReply(interaction, s.recent_error);
    }
  },
};
