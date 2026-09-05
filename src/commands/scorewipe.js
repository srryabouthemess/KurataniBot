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

const osu = require('../osuClient');
const daycore = require('../daycoreAdmin');
const { decodeMods, formatMods } = require('../mods');
const { resolveStaff, checkRedisOrError } = require('../staffGuard');
const { registrarAcao } = require('../adminLog');
const { t } = require('../i18n');
const { logError } = require('../logger');

const REASON_MAX_LENGTH = 200;

// Janelas curtas, pelo mesmo motivo do /wipe: um botão de destruição pendurado
// numa mensagem antiga é um acidente esperando alguém passar por perto.
const PICK_MS    = 60_000;
const CONFIRM_MS = 60_000;

/** Quantas plays a lista oferece. */
const CANDIDATOS = 10;

/** Só os modos que o bancho nomeia (ver GameModes em daycoreAdmin). */
const MODE_CHOICES = Object.entries(daycore.GameModes)
  .map(([value, name]) => ({ name, value: Number(value) }));

/** O texto do mapa, montado dos campos separados que as duas fontes trazem. */
function nomeDoMapa(map) {
  if (!map) return null;
  const artista = map.artist ? `${map.artist} - ` : '';
  return `${artista}${map.title ?? '???'} [${map.version ?? '?'}]`;
}

/**
 * A data como o servidor a guardou, sem conversão de fuso.
 *
 * O `play_time` chega como datetime do MySQL, sem fuso declarado. Interpretá-lo
 * como local ou como UTC seria escolher no escuro; o que a confirmação precisa é
 * bater com o que está no banco, para quem confere ver o mesmo valor dos dois
 * lados.
 */
function quando(playTime) {
  return String(playTime ?? '').replace('T', ' ').slice(0, 16) || '?';
}

/**
 * A forma comum das duas entradas.
 *
 * A lista vem da v1 (`get_player_scores`), que traz o mapa aninhado mas não o
 * `userid` — ele é sabido, porque a consulta foi por jogador. O id digitado vem
 * da v2 (`/scores/{id}`), que traz o `userid` mas só o md5 do mapa, resolvido à
 * parte. Daí as duas normalizações, e um formato só depois delas.
 */
function daLista(row, ownerId) {
  return {
    id:       Number(row.id),
    userId:   Number(ownerId),
    mode:     Number(row.mode),
    status:   Number(row.status),
    pp:       Number(row.pp ?? 0),
    acc:      Number(row.acc ?? 0),
    grade:    row.grade ?? '?',
    mods:     Number(row.mods ?? 0),
    playTime: row.play_time,
    mapId:    row.beatmap?.id ?? null,
    mapLabel: nomeDoMapa(row.beatmap),
    md5:      row.map_md5 ?? null,
  };
}

function porId(score, map) {
  return {
    id:       Number(score.id),
    userId:   Number(score.userid),
    mode:     Number(score.mode),
    status:   Number(score.status),
    pp:       Number(score.pp ?? 0),
    acc:      Number(score.acc ?? 0),
    grade:    score.grade ?? '?',
    mods:     Number(score.mods ?? 0),
    playTime: score.play_time,
    mapId:    map?.id ?? null,
    mapLabel: nomeDoMapa(map),
    md5:      score.map_md5 ?? null,
  };
}

/** Uma linha legível do score — a mesma na lista, na confirmação e no log. */
function descrever(item, s) {
  return s.scorewipe_score_line(
    item.mapLabel ?? s.scorewipe_map_unknown,
    item.pp.toFixed(2),
    item.acc.toFixed(2),
    formatMods(decodeMods(item.mods)),
    item.grade,
    quando(item.playTime),
  );
}

/**
 * A segunda confirmação, e a publicação do lote.
 *
 * Mora fora do `execute` porque é a terceira tela de um comando que já tinha
 * duas; deixá-la inline faria a função principal passar de duzentas linhas e
 * misturar três fluxos no mesmo escopo.
 *
 * O clique no botão do lote NÃO publica: ele traz para cá, e é só o confirmar
 * daqui que manda. A ação é maior que a de um score e ganha confirmação
 * própria, com as plays na tela.
 */
