const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../../osuClient');
const servers = require('../../servers');
const modo = require('../../modo');
const { resolvePlayer, fetchPlayer } = require('../../userLink');
const mapContext = require('../../mapContext');
const playEmbed = require('../../embeds/play');
const { paginate } = require('../../pagination');
const { mapLimit } = require('../../lib/concurrency');
const { weightedPP } = require('../../weightedPP');
const { parseModTokens, modAcronym, canonicalMods, formatMods } = require('../../mods');
const { md } = require('../../markdown');
const emojis = require('../../emojis');
const { t } = require('../../i18n');
const { logError } = require('../../lib/logger');
const { safeEditReply } = require('../../replies');

const { ppLegivel } = playEmbed;

const PAGE_SIZE       = 5;
const FETCH_LIMIT     = 100;
// Mesma razão do FC_CONCURRENCY do /nochoke: sem teto, um top 100 inteiro
// dispararia 100 simulações de PP de uma vez.
const SIM_CONCURRENCY = 5;

/**
 * Texto digitado → o que fazer com os mods de cada play, no formato do Bathbot:
 *
 *   +HD    insere HD em toda play que não tiver
 *   +HDHR! substitui os mods de toda play por exatamente HD+HR
 *   -HD!   remove HD de quem tiver
 *
 * O "!" do `exclude` não é enfeite: sem ele, "-HD" seria um pedido ambíguo
 * (remover só o HD? qualquer coisa que não seja HD?) que o Bathbot também não
 * aceita. `null` é "não entendi" — igual ao `parseModFilter` do topFilter.js,
 * um mod desconhecido invalida o pedido inteiro em vez de ser ignorado.
 *
 * @returns {{type: 'insert'|'exact'|'exclude', mods: Array<string|object>}|null}
 */
function parseModAction(input) {
  const text = String(input ?? '').trim();
  const match = /^([+-])(.*?)(!)?$/.exec(text);
  if (!match) return null;

  const [, sign, body, bang] = match;
  const { mods, unknown } = parseModTokens(body);
  if (unknown.length > 0 || mods.length === 0) return null;

  if (sign === '+') return { type: bang ? 'exact' : 'insert', mods };
  if (!bang) return null;
  return { type: 'exclude', mods };
}

/**
 * Mods que se cancelam ao entrar juntos — só usado no `insert`, porque `exact`
 * substitui a lista inteira (quem digitou já escolheu a combinação) e
 * `exclude` só tira o que já está lá.
 *
 * Sem isto, `+DT` numa play de HT deixaria os dois mods juntos, que nenhum
 * motor de PP sabe interpretar — o mesmo raciocínio do `stripImpliedDT` em
 * mods.js, para o par que ali é implícito (DT+NC) e aqui é explícito.
 */
const INCOMPATIBLE = {
  EZ: ['HR'], HR: ['EZ'],
  DT: ['HT', 'NC'], NC: ['HT', 'DT'], HT: ['DT', 'NC'],
  SD: ['PF'], PF: ['SD'],
};

/** Aplica o modificador nos mods de UMA play. Pura — o cálculo de PP não mora aqui. */
function applyModAction(mods, action) {
  const list = mods ?? [];

  if (action.type === 'exact') return [...action.mods];

  if (action.type === 'exclude') {
    const alvo = new Set(action.mods.map(modAcronym));
    return list.filter(mod => !alvo.has(modAcronym(mod)));
  }

  // insert
  let result = [...list];
  for (const novo of action.mods) {
    const acr = modAcronym(novo);
    const incompativeis = INCOMPATIBLE[acr] ?? [];
    result = result.filter(mod => modAcronym(mod) !== acr && !incompativeis.includes(modAcronym(mod)));
    result.push(novo);
  }
  return result;
}

/** Os quatro acertos da play, nos dois formatos que a normalização deixa (ver nochoke.js). */
function hitCounts(play) {
  const h = play?.statistics ?? {};
  return {
    n300: h.count_300 ?? h.great ?? 0,
    n100: h.count_100 ?? h.ok    ?? 0,
    n50:  h.count_50  ?? h.meh   ?? 0,
    nmiss: h.count_miss ?? h.miss ?? 0,
  };
}

/**
 * A grade que a play já tinha, com o par ouro/prata trocado conforme HD/FL
 * passa a existir ou não nos mods novos.
 *
 * Não é um recálculo de grade completo — e não precisa ser. A letra (X, S, A,
 * B, C, D) só depende dos acertos e do combo, nenhum dos dois muda aqui; o
 * ÚNICO efeito que um mod tem sobre a grade é a versão prata de X e S quando
 * HD ou FL está presente. Fora desse par, a grade fica intocada.
 */
const SILVER_UPGRADE   = { X: 'XH', S: 'SH' };
const SILVER_DOWNGRADE = { XH: 'X', SH: 'S' };

