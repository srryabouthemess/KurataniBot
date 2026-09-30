const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../../../osuClient');
const servers = require('../../../servers');
const modo = require('../../../modo');
const { resolvePlayer, fetchPlayer } = require('../../../userLink');
const mapContext = require('../../../mapContext');
const playEmbed = require('../../../embeds/play');
const { paginate } = require('../../../pagination');
const { mapLimit } = require('../../../lib/concurrency');
const { t } = require('../../../i18n');
const { logError } = require('../../../lib/logger');
const { safeEditReply } = require('../../../replies');
const { unchoke } = require('./logic');
const { linhaPlay } = require('./embed');

const { ppLegivel } = playEmbed;

const PAGE_SIZE      = 5;
const FETCH_LIMIT    = 100;
// Teto de chamadas ao motor de PP em voo. Mesma razão do concurrency.js: sem
// ele, um top 100 cheio de choke dispararia 100 cálculos de FC de uma vez.
const FC_CONCURRENCY = 5;

module.exports = {
  // Valida a entrada e responde o erro em efêmero ANTES do próprio defer
  // público; um defer do despacho tornaria esse erro público (ver
  // bot/dispatch.js).
  defer: false,

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

      // O `getBestScores` devolve score CRU, no formato do servidor. Sem
      // enriquecer, o getFCpp não tem como saber se a play foi choke e devolve
      // null para todas — "nenhum choke" para qualquer jogador. O enrichScores
      // normaliza os acertos e o combo da play e traz o mapa do servidor; o
      // enrichBeatmapData completa o combo do mapa, que é o que o getFCpp
      // compara.
      //
      // Enquanto as plays do Daycore vinham da Shiina-Web (só pp, acc e mods),
      // isto custava um detalhe de score por play — ~100 requisições num /nc
      // frio. Hoje elas vêm da v1 do bancho.py com os acertos, e o detalhe só
      // sai quando falta algum (ver `jaTemDetalhe` em scores.js).
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
