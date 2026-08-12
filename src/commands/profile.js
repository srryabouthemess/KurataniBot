const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { resolvePlayer } = require('../userLink');
const emojis = require('../emojis');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const toDiscordTimestamp = (dateString, format = 'R') => {
  if (!dateString) return 'Unknown';
  const unix = Math.floor(new Date(dateString).getTime() / 1000);
  return `<t:${unix}:${format}>`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription("Show a player's osu! profile")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra o perfil de um jogador de osu!' })
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

    const { username, mode } = resolved;
    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply(s.player_not_found);

      const stats     = user.statistics;
      const rawBest   = await osu.getBestScores(user.id, 1, mode);
      const bestPlays = await osu.enrichScores(rawBest, mode);
      const bestPlay  = bestPlays[0] || null;

      let topPlayString = s.profile_no_play;
      if (bestPlay) {
        const mapUrl = osu.getMapUrl(bestPlay.beatmap.id, bestPlay.beatmapset.id, mode);
        const mapName = `${bestPlay.beatmapset.title} [${bestPlay.beatmap.version}]`;
        topPlayString =
          `🏆 **[${mapName}](${mapUrl})**\n` +
          `> **PP:** ${bestPlay.pp.toFixed(2)}pp | **${s.profile_acc}:** ${(bestPlay.accuracy * 100).toFixed(2)}%\n` +
          `> **Rank:** ${emojis.rankLabel(bestPlay.rank)} | **${s.profile_max_combo}:** ${bestPlay.max_combo !== null ? bestPlay.max_combo + 'x' : '-'}`;
      }

      const rankValue = user._private
        ? `**${s.profile_global}:** ${stats.global_rank ? '#' + stats.global_rank.toLocaleString() : s.profile_unranked}`
        : `**${s.profile_global}:** ${stats.global_rank ? '#' + stats.global_rank.toLocaleString() : s.profile_unranked}\n**${s.profile_regional(user.country_code)}:** ${stats.country_rank ? '#' + stats.country_rank.toLocaleString() : '-'}`;

      const embed = new EmbedBuilder()
        .setTitle(s.profile_title(user.username))
        .setURL(osu.getUserUrl(user.id, mode))
        .setThumbnail(user.avatar_url)
        .setColor(user.is_online ? 0x99ff99 : 0xff66aa)
        .addFields(
          { name: s.profile_ranks,  value: rankValue,  inline: true },
          {
            name: s.profile_stats,
            value: `**${s.profile_acc}:** ${stats.hit_accuracy.toFixed(2)}%\n**${s.profile_max_combo}:** ${stats.maximum_combo}x`,
            inline: true,
          },
          {
            name: s.profile_status,
            value: user.is_online
              ? s.profile_online
              : s.profile_offline(toDiscordTimestamp(user.last_visit, 'R')),
            inline: true,
          },
          { name: s.profile_top_play,   value: topPlayString,                           inline: false },
          { name: s.profile_created_at, value: toDiscordTimestamp(user.join_date, 'D'), inline: false }
        )
        .setFooter({ text: s.profile_footer(osu.getModeLabel(mode)) });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('profile', error);
      // O adaptador oficial já devolve null em 404 (ver osu/officialApi.js), então
      // isto cobre só os 404 das outras chamadas do comando — as top plays.
      if (error.response?.status === 404) return safeEditReply(interaction, s.player_not_found);
      return safeEditReply(interaction, s.error_generic);
    }
  },
};
