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

/** Misses da play, nos dois formatos que a normalização pode deixar. */
const missCount = (play) => {
  const st = play?.statistics ?? {};
  return st.count_miss ?? st.miss ?? 0;
};

/**
 * Reordena as top plays trocando cada choke pelo PP que ele teria com FC.
 *
 * Exportada para teste: é a única parte que faz conta, e ela precisa concordar
 * com o `/whatif` no truque do offset — o `weightedPP` só soma as 100
 * ponderadas, então o total do perfil (com bônus de playcount e a cauda) entra
 * de volta como um desvio calculado uma vez. O ganho não passa pelo offset
 * porque é uma diferença e ele se cancela; é o mesmo raciocínio do whatif.js.
 *
 * @param {{pp: number}[]} plays  top plays JÁ ORDENADAS por pp decrescente (como a API devolve)
 * @param {(number|null)[]} fcpps paralelo a `plays`: o PP de FC, ou null quando a play já é FC
 * @param {number} profilePP      `user.statistics.pp` — o total publicado no perfil
 *
 * Play com mais de `MISS_LIMIT` misses fica no pp real: acima disso o FC não é
 * mais "o mesmo jogador sem o choke".
 * @returns {{entries: {play: object, pp: number, unchoked: boolean}[],
 *            totalAntes: number, totalDepois: number, ganho: number, corrigidos: number}}
 */
function unchoke(plays, fcpps, profilePP) {
  const entries = plays.map((play, i) => {
    const fc = fcpps[i];
    // Só conta como choke desfeito quando o FC pagaria MAIS. Um FC que daria
    // menos (possível no Relax, onde o motor é outro) não é correção nenhuma.
    // E play acima do MISS_LIMIT fica de fora — o FC dela é fantasia.
    const unchoked = Number.isFinite(fc) && fc > play.pp && missCount(play) <= MISS_LIMIT;
    return { play, pp: unchoked ? fc : play.pp, unchoked };
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
      const gainLine   = s.nochoke_gain(
        ppLegivel(totalAntes,  s.locale),
        ppLegivel(totalDepois, s.locale),
        ppLegivel(ganho,       s.locale),
        corrigidos,
      );

      // Mapa do topo de cada página, para o /score sem argumento (mapContext).
      // Fora do buildEmbed porque o embed é memoizado pelo paginate().
      const pageMapId = new Map();
      const fatia = page => entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      async function buildEmbed(page) {
        const itens     = fatia(page);
        // As plays já vieram enriquecidas antes do cálculo de FC; aqui só o
        // enrichBeatmapData de novo (idempotente, cache quente) para garantir
        // estrela e combo do mapa na renderização.
        const pagePlays = await osu.enrichBeatmapData(itens.map(e => e.play));

        pageMapId.set(page, pagePlays[0]?.beatmap?.id ?? null);

        const blocos = await Promise.all(pagePlays.map((play, index) =>
          playEmbed.listItem(play, {
            mode,
            // Posição na lista JÁ reordenada — aqui o #1 é a melhor play depois
            // de desfazer os chokes, que é justamente o que o comando mostra.
            index:  page * PAGE_SIZE + index + 1,
            mapUrl: osu.getMapUrl(play.beatmap.id, play.beatmapset.id, mode),
          })
        ));

        return new EmbedBuilder()
          .setColor(playEmbed.COLOR)
          .setAuthor(playEmbed.author(user, mode, s))
          .setThumbnail(user.avatar_url ?? null)
          .setDescription(`${gainLine}\n\n${blocos.join('\n\n')}`)
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