function adjustGradeForMods(rank, mods) {
  const silver = (mods ?? []).some(mod => ['HD', 'FL'].includes(modAcronym(mod)));
  return silver ? (SILVER_UPGRADE[rank] ?? rank) : (SILVER_DOWNGRADE[rank] ?? rank);
}

/**
 * Reordena as top plays pelo pp que teriam com os mods modificados.
 *
 * Mesmo truque de offset do `/nochoke` e do `/whatif` — ver weightedPP.js.
 *
 * `changed` é decidido aqui, comparando a forma canônica dos mods, e não por
 * quem chama: uma play cujos mods novos caem no MESMO conjunto (`+HD` numa
 * play que já tem HD, ou só a ordem trocada) não é uma mudança de verdade, e
 * fica no pp real mesmo que `newPPs` traga algum valor para ela.
 *
 * @param {{pp: number, mods: Array}[]} plays        top plays JÁ ORDENADAS por pp (como a API devolve)
 * @param {Array<Array>} newModsList                  paralelo a `plays`: os mods depois do modificador
 * @param {(number|null)[]} newPPs                    paralelo a `plays`: o pp simulado, ou null quando não deu para calcular
 * @param {number} profilePP                          `user.statistics.pp`
 */
function buildTopIf(plays, newModsList, newPPs, profilePP) {
  const entries = plays.map((play, i) => {
    const mods    = newModsList[i];
    const changed = canonicalMods(mods) !== canonicalMods(play.mods);
    const pp      = changed && Number.isFinite(newPPs[i]) ? newPPs[i] : play.pp;
    return { play, mods, pp, changed, origIndex: i + 1 };
  });

  entries.sort((a, b) => b.pp - a.pp);

  const antes  = weightedPP(plays);
  const depois = weightedPP(entries);
  const base   = Number.isFinite(profilePP) ? profilePP : antes;
  const offset = base - antes;

  return {
    entries,
    totalAntes:  base,
    totalDepois: depois + offset,
    ganho:       depois - antes,
    alterados:   entries.filter(e => e.changed).length,
  };
}

/** Uma play no embed — no estilo do /nochoke, com o antes/depois só quando mudou. */
async function linhaPlay(entry, mode) {
  const { play, mods: newMods, pp: novoPP, changed, origIndex } = entry;

  const starsAntesRaw = await osu.getAdjustedStars(play.beatmap?.id, play.mods, mode);
  const starsAntes    = parseFloat(starsAntesRaw ?? play.beatmap?.difficulty_rating);
  const temStarsAntes = Number.isFinite(starsAntes) && starsAntes > 0;

  const grade  = emojis.rankLabel(changed ? adjustGradeForMods(play.rank, newMods) : play.rank);
  const titulo = md(playEmbed.mapTitle(play));
  const url    = osu.getMapUrl(play.beatmap?.id, play.beatmapset?.id, mode);

  let modsLabel  = `**${formatMods(play.mods)}**`;
  let starsLabel = temStarsAntes ? ` [${starsAntes.toFixed(2)}★]` : '';

  if (changed) {
    modsLabel = `**${formatMods(play.mods)} → ${formatMods(newMods)}**`;

    const starsDepoisRaw = await osu.getAdjustedStars(play.beatmap?.id, newMods, mode);
    const starsDepois    = parseFloat(starsDepoisRaw ?? starsAntesRaw ?? play.beatmap?.difficulty_rating);
    if (Number.isFinite(starsDepois) && starsDepois > 0) {
      starsLabel = temStarsAntes
        ? ` [${starsAntes.toFixed(2)}★ → ${starsDepois.toFixed(2)}★]`
        : ` [${starsDepois.toFixed(2)}★]`;
    }
  }

  const cabec = url
    ? `**#${origIndex}** [${titulo}](${url}) ${modsLabel}${starsLabel}`
    : `**#${origIndex}** ${grade} ${modsLabel}${starsLabel}`;

  const { n300, n100, n50, nmiss } = hitCounts(play);
  const objetos   = n300 + n100 + n50 + nmiss;
  const accValue  = objetos > 0 ? (300 * n300 + 100 * n100 + 50 * n50) / (3 * objetos) : Number(play?.accuracy) * 100;
  const comboReal = play.max_combo ?? 0;
  const mapCombo  = play.beatmap?.max_combo ?? null;

  const realPP = Number.isFinite(play.pp) ? play.pp.toFixed(2) : '?';
  const accTxt = Number.isFinite(accValue) ? `${accValue.toFixed(2)}%` : '';

  const ms     = new Date(play.created_at).getTime();
  const quando = Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : '';

  let linhaPP;
  if (changed) {
    linhaPP = `${grade} \`${realPP}pp → ${novoPP.toFixed(2)}pp\`${accTxt ? ` • \`${accTxt}\`` : ''}`;
  } else {
    linhaPP = `${grade} \`${realPP}pp\`${accTxt ? ` • \`${accTxt}\`` : ''}`;
  }

  let linhaCombo = `\`[ ${comboReal}x/${mapCombo ?? '?'}x ]\``;
  if (nmiss > 0) linhaCombo += ` · ❌ ${nmiss}`;
  if (quando) linhaCombo += ` · ${quando}`;

  return `${cabec}\n${linhaPP}\n${linhaCombo}`;
}

