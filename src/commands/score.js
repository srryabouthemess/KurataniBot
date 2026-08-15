const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { resolvePlayer, fetchPlayer } = require('../userLink');
const mapContext = require('../mapContext');
const playEmbed = require('../embeds/play');
const { paginate } = require('../pagination');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const PAGE_SIZE = 5;

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

    const { mode } = resolved;

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
      // As três chamadas saem juntas: o mapa nunca dependeu do jogador, e os
      // scores dele no mapa só esperavam pelo id — que o link já deu (userLink).
      const [{ user, scores }, beatmap] = await Promise.all([
        fetchPlayer(resolved, id => osu.getUserBeatmapScores(id, beatmapId, mode)),
        osu.getBeatmap(beatmapId),
      ]);

      if (!user) return interaction.editReply(s.player_not_found);

      // No Daycore o mapa pode ser exclusivo de lá e não existir na API
      // oficial; no Bancho, não achar o mapa significa que ele não existe.
      if (!beatmap && servers.isOfficial(mode)) {
        return interaction.editReply(s.simulate_map_not_found);
      }

      // O mapa embrulhado como se fosse uma play: é a forma que o embeds/play
      // sabe ler, e evita um segundo caminho de leitura de metadados só para o
      // cabeçalho desta tela. Sem mods, porque aqui o mapa é o mapa — cada
      // score da lista mostra os seus.
      const mapaComoPlay = {
        beatmap:    { ...(beatmap ?? {}), id: beatmapId },
        beatmapset: beatmap?.beatmapset ?? scores[0]?.beatmapset ?? {},
        mods:       [],
      };

      const mapTitle = beatmap ? playEmbed.mapTitle(mapaComoPlay) : `\`${beatmapId}\``;

      if (scores.length === 0) {
        // Lembra o mapa mesmo sem score: quem veio pelo link continua no
        // contexto do canal, e o próximo /score não precisa repetir o link.
        mapContext.remember(interaction, beatmapId, mode);
        return interaction.editReply(s.score_none(user.username, mapTitle, osu.getModeLabel(mode)));
      }

      const totalPages = Math.ceil(scores.length / PAGE_SIZE);
      const mapUrl     = osu.getMapUrl(beatmapId, scores[0].beatmapset?.id, mode);
      const cover      = beatmap?.beatmapset?.covers?.list ?? scores[0].beatmapset?.covers?.list ?? null;

      // Fora do buildEmbed: aqui todas as páginas são do MESMO mapa, então
      // status, mapper e atributos são calculados uma vez e valem para todas.
      const meta     = await playEmbed.mapMeta(mapaComoPlay);
      const linhaMapa = await playEmbed.mapLine(mapaComoPlay, { length: meta.length });

      async function buildEmbed(page) {
        const pageScores = scores.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

        // Em paralelo entre os scores: cada bloco pede estrelas e PP (o do FC,
        // e o da própria play quando a API não a pontuou).
        const blocos = await Promise.all(pageScores.map((sc, index) =>
          playEmbed.listItem(sc, { mode, index: page * PAGE_SIZE + index + 1 })
        ));

        return new EmbedBuilder()
          .setColor(playEmbed.COLOR)
          .setAuthor(playEmbed.author(user, mode, s))
          .setTitle(mapTitle)
          .setURL(mapUrl)
          .setThumbnail(cover)
          // A linha do mapa abre a descrição, não cada bloco: ela é a mesma
          // para os cinco scores, e repetida vira parede.
          .setDescription([linhaMapa, ...blocos].filter(Boolean).join('\n\n'))
          .setFooter({
            // O status do mapa e o mapper valem para os cinco scores da página,
            // então são do rodapé — não de uma ressalva repetida linha a linha.
            // Só a API oficial manda os dois; no bancho.py o rodapé sai sem.
            text: s.score_footer(
              page + 1, totalPages, scores.length, osu.getModeLabel(mode),
              meta.status, meta.creator,
            ),
          });
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

// O cálculo de PP local (para quando a API não pontua o score) e o desenho das
// linhas saíram daqui: o primeiro para o scorePP.js, o segundo para o
// embeds/play.js. Os dois pela mesma razão — o /recent mostra a mesma play, e
// as cópias já tinham divergido: uma calculava o pp que a outra imprimia como
// zero. O pré-requisito de play completa continua dado neste comando, porque os
// dois servidores só devolvem play completa em scores de mapa.
