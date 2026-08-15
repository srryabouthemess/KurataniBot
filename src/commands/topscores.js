/**
 * commands/topscores.js
 * As melhores plays do SERVIDOR — não as de um jogador.
 *
 * ── Por que não é uma opção do /topplays nem do /leaderboard ─────────────────
 * No /topplays, "sem `player`" já quer dizer *eu* (via /link), e a opção
 * `server` já quer dizer *em qual servidor procurar esse jogador*: os dois
 * sinais que serviriam para dizer "o servidor inteiro" estão ocupados.
 *
 * No /leaderboard, cada linha é um JOGADOR; aqui cada linha é um SCORE. Seria o
 * mesmo nome para dois comandos com título, formato de linha, rodapé e opções
 * diferentes — e a opção `country` de lá não faria sentido aqui.
 *
 * ── Só em servidor bancho.py, e isso não é limitação nossa ───────────────────
 * O osu! oficial não expõe isso: os tipos de ranking da API v2 são
 * `performance`, `score`, `country` e `charts`, e `top-plays` (o que o site
 * mostra em /rankings/top-plays/osu) responde `invalid type specified`. Aquela
 * página é HTML renderizado no servidor, sem JSON embutido nem versão da API —
 * só daria por raspagem, que quebraria calada a cada deploy do front do osu-web.
 *
 * O Ripple recusa a consulta sem um mapa (`422 Missing parameters: md5|b`).
 *
 * Então o comando pergunta ao osuClient se aquele servidor sabe responder, e
 * quando não sabe explica o motivo em vez de dar erro.
 *
 * ── O que uma página custa ───────────────────────────────────────────────────
 * A busca é uma varredura (ver `topScores` no adaptador): 4 requisições no
 * Daycore, guardadas por 5 minutos. Depois, cada página exibida resolve o mapa
 * (por hash) e o nick (por id) de cinco scores — os dois com cache próprio e
 * compartilhados entre páginas, porque a mesma pessoa e o mesmo mapa se repetem
 * muito numa lista dessas.
 */

const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { getPreferredServer } = require('../db');
const { paginate } = require('../pagination');
const playEmbed = require('../embeds/play');
const { md } = require('../markdown');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const PAGE_SIZE   = 5;
const FETCH_LIMIT = 50;

/**
 * Mapa e jogador de um score cru, na mesma viagem.
 *
 * São duas consultas independentes — uma pelo hash do mapa, outra pelo id de
 * quem jogou — e serializá-las dobraria a espera de cada linha sem motivo.
 */
async function completar(score, mode) {
  const [map, nome] = await Promise.all([
    osu.getServerMapByMd5(score.map_md5, mode),
    osu.getServerPlayerName(score.userid, mode),
  ]);

  return {
    play: osu.normalizeServerScore(score, map),
    nome: nome ?? String(score.userid),
    id:   score.userid,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('topscores')
    .setDescription("Show the server's best plays")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra as melhores plays do servidor' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(option =>
      option
        .setName('server')
        .setDescription('Which server to use? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(...servers.choices())
    ),

  async execute(interaction) {
    const s = t(interaction);

    // Mesma resolução do /leaderboard: opção, preferido, padrão — sem exigir
    // link, porque a lista não é de ninguém.
    const escolhido = interaction.options.getString('server')
      || getPreferredServer(interaction.user.id)
      || osu.DEFAULT_MODE;
    const mode  = servers.resolveKey(escolhido) ?? osu.DEFAULT_MODE;
    const label = osu.getModeLabel(mode);

    if (!osu.supportsTopScores(mode)) {
      return interaction.reply(s.topscores_unsupported(label));
    }

    await interaction.deferReply();

    try {
      const { scores, completo } = await osu.getTopScores(mode, { limit: FETCH_LIMIT });

      // Varredura estourada: a lista que sairia daqui não seria o topo, e sim as
      // primeiras linhas por ordem de inserção (ver topScores no adaptador).
      if (!completo) return interaction.editReply(s.topscores_too_big(label));
      if (scores.length === 0) return interaction.editReply(s.topscores_none(label));

      const totalPages = Math.ceil(scores.length / PAGE_SIZE);

      async function buildEmbed(page) {
        const inicio = page * PAGE_SIZE;
        const pagina = await Promise.all(
          scores.slice(inicio, inicio + PAGE_SIZE).map(score => completar(score, mode))
        );

        const blocos = await Promise.all(pagina.map(({ play, nome, id }, index) =>
          playEmbed.listItem(play, {
            mode,
            index:  inicio + index + 1,
            mapUrl: osu.getMapUrl(play.beatmap.id, play.beatmapset.id, mode),
            // Nick é texto de terceiro em posição de link (ver markdown.js).
            autor:  `**[${md(nome)}](${osu.getUserUrl(id, mode)})**`,
          })
        ));

        return new EmbedBuilder()
          .setColor(playEmbed.COLOR)
          .setTitle(s.topscores_title(label))
          .setDescription(blocos.join('\n\n'))
          .setFooter({ text: s.topscores_footer(page + 1, totalPages, label) });
      }

      await paginate(interaction, {
        id: 'topscores',
        totalPages,
        buildEmbed,
        strings: s,
        // Adianta mapa, nick e o .osu da página seguinte enquanto a pessoa lê a
        // atual — o mesmo motivo do /topplays: o que sobra no relógio de uma
        // página nova é rede, não cálculo.
        prefetch: async (page) => {
          const proxima = scores.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
          const prontos = await Promise.all(proxima.map(score => completar(score, mode)));

          await Promise.all(
            prontos.map(({ play }) => play.beatmap?.id && osu.getBeatmapFile(play.beatmap.id))
          );
        },
      });
    } catch (error) {
      logError('topscores', error);
      return safeEditReply(interaction, s.topscores_error);
    }
  },
};
