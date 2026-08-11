const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags,
} = require('discord.js');

const osu = require('../osuClient');
const daycore = require('../daycoreAdmin');
const { resolveStaff, checkRedisOrError } = require('../staffGuard');
const db = require('../db');
const { t } = require('../i18n');
const { logError } = require('../logger');

// Texto livre que acaba num embed (limite de 4096 no description) e no log de
// auditoria. Sem teto, um motivo muito longo faria o embed estourar e o
// comando falhar depois de a ação já ter sido aplicada no Daycore.
const REASON_MAX_LENGTH = 200;

// Recorta o que for renderizado a partir do banco: o /moderate log junta 15
// linhas, e mesmo motivos dentro do limite somam mais que um embed comporta.
function truncate(text, max) {
  const str = String(text ?? '');
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

/**
 * Resolve o alvo (nome ou ID) para os dados crus dele no Daycore.
 * `resolvePlayerId` faz busca exata: nome que não existe devolve null e o
 * comando recusa, em vez de acertar outra conta por causa de um typo.
 */
async function resolveTarget(input) {
  const osuId = await osu.resolvePlayerId(String(input).trim());
  if (!osuId) return null;
  return daycore.getPlayerPrivileges(osuId);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderate')
    .setDescription('Daycore moderation (staff only)')
    .setDescriptionLocalizations({ 'pt-BR': 'Moderação do Daycore (apenas staff)' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub =>
      sub.setName('restrict')
        .setDescription('Restrict a player')
        .setDescriptionLocalizations({ 'pt-BR': 'Restringe um jogador' })
        .addStringOption(o => o.setName('player')
          .setDescription('Player name or ID')
          .setDescriptionLocalizations({ 'pt-BR': 'Nome ou ID do jogador' })
          .setRequired(true)
          .setMaxLength(32))
        .addStringOption(o => o.setName('reason')
          .setDescription('Reason (goes into the Daycore audit log)')
          .setDescriptionLocalizations({ 'pt-BR': 'Motivo (vai para o log de auditoria do Daycore)' })
          .setRequired(true)
          .setMaxLength(REASON_MAX_LENGTH)))
    .addSubcommand(sub =>
      sub.setName('unrestrict')
        .setDescription('Lift a restriction')
        .setDescriptionLocalizations({ 'pt-BR': 'Remove a restrição de um jogador' })
        .addStringOption(o => o.setName('player')
          .setDescription('Player name or ID').setRequired(true).setMaxLength(32))
        .addStringOption(o => o.setName('reason')
          .setDescription('Reason').setRequired(true).setMaxLength(REASON_MAX_LENGTH)))
    .addSubcommand(sub =>
      sub.setName('check')
        .setDescription('Check a player\'s privileges and restriction status')
        .setDescriptionLocalizations({ 'pt-BR': 'Consulta privilégios e status de restrição de um jogador' })
        .addStringOption(o => o.setName('player')
          .setDescription('Player name or ID').setRequired(true).setMaxLength(32)))
    .addSubcommand(sub =>
      sub.setName('log')
        .setDescription('Recent actions taken through the bot')
        .setDescriptionLocalizations({ 'pt-BR': 'Ações recentes feitas pelo bot' })),

  async execute(interaction) {
    const s   = t(interaction);
    const sub = interaction.options.getSubcommand();

    // `check` e `log` só leem — MODERATOR basta. Restringir exige
    // ADMINISTRATOR, o mesmo que o !restrict in-game do bancho pede.
    const requiredPriv = (sub === 'check' || sub === 'log')
      ? daycore.Privileges.MODERATOR
      : daycore.Privileges.ADMINISTRATOR;

    const staff = await resolveStaff(interaction, requiredPriv, s);
    if (staff.error) {
      return interaction.reply({ content: staff.error, flags: MessageFlags.Ephemeral });
    }

    // ── /moderate log ────────────────────────────────────────────────────────
    if (sub === 'log') {
      const rows = db.listAdminActions(15);
      if (rows.length === 0) {
        return interaction.reply({ content: s.mod_log_empty, flags: MessageFlags.Ephemeral });
      }
      const lines = rows.map(r =>
        s.mod_log_line(
          new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' '),
          r.action, r.target, r.actor_osu_name ?? r.actor_discord_id,
          truncate(r.detail ?? '', 120),
        ));
      const embed = new EmbedBuilder()
        .setColor(0x99ccff)
        .setTitle(s.mod_log_title)
        .setDescription(truncate(lines.join('\n'), 4000));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (sub !== 'check') {
      const redisError = await checkRedisOrError(s);
      if (redisError) {
        return interaction.reply({ content: redisError, flags: MessageFlags.Ephemeral });
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const target = await resolveTarget(interaction.options.getString('player'));
      if (!target) return interaction.editReply(s.player_not_found);

      const isRestricted = !daycore.hasPriv(target.priv, daycore.Privileges.UNRESTRICTED);

      // ── /moderate check ────────────────────────────────────────────────────
      if (sub === 'check') {
        const embed = new EmbedBuilder()
          .setColor(isRestricted ? 0xff9999 : 0x99ff99)
          .setTitle(s.mod_check_title(target.name))
          .setDescription(
            s.mod_check_body(
              target.id,
              daycore.privLabel(target.priv),
              target.priv,
              isRestricted ? s.mod_restricted : s.mod_not_restricted,
            ),
          );
        return interaction.editReply({ embeds: [embed] });
      }

      const reason = interaction.options.getString('reason');

      if (target.id === staff.osuId) return interaction.editReply(s.mod_cannot_self);

      // O bancho recusa se o estado já for o pedido, mas ele não responde ao
      // publisher — sem checar aqui, o comando reportaria sucesso à toa.
      if (sub === 'restrict' && isRestricted)   return interaction.editReply(s.mod_already_restricted(target.name));
      if (sub === 'unrestrict' && !isRestricted) return interaction.editReply(s.mod_not_currently_restricted(target.name));

      // Quem publica precisa das duas identidades: a conta de jogo (que vira o
      // autor no log do servidor) e a do Discord (que vai assinada no motivo,
      // para a auditoria não depender do vínculo guardado aqui dentro).
      const actor = {
        osuId:       staff.osuId,
        discordId:   interaction.user.id,
        discordName: interaction.user.username,
      };

      if (sub === 'restrict') {
        await daycore.restrictPlayer(target.id, actor, reason);
      } else {
        await daycore.unrestrictPlayer(target.id, actor, reason);
      }

      const expectRestricted = sub === 'restrict';
      const confirmed = await daycore.verifyRestricted(target.id, expectRestricted);

      db.logAdminAction({
        action: sub,
        target: target.id,
        detail: `${target.name} | ${reason} | ${confirmed ? 'confirmado' : 'NAO confirmado'}`,
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      const embed = new EmbedBuilder()
        .setColor(confirmed ? 0x99ff99 : 0xffcc66)
        .setTitle(expectRestricted ? s.mod_restrict_title : s.mod_unrestrict_title)
        .setDescription(
          s.mod_action_body(target.name, target.id, reason) + '\n\n' +
          (confirmed ? s.mod_confirmed : s.mod_unconfirmed),
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('moderate', error);
      return interaction.editReply(s.admin_action_failed);
    }
  },
};
