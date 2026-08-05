const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const osu = require('../osuClient');
const { resolvePlayer } = require('../userLink');
const { t } = require('../i18n');

const PAGE_SIZE     = 5;
const FETCH_LIMIT    = 100;
const COLLECTOR_TIME = 120_000;

const truncateTitle = (title, maxLen = 22) =>
  title.length > maxLen ? `${title.slice(0, maxLen).trimEnd()}...` : title;

const discordTimestamp = (dateString) =>
  `<t:${Math.floor(new Date(dateString).getTime() / 1000)}:R>`;

function buildRow(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('topplays_prev')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId('topplays_next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === totalPages - 1)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('topplays')
    .setDescription("Show a player's top plays")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as melhores plays de um jogador' })
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

      const plays = await osu.getBestScores(user.id, FETCH_LIMIT, mode);
      if (plays.length === 0) return interaction.editReply(s.topplays_none);

      const totalPages = Math.ceil(plays.length / PAGE_SIZE);

      const stats       = user.statistics;
      const rankDisplay = stats.global_rank ? `#${stats.global_rank.toLocaleString()}` : s.profile_unranked;
      const countryPart = (!user._private && stats.country_rank)
        ? ` ${user.country_code}#${stats.country_rank.toLocaleString()}`
        : ` ${user.country_code}`;

      async function buildEmbed(page) {
        // Enriquece só os mapas da página atual (5), não os 100 buscados de
        // uma vez — evita rajada de requisições/rate limit na API do osu!
        const rawPage    = plays.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
        const scoredPage = mode === 'official' ? rawPage : await osu.enrichScores(rawPage);
        const pagePlays  = await osu.enrichBeatmapData(scoredPage);

        const [adjustedStarsArray, fcPPArray] = await Promise.all([
          Promise.all(pagePlays.map(play => osu.getAdjustedStars(play.beatmap.id, play.mods, mode))),
          Promise.all(pagePlays.map(play => osu.getFCpp(play, mode))),
        ]);

        const embed = new EmbedBuilder()
          .setColor(0x2f3136)
          .setAuthor({
            name:    `${user.username}: ${stats.pp.toFixed(2)}pp (${rankDisplay}${countryPart})`,
            iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
            url:     osu.getUserUrl(user.id, mode),
          })
          .setThumbnail(user.avatar_url);

        let description = '';
        pagePlays.forEach((play, index) => {
          const globalIndex = page * PAGE_SIZE + index;
          const mapUrl     = osu.getMapUrl(play.beatmap.id, play.beatmapset.id, mode);
          const mods       = play.mods.length > 0 ? `+${play.mods.join('')}` : '';
          const acc        = (play.accuracy * 100).toFixed(2);
          const starsRaw   = adjustedStarsArray[index] ?? play.beatmap.difficulty_rating;
          const stars      = starsRaw ? parseFloat(starsRaw).toFixed(2) : '?';
          const fcPP       = fcPPArray[index];
          const hits       = play.statistics ?? {};
          const h300       = hits.count_300  ?? hits.great ?? '-';
          const h100       = hits.count_100  ?? hits.ok    ?? '-';
          const h50        = hits.count_50   ?? hits.meh   ?? '-';
          const hMiss      = hits.count_miss ?? hits.miss  ?? 0;
          const hitsLine   = `{ ${h300} / ${h100} / ${h50} / ${hMiss} }`;
          const misses     = typeof hMiss === 'number' ? hMiss : 0;
          const mapCombo   = play.beatmap?.max_combo ?? null;
          const scoreCombo = play.max_combo ?? 0;
          const isChoke    = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

          const ppText = fcPP !== null && isChoke
            ? `\`${play.pp.toFixed(2)}pp\` *(FC: ~${fcPP.toFixed(2)}pp)*`
            : `\`${play.pp.toFixed(2)}pp\``;

          const comboText = `${scoreCombo}x/${mapCombo !== null ? mapCombo + 'x' : '?x'}`;

          const title = truncateTitle(play.beatmapset.title);
          description += `**#${globalIndex + 1} [${title} [${play.beatmap.version}]](${mapUrl}) [${stars}★]**\n`;
          description += `**${play.rank}** ${ppText} (${acc}%) [${comboText}] **${mods}** ${discordTimestamp(play.created_at)}\n`;
          description += `${hitsLine}\n\n`;
        });

        embed.setDescription(description);
        embed.setFooter({ text: s.topplays_footer(page + 1, totalPages, osu.getModeLabel(mode)) });

        return embed;
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

        if (i.customId === 'topplays_prev' && page > 0) page--;
        if (i.customId === 'topplays_next' && page < totalPages - 1) page++;

        await i.deferUpdate();
        const newEmbed = await buildEmbed(page);
        await interaction.editReply({ embeds: [newEmbed], components: [buildRow(page, totalPages)] });
      });

      collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => {});
      });
    } catch (error) {
      console.error(error);
      interaction.editReply(s.topplays_error);
    }
  },
};
