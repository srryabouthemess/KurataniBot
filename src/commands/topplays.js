const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { resolvePlayer } = require('../userLink');
const mapContext = require('../mapContext');
const emojis = require('../emojis');
const { paginate } = require('../pagination');
const { displayMods } = require('../mods');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const PAGE_SIZE   = 5;
const FETCH_LIMIT = 100;

const truncateTitle = (title, maxLen = 22) =>
  title.length > maxLen ? `${title.slice(0, maxLen).trimEnd()}...` : title;

const discordTimestamp = (dateString) =>
  `<t:${Math.floor(new Date(dateString).getTime() / 1000)}:R>`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('topplays')
    .setDescription("Show a player's top plays")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as melhores plays de um jogador' })
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
        .addChoices(...servers.choices())
    ),

  async execute(interaction) {
    const s        = t(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const { username, mode } = resolved;
    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply(s.player_not_found);

      const plays = await osu.getBestScores(user.id, FETCH_LIMIT, mode);
      if (plays.length === 0) return interaction.editReply(s.topplays_none);

      const totalPages = Math.ceil(plays.length / PAGE_SIZE);

      // Mapa do topo de cada página, para o /score sem argumento (mapContext).
      // Fica fora do buildEmbed porque o embed é memoizado — voltar para uma
      // página já vista não passa por lá de novo.
      const pageMapId = new Map();

      const stats       = user.statistics;
      const rankDisplay = stats.global_rank ? `#${stats.global_rank.toLocaleString()}` : s.profile_unranked;
      const countryPart = (!user._private && stats.country_rank)
        ? ` ${user.country_code}#${stats.country_rank.toLocaleString()}`
        : ` ${user.country_code}`;

      async function buildEmbed(page) {
        // Enriquece só os mapas da página atual (5), não os 100 buscados de
        // uma vez — evita rajada de requisições/rate limit na API do osu!
        const rawPage    = plays.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
        const scoredPage = await osu.enrichScores(rawPage, mode);
        const pagePlays  = await osu.enrichBeatmapData(scoredPage);

        pageMapId.set(page, pagePlays[0]?.beatmap?.id ?? null);

        const [adjustedStarsArray, fcPPArray] = await Promise.all([
          Promise.all(pagePlays.map(play => osu.getAdjustedStars(play.beatmap.id, play.mods, mode))),
          Promise.all(pagePlays.map(play => osu.getFCpp(play, mode))),
        ]);

        const embed = new EmbedBuilder()
          .setColor(0x2f3136)
          .setAuthor({
            name:    `${user.username}: ${stats.pp.toFixed(2)}pp (${rankDisplay}${countryPart})`,
            iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
            url:     osu.getUserUrl(user.id, mode),
          })
          .setThumbnail(user.avatar_url);

        let description = '';
        pagePlays.forEach((play, index) => {
          const globalIndex = page * PAGE_SIZE + index;
          const mapUrl     = osu.getMapUrl(play.beatmap.id, play.beatmapset.id, mode);
          const shownMods  = displayMods(play.mods);
          const mods       = shownMods.length > 0 ? `+${shownMods.join('')}` : '';
          const acc        = (play.accuracy * 100).toFixed(2);
          const starsRaw   = adjustedStarsArray[index] ?? play.beatmap.difficulty_rating;
          const stars      = starsRaw ? parseFloat(starsRaw).toFixed(2) : '?';
          const fcPP       = fcPPArray[index];
          const hits       = play.statistics ?? {};
          const h300       = hits.count_300  ?? hits.great ?? '-';
          const h100       = hits.count_100  ?? hits.ok    ?? '-';
          const h50        = hits.count_50   ?? hits.meh   ?? '-';
          const hMiss      = hits.count_miss ?? hits.miss  ?? 0;
          const hitsLine   = `{ ${h300} / ${h100} / ${h50} / ${hMiss} }`;
          const misses     = typeof hMiss === 'number' ? hMiss : 0;
          const mapCombo   = play.beatmap?.max_combo ?? null;
          const scoreCombo = play.max_combo ?? 0;
          const isChoke    = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

          const ppText = fcPP !== null && isChoke
            ? `\`${play.pp.toFixed(2)}pp\` *(FC: ~${fcPP.toFixed(2)}pp)*`
            : `\`${play.pp.toFixed(2)}pp\``;

          const comboText = `${scoreCombo}x/${mapCombo !== null ? mapCombo + 'x' : '?x'}`;

          const title = truncateTitle(play.beatmapset.title);
          description += `**#${globalIndex + 1} [${title} [${play.beatmap.version}]](${mapUrl}) [${stars}★]**\n`;
          description += `${emojis.rankLabel(play.rank)} ${ppText} (${acc}%) [${comboText}] **${mods}** ${discordTimestamp(play.created_at)}\n`;
          description += `${hitsLine}\n\n`;
        });

        embed.setDescription(description);
        embed.setFooter({ text: s.topplays_footer(page + 1, totalPages, osu.getModeLabel(mode)) });

        return embed;
      }

      // O embed da página é memoizado pelo paginate(): sem isso, voltar para
      // uma página já vista refazia tudo do zero — enriquecimento dos scores,
      // estrelas e PP de FC das mesmas 5 plays. Navegar 1→2→1 custava o triplo.
      await paginate(interaction, {
        id: 'topplays',
        totalPages,
        buildEmbed,
        strings: s,
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), mode),
        // Baixa os .osu da próxima página enquanto a pessoa lê a atual: o
        // gargalo de uma página nova é o limite de download, não o cálculo.
        prefetch: page => Promise.all(
          plays.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
            .map(play => osu.getBeatmapFile(play.beatmap?.id ?? play.beatmap_id))
        ),
      });
    } catch (error) {
      logError('topplays', error);
      return safeEditReply(interaction, s.topplays_error);
    }
  },
};
