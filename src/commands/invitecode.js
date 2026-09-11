/**
 * /invitecode — gera um código de convite do Daycore.
 *
 * O Daycore passou a exigir código de convite para registro. Quem gera é o
 * Shiina (site), com um INSERT direto na tabela `invite_codes` — não há rota
 * HTTP nem canal Redis para isso (ver o cabeçalho de `daycoreInvites.js`
 * para a análise completa, feita direto no código-fonte do VPS).
 *
 * Este comando produz um código que o `register.java` do site aceita
 * exatamente como um criado pelo painel: mesmo alfabeto, mesmo tamanho,
 * mesma tabela. Não existe um segundo formato de convite.
 *
 * ── Por que ADMINISTRATOR, e não DEVELOPER como /wipe e /scorewipe ───────────
 * O `CreateInvite.java` do site exige `PermissionHelper.hasPrivileges(user.priv,
 * ADMINISTRATOR)` para o botão aparecer e a rota aceitar. Espelhar esse
 * mesmo bit é o ponto inteiro de "o bot não inventa uma regra paralela" —
 * quem já pode gerar convite pelo site pode gerar pelo bot, nem mais nem
 * menos.
 *
 * ── Por que não há confirmação com botão, como as ações destrutivas ─────────
 * Gerar um convite não desfaz estado de ninguém: o pior caso de um clique
 * errado é um código extra, não usado, que o `/ap/invites` do site já deixa
 * revogar. A trava aqui é a de PERMISSÃO (resolveStaff), não a de
 * confirmação — mesmo critério do /role.
 */

const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags,
} = require('discord.js');

const daycoreInvites = require('../daycoreInvites');
const daycore = require('../daycoreAdmin');
const { resolveStaff } = require('../staffGuard');
const { registrarAcao } = require('../adminLog');
const { t } = require('../i18n');
const { logError } = require('../logger');

const NOTE_MAX_LENGTH = 255; // mesmo teto da coluna `note` no banco.

/**
 * Confirma que dá para falar com o MySQL do Daycore antes de prometer nada.
 * Mesmo formato do checkRedisOrError em staffGuard.js, mas só usado aqui —
 * nenhum outro comando fala com esse banco hoje.
 */
async function checkMysqlOrError(s) {
  const check = await daycoreInvites.checkConnection();
  if (check.ok) return null;

  if (check.reason === 'unconfigured') return s.invitecode_unconfigured;

  logError('invitecode:mysql', new Error(check.error ?? 'sem detalhe'));
  return s.invitecode_unreachable;
}

module.exports = {
  // Como /role e /scorewipe: ação de staff, resposta efêmera — em texto a
  // flag de efêmero some (ver prefix/spec.js).
  prefix: { slashOnly: true },

  data: new SlashCommandBuilder()
    .setName('invitecode')
    .setDescription('Generate a Daycore invite code (Administrator only)')
    .setDescriptionLocalizations({ 'pt-BR': 'Gera um código de convite do Daycore (só Administrator)' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addIntegerOption(o => o.setName('max_uses')
      .setDescription('How many registrations this code accepts (default: 1)')
      .setDescriptionLocalizations({ 'pt-BR': 'Quantos registros este código aceita (padrão: 1)' })
      .setMinValue(1))
    .addIntegerOption(o => o.setName('expires_days')
      .setDescription('Days until the code expires (default: never)')
      .setDescriptionLocalizations({ 'pt-BR': 'Dias até o código expirar (padrão: nunca)' })
      .setMinValue(1))
    .addStringOption(o => o.setName('note')
      .setDescription('Note for the invites panel (optional)')
      .setDescriptionLocalizations({ 'pt-BR': 'Anotação para o painel de convites (opcional)' })
      .setMaxLength(NOTE_MAX_LENGTH)),

  async execute(interaction) {
    const s = t(interaction);

    // Mesmo bit que o site exige no formulário — ver o cabeçalho.
    const staff = await resolveStaff(interaction, daycore.Privileges.ADMINISTRATOR, s);
    if (staff.error) {
      return interaction.reply({ content: staff.error, flags: MessageFlags.Ephemeral });
    }

    const mysqlError = await checkMysqlOrError(s);
    if (mysqlError) {
      return interaction.reply({ content: mysqlError, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const maxUses     = interaction.options.getInteger('max_uses') ?? 1;
      const expiresDays = interaction.options.getInteger('expires_days');
      const note        = interaction.options.getString('note');

      const code = await daycoreInvites.createInviteCode({
        maxUses,
        expiresDays,
        note,
        createdByOsuId: staff.osuId,
      });

      const registrado = registrarAcao('invitecode', {
        action: 'invitecode',
        target: staff.osuId,
        detail: `${code} | max_uses=${maxUses} | expires_days=${expiresDays ?? 'never'} | note=${note ?? '-'}`,
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      const embed = new EmbedBuilder()
        .setColor(registrado ? 0x99ff99 : 0xffcc66)
        .setTitle(s.invitecode_done_title)
        .setDescription(
          s.invitecode_done_body(code, maxUses, expiresDays) +
          (registrado ? '' : '\n\n' + s.admin_log_failed),
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('invitecode', error);
      return interaction.editReply(s.admin_action_failed);
    }
  },
};
