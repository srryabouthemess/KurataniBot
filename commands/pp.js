const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const { resolvePlayer } = require('../userLink');
const { t } = require('../i18n');
const { logError } = require('../logger');

/**
 * Calcula o PP total ponderado de uma lista de plays.
 * Fórmula: sum(pp[i] * 0.95^i) para i = 0, 1, 2, ...
 */
function calcWeightedPP(plays) {
  return plays.reduce((sum, play, i) => sum + play.pp * Math.pow(0.95, i), 0);
}

/**
 * Insere uma play hipotética de `x` pp na lista atual e retorna o novo PP
 * ponderado (top 100) e a posição que ela ocupou.
 */
function simulateInsert(currentPlays, x) {
  const hypothetical = { pp: x };
  const simulated = [...currentPlays, hypothetical]
    .sort((a, b) => b.pp - a.pp)
    .slice(0, 100);

  return {
    weightedPP: calcWeightedPP(simulated),
    position: simulated.indexOf(hypothetical) + 1,
  };
}

/**
 * Encontra por busca binária o menor valor de pp de uma única play
 * hipotética necessário para que o PP ponderado total atinja `targetWeighted`.
 * O PP ponderado é monotonicamente não-decrescente em função de `x`, então
 * a busca binária é segura. O limite superior dobra até "passar" do alvo.
 */
function findRequiredPP(currentPlays, targetWeighted) {
  let lo = 0;
  let hi = 1000;

  while (simulateInsert(currentPlays, hi).weightedPP < targetWeighted && hi < 1e7) {
    hi *= 2;
  }

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (simulateInsert(currentPlays, mid).weightedPP < targetWeighted) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return hi;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pp')
    .setDescription('Find out how much pp a single score needs to reach a target pp total')
    .setDescriptionLocalizations({ 'pt-BR': 'Descubra quanto pp uma única play precisa para chegar a um pp total' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addNumberOption(opt =>
      opt
        .setName('target')
        .setDescription('Target pp total (e.g. 10000)')
        .setDescriptionLocalizations({ 'pt-BR': 'PP total desejado (ex: 10000)' })
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
        .setDescription('Which server to use? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(
          { name: 'Bancho',     value: 'official'   },
          { name: 'Daycore',    value: 'private'     },
          { name: 'Daycore RX', value: 'private_rx'  }
        )
    ),

  async execute(interaction) {
    const s         = t(interaction);
    const targetPP  = interaction.options.getNumber('target');
    const resolved  = resolvePlayer(interaction, 'player', 'server');

    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const { username, mode } = resolved;
    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply(s.player_not_found);

      const plays = await osu.getBestScores(user.id, 100, mode);
      if (plays.length === 0) {
        return interaction.editReply(s.no_plays(user.username, osu.getModeLabel(mode)));
      }

      const stats      = user.statistics;
      const currentPP  = stats.pp;
      const rankDisplay = stats.global_rank ? `#${stats.global_rank.toLocaleString()}` : s.profile_unranked;
      const countryPart = (!user._private && stats.country_rank)
        ? ` ${user.country_code}#${stats.country_rank.toLocaleString()}`
        : ` ${user.country_code}`;

      const targetLabel = targetPP.toLocaleString(s.locale);

      // Já está no ou acima do alvo
      if (currentPP >= targetPP) {
        const embed = new EmbedBuilder()
          .setColor(0x99ff99)
          .setAuthor({
            name:    `${user.username}: ${stats.pp.toFixed(2)}pp (${rankDisplay}${countryPart})`,
            iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
            url:     osu.getUserUrl(user.id, mode),
          })
          .setThumbnail(user.avatar_url)
          .setDescription(s.pp_already(user.username, currentPP.toFixed(2), targetLabel));
        return interaction.editReply({ embeds: [embed] });
      }

      // bonus = pp que não vem das top plays ponderadas (ex: playcount bonus)
      const currentWeighted = calcWeightedPP(plays);
      const bonus           = currentPP - currentWeighted;
      const targetWeighted  = targetPP - bonus;

      const requiredPP = findRequiredPP(plays, targetWeighted);
      const { position } = simulateInsert(plays, requiredPP);

      const bestPlay   = plays[0];
      const isBestPlay = requiredPP > bestPlay.pp;
      const requiredLabel = requiredPP.toFixed(2);

      const title = s.pp_title(user.username, targetLabel);

      const description = isBestPlay
        ? s.pp_desc_best(user.username, targetLabel, requiredLabel)
        : s.pp_desc_position(user.username, targetLabel, requiredLabel, position);

      const embed = new EmbedBuilder()
        .setColor(0x99ccff)
        .setAuthor({
          name:    `${user.username}: ${stats.pp.toFixed(2)}pp (${rankDisplay}${countryPart})`,
          iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
          url:     osu.getUserUrl(user.id, mode),
        })
        .setThumbnail(user.avatar_url)
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: s.footer_based_on(osu.getModeLabel(mode), plays.length) });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('pp', error);
      interaction.editReply(s.error_generic);
    }
  },
};
