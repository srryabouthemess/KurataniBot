/**
 * /role — dá e tira cargo do Daycore (Nominator, Moderator, Administrator, ...).
 *
 * ── O servidor não filtra nada aqui ───────────────────────────────────────────
 * O `addpriv`/`removepriv` do bancho (app/api/utils.py) só checa se o alvo
 * existe e se o cargo pedido não é DONATOR. Ele NÃO olha quem publicou — ao
 * contrário do `restrict`, que recusa sozinho um não-Developer mexendo em
 * staff. É a mesma situação do /wipe: o que este arquivo decidir é o que
 * acontece.
 *
 * ── Por que o privilégio exigido varia por cargo ──────────────────────────────
 * Está na tabela ROLES do daycoreAdmin, junto do porquê. Em resumo: conceder
 * `mod`, `admin` ou `developer` é conceder poder sobre outras contas, e exige
 * DEVELOPER; os outros cinco param em ADMINISTRATOR para dar cargo a um mapper
 * novo não depender de o dono estar por perto.
 *
 * ── O motivo não chega ao servidor ────────────────────────────────────────────
 * Estes dois canais não têm campo de motivo, então o `reason` daqui vive só no
 * `admin_actions` do bot. O comentário de `addPrivilege` explica o que isso
 * custa e como fechar.
 */

const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags,
} = require('discord.js');

const osu = require('../osuClient');
const daycore = require('../daycoreAdmin');
const { resolveStaff, checkRedisOrError } = require('../staffGuard');
const db = require('../db');
const { t } = require('../i18n');
const { exigirSubcomando } = require('../subcommands');
const { logError } = require('../logger');

// Mesmo teto do /moderate e do /wipe. Aqui o texto não vai para o log do
// servidor, mas vai para o embed e para o admin_actions.
const REASON_MAX_LENGTH = 200;

/** As choices saem da tabela, como o /wipe faz com os GameModes. */
const ROLE_CHOICES = Object.entries(daycore.ROLES)
  .map(([value, { bit }]) => ({ name: daycore.labelOfBit(bit), value }));

/** Os dois subcomandos pedem exatamente as mesmas três opções. */
function opcoes(sub, descricao, descricaoPt) {
  return sub
    .setDescription(descricao)
    .setDescriptionLocalizations({ 'pt-BR': descricaoPt })
    .addStringOption(o => o.setName('player')
      .setDescription('Player name or ID')
      .setDescriptionLocalizations({ 'pt-BR': 'Nome ou ID do jogador' })
      .setRequired(true)
      .setMaxLength(32))
    .addStringOption(o => o.setName('role')
      .setDescription('Which role')
      .setDescriptionLocalizations({ 'pt-BR': 'Qual cargo' })
      .setRequired(true)
      .addChoices(...ROLE_CHOICES))
    .addStringOption(o => o.setName('reason')
      .setDescription('Reason (recorded by the bot)')
      .setDescriptionLocalizations({ 'pt-BR': 'Motivo (registrado pelo bot)' })
      .setRequired(true)
      .setMaxLength(REASON_MAX_LENGTH));
}

