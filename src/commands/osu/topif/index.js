const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../../../osuClient');
const servers = require('../../../servers');
const modo = require('../../../modo');
const { resolvePlayer, fetchPlayer } = require('../../../userLink');
const mapContext = require('../../../mapContext');
const playEmbed = require('../../../embeds/play');
const { paginate } = require('../../../pagination');
const { mapLimit } = require('../../../lib/concurrency');
const { canonicalMods } = require('../../../mods');
const { t } = require('../../../i18n');
const { logError } = require('../../../lib/logger');
const { safeEditReply } = require('../../../replies');
const { hitCounts } = require('../../../hits');
const { parseModAction, applyModAction, buildTopIf } = require('./logic');
const { linhaPlay } = require('./embed');

const { ppLegivel } = playEmbed;

const PAGE_SIZE       = 5;
const FETCH_LIMIT     = 100;
// Mesma razão do FC_CONCURRENCY do /nochoke: sem teto, um top 100 inteiro
// dispararia 100 simulações de PP de uma vez.
const SIM_CONCURRENCY = 5;

module.exports = {
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
