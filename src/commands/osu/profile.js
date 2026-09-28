const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../../osuClient');
const servers = require('../../servers');
const modo = require('../../modo');
const { resolvePlayer, fetchPlayer } = require('../../userLink');
const emojis = require('../../emojis');
const { mdLink } = require('../../markdown');
const { formatMods } = require('../../mods');
const { author, mapTitle, ppLegivel } = require('../../embeds/play');
const { t } = require('../../i18n');
const { logError } = require('../../lib/logger');
const { safeEditReply } = require('../../replies');

const unix = (dateString) => {
  const ms = new Date(dateString ?? NaN).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/** Emoji de cada nota, na ordem do perfil do osu!; texto quando não houver. */
const GRADES = [['ssh', 'XH', 'SS+'], ['ss', 'X', 'SS'], ['sh', 'SH', 'S+'], ['s', 'S', 'S'], ['a', 'A', 'A']];

const code = (valor) => `\`${valor}\``;

/** Duas casas, no separador do idioma — o mesmo do pp na linha do autor. */
const dec2 = (n, locale) =>
  Number(n ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * O corpo do perfil. Separado do execute para dar para testar sem Discord.
 *
 * Linha com dado que o servidor não manda some inteira, em vez de sair zerada:
 * tempo de jogo e notas faltam no Relax do Gatari, e "0 h" ali seria mentira.
 */
function describe(user, bestPlay, mode, s) {
  const stats = user.statistics ?? {};
  const num   = (n) => Number(n ?? 0).toLocaleString(s.locale);

  const lines = [];

  // Level no formato do perfil do osu! (100,07): o progresso vira os decimais.
  const level = stats.level?.current
    ? dec2(stats.level.current + Math.floor(stats.level.progress ?? 0) / 100, s.locale)
    : null;
  lines.push(`▸ **${s.profile_acc}:** ${code(`${dec2(stats.hit_accuracy, s.locale)}%`)}` +
    (level ? ` • **${s.profile_level}:** ${code(level)}` : ''));

  const horas = stats.play_time ? ` (${code(s.profile_hours(num(Math.floor(stats.play_time / 3600))))})` : '';
  lines.push(`▸ **${s.profile_playcount}:** ${code(num(stats.play_count))}${horas}` +
    ` • **${s.profile_max_combo}:** ${code(`${num(stats.maximum_combo)}x`)}`);

  if (stats.grade_counts) {
    const notas = GRADES
      .map(([campo, grade, texto]) => `${emojis.rank(grade) ?? `**${texto}**`} ${code(num(stats.grade_counts[campo]))}`)
      .join(' ');
    lines.push(`▸ **${s.profile_grades}:** ${notas}`);
  }

  lines.push('');
  if (bestPlay) {
    const mapUrl = osu.getMapUrl(bestPlay.beatmap.id, bestPlay.beatmapset.id, mode);
    const mods   = formatMods(bestPlay.mods ?? []);
    const combo  = bestPlay.max_combo !== null && bestPlay.max_combo !== undefined
      ? ` • ${num(bestPlay.max_combo)}x`
      : '';
    lines.push(
      // Nome de mapa é texto de terceiro em posição de link (ver markdown.js).
      `▸ **${s.profile_top_play}:** [${mdLink(mapTitle(bestPlay))}](${mapUrl})${mods === '+NM' ? '' : ` **${mods}**`}`,
      `\u2003 ${code(`${ppLegivel(bestPlay.pp, s.locale)}pp`)} • ${dec2(bestPlay.accuracy * 100, s.locale)}% • ` +
        `${emojis.rankLabel(bestPlay.rank)}${combo}`,
    );
  } else {
    lines.push(`▸ **${s.profile_top_play}:** ${s.profile_no_play}`);
  }

  const visto  = unix(user.last_visit);
  const entrou = unix(user.join_date);
  const status = user.is_online
    ? s.profile_online
    : (visto ? s.profile_last_seen(`<t:${visto}:R>`) : null);
  const conta  = entrou ? s.profile_joined(`<t:${entrou}:D>`, `<t:${entrou}:R>`) : null;
  const rodape = [status, conta].filter(Boolean).join(' • ');
  if (rodape) lines.push('', rodape);

  return new EmbedBuilder()
    .setAuthor(author(user, mode, s))
    .setThumbnail(user.avatar_url)
    .setColor(user.is_online ? 0x99ff99 : 0x2b4963)
    .setDescription(lines.join('\n'))
    .setFooter({ text: s.profile_footer(osu.getModeLabel(mode)) });
}

module.exports = {
  data: modo.addOption(new SlashCommandBuilder()
    .setName('profile')
    .setDescription("Show a player's osu! profile")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra o perfil de um jogador de osu!' })
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
      // A top play sai junto do perfil quando o link já deu o id (ver userLink):
      // só o enriquecimento dela é que precisa esperar, porque parte do score.
      const { user, scores: rawBest } = await fetchPlayer(
        resolved,
        id => osu.getBestScores(id, 1, mode),
      );
      if (!user) return interaction.editReply(s.player_not_found);

      const bestPlays = await osu.enrichScores(rawBest, mode);
      const embed     = describe(user, bestPlays[0] || null, mode, s);

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('profile', error);
      // O adaptador oficial já devolve null em 404 (ver osu/officialApi.js), então
      // isto cobre só os 404 das outras chamadas do comando — as top plays.
      if (error.response?.status === 404) return safeEditReply(interaction, s.player_not_found);
      return safeEditReply(interaction, s.error_generic);
    }
  },

  // Exportado para teste.
  describe,
};
