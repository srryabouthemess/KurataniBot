const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const osu = require('../osuClient');
const { resolvePlayer } = require('../userLink');
const { t } = require('../i18n');

/**
 * Calcula o PP total ponderado de uma lista de plays.
 * Fórmula: sum(pp[i] * 0.95^i) para i = 0, 1, 2, ...
 * O bonus de PP por playcount não é incluído (é constante e não muda).
 */
function calcWeightedPP(plays) {
  return plays.reduce((sum, play, i) => sum + play.pp * Math.pow(0.95, i), 0);
}

/**
 * Simula o PP total se o jogador fizesse uma play de `hypotheticalPP`.
 * Retorna null se a play hipotética não entraria no top (PP menor que a última).
 */
function simulateWhatIf(currentPlays, hypotheticalPP) {
  // Insere a play hipotética e reordena por PP decrescente
  const simulated = [...currentPlays, { pp: hypotheticalPP }]
    .sort((a, b) => b.pp - a.pp)
    .slice(0, 100); // mantém só as top 100

  const currentPP   = calcWeightedPP(currentPlays);
  const simulatedPP = calcWeightedPP(simulated);
  const gain        = simulatedPP - currentPP;

  // Posição que a play hipotética ocupa
  const position = simulated.findIndex(p => p.pp === hypotheticalPP) + 1;

  // Se não entrou (PP menor que todas as 100 plays atuais)
  const didEnter = position > 0 && position <= simulated.length;

  return { currentPP, simulatedPP, gain, position, didEnter };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whatif')
    .setDescription('Simulate how much pp you would gain from a hypothetical score')
    .setDescriptionLocalizations({ 'pt-BR': 'Simula quanto PP você ganharia com uma play hipotética' })
    .addNumberOption(opt =>
      opt
        .setName('pp')
        .setDescription('Hypothetical PP value (e.g. 400)')
        .setDescriptionLocalizations({ 'pt-BR': 'Valor de PP hipotético (ex: 400)' })
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(30000)
    )
    .addStringOption(opt =>
      opt
        .setName('player')
        .setDescription('Player name (optional if /link is set)')
        .setDescriptionLocalizations({ 'pt-BR': 'Nome do jogador (opcional se tiver /link)' })
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
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
    const s              = t(interaction);
    const hypotheticalPP = interaction.options.getNumber('pp');
    const resolved       = resolvePlayer(interaction, 'player', 'server');

    if (!resolved) {
      return interaction.reply({ content: s.no_link_set, ephemeral: true });
    }

    const { username, mode } = resolved;
    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply(s.player_not_found);

      // Busca até 100 top plays para o cálculo ser preciso
      const plays = await osu.getBestScores(user.id, 100, mode);
      if (plays.length === 0) {
        return interaction.editReply(
          mode === 'official'
            ? `**${user.username}** has no ranked plays.`
            : `**${user.username}** has no plays on ${osu.getModeLabel(mode)}.`
        );
      }

      const { currentPP, simulatedPP, gain, position, didEnter } = simulateWhatIf(plays, hypotheticalPP);

      const stats      = user.statistics;
      const rankDisplay = stats.global_rank ? `#${stats.global_rank.toLocaleString()}` : s.profile_unranked;
      const countryPart = (!user._private && stats.country_rank)
        ? ` ${user.country_code}#${stats.country_rank.toLocaleString()}`
        : ` ${user.country_code}`;

      // Melhor play atual para comparação
      const bestPlay    = plays[0];
      const isBestPlay  = hypotheticalPP > bestPlay.pp;
      const isInTop     = position <= plays.length;

      // Linha descritiva da posição
      let positionLine;
      if (isBestPlay) {
        positionLine = mode === 'official'
          ? `A **${hypotheticalPP}pp** play would be **${user.username}**'s new #1 best play! 🎉`
          : `Uma play de **${hypotheticalPP}pp** seria a nova melhor play de **${user.username}**! 🎉`;
      } else if (didEnter) {
        positionLine = mode === 'official'
          ? `A **${hypotheticalPP}pp** play would be **${user.username}**'s **#${position}** best play.`
          : `Uma play de **${hypotheticalPP}pp** seria a **#${position}ª** melhor play de **${user.username}**.`;
      } else {
        positionLine = mode === 'official'
          ? `A **${hypotheticalPP}pp** play wouldn't enter **${user.username}**'s top 100.`
          : `Uma play de **${hypotheticalPP}pp** não entraria no top 100 de **${user.username}**.`;
      }

      // Linha de ganho de PP
      const gainLine = mode === 'official'
        ? `Their pp would change by **+${gain.toFixed(2)}pp** to **${simulatedPP.toFixed(2)}pp**`
        : `Seu PP mudaria **+${gain.toFixed(2)}pp** para **${simulatedPP.toFixed(2)}pp**`;

      // Top 5 plays para contexto, destacando onde a hipotética entraria.
      // Os títulos só precisam ser buscados pras 5 que realmente vão aparecer
      // aqui, não pras 100 usadas no cálculo — evita requisições desnecessárias.
      let playsPreview = '';
      let previewList = [...plays, { pp: hypotheticalPP, _hypothetical: true }]
        .sort((a, b) => b.pp - a.pp)
        .slice(0, 5);

      if (mode !== 'official') {
        const realOnes    = previewList.filter(p => !p._hypothetical);
        const enrichedMap = new Map(
          (await osu.enrichScores(realOnes)).map((p, i) => [realOnes[i], p])
        );
        previewList = previewList.map(p => p._hypothetical ? p : (enrichedMap.get(p) ?? p));
      }

      previewList.forEach((play, i) => {
        if (play._hypothetical) {
          playsPreview += `**#${i + 1}** → \`${hypotheticalPP}pp\` *(hypothetical)* ✨\n`;
        } else {
          const title = play.beatmapset?.title ?? '???';
          playsPreview += `**#${i + 1}** \`${play.pp.toFixed(2)}pp\` — ${title}\n`;
        }
      });

      const embed = new EmbedBuilder()
        .setColor(gain > 0 ? 0x99ff99 : 0xaaaaaa)
        .setAuthor({
          name:    `${user.username}: ${stats.pp.toFixed(2)}pp (${rankDisplay}${countryPart})`,
          iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
          url:     osu.getUserUrl(user.id, mode),
        })
        .setThumbnail(user.avatar_url)
        .setTitle(
          mode === 'official'
            ? `What if ${user.username} got a new ${hypotheticalPP}pp score?`
            : `E se ${user.username} fizesse uma play de ${hypotheticalPP}pp?`
        )
        .setDescription(
          `${positionLine}\n\n` +
          `${gainLine}\n\n` +
          `**Top 5 (with simulation):**\n${playsPreview}`
        )
        .setFooter({ text: `${osu.getModeLabel(mode)} • based on top ${plays.length} plays` });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      interaction.editReply(s.error_generic);
    }
  },
};
