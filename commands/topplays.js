const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const osu = require('../osuClient');

const relativeTime = (dateString) => {
  const diffInSeconds = Math.floor((Date.now() - new Date(dateString)) / 1000);
  if (diffInSeconds < 60) return 'agora mesmo';
  if (diffInSeconds < 3600) return `há ${Math.floor(diffInSeconds / 60)} min`;
  if (diffInSeconds < 86400) return `há ${Math.floor(diffInSeconds / 3600)} horas`;
  if (diffInSeconds < 2592000) return `há ${Math.floor(diffInSeconds / 86400)} dias`;
  return `há ${Math.floor(diffInSeconds / 2592000)} meses`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('topplays')
    .setDescription('Mostra as 10 melhores plays de um jogador')
    .addStringOption(option =>
      option.setName('usuario').setDescription('Nome do jogador').setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('servidor')
        .setDescription('Qual servidor usar? (padrão: oficial)')
        .setRequired(false)
        .addChoices(
          { name: 'Bancho', value: 'official' },
          { name: 'Daycore', value: 'private' },
          { name: 'Daycore RX', value: 'private_rx' }
        )
    ),

  async execute(interaction) {
    const username = interaction.options.getString('usuario');
    const mode = interaction.options.getString('servidor') || osu.DEFAULT_MODE;

    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply('❌ Jogador não encontrado.');

      const plays = await osu.getBestScores(user.id, 10, mode);
      if (plays.length === 0) return interaction.editReply('Nenhuma play encontrada.');

      // Busca stars ajustadas e FC PP em paralelo para todos os scores
      const [adjustedStarsArray, fcPPArray] = await Promise.all([
        Promise.all(plays.map(play => osu.getAdjustedStars(play.beatmap.id, play.mods, mode))),
        Promise.all(plays.map(play => osu.getFCpp(play, mode))),
      ]);

      const stats = user.statistics;

      const embed = new EmbedBuilder()
        .setColor(0x2f3136)
        .setAuthor({
          name: `${user.username}: ${stats.pp.toFixed(2)}pp (#${stats.global_rank?.toLocaleString()} ${user.country_code}${stats.country_rank || ''})`,
          iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
          url: osu.getUserUrl(user.id, mode),
        })
        .setThumbnail(user.avatar_url);

      let description = '';
      plays.forEach((play, index) => {
        const mapUrl  = osu.getMapUrl(play.beatmap.id, play.beatmapset.id, mode);
        const mods    = play.mods.length > 0 ? `+${play.mods.join('')}` : '';
        const acc     = (play.accuracy * 100).toFixed(2);
        const stars   = adjustedStarsArray[index] || play.beatmap.difficulty_rating.toFixed(2);
        const fcPP    = fcPPArray[index];

        const misses    = play.statistics?.count_miss ?? play.statistics?.miss ?? 0;
        const mapCombo  = play.beatmap?.max_combo ?? null;
        const scoreCombo = play.max_combo ?? 0;
        const isChoke   = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

        const ppText = fcPP !== null && isChoke
          ? `\`${play.pp.toFixed(2)}pp\` *(FC: ~${fcPP.toFixed(2)}pp)*`
          : `\`${play.pp.toFixed(2)}pp\``;

        description += `**#${index + 1} [${play.beatmapset.title} [${play.beatmap.version}]](${mapUrl}) [${stars}★]**\n`;
        description += `**${play.rank}** ${ppText} (${acc}%) [${play.max_combo}x/${play.beatmap.max_combo || '?'}x] **${mods}** \`${relativeTime(play.created_at)}\`\n\n`;
      });

      embed.setDescription(description);
      embed.setFooter({ text: `Página 1/1 • Modo: osu! • ${osu.getModeLabel(mode)}` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      interaction.editReply('Erro ao buscar as top plays.');
    }
  },
};
