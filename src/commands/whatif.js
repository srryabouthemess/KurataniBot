const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { resolvePlayer } = require('../userLink');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

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
  // Insere a play hipotética e reordena por PP decrescente. Usamos a mesma
  // referência de objeto pra achar a posição depois — comparar por valor de
  // pp (`p.pp === hypotheticalPP`) dava posição errada em caso de empate
  // exato com uma play real, já que sort() é estável e o array espalhado
  // deixa a hipotética depois das reais empatadas.
  const hypothetical = { pp: hypotheticalPP };
  const simulated = [...currentPlays, hypothetical]
    .sort((a, b) => b.pp - a.pp)
    .slice(0, 100); // mantém só as top 100

  const currentPP   = calcWeightedPP(currentPlays);
  const simulatedPP = calcWeightedPP(simulated);
  const gain        = simulatedPP - currentPP;

  // Posição que a play hipotética ocupa (0 se foi cortada do top 100)
  const position = simulated.indexOf(hypothetical) + 1;

  // Se não entrou (PP menor que todas as 100 plays atuais)
  const didEnter = position > 0 && position <= simulated.length;

  return { currentPP, simulatedPP, gain, position, didEnter };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whatif')
    .setDescription('Simulate how much pp you would gain from a hypothetical score')
    .setDescriptionLocalizations({ 'pt-BR': 'Simula quanto PP você ganharia com uma play hipotética' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
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
        .setDescription('Which server to use? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(...servers.choices())
    ),

  async execute(interaction) {
    const s              = t(interaction);
    const hypotheticalPP = interaction.options.getNumber('pp');
    const resolved       = resolvePlayer(interaction, 'player', 'server');

    if (resolved.error) {
      return interaction.reply({ content: resolved.error, flags: MessageFlags.Ephemeral });
    }

    const { username, mode } = resolved;
    await interaction.deferReply();

    try {
      const user = await osu.getUser(username, mode);
      if (!user) return interaction.editReply(s.player_not_found);

      // Busca até 100 top plays para o cálculo ser preciso
      const plays = await osu.getBestScores(user.id, 100, mode);
      if (plays.length === 0) {
        return interaction.editReply(s.no_plays(user.username, osu.getModeLabel(mode)));
      }

      const { currentPP: currentWeighted, simulatedPP, gain, position, didEnter } =
        simulateWhatIf(plays, hypotheticalPP);

      const stats      = user.statistics;

      // O total precisa sair da MESMA base que o `stats.pp` do perfil, e o
      // calcWeightedPP só soma as top 100 ponderadas: de fora ficam o bônus por
      // playcount e a cauda das plays além da centésima, que juntos passam de
      // 400pp numa conta ativa.
      //
      // Sem somar isso de volta, o "indo para" saía ABAIXO do pp atual — uma
      // play boa parecia fazer o jogador PERDER pp, e o número discordava do
      // /pp, que pede um valor menor para uma meta maior.
      //
      // O ganho nunca teve esse problema: é uma diferença, e o offset se
      // cancela. É a mesma conta que o /pp já fazia do outro lado — lá o offset
      // é subtraído do alvo antes da busca, aqui é somado ao resultado.
      const offset   = stats.pp - currentWeighted;
      const newTotal = simulatedPP + offset;
      const rankDisplay = stats.global_rank ? `#${stats.global_rank.toLocaleString()}` : s.profile_unranked;
      const countryPart = (!user._private && stats.country_rank)
        ? ` ${user.country_code}#${stats.country_rank.toLocaleString()}`
        : ` ${user.country_code}`;

      // Melhor play atual para comparação
      const bestPlay    = plays[0];
      const isBestPlay  = hypotheticalPP > bestPlay.pp;

      // Linha descritiva da posição
      let positionLine;
      if (isBestPlay) {
        positionLine = s.whatif_pos_best(user.username, hypotheticalPP);
      } else if (didEnter) {
        positionLine = s.whatif_pos_n(user.username, hypotheticalPP, position);
      } else {
        positionLine = s.whatif_pos_none(user.username, hypotheticalPP);
      }

      // Linha de ganho de PP
      const gainLine = s.whatif_gain(gain.toFixed(2), newTotal.toFixed(2));

      // Top 5 plays para contexto, destacando onde a hipotética entraria.
      // Os títulos só precisam ser buscados pras 5 que realmente vão aparecer
      // aqui, não pras 100 usadas no cálculo — evita requisições desnecessárias.
      let playsPreview = '';
      let previewList = [...plays, { pp: hypotheticalPP, _hypothetical: true }]
        .sort((a, b) => b.pp - a.pp)
        .slice(0, 5);

      if (!servers.isOfficial(mode)) {
        const realOnes    = previewList.filter(p => !p._hypothetical);
        const enrichedMap = new Map(
          (await osu.enrichScores(realOnes)).map((p, i) => [realOnes[i], p])
        );
        previewList = previewList.map(p => p._hypothetical ? p : (enrichedMap.get(p) ?? p));
      }

      previewList.forEach((play, i) => {
        if (play._hypothetical) {
          playsPreview += `**#${i + 1}** → \`${hypotheticalPP}pp\` *(${s.whatif_hypothetical})* ✨\n`;
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
        .setTitle(s.whatif_title(user.username, hypotheticalPP))
        .setDescription(
          `${positionLine}\n\n` +
          `${gainLine}\n\n` +
          `**${s.whatif_top5}**\n${playsPreview}`
        )
        .setFooter({ text: s.footer_based_on(osu.getModeLabel(mode), plays.length) });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('whatif', error);
      return safeEditReply(interaction, s.error_generic);
    }
  },
};