module.exports = {
  parseModAction,
  applyModAction,
  buildTopIf,
  adjustGradeForMods,

  data: modo.addOption(new SlashCommandBuilder()
    .setName('topif')
    .setDescription('How the top plays would look like with different mods')
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra como as top plays de um jogador ficariam com outros mods' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(option =>
      option
        .setName('mods')
        .setDescription('+mods to insert, +mods! to replace, -mods! to remove (e.g. +hd, +hdhr!, -hd!)')
        .setDescriptionLocalizations({ 'pt-BR': '+mods insere, +mods! substitui, -mods! remove (ex: +hd, +hdhr!, -hd!)' })
        .setRequired(true)
        .setMaxLength(20)
    )
    .addStringOption(option =>
      option
        .setName('player')
        .setDescription('Player name (optional if /link is set)')
        .setDescriptionLocalizations({ 'pt-BR': 'Nome do jogador (opcional se tiver /link)' })
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('server')
        .setDescription('Which server to use? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(...servers.rootChoices())
    )),

  async execute(interaction) {
    const s        = t(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const modsInput = interaction.options.getString('mods');
    const action    = parseModAction(modsInput);
    if (!action) {
      return interaction.reply({
        content: s.topif_bad_mods(modsInput),
        flags: MessageFlags.Ephemeral,
      });
    }

    const { mode } = resolved;
    await interaction.deferReply();

    try {
      const { user, scores: plays } = await fetchPlayer(
        resolved,
        id => osu.getBestScores(id, FETCH_LIMIT, mode),
      );
      if (!user) return interaction.editReply(s.player_not_found);
      if (plays.length === 0) return interaction.editReply(s.topif_none);

      // Mesmo enriquecimento do /nochoke: hits reais e combo do mapa, sem os
      // quais o motor de simulação não tem o que recalcular.
      const enriched = await osu.enrichBeatmapData(await osu.enrichScores(plays, mode));

      const newModsList = enriched.map(play => applyModAction(play.mods, action));

      const newPPs = await mapLimit(enriched, SIM_CONCURRENCY, async (play, i) => {
        const newMods = newModsList[i];
        if (canonicalMods(newMods) === canonicalMods(play.mods)) return null;

        const { n300, n100, n50, nmiss } = hitCounts(play);
        const resultado = await osu.simulatePP(
          play.beatmap?.id,
          newMods,
          { n300, n100, n50, misses: nmiss, combo: play.max_combo },
          mode,
        ).catch(() => null);

        return resultado?.pp ?? null;
      });

      const { entries, totalAntes, totalDepois, ganho, alterados } =
        buildTopIf(enriched, newModsList, newPPs, user.statistics?.pp);

      if (alterados === 0) {
        return interaction.editReply(s.topif_no_change(user.username));
      }

      const totalPages = Math.ceil(entries.length / PAGE_SIZE);
      // O sinal decide aqui, e não no i18n: `ppLegivel` já devolve "-32.138,70"
      // sozinho quando o número é negativo (toLocaleString cuida disso), mas
      // não acrescenta o "+" no ganho positivo — e testar o sinal em cima da
      // STRING formatada (com separador de milhar) daria errado a partir de mil.
      const sinalGanho = ganho >= 0 ? '+' : '';
      const totalLine  = s.topif_gain(
        ppLegivel(totalAntes,  s.locale),
        ppLegivel(totalDepois, s.locale),
        `${sinalGanho}${ppLegivel(ganho, s.locale)}`,
      );

      const pageMapId = new Map();
      const fatia = page => entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      async function buildEmbed(page) {
        const itens      = fatia(page);
        const pagePlays  = await osu.enrichBeatmapData(itens.map(e => e.play));
        const comMapa    = itens.map((e, i) => ({ ...e, play: pagePlays[i] }));

        pageMapId.set(page, pagePlays[0]?.beatmap?.id ?? null);

        const blocos = await Promise.all(comMapa.map(e => linhaPlay(e, mode)));

        return new EmbedBuilder()
          .setColor(playEmbed.COLOR)
          .setAuthor(playEmbed.author(user, mode, s))
          .setThumbnail(user.avatar_url ?? null)
          .setDescription(`${s.topif_content(user.username, modsInput)}\n${totalLine}\n\n${blocos.join('\n\n')}`)
          .setFooter({ text: s.topif_footer(page + 1, totalPages, osu.getModeLabel(mode)) });
      }

      await paginate(interaction, {
        id: 'topif',
        totalPages,
        buildEmbed,
        strings: s,
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), mode),
      });
    } catch (error) {
      logError('topif', error);
      return safeEditReply(interaction, s.topif_error);
    }
  },
};
