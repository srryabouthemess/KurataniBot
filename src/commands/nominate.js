const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags,
} = require('discord.js');

const osu = require('../osuClient');
const daycore = require('../daycoreAdmin');
const { resolveStaff, checkRedisOrError } = require('../staffGuard');
const announce = require('../announce');
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
// Subir para 2 ou mais funciona: a contagem é por CONTA DE JOGO — a PK de
// map_nominations é (set_id, target_status, osu_id). Já foi por discord_id, e
// aí duas contas do Discord apontando para o mesmo osu! id valiam como duas
// nomeações, o que deixava uma pessoa sozinha atingir um limiar de 2; a
// migração em db.js reconstruiu a tabela justamente por causa disso.
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
 * `getServerMap` levanta em 404, e aqui isso é resposta, não falha: quer dizer
 * que o servidor não conhece o mapa — justamente o caso que o fallback trata.
 *
 * Qualquer outro erro (rede, 5xx) precisa subir. Tratá-lo como "não conhece"
 * mandaria o fluxo para a API oficial e publicaríamos num servidor que não
 * conseguimos nem reler para confirmar o efeito.
 */
async function serverMap(mapId) {
  try {
    return await osu.getServerMap(mapId);
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

/**
 * Dificuldades de um set, do servidor administrado ou — se ele ainda não
 * conhecer o mapa — da API oficial do osu!.
 *
 * O fallback existe porque o bancho é menos exigente do que o bot era: ao
 * receber um publish no canal `rank` ele chama `Beatmap.from_bid`, que busca na
 * API oficial e cacheia o set inteiro quando não tem o mapa no banco. Recusar
 * aqui negava uma nomeação que o servidor daria conta de aplicar — e esse é o
 * caso comum do mapa novo, que ninguém no servidor jogou ainda.
 *
 * @returns {Promise<{setId: number, diffs: object[], onServer: boolean} | {error: 'not_found'}>}
 */
async function diffsForSet(setId) {
  const onServer = await osu.getServerMapsBySet(setId);
  if (onServer.length > 0) return { setId, diffs: onServer, onServer: true };

  // Falha da API oficial vira "não encontrei" em vez de subir: o efeito é
  // recusar a nomeação, e recusar é o lado seguro — o outro seria publicar sem
  // saber a lista de dificuldades.
  const official = await osu.getOfficialMapsBySet(setId).catch(() => []);
  if (official.length > 0) return { setId, diffs: official, onServer: false };

  return { error: 'not_found' };
}

/**
 * Aceita ID de dificuldade, ID de set, ou link de qualquer um dos dois, e
 * devolve sempre o set inteiro — o status é uma propriedade da dificuldade no
 * bancho, mas ninguém rankeia meia dificuldade: o que se nomeia é o mapa todo.
 *
 * `onServer` diz de onde veio a lista, para a resposta poder avisar que o mapa
 * ainda vai ser buscado na hora de aplicar.
 *
 * @returns {Promise<{setId: number, diffs: object[], onServer: boolean} | {error: 'not_found'|'invalid'}>}
 */
async function resolveSet(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'invalid' };

  // Link de beatmapset (sem #diff) → o ID já é o do set.
  const setLink = raw.match(/beatmapsets?\/(\d+)/) ?? raw.match(/\/s\/(\d+)/);
  if (setLink) return diffsForSet(Number(setLink[1]));

  // Link/ID de dificuldade → sobe para o set dela.
  const mapId = osu.parseBeatmapId(raw);
  if (mapId) {
    const map = await serverMap(mapId);
    if (map?.set_id) {
      const resolved = await diffsForSet(map.set_id);
      // O servidor conhece a dificuldade mas não devolveu o set: fica com a
      // única que temos, em vez de descartar o que já está em mãos.
      return resolved.error ? { setId: map.set_id, diffs: [map], onServer: true } : resolved;
    }

    // O servidor não conhece essa dificuldade; a API oficial diz de qual set
    // ela é, e daí o caminho volta a ser o mesmo.
    const official = await osu.getBeatmap(mapId);
    if (official?.beatmapset_id) return diffsForSet(official.beatmapset_id);

    // Número solto que não é dificuldade: tenta como ID de set antes de
    // desistir — quem copia da página do mapa costuma pegar o do set.
    if (/^\d+$/.test(raw)) return diffsForSet(Number(raw));

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
  const published = [];
  let failure = null;

  // A falha no meio do laço NÃO vira exceção, e isso é deliberado. O que já foi
  // publicado não tem como ser desfeito: o bancho consome do Redis por conta
  // própria e vai aplicar aquilo independente do que aconteça aqui. Deixar a
  // exceção subir fazia o comando responder "ocorreu um erro" e pular o
  // logAdminAction — ou seja, o servidor mudava e o log do bot não registrava
  // nada. É o oposto do que a auditoria existe para garantir.
  for (const id of ids) {
    try {
      await daycore.rankBeatmap(id, status, true);
      published.push(id);
    } catch (error) {
      failure = error;
      break;
    }
  }

  const { confirmed, pending } = published.length > 0
    ? await daycore.verifyMapStatus(published, status)
    : { confirmed: [], pending: [] };

  // O que nunca chegou a ser publicado entra como pendente: do ponto de vista
  // de quem pediu, aquelas dificuldades não chegaram ao status alvo — e é isso
  // que decide a cor do embed e se a fila de nomeação sobrevive.
  const enviadas = new Set(published);

  return {
    confirmed,
    pending: [...pending, ...ids.filter(id => !enviadas.has(id))],
    published,
    total: ids.length,
    failure,
  };
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
function announceApplied(interaction, s, { setId, diffs, status, label, actorName, confirmed }) {
  if (confirmed.length === 0) return;

  announce.announceStatus(interaction.client, {
    setId, diffs, status,
    statusLabel: daycore.STATUS_LABELS[status],
    label, actorName, confirmed: confirmed.length,
  }, s).catch(error => logError('announce', error));
}

/**
 * Sufixo de auditoria quando a publicação parou no meio.
 *
 * Vai para o `detail` do admin_actions porque é a única pista de que o servidor
 * recebeu parte das dificuldades: quem ler o log depois precisa saber que o
 * estado ficou pela metade por falha de transporte, e não porque alguém pediu
 * assim.
 */
function failureDetail(result) {
  if (!result.failure) return '';
  return ` | publicacao interrompida em ${result.published.length}/${result.total}: ${result.failure.message}`;
}

function resultLine(s, confirmed, pending) {
  if (pending.length === 0) return s.nom_all_confirmed(confirmed.length);
  if (confirmed.length === 0) return s.nom_none_confirmed(pending.length);
  return s.nom_partial(confirmed.length, confirmed.length + pending.length, pending.join(', '));
}

/**
 * Resultado como quem rodou o comando precisa ler.
 *
 * "Não confirmou" e "nem chegou a ser publicado" são coisas diferentes: a
 * primeira pode ser o bancho ainda processando, a segunda é certeza de que
 * aquela dificuldade não vai mudar sozinha. Sem separar, uma queda do Redis no
 * meio do set se parecia com lentidão do servidor.
 */
function resultBlock(s, result) {
  return resultLine(s, result.confirmed, result.pending) +
    (result.failure ? `\n${s.nom_publish_interrupted(result.published.length, result.total)}` : '');
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
        if (pending.length === 0) {
          db.clearNominations(setId, daycore.RankedStatus.RANK);
          db.clearNominations(setId, daycore.RankedStatus.LOVE);
        }

        db.logAdminAction({
          action: sub === 'disqualify' ? 'disqualify' : 'force',
          target: setId,
          detail: `${daycore.STATUS_LABELS[status]} | ${confirmed.length}/${diffs.length} ok` +
                  (interaction.options.getString('reason') ? ` | ${interaction.options.getString('reason')}` : '') +
                  failureDetail(result),
          actorDiscordId: interaction.user.id,
          actorOsuId: staff.osuId,
          actorOsuName: staff.osuName,
        });

        announceApplied(interaction, s, {
          setId, diffs, status, label, actorName: staff.osuName, confirmed,
        });

        const embed = new EmbedBuilder()
          .setColor(pending.length === 0 ? 0x99ff99 : 0xffcc66)
          .setTitle(s.nom_applied_title(daycore.STATUS_LABELS[status]))
          .setDescription(
            `**${label}**\n${s.nom_set_line(setId, diffs.length)}${origin}\n\n` +
            resultBlock(s, result),
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
            `**${label}**\n${s.nom_set_line(setId, diffs.length)}${origin}\n\n` +
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
      if (pending.length === 0) db.clearNominations(setId, targetStatus);

      db.logAdminAction({
        action: 'rank',
        target: setId,
        detail: `${daycore.STATUS_LABELS[targetStatus]} | ${confirmed.length}/${diffs.length} ok | ` +
                `nominators: ${nominations.map(n => n.osu_name ?? n.osu_id).join(', ')}` +
                failureDetail(result),
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      announceApplied(interaction, s, {
        setId, diffs, status: targetStatus, label,
        actorName: staff.osuName, confirmed,
      });

      const embed = new EmbedBuilder()
        .setColor(pending.length === 0 ? 0x99ff99 : 0xffcc66)
        .setTitle(s.nom_applied_title(daycore.STATUS_LABELS[targetStatus]))
        .setDescription(
          `**${label}**\n${s.nom_set_line(setId, diffs.length)}${origin}\n\n` +
          // Com limiar 1 não houve espera nenhuma — anunciar "limiar atingido"
          // seria ruído.
          (need > 1 ? `${s.nom_threshold_reached(need)}\n` : '') +
          s.nom_by(nominations.map(n => n.osu_name ?? n.osu_id).join(', ')) + '\n\n' +
          resultBlock(s, result),
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

  // Idem: decide de qual fonte sai a lista de dificuldades, e errar aí é
  // publicar no mapa errado ou recusar um que daria certo.
  resolveSet,

  // Idem: é quem separa "publicado" de "confirmado". Errar aqui é apagar a fila
  // de nomeação de um set que nunca mudou no servidor.
  applyStatus,
};
