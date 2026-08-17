const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { resolvePlayer, fetchPlayer } = require('../userLink');
const mapContext = require('../mapContext');
const playEmbed = require('../embeds/play');
const { paginate } = require('../pagination');
const topFilter = require('../topFilter');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const PAGE_SIZE   = 5;
const FETCH_LIMIT = 100;

/**
 * As opções de ordenação como o Discord as mostra.
 *
 * O rótulo é traduzido, o valor não: ele é a chave que o topFilter conhece, e
 * também o que se digita no modo texto (`k!top -acc`, ver coerce.js).
 */
const SORT_LABELS = {
  pp:     { name: 'PP',       'pt-BR': 'PP',        ru: 'PP' },
  acc:    { name: 'Accuracy', 'pt-BR': 'Acurácia',  ru: 'Точность' },
  combo:  { name: 'Combo',    'pt-BR': 'Combo',     ru: 'Комбо' },
  date:   { name: 'Date',     'pt-BR': 'Data',      ru: 'Дата' },
  misses: { name: 'Misses',   'pt-BR': 'Misses',    ru: 'Миссы' },
};

const sortChoices = () => topFilter.SORTS.map(value => ({
  value,
  name: SORT_LABELS[value].name,
  name_localizations: {
    'pt-BR': SORT_LABELS[value]['pt-BR'],
    ru:      SORT_LABELS[value].ru,
  },
}));

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
    )
    .addStringOption(option =>
      option
        .setName('sort')
        .setDescription('Sort by (default: pp)')
        .setDescriptionLocalizations({ 'pt-BR': 'Ordenar por (padrão: pp)' })
        .setRequired(false)
        .addChoices(...sortChoices())
    )
    .addStringOption(option =>
      option
        .setName('mods')
        .setDescription('Only plays with these mods (e.g. HDDT, DT1.4, or NM for no mods)')
        .setDescriptionLocalizations({ 'pt-BR': 'Só plays com estes mods (ex: HDDT, DT1.4, ou NM para sem mods)' })
        .setRequired(false)
        .setMaxLength(20)
    )
    .addBooleanOption(option =>
      option
        .setName('reverse')
        .setDescription('Invert the order')
        .setDescriptionLocalizations({ 'pt-BR': 'Inverte a ordem' })
        .setRequired(false)
    ),

  prefix: {
    // No modo texto os argumentos são posicionais, e estes dois não podem
    // engolir um pedaço de nick: sem as guardas, `k!top nome do cara` daria
    // "não reconheci mods em `do`" em vez do erro de uso que já existia.
    //
    // O `reverse` recusa QUALQUER posicional de propósito: ele continua entrando
    // por `-reverse` e por `reverse` solto (ver parseArgs), que é como se liga um
    // booleano ali — nunca por posição.
    guards: {
      // `pareceMods` e não `parseModFilter`: a guarda pergunta se o token IA ser
      // um filtro de mods, e quem julga a validade é o execute — que já
      // responde `topplays_bad_mods`. Com a validade aqui, `k!top mrekk XYHD`
      // escaparia da guarda e viraria "argumentos demais" em vez de dizer que
      // XY não é mod.
      mods:    value => topFilter.pareceMods(value),
      reverse: () => false,
    },
  },

  async execute(interaction) {
    const s        = t(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const modsInput = interaction.options.getString('mods');
    const filtro    = modsInput ? topFilter.parseModFilter(modsInput) : null;

    // Texto que não vira mod nenhum é ERRO, e não filtro vazio: devolver a lista
    // inteira faria `mods:XY` parecer "você não tem play com XY" (ver topFilter).
    if (modsInput && !filtro) {
      return interaction.reply({
        content: s.topplays_bad_mods(modsInput),
        flags: MessageFlags.Ephemeral,
      });
    }

    const sort    = interaction.options.getString('sort') ?? 'pp';
    const reverse = interaction.options.getBoolean('reverse') ?? false;

    const { mode } = resolved;
    await interaction.deferReply();

    try {
      // Perfil e plays na mesma viagem quando o link já deu o id (ver userLink).
      const { user, scores: todas } = await fetchPlayer(
        resolved,
        id => osu.getBestScores(id, FETCH_LIMIT, mode),
      );
      if (!user) return interaction.editReply(s.player_not_found);
      if (todas.length === 0) return interaction.editReply(s.topplays_none);

      // Ordenar e filtrar acontece ANTES de qualquer enriquecimento: o custo por
      // score é da página exibida, não das cem buscadas (ver topFilter.js).
      const plays = topFilter.arrange(todas, { sort, mods: filtro, reverse });
      if (plays.length === 0) return interaction.editReply(s.topplays_none_match);

      // Quantas de quantas, só quando o filtro tirou alguma: sem filtro o número
      // repetiria o que a contagem de páginas já diz.
      const recorte = plays.length < todas.length ? `${plays.length}/${todas.length} plays` : null;

      const totalPages = Math.ceil(plays.length / PAGE_SIZE);

      // Mapa do topo de cada página, para o /score sem argumento (mapContext).
      // Fica fora do buildEmbed porque o embed é memoizado — voltar para uma
      // página já vista não passa por lá de novo.
      const pageMapId = new Map();

      const fatia = page => plays.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

      async function buildEmbed(page) {
        // Enriquece só os mapas da página atual (5), não os 100 buscados de
        // uma vez — evita rajada de requisições/rate limit na API do osu!
        const itens      = fatia(page);
        const scoredPage = await osu.enrichScores(itens.map(item => item.score), mode);
        const pagePlays  = await osu.enrichBeatmapData(scoredPage);

        pageMapId.set(page, pagePlays[0]?.beatmap?.id ?? null);

        // Em paralelo entre as plays, e não uma por vez: cada bloco ainda pede
        // estrelas e PP de FC, e serializá-los multiplicaria por cinco a espera
        // de uma página nova.
        const blocos = await Promise.all(pagePlays.map((play, index) =>
          playEmbed.listItem(play, {
            mode,
            // A posição no top ORIGINAL, e não o lugar nesta lista: com filtro
            // ou ordenação, renumerar de 1 em diante faria a primeira linha
            // parecer a melhor play do jogador (ver topFilter.js).
            index:  itens[index].posicao,
            mapUrl: osu.getMapUrl(play.beatmap.id, play.beatmapset.id, mode),
          })
        ));

        return new EmbedBuilder()
          .setColor(playEmbed.COLOR)
          .setAuthor(playEmbed.author(user, mode, s))
          .setThumbnail(user.avatar_url ?? null)
          .setDescription(blocos.join('\n\n'))
          .setFooter({ text: s.topplays_footer(page + 1, totalPages, osu.getModeLabel(mode), recorte) });
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
        // Adianta a próxima página inteira enquanto a pessoa lê a atual.
        //
        // O enriquecimento vem PRIMEIRO, e não os arquivos: em servidor privado
        // ele é uma requisição por score (294–843ms medidos numa página de
        // cinco), enquanto o .osu quase sempre já está no cache em disco. Era o
        // que sobrava no relógio depois que o cálculo de PP saiu dele.
        prefetch: async (page) => {
          const proxima = fatia(page).map(item => item.score);
          const cheias  = await osu.enrichBeatmapData(await osu.enrichScores(proxima, mode));

          await Promise.all(
            cheias.map(play => play.beatmap?.id && osu.getBeatmapFile(play.beatmap.id))
          );
        },
      });
    } catch (error) {
      logError('topplays', error);
      return safeEditReply(interaction, s.topplays_error);
    }
  },
};
