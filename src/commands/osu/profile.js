const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const axios = require('axios');
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
const { withRefreshButton } = require('../../refreshButton');

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

const AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const AVATAR_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/**
 * O avatar de servidor privado vai ANEXADO, e não como link.
 *
 * Com o link, o Discord busca a imagem pelo proxy dele, e no Daycore essa busca
 * falha calada: o `a.daycore.org` responde 200 para qualquer um de fora, e o
 * perfil saía sem foto mesmo assim. Anexada, a imagem sai do bot, que consegue
 * buscá-la. Falhar aqui não derruba o perfil — volta para o link, que é o que
 * havia antes.
 */
async function avatarAttachment(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 5000, maxContentLength: AVATAR_MAX_BYTES,
    });
    const ext = AVATAR_EXT[String(res.headers['content-type'] ?? '').split(';')[0].trim()];
    return ext ? new AttachmentBuilder(Buffer.from(res.data), { name: `avatar.${ext}` }) : null;
  } catch {
    return null;
  }
}

/**
 * O corpo do perfil. Separado do execute para dar para testar sem Discord.
 *
 * Linha com dado que o servidor não manda some inteira, em vez de sair zerada:
 * tempo de jogo e notas faltam no Relax do Gatari, e "0 h" ali seria mentira.
 */
function describe(user, bestPlay, mode, s, { thumbnail = user.avatar_url } = {}) {
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
      `▸ **${s.profile_top_play}:** [${mdLink(mapTitle(bestPlay))}](${mapUrl})`,
      `${code(`${ppLegivel(bestPlay.pp, s.locale)}pp`)} • ${dec2(bestPlay.accuracy * 100, s.locale)}% • ` +
        `${emojis.rankLabel(bestPlay.rank)}${combo}${mods === '+NM' ? '' : ` • **${mods}**`}`,
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
    .setThumbnail(thumbnail)
    .setColor(user.is_online ? 0x99ff99 : 0x2b4963)
    .setDescription(lines.join('\n'))
    .setFooter({ text: s.profile_footer(osu.getModeLabel(mode)) });
}

/**
 * Busca tudo e monta o embed. Serve ao carregamento inicial e ao 🔄, que refaz
 * exatamente o mesmo caminho — a diferença é só o `fresh`, que pula os caches de
 * perfil e de top play (ver osuClient.getUser).
 *
 * @param {{username: string|number, mode: string}} resolved
 * @param {object} s i18n
 * @param {object} [opts]
 * @param {boolean} [opts.fresh]
 * @param {string|null} [opts.anexado] nome do avatar que JÁ está anexado à
 *   mensagem, para o refresh não perdê-lo quando o download novo falha
 * @returns {Promise<{embed: EmbedBuilder, avatar: AttachmentBuilder|null,
 *   mantemAnexo: boolean}|null>} null quando o jogador não existe
 */
async function montarPerfil(resolved, s, { fresh = false, anexado = null } = {}) {
  const { mode } = resolved;

  // A top play sai junto do perfil quando o link já deu o id (ver userLink):
  // só o enriquecimento dela é que precisa esperar, porque parte do score.
  const { user, scores: rawBest } = await fetchPlayer(
    resolved,
    id => osu.getBestScores(id, 1, mode, { fresh }),
    { fresh },
  );
  if (!user) return null;

  const [bestPlays, avatar] = await Promise.all([
    osu.enrichScores(rawBest, mode),
    user._private ? avatarAttachment(user.avatar_url) : null,
  ]);

  // O download novo falhou, mas a mensagem já carrega um avatar: a thumbnail
  // continua apontando para ele, em vez de voltar ao link que não renderiza.
  const mantemAnexo = !avatar && !!user._private && !!anexado;
  const nome = avatar?.name ?? (mantemAnexo ? anexado : null);

  const embed = describe(user, bestPlays[0] || null, mode, s, nome
    ? { thumbnail: `attachment://${nome}` }
    : {});

  return { embed, avatar, mantemAnexo };
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

    await interaction.deferReply();

    try {
      const perfil = await montarPerfil(resolved, s);
      if (!perfil) return interaction.editReply(s.player_not_found);

      // O avatar anexado, e não o link, quando o servidor é privado (ver
      // avatarAttachment). É o nome do arquivo que vai para o refresh.
      let anexado = perfil.avatar?.name ?? null;

      await withRefreshButton(
        interaction,
        { embeds: [perfil.embed], files: perfil.avatar ? [perfil.avatar] : [] },
        {
          id: 'profile',
          strings: s,
          errorMessage: s.profile_refresh_error,
          async refresh() {
            const novo = await montarPerfil(resolved, s, { fresh: true, anexado });
            if (!novo) throw new Error('profile refresh: jogador não encontrado');

            if (novo.avatar) anexado = novo.avatar.name;
            else if (!novo.mantemAnexo) anexado = null;

            // O edit SUBSTITUI os anexos (`attachments: []`) em vez de somar: sem
            // isso o avatar novo entraria ao lado do antigo, com o mesmo nome, e a
            // mensagem ficaria com dois. Só quando o download falhou e o anexo
            // velho continua valendo é que o campo é omitido — e o Discord mantém
            // o que já está lá.
            return novo.mantemAnexo
              ? { embeds: [novo.embed] }
              : { embeds: [novo.embed], files: novo.avatar ? [novo.avatar] : [], attachments: [] };
          },
        },
      );
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
