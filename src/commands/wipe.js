/**
 * /wipe — apaga os scores de um jogador num modo e zera as estatísticas dele ali.
 *
 * ── O que torna este comando diferente de todos os outros ─────────────────────
 * É o único IRREVERSÍVEL. O `rank` se desfaz com `unrank`, o `restrict` com
 * `unrestrict`. Aqui o bancho faz `DELETE FROM scores` e zera a linha de
 * `stats`: depois de publicado, nem o dono do servidor recupera.
 *
 * E, ao contrário do `restrict`, o `wipe_user` do bancho **não confere
 * privilégio nenhum** — só checa se o alvo existe. Nos outros comandos o
 * servidor é uma segunda tranca que recusa sozinho o que não devia passar;
 * aqui não existe segunda tranca. O que este arquivo decidir é o que acontece.
 *
 * Daí as três travas que os outros comandos administrativos não têm:
 *
 *   1. Exige DEVELOPER, não ADMINISTRATOR. É o privilégio mais alto do bancho,
 *      e o único proporcional a uma ação sem volta que o servidor não filtra.
 *   2. Confirmação explícita, com os números que serão destruídos na tela. Quem
 *      confirma vê "3076pp, 679 plays" antes de apertar, não depois.
 *   3. O log de auditoria guarda esses números. Depois do wipe eles não existem
 *      em lugar nenhum — o registro do bot vira a única prova de que existiram.
 *
 * O modo é obrigatório e sem padrão: o wipe age sobre UM modo, e deixar o bot
 * escolher por omissão seria apagar o que ninguém pediu.
 */

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ApplicationIntegrationType, InteractionContextType, MessageFlags,
} = require('discord.js');

const osu = require('../osuClient');
const daycore = require('../daycoreAdmin');
const { resolveStaff, checkRedisOrError } = require('../staffGuard');
const { registrarAcao } = require('../adminLog');
const { t } = require('../i18n');
const { logError } = require('../logger');

const REASON_MAX_LENGTH = 200;

// Janela da confirmação. Curta de propósito: um botão de destruição pendurado
// numa mensagem antiga é um acidente esperando alguém passar por perto.
const CONFIRM_MS = 60_000;

/** Só os modos que o bancho nomeia (ver GameModes em daycoreAdmin). */
const MODE_CHOICES = Object.entries(daycore.GameModes)
  .map(([value, name]) => ({ name, value: Number(value) }));

/** Um resumo legível do que existe hoje — e que deixará de existir. */
function describeStats(stats, s) {
  if (!stats) return s.wipe_no_stats;
  const n = value => Number(value ?? 0).toLocaleString('pt-BR');
  return s.wipe_stats_line(
    n(stats.pp), n(stats.plays), Number(stats.acc ?? 0).toFixed(2),
    n(stats.max_combo), n(stats.total_hits),
  );
}

