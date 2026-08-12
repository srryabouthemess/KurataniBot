const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { resolvePlayer } = require('../userLink');
const mapContext = require('../mapContext');
const emojis = require('../emojis');
const { paginate } = require('../pagination');
const { localScorePP } = require('../scorePP');
const { displayMods } = require('../mods');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const PAGE_SIZE = 5;

// Título de embed estoura em 256 caracteres — e "artista - título [diff]" de
// mapa de maratona chega perto. Cortar aqui evita que o comando falhe ao
// responder depois de já ter buscado tudo.
const EMBED_TITLE_MAX = 250;

const truncate = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

const discordTimestamp = (dateString) =>
  `<t:${Math.floor(new Date(dateString).getTime() / 1000)}:R>`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('score')
    .setDescription("Show all of a player's scores on a beatmap")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra todos os scores de um jogador em um mapa' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(option =>
      option
        .setName('map')
        .setDescription('Beatmap ID or link (default: last map shown in this channel)')
        .setDescriptionLocalizations({ 'pt-BR': 'ID ou link do mapa (padrão: o último mapa exibido no canal)' })
        .setRequired(false)
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
        .addChoices(...servers.choices())
    ),

  // No slash o `map` vem primeiro porque é a opção principal do comando. Já
  // escrevendo, `k!c fulano` é o uso normal — o mapa quase sempre vem do
  // contexto do canal. Sem esta guarda o nome do jogador cairia no `map`, e a
  // resposta seria "não consegui identificar o mapa" para quem nem falou de
  // mapa nenhum.
  prefix: {
    guards: { map: value => osu.parseBeatmapId(value) !== null },
  },

  async execute(interaction) {
    const s        = t(interaction);
    const mapInput = interaction.options.getString('map');
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const { username, mode } = resolved;

    // Sem a opção `map`, usa o mapa da mensagem respondida ou o último que
    // apareceu no canal — é o que torna possível responder à play de outra
    // pessoa só com `/score`.
    const beatmapId = mapInput
      ? osu.parseBeatmapId(mapInput)
      : (await mapContext.recall(interaction))?.mapId ?? null;

    if (!beatmapId) {
      return interaction.reply({
        content: mapInput ? s.simulate_invalid_map : s.score_no_map,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply();

    try {
      const [user, beatmap] = await Promise.all([
        osu.getUser(username, mode),
        osu.getBeatmap(beatmapId),
      ]);

      if (!user) return interaction.editReply(s.player_not_found);

      // No Daycore o mapa pode ser exclusivo de lá e não existir na API
      // oficial; no Bancho, não achar o mapa significa que ele não existe.
      if (!beatmap && servers.isOfficial(mode)) {
        return interaction.editReply(s.simulate_map_not_found);
      }

      const scores = await osu.getUserBeatmapScores(user.id, beatmapId, mode);

      const mapTitle = truncate(
        beatmap
          ? `${beatmap.beatmapset?.artist ? `${beatmap.beatmapset.artist} - ` : ''}` +
            `${beatmap.beatmapset?.title ?? '???'} [${beatmap.version ?? '?'}]`
          : `\`${beatmapId}\``,
        EMBED_TITLE_MAX
      );

      if (scores.length === 0) {
        // Lembra o mapa mesmo sem score: quem veio pelo link continua no
        // contexto do canal, e o próximo /score não precisa repetir o link.
        mapContext.remember(interaction, beatmapId, mode);
        return interaction.editReply(s.score_none(user.username, mapTitle, osu.getModeLabel(mode)));
      }

      const totalPages  = Math.ceil(scores.length / PAGE_SIZE);
      const mapUrl      = osu.getMapUrl(beatmapId, scores[0].beatmapset?.id, mode);
      const stats       = user.statistics;
      const rankDisplay = stats.global_rank ? `#${stats.global_rank.toLocaleString(s.locale)}` : s.profile_unranked;
      const countryPart = (!user._private && stats.country_rank)
        ? ` ${user.country_code}#${stats.country_rank.toLocaleString(s.locale)}`
        : ` ${user.country_code}`;

      async function buildEmbed(page) {
        const pageScores = scores.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

        const [starsArray, fcPPArray, calcPPArray] = await Promise.all([
          Promise.all(pageScores.map(sc => osu.getAdjustedStars(beatmapId, sc.mods, mode))),
          Promise.all(pageScores.map(sc => osu.getFCpp(sc, mode))),
          // A API devolve pp nulo em alguns scores (os de lazer com CL, por
          // exemplo, que é o caso do print que originou este comando). Em vez
          // de exibir 0pp, calculamos o valor localmente a partir dos hits
          // reais — o mesmo caminho do /simulate.
          Promise.all(pageScores.map(sc =>
            sc.pp != null ? null : localScorePP(sc, mode)
          )),
        ]);

        let description = '';
        pageScores.forEach((sc, index) => {
          const globalIndex = page * PAGE_SIZE + index;

          const hits   = sc.statistics ?? {};
          const h300   = hits.count_300  ?? hits.great ?? '-';
          const h100   = hits.count_100  ?? hits.ok    ?? '-';
          const h50    = hits.count_50   ?? hits.meh   ?? '-';
          const hMiss  = hits.count_miss ?? hits.miss  ?? 0;
          const misses = typeof hMiss === 'number' ? hMiss : 0;

          const mapCombo   = sc.beatmap?.max_combo ?? null;
          const scoreCombo = sc.max_combo ?? 0;
          const isChoke    = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

          const starsRaw = starsArray[index] ?? sc.beatmap?.difficulty_rating;
          const stars    = starsRaw ? ` [${parseFloat(starsRaw).toFixed(2)}★]` : '';
          const shownMods = displayMods(sc.mods);
          const mods     = shownMods.length > 0 ? `+${shownMods.join('')}` : s.score_no_mods;

          // pp calculado por nós vai com ~ na frente, para não passar por
          // número oficial do servidor.
          const ppValue = sc.pp ?? calcPPArray[index];
          const ppText  = ppValue == null
            ? '`?pp`'
            : `\`${sc.pp != null ? '' : '~'}${ppValue.toFixed(2)}pp\``;

          const fcPP    = fcPPArray[index];
          const fcText  = fcPP !== null && isChoke ? ` *(FC: ~${fcPP.toFixed(2)}pp)*` : '';

          const comboText = `${scoreCombo}x/${mapCombo !== null ? mapCombo + 'x' : '?x'}`;

          description += `**#${globalIndex + 1}** ${emojis.rankLabel(sc.rank)} **${mods}**${stars}\n`;
          description += `${ppText}${fcText} • ${(sc.accuracy * 100).toFixed(2)}% • ` +
                         `[${comboText}] • ${discordTimestamp(sc.created_at)}\n`;
          description += `{ ${h300} / ${h100} / ${h50} / ${hMiss} }\n\n`;
        });

        const embed = new EmbedBuilder()
          .setColor(0xff66aa)
          .setAuthor({
            name:    `${user.username}: ${stats.pp.toFixed(2)}pp (${rankDisplay}${countryPart})`,
            iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
            url:     osu.getUserUrl(user.id, mode),
          })
          .setTitle(mapTitle)
          .setURL(mapUrl)
          .setDescription(description)
          .setFooter({
            // O status do mapa vale para os cinco scores da página, então é do
            // rodapé — não de uma ressalva repetida linha a linha. Só a API
            // oficial manda o campo; no bancho.py o rodapé sai sem ele.
            text: s.score_footer(
              page + 1, totalPages, scores.length, osu.getModeLabel(mode),
              beatmap?.status ?? null,
            ),
          });

        const cover = beatmap?.beatmapset?.covers?.list ?? scores[0].beatmapset?.covers?.list;
        if (cover) embed.setThumbnail(cover);

        return embed;
      }

      mapContext.remember(interaction, beatmapId, mode);

      // Aqui todas as páginas são do MESMO mapa, então não há prefetch a fazer:
      // o .osu já veio na primeira e o cache serve as demais.
      await paginate(interaction, {
        id: 'score',
        totalPages,
        buildEmbed,
        strings: s,
      });
    } catch (error) {
      logError('score', error);
      return safeEditReply(interaction, s.score_error);
    }
  },
};

// O cálculo local saiu daqui para o scorePP.js: o /recent precisa do mesmo
// número, e as duas cópias já tinham divergido — esta calculava, a de lá
// imprimia zero. O pré-requisito de play completa vale igual, e neste comando
// ele é dado: os dois servidores só devolvem play completa em scores de mapa.
