const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../../osuClient');
const servers = require('../../servers');
const recentMerge = require('../../recentMerge');
const modo = require('../../modo');
const { getPreferredModo, getScoreFormat, getEmbedLayout } = require('../../db');
const { liga } = require('../../embedLayout');
const { resolvePlayer, fetchPlayer } = require('../../userLink');
const mapContext = require('../../mapContext');
const playEmbed = require('../../embeds/play');
const { md } = require('../../markdown');
const { paginate } = require('../../pagination');
const { t } = require('../../i18n');
const { logError } = require('../../lib/logger');
const { safeEditReply } = require('../../replies');

const FETCH_LIMIT = 50;

// O top que o "PB #N" consulta. É o mesmo limite do /topplays, do /nc e do /pp
// de propósito: a chave do cache do getBestScores inclui o limite, então com
// 100 aqui a lista que um deles acabou de buscar serve de graça.
const TOP_LIMIT = 100;

module.exports = {
  // Valida a entrada e responde o erro em efêmero ANTES do próprio defer
  // público; um defer do despacho tornaria esse erro público (ver
  // bot/dispatch.js).
  defer: false,

  data: modo.addOption(new SlashCommandBuilder()
    .setName('recent')
    .setDescription("Show a player's most recent plays (including fails)")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as últimas plays (incluindo falhas) de um jogador' })
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
    ), { ambos: true }),

  async execute(interaction) {
    const s        = t(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const { mode } = resolved;
    // Sem `modo:` no comando, cai na preferência salva por `/link default`
    // (ver db/users.js) — assim quem só digita `/rs` continua vendo o que
    // escolheu, em vez de precisar repetir a opção toda vez. Com `@fulano`, é
    // a preferência do fulano (ver resolvePlayer).
    const modoOption = interaction.options.getString('modo') ?? getPreferredModo(resolved.ownerId);
    // O formato do score total é de quem PEDIU, não do dono das plays: com
    // `@fulano`, quem lê é quem digitou (ver embeds/play.js).
    const scoreFormat = getScoreFormat(interaction.user.id);
    // Quais pedaços do embed aparecem (o /builder), pela mesma regra: de quem
    // pediu. Null é o embed completo.
    const layout = getEmbedLayout(interaction.user.id);
    // Sem a linha do "Top #N", o top de cada chave não é buscado: ele só serve
    // a ela, e é uma requisição por chave a menos.
    const querPB = liga(layout, 'pb');
    const pair = recentMerge.pairFor(mode);
    const keys = recentMerge.keysToFetch(pair, modoOption);
    await interaction.deferReply();

    try {
      // Perfil e plays na mesma viagem quando o link já deu o id (ver userLink).
      // Com par VN/RX, "as plays" pode vir de mais de uma chave — fetchEach
      // busca as duas em paralelo e tolera uma falhando; mergeRecent junta e
      // corta no FETCH_LIMIT, marcando cada play com o `_mode` de onde veio.
      //
      // O top de cada chave vai junto, em paralelo, para o "PB #N". Ele não
      // pode derrubar nada: o fetchTops nunca rejeita, e sem top o comando
      // responde como antes, só sem a marca.
      //
      // O 🔄 repete esta mesma busca, com `fresh` (ver refreshList).
      // O top sai por `guardarTops`, e não pelo retorno: o fetchPlayer só
      // repassa a lista de scores.
      const buscarRecentes = (guardarTops, { fresh = false } = {}) => async id => {
        const [porModo, topsPorModo] = await Promise.all([
          recentMerge.fetchEach(keys, key => osu.getRecentScores(id, FETCH_LIMIT, key)),
          querPB
            ? recentMerge.fetchTops(keys, key => osu.getBestScores(id, TOP_LIMIT, key, { fresh }))
            : new Map(),
        ]);
        guardarTops(topsPorModo);
        return recentMerge.mergeRecent(porModo, FETCH_LIMIT);
      };

      // Estado que o buildEmbed lê, e que o refresh troca por inteiro.
      let tops = new Map();
      let { user, scores: recents } = await fetchPlayer(resolved, buscarRecentes(t => { tops = t; }));
      if (!user) return interaction.editReply(s.player_not_found);
      // O nick vai numa mensagem que renderiza markdown (ver markdown.js).
      if (recents.length === 0) return interaction.editReply(s.recent_none(md(user.username)));

      let totalPages = recents.length;

      // Mapa de cada página já montada, para o /score conseguir responder à
      // play que está sendo exibida agora (ver mapContext.js). Fica fora do
      // buildEmbed porque o embed é memoizado: voltar para uma página antiga
      // não passa por lá de novo, mas ainda precisa atualizar o contexto.
      const pageMapId = new Map();

      // O perfil de CADA leaderboard, buscado sob demanda e uma vez só.
      //
      // O `fetchPlayer` acima trouxe o do modo que o comando resolveu, e com
      // `modo: both` esse modo é o VN (ver modo.apply) — a metade que se mostra
      // quando não dá para mostrar as duas. Só que o cabeçalho não fala da lista:
      // ele fala da play que está na tela, e uma play de RX com "7.112,00pp (#3)"
      // do vanilla em cima é um número que não tem nada a ver com ela (a mesma
      // conta tem 14.324pp e #4 no RX). Estável e errado é pior do que acompanhar
      // a página.
      //
      // Fora do `modo: both` isto não faz requisição nenhuma: as chaves buscadas
      // e a chave resolvida são a mesma, e o mapa já nasce com a resposta.
      //
      // Depois de um 🔄 (`perfisFrescos`), o do outro leaderboard também vem sem
      // cache: a play nova mudou o pp dele.
      const perfis = new Map([[resolved.mode, Promise.resolve(user)]]);
      let perfisFrescos = false;
      const perfilDe = (key) => {
        // Falhar aqui cai no perfil que já se tem: o cabeçalho fica com o número
        // do outro leaderboard, que é o que acontecia sempre até agora — melhor
        // do que derrubar a página inteira por causa da linha do autor.
        if (!perfis.has(key)) {
          perfis.set(key, osu.getUser(user.id, key, { fresh: perfisFrescos }).catch(() => null));
        }
        return perfis.get(key);
      };

      // "Try #N": em que tentativa seguida daquele mapa a play está. Com a
      // sequência encostando no fim das FETCH_LIMIT buscadas, sai "50+" — o
      // número de verdade pode ser maior e não dá para afirmar qual.
      const tentativa = (page) => {
        const tries = recentMerge.triesAt(recents, page, FETCH_LIMIT);
        if (!tries) return null;
        return tries.partial ? `${tries.count}+` : String(tries.count);
      };

      async function buildEmbed(page) {
        // Enriquece só a play exibida agora, não as 50 buscadas de uma vez —
        // evita rajada de requisições/rate limit na API do osu! O .osu de mapa
        // frio sai junto dos metadados (ver aquecerArquivos no osuClient).
        const rawPlay      = recents[page];
        const playMode     = rawPlay._mode; // de qual chave (VN ou RX) essa play veio
        const [scoredPlay] = await osu.enrichScores([rawPlay], playMode);
        const [recent]     = await osu.enrichBeatmapData([scoredPlay], { aquecerArquivos: true });

        pageMapId.set(page, recent.beatmap.id);

        // Todo o desenho da play mora no embeds/play.js — é o mesmo em todo
        // comando. O que sobra aqui é a moldura: quem jogou, e onde a play
        // está na lista de páginas.
        const [bloco, dono] = await Promise.all([
          playEmbed.single(recent, {
            mode: playMode,
            s,
            scoreFormat,
            layout,
            // Da play CRUA: é nela que o id do score está em todo servidor (o
            // enriquecimento do bancho.py reescreve o objeto).
            personalBest: recentMerge.personalBestAt(rawPlay, tops),
          }),
          perfilDe(playMode),
        ]);

        return new EmbedBuilder()
          // pp e rank do leaderboard DESTA play — numa lista combinada eles
          // mudam de uma página para a outra, porque são outros números. O link
          // de perfil é o mesmo em VN e RX (ver banchoPyApi/rippleApi userUrl),
          // então o modo aqui só decide o que se lê, não para onde se clica.
          .setAuthor(playEmbed.author(dono ?? user, playMode, s))
          .setTitle(bloco.title)
          .setURL(bloco.url)
          .setColor(bloco.color)
          .setThumbnail(bloco.thumbnail)
          .setDescription(bloco.description)
          .setFooter({
            // Status do mapa (ranked, loved, graveyard...) e mapper só existem
            // pela API oficial; no bancho.py o rodapé sai sem eles, em vez de
            // afirmar o que não dá para saber. O rótulo agora é o da PLAY: com
            // as duas listas juntas, uma página pode ser Daycore e a seguinte
            // Daycore RX.
            text: s.recent_footer(
              page + 1,
              totalPages,
              osu.getModeLabel(playMode),
              bloco.status,
              bloco.creator,
              tentativa(page),
            ),
          });
      }

      /**
       * Refaz a busca da lista INTEIRA (as mesmas chaves do carregamento
       * inicial) e volta para a primeira página. Quem clica no 🔄 do /rs
       * acabou de jogar e quer ver a play nova — que entra no topo e empurra as
       * outras. Re-buscar só a play da página não mudava nada: um score enviado
       * não muda depois.
       *
       * Perfil e top vêm sem cache: a play nova mexe no pp e rank do cabeçalho
       * e no "PB #N". Busca pelo id que já se conhece, e o estado só é trocado
       * no fim — falha ou lista vazia lançam antes, e a tela fica como estava.
       */
      async function refreshList() {
        let novosTops = new Map();
        const novo = await fetchPlayer(
          { username: user.id, mode: resolved.mode },
          buscarRecentes(t => { novosTops = t; }, { fresh: true }),
          { fresh: true },
        );
        if (!novo.user || novo.scores.length === 0) {
          throw new Error('recent refresh: a busca nova não trouxe plays');
        }

        // O top de uma chave que falhou agora fica o de antes: o fetchTops não
        // rejeita, só deixa a chave de fora — e sem ela o "PB #N" sumiria.
        for (const [key, top] of tops) if (!novosTops.has(key)) novosTops.set(key, top);

        user = novo.user;
        recents = novo.scores;
        tops = novosTops;
        totalPages = recents.length;
        pageMapId.clear();
        perfis.clear();
        perfis.set(resolved.mode, Promise.resolve(user));
        perfisFrescos = true;

        return { totalPages, page: 0 };
      }

      await paginate(interaction, {
        id: 'recent',
        totalPages,
        buildEmbed,
        strings: s,
        onRefresh: refreshList,
        refreshError: s.recent_refresh_error,
        // O contexto do canal acompanha a página em que os botões pararam —
        // no modo da PLAY, pro /score sem argumento procurar no leaderboard
        // certo (ver mapContext.js).
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), recents[page]?._mode ?? mode),
        // Mesma ordem do /topplays: primeiro o enriquecimento (uma requisição
        // por play em servidor privado), depois o arquivo do mapa — que, com o
        // mapa frio, já saiu junto dos metadados (ver aquecerArquivos no
        // osuClient).
        prefetch: async (page) => {
          const proxima = recents[page];
          if (!proxima) return;

          const [scored] = await osu.enrichScores([proxima], proxima._mode);
          const [cheia]  = await osu.enrichBeatmapData([scored], { aquecerArquivos: true });
          if (cheia?.beatmap?.id) await osu.getBeatmapFile(cheia.beatmap.id);
        },
      });
    } catch (error) {
      logError('recent', error);
      return safeEditReply(interaction, s.recent_error);
    }
  },
};