module.exports = {
  // Como o /moderate e o /staff: a resposta traz privilégio de terceiro, e em
  // texto a flag de efêmero some — ver o comentário em prefix/spec.js.
  prefix: { slashOnly: true },

  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Grant and remove Daycore server roles (staff only)')
    .setDescriptionLocalizations({ 'pt-BR': 'Dá e tira cargos do Daycore (apenas staff)' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub => opcoes(sub.setName('give'), 'Grant a role', 'Concede um cargo'))
    .addSubcommand(sub => opcoes(sub.setName('take'), 'Remove a role', 'Remove um cargo')),

  async execute(interaction) {
    const s   = t(interaction);
    // Lança se o subcomando não estiver declarado no builder — ver
    // subcommands.js.
    const sub = exigirSubcomando(module.exports, interaction);

    // A guarda do caso inverso: subcomando DECLARADO e sem ramo aqui. Sem ela,
    // um `addSubcommand` novo cairia no ramo do `take` e tiraria cargo de
    // alguém sozinho.
    if (sub !== 'give' && sub !== 'take') {
      throw new Error(`/role: subcomando declarado mas sem tratamento: "${sub}"`);
    }

    const roleKey = interaction.options.getString('role');
    const role    = daycore.ROLES[roleKey];
    // O Discord só envia choice declarada, e o modo texto nem chega aqui
    // (slashOnly). Sobra o chamador que não é nenhum dos dois.
    if (!role) throw new Error(`/role: cargo fora da tabela: "${roleKey}"`);

    // O cargo escolhido é que decide o privilégio exigido — ver ROLES.
    const staff = await resolveStaff(interaction, role.requires, s);
    if (staff.error) {
      return interaction.reply({ content: staff.error, flags: MessageFlags.Ephemeral });
    }

    const redisError = await checkRedisOrError(s);
    if (redisError) {
      return interaction.reply({ content: redisError, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const reason   = interaction.options.getString('reason');
      const roleName = daycore.labelOfBit(role.bit);

      const targetId = await osu.resolvePlayerId(String(interaction.options.getString('player')).trim());
      if (!targetId) return interaction.editReply(s.player_not_found);

      const target = await daycore.getPlayerPrivileges(targetId);
      if (!target) return interaction.editReply(s.player_not_found);

      // O privilégio exigido já barra a auto-promoção a staff, mas não barraria
      // um Administrator se dando `whitelisted` — que é bypass de anticheat.
      // Isso é ganho real, então a trava do /moderate vale aqui também.
      if (target.id === staff.osuId) return interaction.editReply(s.mod_cannot_self);

      // Espelha a regra que o bancho aplica no restrict e que ele NÃO aplica
      // aqui. Sem ela, um Administrator tira o `nominator` de um Moderator.
      if (daycore.isStaff(target.priv) && !daycore.hasPriv(staff.priv, daycore.Privileges.DEVELOPER)) {
        return interaction.editReply(
          s.mod_target_is_staff(target.name, daycore.privLabel(target.priv)),
        );
      }

      // Pub/sub não devolve resultado: sem conferir antes, o comando anunciaria
      // sucesso de uma publicação que não muda nada.
      const jaTem = daycore.hasPriv(target.priv, role.bit);
      if (sub === 'give' && jaTem)  return interaction.editReply(s.role_already_has(target.name, roleName));
      if (sub === 'take' && !jaTem) return interaction.editReply(s.role_missing(target.name, roleName));

      const actor = {
        osuId:       staff.osuId,
        discordId:   interaction.user.id,
        discordName: interaction.user.username,
      };

      if (sub === 'give') {
        await daycore.addPrivilege(target.id, roleKey, actor);
      } else {
        await daycore.removePrivilege(target.id, roleKey, actor);
      }

      const confirmado = await daycore.verifyPriv(target.id, role.bit, sub === 'give');

      // O único lugar onde a conta do Discord fica amarrada a esta ação: o log
      // do servidor não tem campo de motivo nestes dois canais.
      db.logAdminAction({
        action: sub === 'give' ? 'addpriv' : 'removepriv',
        target: target.id,
        detail: `${target.name} | ${roleKey} | ${reason} | ${confirmado ? 'confirmado' : 'NAO confirmado'}`,
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      const embed = new EmbedBuilder()
        .setColor(confirmado ? 0x99ff99 : 0xffcc66)
        .setTitle(sub === 'give' ? s.role_give_title(roleName) : s.role_take_title(roleName))
        .setDescription(
          s.role_body(target.name, target.id, roleName, reason) + '\n\n' +
          (confirmado ? s.mod_confirmed : s.mod_unconfirmed),
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('role', error);
      return interaction.editReply(s.admin_action_failed);
    }
  },
};
