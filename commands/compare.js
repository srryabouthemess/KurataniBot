const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const osu = require('../osuClient');
const { getLink } = require('../db');
const { t } = require('../i18n');
const { logError } = require('../logger');

const center = (str, width) => {
  str = String(str);
  if (str.length >= width) return str;
  const left  = Math.floor((width - str.length) / 2);
  const right = width - str.length - left;
  return ' '.repeat(left) + str + ' '.repeat(right);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('compare')
    .setDescription("Compare two players' statistics")
    .setDescriptionLocalizations({ 'pt-BR': 'Compara as estatísticas de dois jogadores' })
    // Permite instalar o bot na própria conta (User Install) e usar os
    // comandos em servidores, DM com o bot e DM/grupo entre outros usuários.
    // Requer "User Install" habilitado em Installation no Developer Portal.
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(option =>
      option
        .setName('user1')
        .setDescription('First player (optional if /link is set)')
        .setDescriptionLocalizations({ 'pt-BR': 'Primeiro jogador (opcional se tiver /link)' })
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('user2')
        .setDescription('Second player')
        .setDescriptionLocalizations({ 'pt-BR': 'Segundo jogador' })
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
    const manualU1 = interaction.options.getString('user1');
    const manualU2 = interaction.options.getString('user2');
    const mode     = interaction.options.getString('server') || osu.DEFAULT_MODE;
    const link     = getLink(interaction.user.id);

    let u1Name = manualU1 ?? (link ? link.osu_user : null);
    let u2Name = manualU2;

    if (!u1Name) {
      return interaction.reply({ content: s.compare_need_user1, ephemeral: true });
    }
    if (!u2Name) {
      return interaction.reply({ content: s.compare_need_user2, ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const [u1, u2] = await Promise.all([osu.getUser(u1Name, mode), osu.getUser(u2Name, mode)]);
      if (!u1 || !u2) return interaction.editReply(s.compare_not_found);

      const s1 = u1.statistics;
      const s2 = u2.statistics;

      let table = '```arm\n';
      table += `${center(u1.username, 12)} | ${center(s.compare_header_label, 10)} | ${center(u2.username, 12)}\n`;
      table += `${'-'.repeat(13)}+${'-'.repeat(12)}+${'-'.repeat(13)}\n`;

      const rows = [
        [s1.global_rank,                            'Rank',      s2.global_rank,                            true ],
        [s1.pp.toFixed(2),                          'PP',        s2.pp.toFixed(2)                                ],
        [s1.hit_accuracy.toFixed(2) + '%',          'Accuracy',  s2.hit_accuracy.toFixed(2) + '%'               ],
        [s1.level.current,                          'Level',     s2.level.current                               ],
        [s1.maximum_combo + 'x',                    'Max Combo', s2.maximum_combo + 'x'                         ],
        [s1.play_count,                             'Playcount', s2.play_count                                  ],
      ];

      rows.forEach(row => {
        const val1 = row[3] ? (row[0] ? `#${row[0].toLocaleString()}` : s.profile_unranked) : row[0];
        const val2 = row[3] ? (row[2] ? `#${row[2].toLocaleString()}` : s.profile_unranked) : row[2];
        table += `${center(val1, 12)} | ${center(row[1], 10)} | ${center(val2, 12)}\n`;
      });

      table += '```';

      const embed = new EmbedBuilder()
        .setColor(0x313338)
        .setTitle(s.compare_title)
        .setDescription(table)
        .setFooter({ text: s.compare_footer(interaction.user.username, osu.getModeLabel(mode)) });

      if (u1.avatar_url) embed.setThumbnail(u1.avatar_url);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('compare', error);
      interaction.editReply(s.compare_error);
    }
  },
};
