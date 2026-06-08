const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const osu = require('../osuClient');
const { resolvePlayer } = require('../userLink');
const { t } = require('../i18n');

const relativeTime = (dateString, lang) => {
  const diffInSeconds = Math.floor((Date.now() - new Date(dateString)) / 1000);
  if (lang === 'en' || lang === undefined) {
    if (diffInSeconds < 60)      return 'just now';
    if (diffInSeconds < 3600)    return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400)   return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    return `${Math.floor(diffInSeconds / 2592000)}mo ago`;
  }
  if (diffInSeconds < 60)      return 'agora mesmo';
  if (diffInSeconds < 3600)    return `há ${Math.floor(diffInSeconds / 60)} min`;
  if (diffInSeconds < 86400)   return `há ${Math.floor(diffInSeconds / 3600)} horas`;
  if (diffInSeconds < 2592000) return `há ${Math.floor(diffInSeconds / 86400)} dias`;
  return `há ${Math.floor(diffInSeconds / 2592000)} meses`;
};

const { loadLangData } = require('../i18n');

function getLang(interaction) {
  const data       = loadLangData();
  const userLang   = data.users?.[interaction.user.id];
  const serverLang = interaction.guildId ? data.servers?.[interaction.guildId] : undefined;
  return userLang ?? serverLang ?? 'pt';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('topplays')
    .setDescription("Show a player's top 10 plays")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as 10 melhores plays de um jogador' })
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
    const lang     = getLang(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (!resolved) {
      return interaction.reply({ content: s.no_link_set, ephemeral: true });
    }

    const { username, mode } = resolved;
    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply(s.player_not_found);

      const plays = await osu.getBestScores(user.id, 10, mode);
      if (plays.length === 0) return interaction.editReply(s.topplays_none);

      const [adjustedStarsArray, fcPPArray] = await Promise.all([
        Promise.all(plays.map(play => osu.getAdjustedStars(play.beatmap.id, play.mods, mode))),
        Promise.all(plays.map(play => osu.getFCpp(play, mode))),
      ]);

      const stats       = user.statistics;
      const rankDisplay = stats.global_rank ? `#${stats.global_rank.toLocaleString()}` : s.profile_unranked;
      const countryPart = (!user._private && stats.country_rank)
        ? ` ${user.country_code}#${stats.country_rank.toLocaleString()}`
        : ` ${user.country_code}`;

      const embed = new EmbedBuilder()
        .setColor(0x2f3136)
        .setAuthor({
          name:    `${user.username}: ${stats.pp.toFixed(2)}pp (${rankDisplay}${countryPart})`,
          iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
          url:     osu.getUserUrl(user.id, mode),
        })
        .setThumbnail(user.avatar_url);

      let description = '';
      plays.forEach((play, index) => {
        const mapUrl     = osu.getMapUrl(play.beatmap.id, play.beatmapset.id, mode);
        const mods       = play.mods.length > 0 ? `+${play.mods.join('')}` : '';
        const acc        = (play.accuracy * 100).toFixed(2);
        const starsRaw   = adjustedStarsArray[index] ?? play.beatmap.difficulty_rating;
        const stars      = starsRaw ? parseFloat(starsRaw).toFixed(2) : '?';
        const fcPP       = fcPPArray[index];
        const misses     = play.statistics?.count_miss ?? play.statistics?.miss ?? 0;
        const mapCombo   = play.beatmap?.max_combo ?? null;
        const scoreCombo = play.max_combo ?? 0;
        const isChoke    = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

        const ppText = fcPP !== null && isChoke
          ? `\`${play.pp.toFixed(2)}pp\` *(FC: ~${fcPP.toFixed(2)}pp)*`
          : `\`${play.pp.toFixed(2)}pp\``;

        const comboText = `${scoreCombo}x/${mapCombo !== null ? mapCombo + 'x' : '?x'}`;

        description += `**#${index + 1} [${play.beatmapset.title} [${play.beatmap.version}]](${mapUrl}) [${stars}★]**\n`;
        description += `**${play.rank}** ${ppText} (${acc}%) [${comboText}] **${mods}** \`${relativeTime(play.created_at, lang)}\`\n\n`;
      });

      embed.setDescription(description);
      embed.setFooter({ text: s.topplays_footer(osu.getModeLabel(mode)) });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      interaction.editReply(s.topplays_error);
    }
  },
};
