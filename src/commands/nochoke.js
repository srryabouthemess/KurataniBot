const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const modo = require('../modo');
const { resolvePlayer, fetchPlayer } = require('../userLink');
const mapContext = require('../mapContext');
const playEmbed = require('../embeds/play');
const { paginate } = require('../pagination');
const { mapLimit } = require('../concurrency');
const { weightedPP } = require('../weightedPP');
const { formatMods } = require('../mods');
const { md } = require('../markdown');
const emojis = require('../emojis');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const { ppLegivel } = playEmbed;

const PAGE_SIZE      = 5;
const FETCH_LIMIT    = 100;
// Teto de chamadas ao motor de PP em voo. Mesma razão do concurrency.js: sem
// ele, um top 100 cheio de choke dispararia 100 cálculos de FC de uma vez.
const FC_CONCURRENCY = 5;
// Acima disto a play não é mais "um choke" e sim outra corrida: o FC vira uma
// fantasia (rafs tinha play de 169 miss pagando 1048pp de FC contra 64 reais),
// e o top "sem choke" deixava de descrever o jogador. Fica no valor real.
const MISS_LIMIT     = 20;

/** Os quatro acertos da play, nos dois formatos que a normalização deixa. */
function hitCounts(play) {
  const h = play?.statistics ?? {};
  return {
    n300: h.count_300 ?? h.great ?? 0,
    n100: h.count_100 ?? h.ok    ?? 0,
    n50:  h.count_50  ?? h.meh    ?? 0,
    nmiss: h.count_miss ?? h.miss ?? 0,
  };
}

/** Acurácia (0–100) a partir dos hits; e a que a play teria com os misses virando 300. */
function accPair(play) {
  const { n300, n100, n50, nmiss } = hitCounts(play);
  const objetos = n300 + n100 + n50 + nmiss;
  if (!objetos) {
    const bruto = Number(play?.accuracy) * 100;
    const val = Number.isFinite(bruto) ? bruto : 0;
    return { real: val, fc: val };
  }
  return {
    real: (300 * n300 + 100 * n100 + 50 * n50) / (3 * objetos),
    fc:   (300 * (n300 + nmiss) + 100 * n100 + 50 * n50) / (3 * objetos),
  };
}

/**
 * Reordena as top plays trocando cada choke pelo PP que ele teria com FC.
 *
 * Exportada para teste: é a única parte que faz conta, e ela precisa concordar
 * com o `/whatif` no truque do offset — o `weightedPP` só soma as 100
 * ponderadas, então o total do perfil (com bônus de playcount e a cauda) entra
 * de volta como um desvio calculado uma vez. O ganho não passa pelo offset
 * porque é uma diferença e ele se cancela; é o mesmo raciocínio do whatif.js.
 *
 * Cada entry leva o `origIndex` (posição 1-based na lista ANTES do sort, que é
 * a ordem de pp da API) — o embed mostra a posição de origem da play, não o
 * lugar dela na lista reordenada.
 *
 * Play com mais de `MISS_LIMIT` misses fica no pp real: acima disso o FC não é
 * mais "o mesmo jogador sem o choke".
 *
 * @param {{pp: number}[]} plays  top plays JÁ ORDENADAS por pp decrescente (como a API devolve)
 * @param {(number|null)[]} fcpps paralelo a `plays`: o PP de FC, ou null quando a play já é FC
 * @param {number} profilePP      `user.statistics.pp` — o total publicado no perfil
 * @returns {{entries: {play: object, pp: number, unchoked: boolean, origIndex: number}[],
 *            totalAntes: number, totalDepois: number, ganho: number, corrigidos: number}}
 */
function unchoke(plays, fcpps, profilePP) {
  const entries = plays.map((play, i) => {
    const fc = fcpps[i];
    const { nmiss } = hitCounts(play);
    // Só conta como choke desfeito quando o FC pagaria MAIS. Um FC que daria
    // menos (possível no Relax, onde o motor é outro) não é correção nenhuma.
    // E play acima do MISS_LIMIT fica de fora — o FC dela é fantasia.
    const unchoked = Number.isFinite(fc) && fc > play.pp && nmiss <= MISS_LIMIT;
    return { play, pp: unchoked ? fc : play.pp, unchoked, origIndex: i + 1 };
  });

  entries.sort((a, b) => b.pp - a.pp);

  const antes  = weightedPP(plays);           // `plays` já vem decrescente
  const depois = weightedPP(entries);         // reordenado acima
  const base   = Number.isFinite(profilePP) ? profilePP : antes;
  const offset = base - antes;

  return {
    entries,
    totalAntes:  base,
    totalDepois: depois + offset,
    ganho:       depois - antes,
    corrigidos:  entries.filter(e => e.unchoked).length,
  };
}

