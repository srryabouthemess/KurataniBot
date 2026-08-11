const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags, PermissionFlagsBits,
} = require('discord.js');

const osu = require('../osuClient');
const daycore = require('../daycoreAdmin');
const db = require('../db');
const { t } = require('../i18n');
const { logError } = require('../logger');

/**
 * Vincula contas do Discord a contas do Daycore para fins de PERMISSÃO.
 *
 * Por que não reaproveitar o /link: aquele é auto-declarado — só confere que a
 * conta existe, não que quem rodou o comando é dono dela. Serve bem para os
 * comandos de consulta, onde no máximo você vê o PP de outra pessoa. Como base
 * de autorização, deixaria qualquer um do servidor virar administrador do
 * Daycore linkando o nick de um admin.
 *
 * A raiz de confiança aqui é ter **Administrator no Discord do Daycore**. Não é
 * uma permissão qualquer do Discord: o comando só funciona naquele servidor
 * específico (DAYCORE_GUILD_ID), que é controlado por quem administra o
 * Daycore. Em qualquer outro servidor, onde "ser admin" não significa nada, o
 * comando é recusado antes de olhar permissão.
 *
 * ── O que este comando AINDA não garante ──────────────────────────────────────
 * O vínculo é auto-declarado do lado do jogo: nada prova que a conta informada
 * pertence ao membro sendo vinculado. Quem tem Administrator no Discord pode
 * apontar a própria conta do Discord para o nick de outro staff e passar a agir
 * com o privilégio dele. E "Administrator no Discord" não é o mesmo conjunto de
 * pessoas que "staff do servidor de jogo" — um community manager entra num, não
 * no outro.
 *
 * Mitigado, não resolvido: toda ação publicada leva o Discord de quem pediu
 * assinado no motivo (ver `signReason` em daycoreAdmin.js), então o log do
 * **servidor** registra as duas pontas e a auditoria não depende de o bot estar
 * íntegro. Continua sendo possível agir em nome de outro; deixa de ser possível
 * fazer isso sem rastro.
 *
 * A correção de raiz é provar posse da conta antes de vincular — código
 * temporário que a pessoa cola no perfil do osu!, ou OAuth do próprio servidor.
 * Está em aberto de propósito, para quando o fluxo administrativo for testado
 * de verdade contra um bancho.py real.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Manage which Discord accounts map to Daycore staff accounts')
    .setDescriptionLocalizations({ 'pt-BR': 'Gerencia quais contas do Discord correspondem a contas de staff do Daycore' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    // Esconde o comando de quem não é admin no Discord. É só usabilidade — a
    // checagem que vale é a do execute(), já que permissão default pode ser
    // sobrescrita nas configurações do servidor.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
      sub.setName('register')
        .setDescription('Link a Discord member to their Daycore account')
        .setDescriptionLocalizations({ 'pt-BR': 'Vincula um membro do Discord à conta dele no Daycore' })
        .addUserOption(o => o.setName('member')
          .setDescription('Discord member')
          .setDescriptionLocalizations({ 'pt-BR': 'Membro do Discord' })
          .setRequired(true))
        .addStringOption(o => o.setName('player')
          .setDescription('Their Daycore username')
          .setDescriptionLocalizations({ 'pt-BR': 'O nome dele(a) no Daycore' })
          .setRequired(true)
          .setMaxLength(32)))
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove a staff link')
        .setDescriptionLocalizations({ 'pt-BR': 'Remove um vínculo de staff' })
        .addUserOption(o => o.setName('member')
          .setDescription('Discord member').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List all staff links')
        .setDescriptionLocalizations({ 'pt-BR': 'Lista todos os vínculos de staff' })),

  async execute(interaction) {
    const s   = t(interaction);
    const sub = interaction.options.getSubcommand();

    const guildId = process.env.DAYCORE_GUILD_ID;
    if (!guildId) {
      return interaction.reply({ content: s.admin_not_configured, flags: MessageFlags.Ephemeral });
    }
    if (interaction.guildId !== guildId) {
      return interaction.reply({ content: s.admin_wrong_guild, flags: MessageFlags.Ephemeral });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: s.staff_need_admin, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'list') {
      const rows = db.listStaffLinks();
      if (rows.length === 0) {
        return interaction.reply({ content: s.staff_list_empty, flags: MessageFlags.Ephemeral });
      }
      const embed = new EmbedBuilder()
        .setColor(0x99ccff)
        .setTitle(s.staff_list_title)
        .setDescription(rows.map(r =>
          s.staff_list_line(r.discord_id, r.osu_name ?? '?', r.osu_id)).join('\n'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const member = interaction.options.getUser('member');

    if (sub === 'remove') {
      const removed = db.removeStaffLink(member.id);
      return interaction.reply({
        content: removed ? s.staff_removed(member.id) : s.staff_nothing_to_remove(member.id),
        flags: MessageFlags.Ephemeral,
      });
    }

    // register
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const name = interaction.options.getString('player');
      const osuId = await osu.resolvePlayerId(name);
      if (!osuId) return interaction.editReply(s.player_not_found);

      const player = await daycore.getPlayerPrivileges(osuId);
      if (!player) return interaction.editReply(s.player_not_found);

      db.setStaffLink(member.id, player.id, player.name, interaction.user.id);

      // Mostra o cargo atual só como conferência: o vínculo não concede nada
      // por si só — a permissão vem do priv, relido a cada comando.
      const embed = new EmbedBuilder()
        .setColor(0x99ff99)
        .setTitle(s.staff_registered_title)
        .setDescription(s.staff_registered_body(
          member.id, player.name, player.id, daycore.privLabel(player.priv),
        ));
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('staff', error);
      return interaction.editReply(s.admin_action_failed);
    }
  },
};
