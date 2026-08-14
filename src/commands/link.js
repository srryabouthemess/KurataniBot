const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const { setLink, getLink, getAllLinks, removeLink, setPreferredServer, getPreferredServer, linkNamespace } = require('../db');
const { t } = require('../i18n');
const { exigirSubcomando } = require('../subcommands');
const osu = require('../osuClient');
const servers = require('../servers');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const SERVER_CHOICES = servers.choices();

/**
 * Rótulo a exibir para uma conta linkada. Vanilla e RX do mesmo servidor
 * compartilham o cadastro, então o link é listado com o nome do servidor —
 * não faria sentido mostrar duas linhas com o mesmo nick.
 */
function namespaceLabel(namespace) {
  return servers.label(servers.keyForNamespace(namespace));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to an osu! profile')
    .setDescriptionLocalizations({ 'pt-BR': 'Vincula sua conta Discord a um perfil osu!' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set or update your link for a server')
        .setDescriptionLocalizations({ 'pt-BR': 'Define ou atualiza seu link em um servidor' })
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
            .addChoices(...SERVER_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a link (or all of them)')
        .setDescriptionLocalizations({ 'pt-BR': 'Remove um link (ou todos)' })
        .addStringOption(opt =>
          opt
            .setName('server')
            .setDescription('Which link to remove (default: all)')
            .setDescriptionLocalizations({ 'pt-BR': 'Qual link remover (padrão: todos)' })
            .setRequired(false)
            .addChoices(...SERVER_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show your links')
        .setDescriptionLocalizations({ 'pt-BR': 'Mostra seus links' })
    )
    .addSubcommand(sub =>
      sub
        .setName('default')
        .setDescription('Choose which server commands use by default')
        .setDescriptionLocalizations({ 'pt-BR': 'Escolhe qual servidor os comandos usam por padrão' })
        .addStringOption(opt =>
          opt
            .setName('server')
            .setDescription('Server to use by default')
            .setDescriptionLocalizations({ 'pt-BR': 'Servidor a usar por padrão' })
            .setRequired(true)
            .addChoices(...SERVER_CHOICES)
        )
    ),

  async execute(interaction) {
    const s   = t(interaction);
    // Lança se o subcomando não estiver declarado no builder — ver
    // subcommands.js para o que cada um destes fazia em silêncio antes.
    const sub = exigirSubcomando(module.exports, interaction);

    if (sub === 'status') {
      const links = getAllLinks(interaction.user.id);
      if (links.length === 0) {
        return interaction.reply({ content: s.link_no_link, flags: MessageFlags.Ephemeral });
      }

      const preferred = getPreferredServer(interaction.user.id) ?? osu.DEFAULT_MODE;
      const preferredNs = linkNamespace(preferred);

      const lines = links.map(l =>
        s.link_status_line(
          // Se o preferido é RX, mostra "Daycore RX" na linha do Daycore para
          // a pessoa saber qual modo vai ser usado por padrão.
          l.namespace === preferredNs ? osu.getModeLabel(preferred) : namespaceLabel(l.namespace),
          l.osu_user,
          l.namespace === preferredNs
        )
      );

      return interaction.reply({
        content: `${s.link_status_header}\n${lines.join('\n')}\n\n-# ${s.link_status_hint}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'remove') {
      const server = interaction.options.getString('server');

      if (!server) {
        const count = removeLink(interaction.user.id, null);
        return interaction.reply({
          content: count > 0 ? s.link_removed_all(count) : s.link_nothing_to_remove,
          flags: MessageFlags.Ephemeral,
        });
      }

      const count = removeLink(interaction.user.id, server);
      return interaction.reply({
        content: count > 0 ? s.link_removed_server(namespaceLabel(linkNamespace(server))) : s.link_nothing_to_remove,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'default') {
      const server = interaction.options.getString('server');

      // Só faz sentido apontar o padrão para um servidor onde há link.
      if (!getLink(interaction.user.id, server)) {
        return interaction.reply({ content: s.link_default_missing(osu.getModeLabel(server)), flags: MessageFlags.Ephemeral });
      }

      setPreferredServer(interaction.user.id, server);
      return interaction.reply({ content: s.link_default_set(osu.getModeLabel(server)), flags: MessageFlags.Ephemeral });
    }

    // Explícito, e não como "tudo que sobrou".
    //
    // Este ramo ESCREVE, e era o destino de qualquer subcomando desconhecido:
    // um `addSubcommand` novo sem o ramo correspondente aqui viraria um /link
    // set silencioso. Pelo Discord não acontece (ele só envia subcomando
    // declarado), mas a proteção custa uma linha e o estrago seria um vínculo
    // criado sem ninguém ter pedido.
    if (sub !== 'set') {
      throw new Error(`/link: subcomando sem tratamento: "${sub}"`);
    }

    const username = interaction.options.getString('player');
    const server   = interaction.options.getString('server') || osu.DEFAULT_MODE;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const user = await osu.getUser(username, server);
      if (!user) return interaction.editReply(s.link_not_found);

      // Guarda também o ID numérico: o nome do osu! pode mudar, o ID não.
      setLink(interaction.user.id, server, user.username, user.id);

      const embed = new EmbedBuilder()
        .setColor(0x99ff99)
        .setTitle(s.link_success_title)
        .setThumbnail(user.avatar_url)
        .setDescription(s.link_success_desc(user.username, osu.getModeLabel(server)));

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('link', error);
      return safeEditReply(interaction, s.link_error);
    }
  },
};
