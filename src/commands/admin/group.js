/**
 * /group — põe e tira jogador de um grupo do Daycore (Legit, Closet, Blatant...).
 *
 * O grupo decide em qual leaderboard o jogador joga e aparece. Quem registra a
 * conta é que precisava ir ao painel do site e colocar o grupo à mão.
 *
 * ── Quem grava ────────────────────────────────────────────────────────────────
 * O bot só publica no canal `setgroup`; o bancho grava em `sh_groups_users` e
 * já reposiciona o jogador nos sorted sets de leaderboard (ver o patch do
 * Daycore, `set_user_group`). O MySQL aqui é só leitura: listar os grupos e
 * conferir o efeito depois, porque pub/sub não devolve resultado.
 *
 * ── Privilégio ────────────────────────────────────────────────────────────────
 * MODERATOR. Grupo não dá poder sobre conta nenhuma, só muda onde o jogador
 * aparece, e é tarefa de rotina de registro. O servidor não confere quem
 * publicou, então esta é a única tranca.
 */

const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType,
} = require('discord.js');

const osu = require('../../osuClient');
const daycore = require('../../daycoreAdmin');
const daycoreMysql = require('../../daycoreMysql');
const { resolveStaff, checkRedisOrError } = require('../../staffGuard');
const { registrarAcao } = require('../../adminLog');
const { t } = require('../../i18n');
const { exigirSubcomando } = require('../../subcommands');
const { logError } = require('../../lib/logger');

// Mesmo teto do /role.
const REASON_MAX_LENGTH = 200;

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
    .addStringOption(o => o.setName('group')
      .setDescription('Group name (e.g. Legit)')
      .setDescriptionLocalizations({ 'pt-BR': 'Nome do grupo (ex.: Legit)' })
      .setRequired(true)
      .setMaxLength(64))
    .addStringOption(o => o.setName('reason')
      .setDescription('Reason (recorded by the bot)')
      .setDescriptionLocalizations({ 'pt-BR': 'Motivo (registrado pelo bot)' })
      .setRequired(true)
      .setMaxLength(REASON_MAX_LENGTH));
}

/** Confirma que dá para falar com o MySQL do Daycore antes de prometer nada. */
async function checkMysqlOrError(s) {
  const check = await daycoreMysql.checkConnection();
  if (check.ok) return null;

  if (check.reason === 'unconfigured') return s.group_unconfigured;

  logError('group:mysql', new Error(check.error ?? 'sem detalhe'));
  return s.group_unreachable;
}

module.exports = {
  // Como o /role: resposta efêmera, e em texto a flag de efêmero some.
  prefix: { slashOnly: true },
  defer: 'ephemeral',

  data: new SlashCommandBuilder()
    .setName('group')
    .setDescription('Add and remove players from leaderboard groups (staff only)')
    .setDescriptionLocalizations({ 'pt-BR': 'Põe e tira jogadores de grupos de leaderboard (apenas staff)' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub => opcoes(sub.setName('add'), 'Add a player to a group', 'Põe um jogador num grupo'))
    .addSubcommand(sub => opcoes(sub.setName('remove'), 'Remove a player from a group', 'Tira um jogador de um grupo')),

  async execute(interaction) {
    const s   = t(interaction);
    const sub = exigirSubcomando(module.exports, interaction);

    // Subcomando declarado e sem ramo aqui cairia no `remove` e tiraria grupo
    // de alguém sozinho — a mesma guarda do /role.
    if (sub !== 'add' && sub !== 'remove') {
      throw new Error(`/group: subcomando declarado mas sem tratamento: "${sub}"`);
    }

    const staff = await resolveStaff(interaction, daycore.Privileges.MODERATOR, s);
    if (staff.error) return interaction.editReply(staff.error);

    const redisError = await checkRedisOrError(s);
    if (redisError) return interaction.editReply(redisError);

    const mysqlError = await checkMysqlOrError(s);
    if (mysqlError) return interaction.editReply(mysqlError);

    try {
      const reason    = interaction.options.getString('reason');
      const groupName = String(interaction.options.getString('group')).trim();

      const targetId = await osu.resolvePlayerId(String(interaction.options.getString('player')).trim());
      if (!targetId) return interaction.editReply(s.player_not_found);

      const target = await daycore.getPlayerPrivileges(targetId);
      if (!target) return interaction.editReply(s.player_not_found);

      // Mover a si mesmo para outro leaderboard é a trava do /role e do
      // /moderate: quem decide sobre a conta não é a própria conta.
      if (target.id === staff.osuId) return interaction.editReply(s.mod_cannot_self);

      const group = await daycore.findGroupByName(groupName);
      if (!group) {
        const lista = (await daycore.listGroups()).map(g => `\`${g.name}\``).join(', ');
        return interaction.editReply(s.group_unknown(groupName, lista || '—'));
      }

      // Pub/sub não devolve resultado: sem conferir antes, o comando anunciaria
      // sucesso de uma publicação que não muda nada.
      const jaEsta = (await daycore.getUserGroupIds(target.id)).includes(group.id);
      if (sub === 'add' && jaEsta)  return interaction.editReply(s.group_already_in(target.name, group.name));
      if (sub === 'remove' && !jaEsta) return interaction.editReply(s.group_not_in(target.name, group.name));

      const actor = {
        osuId:       staff.osuId,
        discordId:   interaction.user.id,
        discordName: interaction.user.username,
      };

      await daycore.setGroup(target.id, group.id, sub, actor);

      const confirmado = await daycore.verifyGroup(target.id, group.id, sub === 'add');

      // Pelo adminLog, e não pelo `db` direto: neste ponto o grupo JÁ mudou, e
      // uma falha de SQLite não pode cair no `catch` e responder "nada foi
      // confirmado" para uma ação que aconteceu.
      const registrado = registrarAcao('group', {
        action: sub === 'add' ? 'addgroup' : 'removegroup',
        target: target.id,
        detail: `${target.name} | ${group.name} | ${reason} | ${confirmado ? 'confirmado' : 'NAO confirmado'}`,
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      const embed = new EmbedBuilder()
        .setColor(confirmado && registrado ? 0x99ff99 : 0xffcc66)
        .setTitle(sub === 'add' ? s.group_add_title(group.name) : s.group_remove_title(group.name))
        .setDescription(
          s.group_body(target.name, target.id, group.name, reason) + '\n\n' +
          (confirmado ? s.mod_confirmed : s.mod_unconfirmed) +
          (registrado ? '' : '\n\n' + s.admin_log_failed),
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('group', error);
      return interaction.editReply(s.admin_action_failed);
    }
  },
};
