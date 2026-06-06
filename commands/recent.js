const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const osu = require('../osuClient');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('recent')
    .setDescription('Mostra a última play (incluindo falhas) de um jogador')
    .addStringOption(option =>
      option.setName('player').setDescription('Nome do jogador').setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('servidor')
        .setDescription('Qual servidor usar? (padrão: oficial)')
        .setRequired(false)
        .addChoices(
          { name: 'Bancho', value: 'official' },
          { name: 'Daycore', value: 'private' },
          { name: 'Daycore RX', value: 'private_rx' }
        )
    ),

  async execute(interaction) {
    const player = interaction.options.getString('player');
    const mode = interaction.options.getString('servidor') || osu.DEFAULT_MODE;

    await interaction.deferReply();

    try {
      const user = await osu.getUser(player, mode);
      if (!user) return interaction.editReply('❌ Jogador não encontrado.');

      const recents = await osu.getRecentScores(user.id, 1, mode);
      const recent = recents[0];

      if (!recent) {
        return interaction.editReply(`Nenhuma play recente encontrada para **${user.username}**.`);
      }

      const mapUrl = osu.getMapUrl(recent.beatmap.id, recent.beatmapset.id, mode);
      const mods = recent.mods.length > 0 ? `+${recent.mods.join('')}` : 'No Mods';
      const isPass = recent.passed;

      // Hits explícitos (300/100/50/miss)
      const hits = recent.statistics ?? {};
      const h300  = hits.count_300  ?? hits.great  ?? '-';
      const h100  = hits.count_100  ?? hits.ok      ?? '-';
      const h50   = hits.count_50   ?? hits.meh     ?? '-';
      const hMiss = hits.count_miss ?? hits.miss    ?? 0;

      const hitsLine = `{ ${h300} / ${h100} / ${h50} / ${hMiss} }`;

      // FC PP (calculado em paralelo com o restante)
      const fcPP = await osu.getFCpp(recent, mode);
      const misses    = typeof hMiss === 'number' ? hMiss : 0;
      const mapCombo  = recent.beatmap?.max_combo ?? null;
      const scoreCombo = recent.max_combo ?? 0;
      const isChoke = misses > 0 || (mapCombo !== null && scoreCombo < mapCombo);

      const ppLine =
        `**PP:** ${recent.pp ? recent.pp.toFixed(2) : '0'}pp` +
        (fcPP !== null && isChoke ? ` *(FC: ~${fcPP.toFixed(2)}pp)*` : '');

      const embed = new EmbedBuilder()
        .setAuthor({
          name: `Play recente de ${user.username}`,
          iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
          url: osu.getUserUrl(user.id, mode),
        })
        .setTitle(`${recent.beatmapset.title} [${recent.beatmap.version}]`)
        .setURL(mapUrl)
        .setColor(isPass ? 0xff66aa : 0xee4444)
        .setThumbnail(recent.beatmapset.covers.list)
        .addFields(
          { name: 'Status', value: isPass ? '✅ **Pass**' : '❌ **Quit**', inline: true },
          { name: 'Rank',   value: `**${recent.rank}**`, inline: true },
          { name: 'Mods',   value: mods, inline: true },
          {
            name: 'Estatísticas',
            value:
              `${ppLine}\n` +
              `**Acc:** ${(recent.accuracy * 100).toFixed(2)}%\n` +
              `**Combo:** ${recent.max_combo !== null ? recent.max_combo + 'x' : '-'}\n` +
              `**Hits:** ${hitsLine}`,
            inline: false,
          }
        )
        .setFooter({
          text: `Modo: ${recent.mode} | ${new Date(recent.created_at).toLocaleString('pt-BR')} • ${osu.getModeLabel(mode)}`,
        });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error.response?.data || error);
      interaction.editReply('Erro ao buscar a play recente. Verifique se o jogador existe.');
    }
  },
};
