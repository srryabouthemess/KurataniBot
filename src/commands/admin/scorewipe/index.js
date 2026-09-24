/**
 * /scorewipe — apaga UM score de um jogador.
 *
 * ── A diferença para o /wipe, que é a razão deste comando existir ─────────────
 * O /wipe é o bisturi grosso: apaga TODOS os scores de uma conta num modo e
 * zera as estatísticas. Serve para multiconta e para limpar conta de teste. Não
 * serve para o caso mais comum de moderação — uma play suja no meio de um
 * perfil legítimo —, porque a única forma de tirar aquela play era destruir o
 * resto junto.
 *
 * ── E o que ele NÃO tem: o "isto não tem volta" do /wipe ──────────────────────
 * O `wipe_score` do bancho não faz DELETE. Ele estaciona o score no status -1,
 * que está fora do `SubmissionStatus`, e a partir daí toda consulta que
 * seleciona `status = 2` (leaderboards, top plays, a soma de pp) já o descarta
 * sozinha. A linha continua no banco: desfazer é um UPDATE.
 *
 * Isso muda o tom da confirmação — e só o tom. As travas continuam as mesmas do
 * /wipe, porque o que as justifica não é o dano ser eterno:
 *
 *   1. Exige DEVELOPER. O `channel_scorewipe_reciever` aceita qualquer publish,
 *      sem conferir privilégio, exatamente como o do `wipe`. Quem chama daqui é
 *      a única tranca que existe.
 *   2. Confirmação explícita, com o score na tela — mapa, pp, acurácia, mods e
 *      data. O id de um score não diz nada a quem o lê; ninguém confere um
 *      número de nove dígitos de cabeça.
 *   3. O log de auditoria guarda o que foi apagado, e não só o id.
 *
 * ── E quando é o mapa inteiro? ────────────────────────────────────────────────
 * Apagar dez plays uma a uma funciona, e custa dez embeds no log de auditoria do
 * servidor: o `wipe_score` do bancho escreve um por chamada. Por isso existe o
 * canal `mapwipe`, com um `post_audit_log` para o lote inteiro — e o botão que o
 * aciona só aparece quando há mais de uma play, porque com uma só este comando
 * já faz exatamente isso.
 *
 * O lote leva os failed junto. Eles contam em `plays`, e deixá-los de pé faria o
 * mapa continuar somando tentativas depois de um wipe que se anunciou total.
 *
 * ── O id vem de onde? ─────────────────────────────────────────────────────────
 * Do site dá para tirar: a página de um score é `/scores/<id>`, então clicar numa
 * linha da leaderboard do mapa e ler o número da URL funciona. O que isso não
 * responde é a pergunta que a moderação faz — "qual das plays DELE?" —, porque
 * exige achar o mapa certo antes, e não alcança o que não está numa leaderboard.
 * Os embeds do bot não carregam o id em lugar nenhum.
 *
 * Por isso o comando lista as plays do alvo e deixa escolher; o campo `score`
 * existe para quem já tem o id em mãos (da URL, do banco, do log de auditoria de
 * um wipe anterior).
 *
 * O alvo e o modo são obrigatórios NOS DOIS caminhos, inclusive quando o id é
 * digitado: eles viram conferência. Um id errado apagaria a play de outra
 * pessoa sem que nada na tela denunciasse a troca, e é o tipo de engano que só
 * aparece quando o dono da play reclama.
 */

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags,
} = require('discord.js');

const osu = require('../../../osuClient');
const daycore = require('../../../daycoreAdmin');
const { resolveStaff, checkRedisOrError } = require('../../../staffGuard');
const { registrarAcao } = require('../../../adminLog');
const { t } = require('../../../i18n');
const { logError } = require('../../../lib/logger');
const { decodeMods, formatMods } = require('../../../mods');
const { daLista, porId, descrever, quando } = require('./format');
const { apagarOMapa } = require('./mapwipe');
const { REASON_MAX_LENGTH, PICK_MS, CONFIRM_MS, CANDIDATOS } = require('./limits');

/** Só os modos que o bancho nomeia (ver GameModes em daycoreAdmin). */
const MODE_CHOICES = Object.entries(daycore.GameModes)
  .map(([value, name]) => ({ name, value: Number(value) }));

