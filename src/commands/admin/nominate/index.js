const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags,
} = require('discord.js');

const daycore = require('../../../daycoreAdmin');
const { resolveStaff, checkRedisOrError } = require('../../../staffGuard');
const announce = require('../../../announce');
const db = require('../../../db');
const { registrarAcao } = require('../../../adminLog');
const { md } = require('../../../markdown');
const { t, forGuild } = require('../../../i18n');
const { exigirSubcomando } = require('../../../subcommands');
const { logError } = require('../../../lib/logger');
const config = require('../../../config');
const { truncate, failureDetail, resultBlock, avisosLocais } = require('./messages');
const { resolveSet, mapLabel, applyStatus } = require('./set');

// Quantas nomeações distintas um set precisa antes de ser aplicado de fato
// (NOMINATION_THRESHOLD, lido em config.js).
//
// O padrão é 1: quem nomeia já aplica. O osu! oficial pede 2 (dois BNs), mas lá
// isso resolve um problema que um servidor pequeno não tem — com poucos
// nominators, exigir um segundo só trava mapa esperando alguém aparecer. Quem
// quiser o modelo do osu! sobe o número no `.env`.
//
// Subir para 2 ou mais funciona: a contagem é por CONTA DE JOGO — a PK de
// map_nominations é (set_id, target_status, osu_id). Já foi por discord_id, e
// aí duas contas do Discord apontando para o mesmo osu! id valiam como duas
// nomeações, o que deixava uma pessoa sozinha atingir um limiar de 2; a
// migração em db.js reconstruiu a tabela justamente por causa disso.

// Tetos nas entradas de texto livre. Sem eles o Discord aceita até 6000
// caracteres, que estouram o limite de 4096 do embed — o comando falharia ao
// responder, possivelmente depois de a ação já ter sido aplicada no Daycore.
const MAP_INPUT_MAX_LENGTH = 200;
const REASON_MAX_LENGTH    = 200;

function threshold() {
  return config.daycore.nominationThreshold;
}

/**
 * Anúncio no canal público, quando houver um configurado.
 *
 * Só sai com pelo menos uma dificuldade confirmada: anunciar "rankeado" depois
 * de zero confirmações seria divulgar o que não aconteceu — e é justamente o
 * caso que o `verifyMapStatus` existe para detectar.
 *
 * Não é esperado dar certo. Se o canal sumiu ou a permissão foi retirada, a
 * ação no Daycore continua valendo e quem rodou o comando ainda recebe a
 * resposta normal; o erro fica no log.
 *
 * Por isso também NÃO é aguardado por quem chama: o anúncio não faz parte do
 * contrato do comando, e deixá-lo no caminho crítico fazia a resposta de quem
 * rodou esperar a API do Discord entregar uma mensagem para outro canal. O
 * try/catch de dentro já impedia a exceção — não a demora.
 */
function announceApplied(interaction, { setId, diffs, status, label, actorName, confirmed }) {
  if (confirmed.length === 0) return;

  // Idioma do SERVIDOR, nao o da interacao: o embed vai para um canal publico,
  // e quem le nao rodou comando nenhum. Usando o `s` daqui, um staff com a
  // preferencia pessoal diferente da do servidor fazia o canal receber dois
  // anuncios iguais em linguas diferentes -- o do comando na dele, o do rank
  // in-game na do servidor (ver index.js).
  const s = forGuild(config.daycore.guildId);

  announce.announceStatus(interaction.client, {
    setId, diffs, status,
    statusLabel: daycore.STATUS_LABELS[status],
    label, actorName, confirmed: confirmed.length,
  }, s).catch(error => logError('announce', error));
}

/**
 * Descarta a fila DEPOIS de o status já ter sido aplicado no servidor.
 *
 * Com try/catch pelo mesmo motivo do registro de auditoria (ver adminLog.js):
 * neste ponto as dificuldades já mudaram no Daycore e a releitura já confirmou.
 * Um erro de SQLite subindo daqui caía no `catch` do execute e a resposta virava
 * `admin_action_failed` — "nada foi confirmado" para um set que acabou de ser
 * rankeado. Quem lesse isso rankearia de novo.
 *
 * Não limpar é um problema menor e reversível: a fila continua mostrando votos
 * de um estado que já mudou, e a resposta avisa para quem quiser retirá-los.
 *
 * @returns {boolean} se a fila foi mesmo esvaziada
 */