async function apagarOMapa(interaction, { s, staff, target, modeLabel, modeNum, reason, alvo, doMapa }) {
  const mapLabel  = alvo.mapLabel ?? s.scorewipe_map_unknown;
  const confirmId = `mapwipe_ok_${interaction.id}`;
  const cancelId  = `mapwipe_no_${interaction.id}`;

  const aviso = new EmbedBuilder()
    .setColor(0xff6666)
    .setTitle(s.mapwipe_confirm_title)
    .setDescription(
      s.mapwipe_confirm_body(target.name, target.id, modeLabel, mapLabel, doMapa.length) + '\n\n' +
      // O teto de descrição do embed é 4096; o corte deixa folga para os dois
      // avisos que vêm depois.
      doMapa.map(item => descrever(item, s)).join('\n\n').slice(0, 2500) + '\n\n' +
      s.mapwipe_includes_failed + '\n\n' +
      s.scorewipe_reversible,
    )
    .setFooter({ text: s.nom_actor(staff.osuName) });

  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(s.mapwipe_button_confirm(doMapa.length)).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel(s.wipe_button_cancel).setStyle(ButtonStyle.Secondary),
  );

  const prompt = await interaction.editReply({ embeds: [aviso], components: [botoes] });

  let clique;
  try {
    clique = await prompt.awaitMessageComponent({
      filter: i => i.user.id === interaction.user.id,
      time: CONFIRM_MS,
    });
  } catch {
    return interaction.editReply({ content: s.scorewipe_expired, embeds: [], components: [] });
  }

  await clique.deferUpdate().catch(() => {});

  if (clique.customId === cancelId) {
    return interaction.editReply({ content: s.scorewipe_cancelled, embeds: [], components: [] });
  }

  await daycore.wipeMapScores(target.id, alvo.md5, modeNum, {
    osuId:       staff.osuId,
    discordId:   interaction.user.id,
    discordName: interaction.user.username,
  }, reason);

  const confirmado = await daycore.verifyMapScoresWiped(target.id, alvo.md5, modeNum);

  const registrado = registrarAcao('mapwipe', {
    action: 'mapwipe',
    target: target.id,
    detail: `${target.name} | ${modeLabel} | ${doMapa.length} scores em ${mapLabel} | ${reason} | ` +
            `${doMapa.map(item => item.id).join(',')} | ` +
            (confirmado ? 'confirmado' : 'NAO confirmado'),
    actorDiscordId: interaction.user.id,
    actorOsuId: staff.osuId,
    actorOsuName: staff.osuName,
  });

  const resultado = new EmbedBuilder()
    .setColor(confirmado && registrado ? 0x99ff99 : 0xffcc66)
    .setTitle(s.mapwipe_done_title)
    .setDescription(
      s.mapwipe_done_body(target.name, target.id, doMapa.length, mapLabel) + '\n\n' +
      (confirmado ? s.mapwipe_confirmed : s.mapwipe_unconfirmed) +
      (registrado ? '' : '\n\n' + s.admin_log_failed),
    )
    .setFooter({ text: s.nom_actor(staff.osuName) });

  return interaction.editReply({ embeds: [resultado], components: [] });
}

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
      const linhasDoMapa = alvo.md5
        ? await osu.getServerPlayerMapScores(target.id, alvo.md5, modeNum).catch(() => [])
        : [];

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
          filter: i => i.user.id === interaction.user.id,
          time: CONFIRM_MS,
        });
      } catch {
        return interaction.editReply({ content: s.scorewipe_expired, embeds: [], components: [] });
      }

      await clique.deferUpdate().catch(() => {});

      if (clique.customId === cancelId) {
        return interaction.editReply({ content: s.scorewipe_cancelled, embeds: [], components: [] });
      }

      if (clique.customId === loteId) {
        return apagarOMapa(interaction, {
          s, staff, target, modeLabel, modeNum, reason, alvo, doMapa,
        });
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
