const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const osu = require('../osuClient');
const { resolvePlayer } = require('../userLink');
const { t } = require('../i18n');
const { logError } = require('../logger');

const FETCH_LIMIT    = 50;
const COLLECTOR_TIME = 120_000;

function buildRow(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('recent_prev')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('recent_next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === totalPages - 1)
  );
}

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
        .setDescription('Which server to use? (default: official)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: oficial)' })
        .setRequired(false)
        .addChoices(
          { name: 'Bancho',     value: 'official'   },
          { name: 'Daycore',    value: 'private'     },
          { name: 'Daycore RX', value: 'private_rx'  }
        )
    ),

  async execute(interaction) {
    const s        = t(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (!resolved) {
      return interaction.reply({ content: s.no_link_set, ephemeral: true });
    }

    const { username, mode } = resolved;
    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply(s.player_not_found);

      const recents = await osu.getRecentScores(user.id, FETCH_LIMIT, mode);
      if (recents.length === 0) return interaction.editReply(s.recent_none(user.username));

      const totalPages = recents.length;

      async function buildEmbed(page) {
        // Enriquece só a play exibida agora, não as 50 buscadas de uma vez —
        // evita rajada de requisições/rate limit na API do osu!
        const rawPlay      = recents[page];
        const [scoredPlay] = mode === 'official' ? [rawPlay] : await osu.enrichScores([rawPlay]);
        const [recent]     = await osu.enrichBeatmapData([scoredPlay]);

        const mapUrl = osu.getMapUrl(recent.beatmap.id, recent.beatmapset.id, mode);
        const mods   = recent.mods.length > 0 ? `+${recent.mods.join('')}` : 'No Mods';
        const isPass = recent.passed;

        const hits  = recent.statistics ?? {};
        const h300  = hits.count_300  ?? hits.great ?? '-';
        const h100  = hits.count_100  ?? hits.ok    ?? '-';
        const h50   = hits.count_50   ?? hits.meh   ?? '-';
        const hMiss = hits.count_miss ?? hits.miss  ?? 0;
        const hitsLine = `{ ${h300} / ${h100} / ${h50} / ${hMiss} }`;

        const fcPP       = await osu.getFCpp(recent, mode);
        const misses     = typeof hMiss === 'number' ? hMiss : 0;
        const mapCombo   = recent.beatmap?.max_combo ?? null;
        const scoreCombo = recent.max_combo ?? 0;
        const isChoke    = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

        const ppLine =
          `**${s.recent_pp}:** ${recent.pp ? recent.pp.toFixed(2) : '0'}pp` +
          (fcPP !== null && isChoke ? ` *(FC: ~${fcPP.toFixed(2)}pp)*` : '');

        return new EmbedBuilder()
          .setAuthor({
            name:    s.recent_author(user.username),
            iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
            url:     osu.getUserUrl(user.id, mode),
          })
          .setTitle(`${recent.beatmapset.title} [${recent.beatmap.version}]`)
          .setURL(mapUrl)
          .setColor(isPass ? 0xff66aa : 0xee4444)
          .setThumbnail(recent.beatmapset.covers.list)
          .addFields(
            { name: s.recent_status, value: isPass ? s.recent_pass : s.recent_fail, inline: true },
            { name: s.recent_rank,   value: `**${recent.rank}**`,                   inline: true },
            { name: s.recent_mods,   value: mods,                                   inline: true },
            {
              name: s.recent_stats,
              value:
                `${ppLine}\n` +
                `**${s.recent_acc}:** ${(recent.accuracy * 100).toFixed(2)}%\n` +
                `**${s.recent_combo}:** ${scoreCombo}x/${mapCombo !== null ? mapCombo + 'x' : '?x'}\n` +
                `**${s.recent_hits}:** ${hitsLine}`,
              inline: false,
            }
          )
          .setFooter({
            text: s.recent_footer(
              recent.mode,
              new Date(recent.created_at).toLocaleString('pt-BR'),
              osu.getModeLabel(mode),
              page + 1,
              totalPages
            ),
          });
      }

      let page = 0;
      const embed = await buildEmbed(page);
      const message = await interaction.editReply({
        embeds: [embed],
        components: totalPages > 1 ? [buildRow(page, totalPages)] : [],
      });

      if (totalPages <= 1) return;

      const collector = message.createMessageComponentCollector({ time: COLLECTOR_TIME });

      collector.on('collect', async (i) => {
        if (i.user.id !== interaction.user.id) {
          return i.reply({ content: s.pagination_not_yours, ephemeral: true }).catch(() => {});
        }

        if (i.customId === 'recent_prev' && page > 0) page--;
        if (i.customId === 'recent_next' && page < totalPages - 1) page++;

        await i.deferUpdate();
        const newEmbed = await buildEmbed(page);
        await interaction.editReply({ embeds: [newEmbed], components: [buildRow(page, totalPages)] });
      });

      collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (error) {
      logError('recent', error);
      interaction.editReply(s.recent_error);
    }
  },
};
