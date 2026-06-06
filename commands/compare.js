const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const osu = require('../osuClient');

const center = (str, width) => {
  str = String(str);
  if (str.length >= width) return str;
  const left = Math.floor((width - str.length) / 2);
  const right = width - str.length - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription('Compara as estatísticas de dois jogadores')
    .addStringOption(option =>
      option.setName('user1').setDescription('Primeiro jogador').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('user2').setDescription('Segundo jogador').setRequired(true)
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
    const u1Name = interaction.options.getString('user1');
    const u2Name = interaction.options.getString('user2');
    const mode = interaction.options.getString('servidor') || osu.DEFAULT_MODE;

    await interaction.deferReply();

    try {
      const [u1, u2] = await Promise.all([osu.getUser(u1Name, mode), osu.getUser(u2Name, mode)]);
      if (!u1 || !u2) return interaction.editReply('❌ Um ou ambos os jogadores não foram encontrados.');

      const s1 = u1.statistics;
      const s2 = u2.statistics;

      let table = '```arm\n';
      table += `${center(u1.username, 12)} | ${center('osu!', 10)} | ${center(u2.username, 12)}\n`;
      table += `${'-'.repeat(13)}+${'-'.repeat(12)}+${'-'.repeat(13)}\n`;

      const rows = [
        [s1.global_rank, 'Rank', s2.global_rank, true],
        [s1.pp.toFixed(2), 'PP', s2.pp.toFixed(2)],
        [s1.hit_accuracy.toFixed(2) + '%', 'Accuracy', s2.hit_accuracy.toFixed(2) + '%'],
        [s1.level.current, 'Level', s2.level.current],
        [s1.maximum_combo + 'x', 'Max Combo', s2.maximum_combo + 'x'],
        [s1.play_count, 'Playcount', s2.play_count],
      ];

      rows.forEach(row => {
        const val1 = row[3] ? `#${row[0]?.toLocaleString()}` : row[0];
        const val2 = row[3] ? `#${row[2]?.toLocaleString()}` : row[2];
        table += `${center(val1, 12)} | ${center(row[1], 10)} | ${center(val2, 12)}\n`;
      });

      table += '```';

      const embed = new EmbedBuilder()
        .setColor(0x313338)
        .setTitle('Comparação osu!')
        .setDescription(table)
        .setFooter({ text: `Solicitado por ${interaction.user.username} • ${osu.getModeLabel(mode)}` });

      if (u1.avatar_url) embed.setThumbnail(u1.avatar_url);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      interaction.editReply('Erro ao comparar jogadores. Verifique se os nicks estão corretos.');
    }
  },
};
