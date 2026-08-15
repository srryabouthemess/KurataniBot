const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { resolvePlayer, fetchPlayer } = require('../userLink');
const mapContext = require('../mapContext');
const playEmbed = require('../embeds/play');
const { paginate } = require('../pagination');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const PAGE_SIZE   = 5;
const FETCH_LIMIT = 100;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('topplays')
    .setDescription("Show a player's top plays")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as melhores plays de um jogador' })
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
    ),

  async execute(interaction) {
    const s        = t(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const { mode } = resolved;
    await interaction.deferReply();

    try {
      // Perfil e plays na mesma viagem quando o link já deu o id (ver userLink).
      const { user, scores: plays } = await fetchPlayer(
        resolved,
        id => osu.getBestScores(id, FETCH_LIMIT, mode),
      );
      if (!user) return interaction.editReply(s.player_not_found);
      if (plays.length === 0) return interaction.editReply(s.topplays_none);

      const totalPages = Math.ceil(plays.length / PAGE_SIZE);

      // Mapa do topo de cada página, para o /score sem argumento (mapContext).
      // Fica fora do buildEmbed porque o embed é memoizado — voltar para uma
      // página já vista não passa por lá de novo.
      const pageMapId = new Map();

      async function buildEmbed(page) {
        // Enriquece só os mapas da página atual (5), não os 100 buscados de
        // uma vez — evita rajada de requisições/rate limit na API do osu!
        const rawPage    = plays.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
        const scoredPage = await osu.enrichScores(rawPage, mode);
        const pagePlays  = await osu.enrichBeatmapData(scoredPage);

        pageMapId.set(page, pagePlays[0]?.beatmap?.id ?? null);

        // Em paralelo entre as plays, e não uma por vez: cada bloco ainda pede
        // estrelas e PP de FC, e serializá-los multiplicaria por cinco a espera
        // de uma página nova.
        const blocos = await Promise.all(pagePlays.map((play, index) =>
          playEmbed.listItem(play, {
            mode,
            index:  page * PAGE_SIZE + index + 1,
            mapUrl: osu.getMapUrl(play.beatmap.id, play.beatmapset.id, mode),
          })
        ));

        return new EmbedBuilder()
          .setColor(playEmbed.COLOR)
          .setAuthor(playEmbed.author(user, mode, s))
          .setThumbnail(user.avatar_url ?? null)
          .setDescription(blocos.join('\n\n'))
          .setFooter({ text: s.topplays_footer(page + 1, totalPages, osu.getModeLabel(mode)) });
      }

      // O embed da página é memoizado pelo paginate(): sem isso, voltar para
      // uma página já vista refazia tudo do zero — enriquecimento dos scores,
      // estrelas e PP de FC das mesmas 5 plays. Navegar 1→2→1 custava o triplo.
      await paginate(interaction, {
        id: 'topplays',
        totalPages,
        buildEmbed,
        strings: s,
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), mode),
        // Baixa os .osu da próxima página enquanto a pessoa lê a atual: o
        // gargalo de uma página nova é o limite de download, não o cálculo.
        prefetch: page => Promise.all(
          plays.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
            .map(play => osu.getBeatmapFile(play.beatmap?.id ?? play.beatmap_id))
        ),
      });
    } catch (error) {
      logError('topplays', error);
      return safeEditReply(interaction, s.topplays_error);
    }
  },
};