module.exports = {
  // Como o /moderate e o /staff: toda resposta é efêmera, e em texto a flag
  // some. Um comando destrutivo é o último que deveria existir no modo em que a
  // confirmação some junto com a privacidade.
  prefix: { slashOnly: true },

  data: new SlashCommandBuilder()
    .setName('wipe')
    .setDescription('Erase a player\'s scores in one mode (irreversible, Developer only)')
    .setDescriptionLocalizations({ 'pt-BR': 'Apaga os scores de um jogador num modo (irreversível, só Developer)' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addStringOption(o => o.setName('player')
      .setDescription('Player name or ID')
      .setDescriptionLocalizations({ 'pt-BR': 'Nome ou ID do jogador' })
      .setRequired(true)
      .setMaxLength(32))
    .addIntegerOption(o => o.setName('mode')
      .setDescription('Which game mode to erase')
      .setDescriptionLocalizations({ 'pt-BR': 'Qual modo de jogo apagar' })
      .setRequired(true)
      .addChoices(...MODE_CHOICES))
    .addStringOption(o => o.setName('reason')
      .setDescription('Reason (goes into the server audit log)')
      .setDescriptionLocalizations({ 'pt-BR': 'Motivo (vai para o log de auditoria do servidor)' })
      .setRequired(true)
      .setMaxLength(REASON_MAX_LENGTH)),

  async execute(interaction) {
    const s = t(interaction);

    // DEVELOPER, e não ADMINISTRATOR: ver o cabeçalho. O servidor não filtra
    // este canal, então esta linha é a tranca inteira.
    const staff = await resolveStaff(interaction, daycore.Privileges.DEVELOPER, s);
    if (staff.error) {
      return interaction.reply({ content: staff.error, flags: MessageFlags.Ephemeral });
    }

    const redisError = await checkRedisOrError(s);
    if (redisError) {
      return interaction.reply({ content: redisError, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const modeNum   = interaction.options.getInteger('mode');
      const modeLabel = daycore.GameModes[modeNum] ?? String(modeNum);
      const reason    = interaction.options.getString('reason');

      const targetId = await osu.resolvePlayerId(String(interaction.options.getString('player')).trim());
      if (!targetId) return interaction.editReply(s.player_not_found);

      const target = await daycore.getPlayerPrivileges(targetId);
      if (!target) return interaction.editReply(s.player_not_found);

      // ── Aqui NÃO há trava de "não pode em si mesmo", e o /moderate tem ──────
      // A assimetria é de propósito, e não descuido de quem copiou o outro.
      //
      // No /moderate a trava é estrutural: sem ela, um staff restrito poderia
      // se DESRESTRINGIR. Bloquear o alvo igual ao autor fecha uma escalada de
      // privilégio, e por isso continua lá.
      //
      // No wipe não existe esse ganho — ninguém obtém nada apagando os próprios
      // scores. Sobrava só o argumento do engano, e contra engano este comando
      // já tem o que o outro não tem: a confirmação mostra os números que serão
      // destruídos ("3076pp, 679 plays") e expira em 60 segundos. Limpar a
      // própria conta de teste é coisa normal de quem administra o servidor, e
      // era exatamente o que a trava impedia.

      // Lido ANTES de qualquer publicação: é o que a confirmação mostra e o que
      // o log guarda. Depois do wipe estes números não existem mais.
      const stats = await osu.getServerPlayerStats(target.id, modeNum).catch(() => null);

      const confirmId = `wipe_ok_${interaction.id}`;
      const cancelId  = `wipe_no_${interaction.id}`;

      const aviso = new EmbedBuilder()
        .setColor(0xff6666)
        .setTitle(s.wipe_confirm_title)
        .setDescription(
          s.wipe_confirm_body(target.name, target.id, modeLabel) + '\n\n' +
          describeStats(stats, s) + '\n\n' +
          s.wipe_irreversible,
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });

      const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel(s.wipe_button_confirm).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelId).setLabel(s.wipe_button_cancel).setStyle(ButtonStyle.Secondary),
      );

      const prompt = await interaction.editReply({ embeds: [aviso], components: [botoes] });

      let click;
      try {
        click = await prompt.awaitMessageComponent({
          // Só quem rodou. O componente é efêmero, mas a checagem não custa e
          // fecha o caso de a mensagem ser alcançada de outro jeito.
          filter: i => i.user.id === interaction.user.id,
          time: CONFIRM_MS,
        });
      } catch {
        // Expirou sem clique: não fazer nada é a resposta certa.
        return interaction.editReply({ content: s.wipe_expired, embeds: [], components: [] });
      }

      await click.deferUpdate().catch(() => {});

      if (click.customId === cancelId) {
        return interaction.editReply({ content: s.wipe_cancelled, embeds: [], components: [] });
      }

      await daycore.wipePlayer(target.id, modeNum, {
        osuId:       staff.osuId,
        discordId:   interaction.user.id,
        discordName: interaction.user.username,
      }, reason);

      const confirmado = await daycore.verifyWiped(target.id, modeNum);

      // Os números destruídos vão no detail: é o único lugar onde eles ainda
      // existem depois desta linha.
      //
      // E é justamente por isso que a gravação passa pelo adminLog em vez de ir
      // direto ao `db`: dentro do `try`, uma falha de SQLite caía no `catch` lá
      // embaixo e respondia "nada foi confirmado — verifique o estado antes de
      // tentar de novo" para um wipe que já tinha acontecido e já tinha sido
      // confirmado pela releitura. Aqui isso é o pior conselho possível: o
      // comando não tem volta, quem lesse a resposta tentaria de novo, e o
      // registro que se perdeu era a única prova dos números apagados. O
      // adminLog ainda imprime a linha no log do processo, e o embed abaixo
      // continua mostrando os stats — as duas cópias que sobram. Ver
      // adminLog.js.
      const registrado = registrarAcao('wipe', {
        action: 'wipe',
        target: target.id,
        detail: `${target.name} | ${modeLabel} | ${reason} | ` +
                `antes: ${stats?.pp ?? '?'}pp, ${stats?.plays ?? '?'} plays, acc ${stats?.acc ?? '?'} | ` +
                (confirmado ? 'confirmado' : 'NAO confirmado'),
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      const resultado = new EmbedBuilder()
        // Verde só quando as duas pontas fecharam — mesma regra do /role e do
        // /moderate.
        .setColor(confirmado && registrado ? 0x99ff99 : 0xffcc66)
        .setTitle(s.wipe_done_title(modeLabel))
        .setDescription(
          s.wipe_done_body(target.name, target.id, modeLabel) + '\n\n' +
          describeStats(stats, s) + '\n\n' +
          (confirmado ? s.wipe_confirmed : s.wipe_unconfirmed) +
          (registrado ? '' : '\n\n' + s.admin_log_failed),
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });

      return interaction.editReply({ embeds: [resultado], components: [] });
    } catch (error) {
      logError('wipe', error);
      return interaction.editReply({ content: s.admin_action_failed, embeds: [], components: [] });
    }
  },
};