module.exports = {
  // Como o /wipe: toda resposta é efêmera, e em texto a flag some.
  prefix: { slashOnly: true },

  data: new SlashCommandBuilder()
    .setName('scorewipe')
    .setDescription('Erase a single score of a player (Developer only)')
    .setDescriptionLocalizations({ 'pt-BR': 'Apaga um único score de um jogador (só Developer)' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addStringOption(o => o.setName('player')
      .setDescription('Player name or ID')
      .setDescriptionLocalizations({ 'pt-BR': 'Nome ou ID do jogador' })
      .setRequired(true)
      .setMaxLength(32))
    .addIntegerOption(o => o.setName('mode')
      .setDescription('Game mode the score belongs to')
      .setDescriptionLocalizations({ 'pt-BR': 'Modo de jogo do score' })
      .setRequired(true)
      .addChoices(...MODE_CHOICES))
    .addStringOption(o => o.setName('reason')
      .setDescription('Reason (goes into the server audit log)')
      .setDescriptionLocalizations({ 'pt-BR': 'Motivo (vai para o log de auditoria do servidor)' })
      .setRequired(true)
      .setMaxLength(REASON_MAX_LENGTH))
    .addStringOption(o => o.setName('list')
      .setDescription('Which plays to offer (default: top plays)')
      .setDescriptionLocalizations({ 'pt-BR': 'Quais plays oferecer (padrão: top plays)' })
      .addChoices(
        { name: 'top plays', value: 'best' },
        { name: 'recent', value: 'recent' },
      ))
    .addIntegerOption(o => o.setName('score')
      .setDescription('Score ID, when you already have it')
      .setDescriptionLocalizations({ 'pt-BR': 'ID do score, se você já o tiver' })
      .setMinValue(1)),

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
      const escopo    = interaction.options.getString('list') ?? 'best';
      const scoreId   = interaction.options.getInteger('score');

      const targetId = await osu.resolvePlayerId(String(interaction.options.getString('player')).trim());
      if (!targetId) return interaction.editReply(s.player_not_found);

      const target = await daycore.getPlayerPrivileges(targetId);
      if (!target) return interaction.editReply(s.player_not_found);

      let alvo = null;

      if (scoreId) {
        // `getServerScore` levanta em 404, e aqui isso é resposta: id que não
        // existe é engano de digitação, não falha do serviço.
        const bruto = await osu.getServerScore(scoreId).catch(() => null);
        if (!bruto) return interaction.editReply(s.scorewipe_not_found(scoreId));

        const map = await osu.getServerMapByMd5(bruto.map_md5).catch(() => null);
        alvo = porId(bruto, map);

        // As duas conferências que o id digitado não faz sozinho.
        if (alvo.userId !== target.id) {
          return interaction.editReply(s.scorewipe_other_player(scoreId, alvo.userId));
        }
        if (alvo.mode !== modeNum) {
          const outro = daycore.GameModes[alvo.mode] ?? String(alvo.mode);
          return interaction.editReply(s.scorewipe_other_mode(scoreId, outro));
        }
      } else {
        const linhas = await osu.getServerPlayerScores(target.id, modeNum, escopo, CANDIDATOS);
        const candidatos = linhas.map(row => daLista(row, target.id));

        if (candidatos.length === 0) {
          return interaction.editReply(s.scorewipe_no_scores(target.name, modeLabel));
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`scorewipe_pick_${interaction.id}`)
          .setPlaceholder(s.scorewipe_pick_placeholder)
          .addOptions(candidatos.map(item => ({
            // O teto do Discord é 100 caracteres em cada campo, e nome de mapa
            // passa disso com facilidade.
            label:       `${item.pp.toFixed(0)}pp · ${item.mapLabel ?? s.scorewipe_map_unknown}`.slice(0, 100),
            description: `${item.grade} · ${item.acc.toFixed(2)}% · ${formatMods(decodeMods(item.mods))} · ${quando(item.playTime)}`.slice(0, 100),
            value:       String(item.id),
          })));

        const lista = new EmbedBuilder()
          .setColor(0xffcc66)
          .setTitle(s.scorewipe_pick_title)
          .setDescription(s.scorewipe_pick_body(target.name, target.id, modeLabel))
          .setFooter({ text: s.nom_actor(staff.osuName) });

        const prompt = await interaction.editReply({
          embeds: [lista],
          components: [new ActionRowBuilder().addComponents(menu)],
        });

        let escolha;
        try {
          escolha = await prompt.awaitMessageComponent({
            filter: i => i.user.id === interaction.user.id,
            time: PICK_MS,
          });
        } catch {
          return interaction.editReply({ content: s.scorewipe_expired, embeds: [], components: [] });
        }

        await escolha.deferUpdate().catch(() => {});
        alvo = candidatos.find(item => String(item.id) === escolha.values[0]);
        if (!alvo) return interaction.editReply({ content: s.admin_action_failed, embeds: [], components: [] });
      }

      if (alvo.status === daycore.WIPED_SCORE_STATUS) {
        return interaction.editReply({ content: s.scorewipe_already(alvo.id), embeds: [], components: [] });
      }

      // As outras plays do mesmo mapa e modo. É um extra: se o endpoint não
      // estiver no ar, o /scorewipe de um score continua funcionando igual.
      // Tolerante de propósito, ao contrário do `verifyMapScoresWiped`: aqui a
      // resposta serve só para decidir se OFERECE o botão do lote. Não saber
      // quantas plays há é motivo para não oferecer, e não para derrubar o
      // comando — o `null` da leitura que falhou vira lista vazia.
      const linhasDoMapa = (alvo.md5
        ? await osu.getServerPlayerMapScores(target.id, alvo.md5, modeNum).catch(() => [])
        : []) ?? [];

      const doMapa = linhasDoMapa
        .filter(row => Number(row.status) >= 0)
        .map(row => ({
          ...daLista(row, target.id),
          // A linha deste endpoint não traz o mapa aninhado — é sempre o mesmo
          // mapa do score escolhido, então o rótulo vem de lá.
          mapId:    alvo.mapId,
          mapLabel: alvo.mapLabel,
          md5:      alvo.md5,
        }));

      const confirmId = `scorewipe_ok_${interaction.id}`;
      const cancelId  = `scorewipe_no_${interaction.id}`;

      // O aviso do melhor score é a parte que surpreende: apagar o topo não
      // deixa o mapa vazio, o segundo colocado assume — e o pp do jogador cai
      // pela diferença, não pelo valor da play apagada.
      const aviso = new EmbedBuilder()
        .setColor(0xff6666)
        .setTitle(s.scorewipe_confirm_title)
        .setDescription(
          s.scorewipe_confirm_body(target.name, target.id, modeLabel) + '\n\n' +
          descrever(alvo, s) + '\n\n' +
          (alvo.status === 2 ? s.scorewipe_was_best + '\n\n' : '') +
          s.scorewipe_reversible,
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });

      const loteId  = `scorewipe_lote_${interaction.id}`;
      const temLote = doMapa.length > 1;

      const botoes = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel(s.scorewipe_button_confirm).setStyle(ButtonStyle.Danger),
        ...(temLote
          ? [new ButtonBuilder().setCustomId(loteId).setLabel(s.mapwipe_button(doMapa.length)).setStyle(ButtonStyle.Danger)]
          : []),
        new ButtonBuilder().setCustomId(cancelId).setLabel(s.wipe_button_cancel).setStyle(ButtonStyle.Secondary),
      );

      const prompt = await interaction.editReply({ embeds: [aviso], components: [botoes] });

      let clique;
      try {
        clique = await prompt.awaitMessageComponent({
          // Mesma regra da segunda tela (ver `apagarOMapa`): o filtro prende os
          // ids DESTES botões, e não só o autor. O menu de seleção da tela
          // anterior continua desenhado no cliente por centenas de
          // milissegundos depois do `deferUpdate`, e uma escolha atrasada dele
          // satisfaz `i.user.id` — entrava aqui e, com a decisão negativa que
          // havia abaixo, caía direto na publicação. O score era apagado sem
          // ninguém ter clicado em confirmar.
          filter: i => i.user.id === interaction.user.id &&
                       (i.customId === confirmId || i.customId === loteId || i.customId === cancelId),
          time: CONFIRM_MS,
        });
      } catch {
        return interaction.editReply({ content: s.scorewipe_expired, embeds: [], components: [] });
      }

      await clique.deferUpdate().catch(() => {});

      if (clique.customId === loteId) {
        // `return await`, e não `return` puro: sem o await a rejeição escapa
        // deste `try` e o catch local não chega a rodar — a falha do lote não
        // viraria `admin_action_failed` com `logError`, e os botões ficariam na
        // tela como se a tela ainda estivesse viva.
        return await apagarOMapa(interaction, {
          s, staff, target, modeLabel, modeNum, reason, alvo, doMapa,
        });
      }

      // Checagem POSITIVA, como na segunda tela: só o confirmar DESTA tela
      // publica. Qualquer outra coisa que chegue até aqui cai no cancelamento,
      // porque numa tela destrutiva o seguro por omissão é não fazer nada.
      if (clique.customId !== confirmId) {
        return interaction.editReply({ content: s.scorewipe_cancelled, embeds: [], components: [] });
      }

      await daycore.wipeScore(alvo.id, {
        osuId:       staff.osuId,
        discordId:   interaction.user.id,
        discordName: interaction.user.username,
      }, reason);

      const confirmado = await daycore.verifyScoreWiped(alvo.id);

      // O score apagado continua no banco, então este log não é a última cópia
      // dos números, como é no /wipe. Ele responde a outra pergunta, que o banco
      // não responde: QUEM mandou apagar, e por quê.
      const registrado = registrarAcao('scorewipe', {
        action: 'scorewipe',
        target: target.id,
        detail: `${target.name} | ${modeLabel} | score ${alvo.id} | ${reason} | ` +
                `${alvo.pp.toFixed(2)}pp ${alvo.grade} ${alvo.acc.toFixed(2)}% em ${alvo.mapLabel ?? '?'} | ` +
                (confirmado ? 'confirmado' : 'NAO confirmado'),
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      const resultado = new EmbedBuilder()
        // Verde só quando as duas pontas fecharam — mesma regra do /wipe.
        .setColor(confirmado && registrado ? 0x99ff99 : 0xffcc66)
        .setTitle(s.scorewipe_done_title)
        .setDescription(
          s.scorewipe_done_body(target.name, target.id, alvo.id) + '\n\n' +
          descrever(alvo, s) + '\n\n' +
          (confirmado ? s.scorewipe_confirmed : s.scorewipe_unconfirmed) +
          (registrado ? '' : '\n\n' + s.admin_log_failed),
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });

      return interaction.editReply({ embeds: [resultado], components: [] });
    } catch (error) {
      logError('scorewipe', error);
      return interaction.editReply({ content: s.admin_action_failed, embeds: [], components: [] });
    }
  },
};
