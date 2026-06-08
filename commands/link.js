const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { setLink, getLink, removeLink } = require('../db');
const { t } = require('../i18n');
const osu = require('../osuClient');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to an osu! profile')
    .setDescriptionLocalizations({ 'pt-BR': 'Vincula sua conta Discord a um perfil osu!' })
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set or update your link')
        .setDescriptionLocalizations({ 'pt-BR': 'Define ou atualiza seu link' })
        .addStringOption(opt =>
          opt
            .setName('player')
            .setDescription('Your osu!/Daycore username')
            .setDescriptionLocalizations({ 'pt-BR': 'Seu nome no osu!/Daycore' })
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('server')
            .setDescription('Profile server (default: Bancho)')
            .setDescriptionLocalizations({ 'pt-BR': 'Servidor do perfil (padrão: Bancho)' })
            .setRequired(false)
            .addChoices(
              { name: 'Bancho',     value: 'official'   },
              { name: 'Daycore',    value: 'private'     },
              { name: 'Daycore RX', value: 'private_rx'  }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove your current link')
        .setDescriptionLocalizations({ 'pt-BR': 'Remove seu link atual' })
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show your current link')
        .setDescriptionLocalizations({ 'pt-BR': 'Mostra seu link atual' })
    ),

  async execute(interaction) {
    const s   = t(interaction);
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const link = getLink(interaction.user.id);
      if (!link) return interaction.reply({ content: s.link_no_link, ephemeral: true });
      return interaction.reply({
        content: s.link_status_msg(link.osu_user, osu.getModeLabel(link.server)),
        ephemeral: true,
      });
    }

    if (sub === 'remove') {
      const removed = removeLink(interaction.user.id);
      return interaction.reply({
        content: removed ? s.link_removed : s.link_nothing_to_remove,
        ephemeral: true,
      });
    }

    // set
    const username = interaction.options.getString('player');
    const server   = interaction.options.getString('server') || osu.DEFAULT_MODE;

    await interaction.deferReply({ ephemeral: true });

    try {
      const user = await osu.getUser(username, server);
      if (!user) return interaction.editReply(s.link_not_found);

      setLink(interaction.user.id, user.username, server);

      const embed = new EmbedBuilder()
        .setColor(0x99ff99)
        .setTitle(s.link_success_title)
        .setThumbnail(user.avatar_url)
        .setDescription(s.link_success_desc(user.username, osu.getModeLabel(server)));

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      interaction.editReply(s.link_error);
    }
  },
};