function limparFila(setId, statuses) {
  try {
    for (const status of statuses) db.clearNominations(setId, status);
    return true;
  } catch (error) {
    logError('nominate:fila', error);
    return false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nominate')
    .setDescription('Daycore map nomination (staff only)')
    .setDescriptionLocalizations({ 'pt-BR': 'Nomeação de mapas do Daycore (apenas staff)' })
    // Diferente dos outros comandos do bot: sem UserInstall. Um comando que
    // muda o servidor não deve viajar junto com a conta da pessoa para
    // qualquer DM ou servidor onde ela esteja.
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Nominate a map for ranking or loving')
        .setDescriptionLocalizations({ 'pt-BR': 'Nomeia um mapa para ranked ou loved' })
        .addStringOption(o => o.setName('map')
          .setDescription('Beatmap/set ID or link')
          .setDescriptionLocalizations({ 'pt-BR': 'ID ou link do mapa/set' })
          .setRequired(true)
          .setMaxLength(MAP_INPUT_MAX_LENGTH))
        .addStringOption(o => o.setName('status')
          .setDescription('Target status (default: ranked)')
          .setDescriptionLocalizations({ 'pt-BR': 'Status alvo (padrão: ranked)' })
          .setRequired(false)
          .addChoices(
            { name: 'Ranked', value: 'rank' },
            { name: 'Loved',  value: 'love' },
          )))
    .addSubcommand(sub =>
      sub.setName('withdraw')
        .setDescription('Withdraw your own nomination')
        .setDescriptionLocalizations({ 'pt-BR': 'Retira sua própria nomeação' })
        .addStringOption(o => o.setName('map')
          .setDescription('Beatmap/set ID or link').setRequired(true).setMaxLength(MAP_INPUT_MAX_LENGTH))
        .addStringOption(o => o.setName('status')
          .setDescription('Target status (default: ranked)').setRequired(false)
          .addChoices(
            { name: 'Ranked', value: 'rank' },
            { name: 'Loved',  value: 'love' },
          )))
    .addSubcommand(sub =>
      sub.setName('queue')
        .setDescription('Show maps waiting for nominations')
        .setDescriptionLocalizations({ 'pt-BR': 'Mostra os mapas aguardando nomeação' }))
    .addSubcommand(sub =>
      sub.setName('disqualify')
        .setDescription('Immediately unrank a map (no nominations needed)')
        .setDescriptionLocalizations({ 'pt-BR': 'Desqualifica um mapa na hora (sem precisar de nomeações)' })
        .addStringOption(o => o.setName('map')
          .setDescription('Beatmap/set ID or link').setRequired(true).setMaxLength(MAP_INPUT_MAX_LENGTH))
        .addStringOption(o => o.setName('reason')
          .setDescription('Why').setRequired(false).setMaxLength(REASON_MAX_LENGTH)))
    .addSubcommand(sub =>
      sub.setName('force')
        .setDescription('Apply a status immediately, bypassing nominations (Administrator)')
        .setDescriptionLocalizations({ 'pt-BR': 'Aplica um status na hora, ignorando as nomeações (Administrator)' })
        .addStringOption(o => o.setName('map')
          .setDescription('Beatmap/set ID or link').setRequired(true).setMaxLength(MAP_INPUT_MAX_LENGTH))
        .addStringOption(o => o.setName('status')
          .setDescription('Target status').setRequired(true)
          .addChoices(
            { name: 'Ranked',   value: 'rank' },
            { name: 'Loved',    value: 'love' },
            { name: 'Unranked', value: 'unrank' },
          ))),

  async execute(interaction) {
    const s   = t(interaction);
    // Lança se o subcomando não estiver declarado no builder — ver
    // subcommands.js para o que cada um destes fazia em silêncio antes.
    const sub = exigirSubcomando(module.exports, interaction);

    // ── /nominate queue — só leitura, exige apenas ser nominator ─────────────
    if (sub === 'queue') {
      const staff = await resolveStaff(interaction, daycore.Privileges.NOMINATOR, s);
      if (staff.error) {
        return interaction.reply({ content: staff.error, flags: MessageFlags.Ephemeral });
      }

      const rows = db.listPendingNominations(25);
      if (rows.length === 0) {
        return interaction.reply({ content: s.nom_queue_empty, flags: MessageFlags.Ephemeral });
      }

      const need = threshold();
      const lines = rows.map(r => {
        const name = r.title ? truncate(`${r.artist} - ${r.title}`, 80) : `set ${r.set_id}`;
        return s.nom_queue_line(
          r.set_id, name, daycore.STATUS_LABELS[r.target_status] ?? r.target_status,
          r.votes, need,
        );
      });

      const embed = new EmbedBuilder()
        .setColor(0x99ccff)
        .setTitle(s.nom_queue_title)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // ── Demais subcomandos escrevem no Daycore ───────────────────────────────
    const requiredPriv = sub === 'force'
      ? daycore.Privileges.ADMINISTRATOR
      : daycore.Privileges.NOMINATOR;

    const staff = await resolveStaff(interaction, requiredPriv, s);
    if (staff.error) {
      return interaction.reply({ content: staff.error, flags: MessageFlags.Ephemeral });
    }

    // `withdraw` é puramente local, não precisa do Redis.
    if (sub !== 'withdraw') {
      const redisError = await checkRedisOrError(s);
      if (redisError) {
        return interaction.reply({ content: redisError, flags: MessageFlags.Ephemeral });
      }
    }

    await interaction.deferReply();

    try {
      const resolved = await resolveSet(interaction.options.getString('map'));
      if (resolved.error) {
        return interaction.editReply(
          resolved.error === 'invalid' ? s.nom_invalid_map : s.nom_map_not_found,
        );
      }

      const { setId, diffs } = resolved;
      const label = mapLabel(diffs);
      // Quando a lista veio do osu!, quem lê precisa saber que o servidor ainda
      // não tem o mapa — o número de dificuldades é do osu!, não dali.
      const origin = resolved.onServer ? '' : `\n${s.nom_not_on_server}`;

      db.cacheNominationMap(setId, {
        artist: diffs[0]?.artist, title: diffs[0]?.title,
        creator: diffs[0]?.creator, diffCount: diffs.length,
      });

      const statusOpt = interaction.options.getString('status') ?? 'rank';
      const statusMap = {
        rank:   daycore.RankedStatus.RANK,
        love:   daycore.RankedStatus.LOVE,
        unrank: daycore.RankedStatus.UNRANK,
      };
      const targetStatus = statusMap[statusOpt];

      // ── withdraw ─────────────────────────────────────────────────────────
      if (sub === 'withdraw') {
        // Por conta de jogo, como a nomeação: quem nomeou de um Discord
        // consegue retirar de outro, porque é a mesma pessoa.
        const removed = db.removeNomination(setId, targetStatus, staff.osuId);
        const left = db.getNominations(setId, targetStatus).length;
        return interaction.editReply(
          removed ? s.nom_withdrawn(label, left, threshold()) : s.nom_nothing_to_withdraw(label),
        );
      }

      // ── disqualify / force ───────────────────────────────────────────────
      if (sub === 'disqualify' || sub === 'force') {
        const status = sub === 'disqualify' ? daycore.RankedStatus.UNRANK : targetStatus;
        const result = await applyStatus(diffs, status);
        const { confirmed, pending } = result;

        // Aplicar encerra qualquer fila pendente daquele set: as nomeações
        // acumuladas se referem a um estado que não existe mais. Só que isso
        // vale quando o estado MUDOU — antes a limpeza era incondicional, e uma
        // queda do bancho apagava a fila sem que nada tivesse sido aplicado.
        //
        // Sem nada para limpar não há o que avisar, daí o `true`.
        const filaLimpa = pending.length === 0
          ? limparFila(setId, [daycore.RankedStatus.RANK, daycore.RankedStatus.LOVE])
          : true;

        // Pelo adminLog, e não pelo `db` direto: o status já foi publicado e a
        // releitura já disse o que pegou. Uma falha de SQLite aqui não pode cair
        // no `catch` lá embaixo e responder "nada foi confirmado" para um set já
        // rankeado — ver adminLog.js.
        const registrado = registrarAcao('nominate', {
          action: sub === 'disqualify' ? 'disqualify' : 'force',
          target: setId,
          detail: `${daycore.STATUS_LABELS[status]} | ${confirmed.length}/${diffs.length} ok` +
                  (interaction.options.getString('reason') ? ` | ${interaction.options.getString('reason')}` : '') +
                  failureDetail(result),
          actorDiscordId: interaction.user.id,
          actorOsuId: staff.osuId,
          actorOsuName: staff.osuName,
        });

        announceApplied(interaction, {
          setId, diffs, status, label, actorName: staff.osuName, confirmed,
        });

        const embed = new EmbedBuilder()
          // Verde só quando tudo fechou: o servidor confirmou todas as
          // dificuldades E a papelada local foi em frente. Mesma regra do /role,
          // /moderate e /wipe.
          .setColor(pending.length === 0 && registrado && filaLimpa ? 0x99ff99 : 0xffcc66)
          .setTitle(s.nom_applied_title(daycore.STATUS_LABELS[status]))
          .setDescription(
            `**${md(label)}**\n${s.nom_set_line(setId, diffs.length)}${origin}\n\n` +
            resultBlock(s, result) + avisosLocais(s, registrado, filaLimpa),
          )
          .setFooter({ text: s.nom_actor(staff.osuName) });
        return interaction.editReply({ embeds: [embed] });
      }

      // ── add ──────────────────────────────────────────────────────────────
      // Explícito, e não "tudo que sobrou": este ramo registra nomeação e, ao
      // atingir o limiar, APLICA o status no servidor. Um `addSubcommand` novo
      // sem ramo correspondente cairia aqui e mudaria mapa sem ninguém pedir.
      if (sub !== 'add') {
        throw new Error(`/nominate: subcomando declarado mas sem tratamento: "${sub}"`);
      }

      db.addNomination(setId, targetStatus, interaction.user.id, staff.osuId, staff.osuName);
      const nominations = db.getNominations(setId, targetStatus);
      const need = threshold();

      if (nominations.length < need) {
        const who = nominations.map(n => n.osu_name ?? n.osu_id).join(', ');
        const embed = new EmbedBuilder()
          .setColor(0x99ccff)
          .setTitle(s.nom_added_title(daycore.STATUS_LABELS[targetStatus]))
          .setDescription(
            `**${md(label)}**\n${s.nom_set_line(setId, diffs.length)}${origin}\n\n` +
            s.nom_progress(nominations.length, need) + `\n${s.nom_by(who)}`,
          );
        return interaction.editReply({ embeds: [embed] });
      }

      // Atingiu o limiar — aplica de verdade.
      const result = await applyStatus(diffs, targetStatus);
      const { confirmed, pending } = result;

      // Só descarta a fila se o set inteiro chegou ao status pedido. A limpeza
      // era incondicional, e em 09/08 um `0/100 ok` apagou as nomeações sem que
      // uma única dificuldade tivesse mudado no servidor. Com limiar 1 o custo é
      // renomear; com limiar maior, uma falha transitória destruía os votos de
      // várias pessoas. Reexecutar é idempotente — recuperar voto perdido não é.
      const filaLimpa = pending.length === 0
        ? limparFila(setId, [targetStatus])
        : true;

      // Mesmo motivo do ramo acima: o servidor já mudou, então falha de escrita
      // vira aviso e não negação — ver adminLog.js.
      const registrado = registrarAcao('nominate', {
        action: 'rank',
        target: setId,
        detail: `${daycore.STATUS_LABELS[targetStatus]} | ${confirmed.length}/${diffs.length} ok | ` +
                `nominators: ${nominations.map(n => n.osu_name ?? n.osu_id).join(', ')}` +
                failureDetail(result),
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      announceApplied(interaction, {
        setId, diffs, status: targetStatus, label,
        actorName: staff.osuName, confirmed,
      });

      const embed = new EmbedBuilder()
        // Verde só quando tudo fechou — mesma regra do ramo de cima.
        .setColor(pending.length === 0 && registrado && filaLimpa ? 0x99ff99 : 0xffcc66)
        .setTitle(s.nom_applied_title(daycore.STATUS_LABELS[targetStatus]))
        .setDescription(
          `**${md(label)}**\n${s.nom_set_line(setId, diffs.length)}${origin}\n\n` +
          // Com limiar 1 não houve espera nenhuma — anunciar "limiar atingido"
          // seria ruído.
          (need > 1 ? `${s.nom_threshold_reached(need)}\n` : '') +
          s.nom_by(nominations.map(n => n.osu_name ?? n.osu_id).join(', ')) + '\n\n' +
          resultBlock(s, result) + avisosLocais(s, registrado, filaLimpa),
        );
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('nominate', error);
      return interaction.editReply(s.admin_action_failed);
    }
  },

  // Exportado para poder ser verificado direto: é a leitura de uma configuração
  // que muda quanta gente precisa concordar antes de mexer no servidor.
  threshold,
};
