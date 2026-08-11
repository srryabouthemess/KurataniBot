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

// Quantas nomeações distintas um set precisa antes de ser aplicado de fato.
//
// O padrão é 1: quem nomeia já aplica. O osu! oficial pede 2 (dois BNs), mas lá
// isso resolve um problema que um servidor pequeno não tem — com poucos
// nominators, exigir um segundo só trava mapa esperando alguém aparecer. Quem
// quiser o modelo do osu! sobe o número no `.env`.
//
// ATENÇÃO ao subir para 2 ou mais: hoje a contagem é por conta do **Discord**
// (a PK de map_nominations é discord_id), não por conta do jogo. Duas contas do
// Discord ligadas ao mesmo osu! id valem como duas nomeações — então o limiar
// só vale de verdade depois de trocar essa unicidade para osu_id.
const DEFAULT_THRESHOLD = 1;

// Tetos nas entradas de texto livre. Sem eles o Discord aceita até 6000
// caracteres, que estouram o limite de 4096 do embed — o comando falharia ao
// responder, possivelmente depois de a ação já ter sido aplicada no Daycore.
const MAP_INPUT_MAX_LENGTH = 200;
const REASON_MAX_LENGTH    = 200;

/** Recorta texto vindo do banco/API antes de renderizar num embed. */
function truncate(text, max) {
  const str = String(text ?? '');
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

function threshold() {
  const raw = Number(process.env.NOMINATION_THRESHOLD);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_THRESHOLD;
}

/**
 * Aceita ID de dificuldade, ID de set, ou link de qualquer um dos dois, e
 * devolve sempre o set inteiro — o status é uma propriedade da dificuldade no
 * bancho, mas ninguém rankeia meia dificuldade: o que se nomeia é o mapa todo.
 *
 * @returns {Promise<{setId: number, diffs: object[]} | {error: 'not_found'|'invalid'}>}
 */
async function resolveSet(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'invalid' };

  // Link de beatmapset (sem #diff) → o ID já é o do set.
  const setLink = raw.match(/beatmapsets?\/(\d+)/) ?? raw.match(/\/s\/(\d+)/);
  if (setLink) {
    const diffs = await osu.getServerMapsBySet(Number(setLink[1]));
    return diffs.length > 0 ? { setId: Number(setLink[1]), diffs } : { error: 'not_found' };
  }

  // Link/ID de dificuldade → sobe para o set dela.
  const mapId = osu.parseBeatmapId(raw);
  if (mapId) {
    const map = await osu.getServerMap(mapId);
    if (map?.set_id) {
      const diffs = await osu.getServerMapsBySet(map.set_id);
      return { setId: map.set_id, diffs: diffs.length > 0 ? diffs : [map] };
    }

    // Número solto que não é dificuldade: tenta como ID de set antes de
    // desistir — quem copia da página do mapa costuma pegar o do set.
    if (/^\d+$/.test(raw)) {
      const diffs = await osu.getServerMapsBySet(Number(raw));
      if (diffs.length > 0) return { setId: Number(raw), diffs };
    }
    return { error: 'not_found' };
  }

  return { error: 'invalid' };
}

function mapLabel(diffs) {
  const first = diffs[0] ?? {};
  // Metadados vêm do .osu enviado por quem fez o upload — título e artista são
  // texto arbitrário de terceiro, então limitamos antes de compor o embed.
  return truncate(`${first.artist ?? '?'} - ${first.title ?? '?'} (${first.creator ?? '?'})`, 150);
}

/**
 * Publica a mudança de status para todas as dificuldades e confirma o efeito.
 *
 * O canal `rank` do bancho age sobre UMA dificuldade por mensagem, então um
 * set com 7 diffs são 7 publicações. E como pub/sub não devolve resposta,
 * relemos o estado pela API v2 em vez de assumir sucesso.
 */
async function applyStatus(diffs, status) {
  const ids = diffs.map(d => d.id);

  for (const id of ids) {
    await daycore.rankBeatmap(id, status, true);
  }

  return daycore.verifyMapStatus(ids, status);
}

function resultLine(s, confirmed, pending) {
  if (pending.length === 0) return s.nom_all_confirmed(confirmed.length);
  if (confirmed.length === 0) return s.nom_none_confirmed(pending.length);
  return s.nom_partial(confirmed.length, confirmed.length + pending.length, pending.join(', '));
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
    const sub = interaction.options.getSubcommand();

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
        const { confirmed, pending } = await applyStatus(diffs, status);

        // Aplicar encerra qualquer fila pendente daquele set: as nomeações
        // acumuladas se referem a um estado que não existe mais.
        db.clearNominations(setId, daycore.RankedStatus.RANK);
        db.clearNominations(setId, daycore.RankedStatus.LOVE);

        db.logAdminAction({
          action: sub === 'disqualify' ? 'disqualify' : 'force',
          target: setId,
          detail: `${daycore.STATUS_LABELS[status]} | ${confirmed.length}/${diffs.length} ok` +
                  (interaction.options.getString('reason') ? ` | ${interaction.options.getString('reason')}` : ''),
          actorDiscordId: interaction.user.id,
          actorOsuId: staff.osuId,
          actorOsuName: staff.osuName,
        });

        const embed = new EmbedBuilder()
          .setColor(pending.length === 0 ? 0x99ff99 : 0xffcc66)
          .setTitle(s.nom_applied_title(daycore.STATUS_LABELS[status]))
          .setDescription(
            `**${label}**\n${s.nom_set_line(setId, diffs.length)}\n\n` +
            resultLine(s, confirmed, pending),
          )
          .setFooter({ text: s.nom_actor(staff.osuName) });
        return interaction.editReply({ embeds: [embed] });
      }

      // ── add ──────────────────────────────────────────────────────────────
      db.addNomination(setId, targetStatus, interaction.user.id, staff.osuId, staff.osuName);
      const nominations = db.getNominations(setId, targetStatus);
      const need = threshold();

      if (nominations.length < need) {
        const who = nominations.map(n => n.osu_name ?? n.osu_id).join(', ');
        const embed = new EmbedBuilder()
          .setColor(0x99ccff)
          .setTitle(s.nom_added_title(daycore.STATUS_LABELS[targetStatus]))
          .setDescription(
            `**${label}**\n${s.nom_set_line(setId, diffs.length)}\n\n` +
            s.nom_progress(nominations.length, need) + `\n${s.nom_by(who)}`,
          );
        return interaction.editReply({ embeds: [embed] });
      }

      // Atingiu o limiar — aplica de verdade.
      const { confirmed, pending } = await applyStatus(diffs, targetStatus);
      db.clearNominations(setId, targetStatus);

      db.logAdminAction({
        action: 'rank',
        target: setId,
        detail: `${daycore.STATUS_LABELS[targetStatus]} | ${confirmed.length}/${diffs.length} ok | ` +
                `nominators: ${nominations.map(n => n.osu_name ?? n.osu_id).join(', ')}`,
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      const embed = new EmbedBuilder()
        .setColor(pending.length === 0 ? 0x99ff99 : 0xffcc66)
        .setTitle(s.nom_applied_title(daycore.STATUS_LABELS[targetStatus]))
        .setDescription(
          `**${label}**\n${s.nom_set_line(setId, diffs.length)}\n\n` +
          // Com limiar 1 não houve espera nenhuma — anunciar "limiar atingido"
          // seria ruído.
          (need > 1 ? `${s.nom_threshold_reached(need)}\n` : '') +
          s.nom_by(nominations.map(n => n.osu_name ?? n.osu_id).join(', ')) + '\n\n' +
          resultLine(s, confirmed, pending),
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
