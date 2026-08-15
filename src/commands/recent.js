const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
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
      const { user, scores: recents } = await fetchPlayer(
        resolved,
        id => osu.getRecentScores(id, FETCH_LIMIT, mode),
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
        const [scoredPlay] = await osu.enrichScores([rawPlay], mode);
        const [recent]     = await osu.enrichBeatmapData([scoredPlay]);

        pageMapId.set(page, recent.beatmap.id);

        // Todo o desenho da play mora no embeds/play.js — é o mesmo em todo
        // comando. O que sobra aqui é a moldura: quem jogou, e onde a play
        // está na lista de páginas.
        const bloco = await playEmbed.single(recent, { mode, s });

        return new EmbedBuilder()
          .setAuthor(playEmbed.author(user, mode, s))
          .setTitle(bloco.title)
          .setURL(bloco.url)
          .setColor(bloco.color)
          .setThumbnail(bloco.thumbnail)
          .setDescription(bloco.description)
          .setFooter({
            // Status do mapa (ranked, loved, graveyard...) e mapper só existem
            // pela API oficial; no bancho.py o rodapé sai sem eles, em vez de
            // afirmar o que não dá para saber.
            text: s.recent_footer(
              page + 1,
              totalPages,
              osu.getModeLabel(mode),
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
        // O contexto do canal acompanha a página em que os botões pararam.
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), mode),
        // Mesma ordem do /topplays: primeiro o enriquecimento (uma requisição
        // por play em servidor privado), depois o arquivo do mapa.
        prefetch: async (page) => {
          const proxima = recents[page];
          if (!proxima) return;

          const [scored] = await osu.enrichScores([proxima], mode);
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
