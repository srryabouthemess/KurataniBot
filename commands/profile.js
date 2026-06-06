const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const osu = require('../osuClient');

const toDiscordTimestamp = (dateString, format = 'R') => {
  if (!dateString) return 'Desconhecido';
  const unix = Math.floor(new Date(dateString).getTime() / 1000);
  return `<t:${unix}:${format}>`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Mostra o perfil de um jogador de osu!')
    .addStringOption(option =>
      option.setName('jogador').setDescription('Nome do jogador').setRequired(true)
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
    const player = interaction.options.getString('jogador');
    const mode = interaction.options.getString('servidor') || osu.DEFAULT_MODE;

    await interaction.deferReply();

    try {
      const user = await osu.getUser(player, mode);
      if (!user) return interaction.editReply('❌ Jogador não encontrado.');

      const stats = user.statistics;
      const bestPlays = await osu.getBestScores(user.id, 1, mode);
      const bestPlay = bestPlays[0] || null;
      

      let topPlayString = 'Nenhuma play encontrada.';
      if (bestPlay) {
        const mapUrl = osu.getMapUrl(bestPlay.beatmap.id, bestPlay.beatmapset.id, mode);
        const mapName = `${bestPlay.beatmapset.title} [${bestPlay.beatmap.version}]`;
        topPlayString =
          `🏆 **[${mapName}](${mapUrl})**\n` +
          `> **PP:** ${bestPlay.pp.toFixed(2)}pp | **Acc:** ${(bestPlay.accuracy * 100).toFixed(2)}%\n` +
          `> **Rank:** ${bestPlay.rank} | **Combo:** ${bestPlay.max_combo !== null ? bestPlay.max_combo + "x" : "-"}`;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Perfil de ${user.username}`)
        .setURL(osu.getUserUrl(user.id, mode))
        .setThumbnail(user.avatar_url)
        .setColor(user.is_online ? 0x99ff99 : 0xff66aa)
        .addFields(
          {
            name: '🌐 Ranks',
            value: `**Global:** #${stats.global_rank?.toLocaleString() || '-'}\n**Regional (${user.country_code}):** #${stats.country_rank?.toLocaleString() || '-'}`,
            inline: true,
          },
          {
            name: '📊 Estatísticas',
            value: `**Acc:** ${stats.hit_accuracy.toFixed(2)}%\n**Max Combo:** ${stats.maximum_combo}x`,
            inline: true,
          },
          {
            name: '🎮 Status',
            value: user.is_online
              ? '🟢 Online'
              : `🔴 Offline\nÚltima vez: ${toDiscordTimestamp(user.last_visit, 'R')}`,
            inline: true,
          },
          { name: '📌 Top Play', value: topPlayString, inline: false },
          { name: '📅 Conta Criada Em', value: toDiscordTimestamp(user.join_date, 'D'), inline: false }
        )
        .setFooter({ text: `osu! Stats • ${osu.getModeLabel(mode)}` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error.response?.data || error);
      if (error.response?.status === 404) return interaction.editReply('❌ Jogador não encontrado.');
      interaction.editReply('❌ Ocorreu um erro ao buscar os dados.');
    }
  },
};