/** Uma play no embed — três linhas no estilo do Bathbot. */
async function linhaPlay(entry, mode, s) {
  const { play, pp: fcPP, unchoked, origIndex } = entry;

  const aj    = await osu.getAdjustedStars(play.beatmap?.id, play.mods, mode);
  const st    = parseFloat(aj ?? play.beatmap?.difficulty_rating);
  const stars = Number.isFinite(st) && st > 0 ? ` [${st.toFixed(2)}★]` : '';

  const grade  = emojis.rankLabel(play.rank);
  const mods   = `**${formatMods(play.mods)}**`;
  const titulo = md(playEmbed.mapTitle(play));
  const url    = osu.getMapUrl(play.beatmap?.id, play.beatmapset?.id, mode);
  const cabec  = url
    ? `**#${origIndex}** [${titulo}](${url}) ${mods}${stars}`
    : `**#${origIndex}** ${grade} ${mods}${stars}`;

  const realPP    = Number.isFinite(play.pp) ? play.pp.toFixed(2) : '?';
  const { real: accReal, fc: accFC } = accPair(play);
  const comboReal = play.max_combo ?? 0;
  const mapCombo  = play.beatmap?.max_combo ?? null;

  const ms     = new Date(play.created_at).getTime();
  const quando = Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : '';

  let linhaPP;
  let linhaCombo;
  if (unchoked) {
    linhaPP = `${grade} \`${realPP} → ${fcPP.toFixed(2)}pp\` • \`${accReal.toFixed(2)}% → ${accFC.toFixed(2)}%\``;
    const alvo = mapCombo ?? comboReal;
    linhaCombo = `\`[ ${comboReal}x → ${alvo}x/${alvo}x ]\` · ${s.nochoke_removed} ${hitCounts(play).nmiss} ❌`;
  } else {
    linhaPP = `${grade} \`${realPP}pp\` • \`${accReal.toFixed(2)}%\``;
    linhaCombo = `\`[ ${comboReal}x/${mapCombo ?? '?'}x ]\``;
  }
  if (quando) linhaCombo += ` · ${quando}`;

  return `${cabec}\n${linhaPP}\n${linhaCombo}`;
}

module.exports = {
  unchoke,

  data: modo.addOption(new SlashCommandBuilder()
    .setName('nochoke')
    .setDescription("Show a player's top plays re-scored as if every choke had been an FC")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as top plays de um jogador recalculadas como se todo choke tivesse sido FC' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
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

    const { mode } = resolved;
    await interaction.deferReply();

    try {
      const { user, scores: plays } = await fetchPlayer(
        resolved,
        id => osu.getBestScores(id, FETCH_LIMIT, mode),
      );
      if (!user) return interaction.editReply(s.player_not_found);
      if (plays.length === 0) return interaction.editReply(s.nochoke_none);

      // O `getBestScores` devolve score CRU — e no bancho.py-ex + Shiina-Web
      // (Daycore) o cru é só pp, acc e mods, sem hits nem combo. Sem enriquecer,
      // o getFCpp não tem como saber se a play foi choke e devolve null para
      // todas — "nenhum choke" para qualquer jogador. O enrichScores resolve o
      // detalhe de cada score (scoreDetail, cache de 1h) e o enrichBeatmapData
      // traz o combo do mapa, que é o que o getFCpp compara.
      const enriched = await osu.enrichBeatmapData(await osu.enrichScores(plays, mode));

      // O FC de cada play, com o teto de chamadas em voo. O getFCpp devolve
      // null de graça para quem já é FC (sem tocar no motor), e guarda o
      // resultado em cache.db — a segunda passada do mesmo jogador é barata.
      const fcpps = await mapLimit(enriched, FC_CONCURRENCY, play =>
        osu.getFCpp(play, mode).catch(() => null),
      );

      const { entries, totalAntes, totalDepois, ganho, corrigidos } =
        unchoke(enriched, fcpps, user.statistics?.pp);

      if (corrigidos === 0) {
        return interaction.editReply(s.nochoke_no_chokes(user.username));
      }

      const totalPages = Math.ceil(entries.length / PAGE_SIZE);
      const totalLine  = s.nochoke_gain(
        ppLegivel(totalAntes,  s.locale),
        ppLegivel(totalDepois, s.locale),
        ppLegivel(ganho,       s.locale),
      );

      // Mapa do topo de cada página, para o /score sem argumento (mapContext).
      // Fora do buildEmbed porque o embed é memoizado pelo paginate().
      const pageMapId = new Map();
      const fatia = page => entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      async function buildEmbed(page) {
        const itens = fatia(page);
        // As plays já vieram enriquecidas; o enrichBeatmapData de novo é
        // idempotente (cache quente) e garante combo e estrela do mapa.
        const pagePlays = await osu.enrichBeatmapData(itens.map(e => e.play));
        const comMapa   = itens.map((e, i) => ({ ...e, play: pagePlays[i] }));

        pageMapId.set(page, pagePlays[0]?.beatmap?.id ?? null);

        const blocos = await Promise.all(comMapa.map(e => linhaPlay(e, mode, s)));

        return new EmbedBuilder()
          .setColor(playEmbed.COLOR)
          .setAuthor(playEmbed.author(user, mode, s))
          .setThumbnail(user.avatar_url ?? null)
          .setDescription(`${totalLine}\n\n${blocos.join('\n\n')}`)
          .setFooter({ text: s.nochoke_footer(page + 1, totalPages, osu.getModeLabel(mode)) });
      }

      await paginate(interaction, {
        id: 'nochoke',
        totalPages,
        buildEmbed,
        strings: s,
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), mode),
      });
    } catch (error) {
      logError('nochoke', error);
      return safeEditReply(interaction, s.nochoke_error);
    }
  },
};
