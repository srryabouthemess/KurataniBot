const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { resolvePlayer } = require('../userLink');
const mapContext = require('../mapContext');
const emojis = require('../emojis');
const { paginate } = require('../pagination');
const { formatMods } = require('../mods');
const { localScorePP } = require('../scorePP');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const FETCH_LIMIT = 50;

/**
 * O PP da play. O `pp` nulo tem três causas, e todas viravam o mesmo "0pp".
 *
 *  - Mapa que não paga pp (graveyard, loved): o servidor não paga mesmo, mas
 *    "0pp" sozinho parece nota da play — e ao lado do "(FC: ~634pp)" sugeria
 *    que um FC pagaria isso, quando pagaria zero também.
 *  - Play não terminada: o valor sai do trecho jogado, via `passedObjects`. Sem
 *    ele a conta assume o mapa inteiro, inventa um 300 por objeto não jogado e
 *    devolve quase o valor de um FC.
 *  - Mapa ranqueado, play completa, pp nulo: é a API não ter pontuado o score
 *    (acontece com lazer + CL). Aí zero é simplesmente errado.
 *
 * Nenhum dos três leva ressalva escrita na linha. O que a play foi já está no
 * campo **Status** ("❌ Quit"), o que o MAPA é está no rodapé, e o `~` na frente
 * marca "calculado aqui, não é número oficial". Explicar de novo em texto só
 * engordava uma linha que já carrega pp, acurácia e o valor de FC.
 */
async function describePP(score, isPass, mode) {
  // Finito, e não só "não-nulo": o `pp` vem do servidor, e um valor não
  // numérico imprimiria "NaN pp" em vez de cair no cálculo local.
  if (Number.isFinite(score.pp)) return `${score.pp.toFixed(2)}pp`;

  const local = await localScorePP(score, mode, { partial: !isPass });
  return local === null ? '?pp' : `~${local.toFixed(2)}pp`;
}

module.exports = {
  data: new SlashCommandBuilder()
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

      const recents = await osu.getRecentScores(user.id, FETCH_LIMIT, mode);
      if (recents.length === 0) return interaction.editReply(s.recent_none(user.username));

      const totalPages = recents.length;

      // Mapa de cada página já montada, para o /score conseguir responder à
      // play que está sendo exibida agora (ver mapContext.js). Fica fora do
      // buildEmbed porque o embed é memoizado: voltar para uma página antiga
      // não passa por lá de novo, mas ainda precisa atualizar o contexto.
      const pageMapId = new Map();

      async function buildEmbed(page) {
        // Enriquece só a play exibida agora, não as 50 buscadas de uma vez —
        // evita rajada de requisições/rate limit na API do osu!
        const rawPlay      = recents[page];
        const [scoredPlay] = await osu.enrichScores([rawPlay], mode);
        const [recent]     = await osu.enrichBeatmapData([scoredPlay]);

        pageMapId.set(page, recent.beatmap.id);

        const mapUrl = osu.getMapUrl(recent.beatmap.id, recent.beatmapset.id, mode);
        // Com o CL: ele diz se a play foi em mecânica clássica ou no lazer.
        const mods   = formatMods(recent.mods);
        const isPass = recent.passed;

        const hits  = recent.statistics ?? {};
        const h300  = hits.count_300  ?? hits.great ?? '-';
        const h100  = hits.count_100  ?? hits.ok    ?? '-';
        const h50   = hits.count_50   ?? hits.meh   ?? '-';
        const hMiss = hits.count_miss ?? hits.miss  ?? 0;
        const hitsLine = `{ ${h300} / ${h100} / ${h50} / ${hMiss} }`;

        // Vale para mapa que não paga pp também: ali o valor da play já sai
        // calculado localmente, então o do FC ao lado é a mesma natureza de
        // número — os dois hipotéticos, os dois com `~`. Era contraditório
        // enquanto a play aparecia como "0pp".
        const fcPP       = await osu.getFCpp(recent, mode);
        const misses     = typeof hMiss === 'number' ? hMiss : 0;
        const mapCombo   = recent.beatmap?.max_combo ?? null;
        const scoreCombo = recent.max_combo ?? 0;
        const isChoke    = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

        const ppText = await describePP(recent, isPass, mode);

        const ppLine =
          `**${s.recent_pp}:** ${ppText}` +
          (fcPP !== null && isChoke ? ` *(FC: ~${fcPP.toFixed(2)}pp)*` : '');

        return new EmbedBuilder()
          .setAuthor({
            name:    s.recent_author(user.username),
            iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
            url:     osu.getUserUrl(user.id, mode),
          })
          .setTitle(`${recent.beatmapset.title} [${recent.beatmap.version}]`)
          .setURL(mapUrl)
          .setColor(isPass ? 0xff66aa : 0xee4444)
          .setThumbnail(recent.beatmapset.covers.list)
          .addFields(
            { name: s.recent_status, value: isPass ? s.recent_pass : s.recent_fail, inline: true },
            { name: s.recent_rank,   value: emojis.rankLabel(recent.rank),         inline: true },
            { name: s.recent_mods,   value: mods,                                   inline: true },
            {
              name: s.recent_stats,
              value:
                `${ppLine}\n` +
                `**${s.recent_acc}:** ${(recent.accuracy * 100).toFixed(2)}%\n` +
                `**${s.recent_combo}:** ${scoreCombo}x/${mapCombo !== null ? mapCombo + 'x' : '?x'}\n` +
                `**${s.recent_hits}:** ${hitsLine}`,
              inline: false,
            }
          )
          .setFooter({
            text: s.recent_footer(
              recent.mode,
              new Date(recent.created_at).toLocaleString('pt-BR'),
              osu.getModeLabel(mode),
              page + 1,
              totalPages,
              // Status do mapa (ranked, loved, graveyard...). Só a API oficial
              // manda esse campo; no bancho.py ele não existe e o rodapé sai
              // sem ele, em vez de afirmar o que não dá para saber.
              recent.beatmap?.status ?? null
            ),
          });
      }

      await paginate(interaction, {
        id: 'recent',
        totalPages,
        buildEmbed,
        strings: s,
        // O contexto do canal acompanha a página em que os botões pararam.
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), mode),
        prefetch: page => osu.getBeatmapFile(recents[page]?.beatmap_id ?? recents[page]?.beatmap?.id),
      });
    } catch (error) {
      logError('recent', error);
      return safeEditReply(interaction, s.recent_error);
    }
  },
};
