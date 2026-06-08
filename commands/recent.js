const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const osu = require('../osuClient');
const { resolvePlayer } = require('../userLink');
const { t } = require('../i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recent')
    .setDescription("Show a player's most recent play (including fails)")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra a última play (incluindo falhas) de um jogador' })
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
        .setDescription('Which server to use? (default: official)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: oficial)' })
        .setRequired(false)
        .addChoices(
          { name: 'Bancho',     value: 'official'   },
          { name: 'Daycore',    value: 'private'     },
          { name: 'Daycore RX', value: 'private_rx'  }
        )
    ),

  async execute(interaction) {
    const s        = t(interaction);
    const resolved = resolvePlayer(interaction, 'player', 'server');
    if (!resolved) {
      return interaction.reply({ content: s.no_link_set, ephemeral: true });
    }

    const { username, mode } = resolved;
    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply(s.player_not_found);

      const recents = await osu.getRecentScores(user.id, 1, mode);
      const recent  = recents[0];

      if (!recent) return interaction.editReply(s.recent_none(user.username));

      const mapUrl = osu.getMapUrl(recent.beatmap.id, recent.beatmapset.id, mode);
      const mods   = recent.mods.length > 0 ? `+${recent.mods.join('')}` : 'No Mods';
      const isPass = recent.passed;

      const hits  = recent.statistics ?? {};
      const h300  = hits.count_300  ?? hits.great ?? '-';
      const h100  = hits.count_100  ?? hits.ok    ?? '-';
      const h50   = hits.count_50   ?? hits.meh   ?? '-';
      const hMiss = hits.count_miss ?? hits.miss  ?? 0;
      const hitsLine = `{ ${h300} / ${h100} / ${h50} / ${hMiss} }`;

      const fcPP       = await osu.getFCpp(recent, mode);
      const misses     = typeof hMiss === 'number' ? hMiss : 0;
      const mapCombo   = recent.beatmap?.max_combo ?? null;
      const scoreCombo = recent.max_combo ?? 0;
      const isChoke    = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

      const ppLine =
        `**${s.recent_pp}:** ${recent.pp ? recent.pp.toFixed(2) : '0'}pp` +
        (fcPP !== null && isChoke ? ` *(FC: ~${fcPP.toFixed(2)}pp)*` : '');

      const embed = new EmbedBuilder()
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
          { name: s.recent_rank,   value: `**${recent.rank}**`,                   inline: true },
          { name: s.recent_mods,   value: mods,                                   inline: true },
          {
            name: s.recent_stats,
            value:
              `${ppLine}\n` +
              `**${s.recent_acc}:** ${(recent.accuracy * 100).toFixed(2)}%\n` +
              `**${s.recent_combo}:** ${recent.max_combo !== null ? recent.max_combo + 'x' : '-'}\n` +
              `**${s.recent_hits}:** ${hitsLine}`,
            inline: false,
          }
        )
        .setFooter({
          text: s.recent_footer(
            recent.mode,
            new Date(recent.created_at).toLocaleString('pt-BR'),
            osu.getModeLabel(mode)
          ),
        });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error.response?.data || error);
      interaction.editReply(s.recent_error);
    }
  },
};
