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

const MAX_SIMULATED_PLAYS = 5000;
const PROGRESSION_STEP    = 1;  // pp a mais por play

// O randomize varia cada play por uma FRAÇÃO do valor dela, não por um número
// fixo de pp. Medindo as top plays reais de 21 jogadores do #1 ao #10.000, a
// dispersão relativa fica em ~5% independente do nível — ou seja, ela escala
// proporcional ao valor da play, não exponencialmente com o skill. Um ±50 fixo
// seria 10% pra quem joga 480pp mas só 3,7% pro mrekk (plays de ~1350pp).
const DEFAULT_SPREAD_RATIO = 0.050;
const SPREAD_RATIO_MIN     = 0.025;
const SPREAD_RATIO_MAX     = 0.10;
const SPREAD_SAMPLE_SIZE   = 20;
// Fator que põe o MAD na mesma escala do desvio padrão numa normal.
const MAD_TO_SD            = 1.4826;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid    = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Mede a dispersão relativa das melhores plays do jogador, pra usar como
 * amplitude do randomize.
 *
 * Usa MAD/mediana em vez de desvio padrão/média porque uma única top play
 * muito destacada do resto inflava a estimativa — na amostra real isso levava
 * um perfil a 10% de dispersão contra ~5% de todo mundo, o dobro do devido.
 * O MAD ignora o outlier e devolve 6,7% pro mesmo perfil.
 *
 * Cai no padrão quando há poucas plays pra amostrar, e é limitada à faixa
 * observada nos perfis reais (2,6%–8,7%) com uma folga.
 */
function measureSpreadRatio(plays) {
  const sample = plays.slice(0, SPREAD_SAMPLE_SIZE).map(p => p.pp).filter(pp => pp > 0);
  if (sample.length < 5) return DEFAULT_SPREAD_RATIO;

  const med = median(sample);
  if (med <= 0) return DEFAULT_SPREAD_RATIO;

  const mad   = median(sample.map(pp => Math.abs(pp - med)));
  const ratio = (MAD_TO_SD * mad) / med;

  return Math.min(SPREAD_RATIO_MAX, Math.max(SPREAD_RATIO_MIN, ratio));
}

/**
 * Simula quantas novas plays com valor ~`avgPP` são necessárias para
 * o PP ponderado total (mais o `bonus`) atingir `targetPP`.
 *
 * Cada play "nova" é inserida na lista (mantendo só o top 100, como o osu!
 * faz de verdade), reordenada, e o PP ponderado é recalculado — por isso
 * plays adicionais valem cada vez menos (efeito do peso 0.95^i), igual ao
 * comportamento real do ranking.
 *
 * O valor base de cada play sobe PROGRESSION_STEP pp em relação à anterior
 * (700, 701, 702...), simulando o jogador melhorando aos poucos. Sem isso a
 * média ficaria presa em `avgPP` e o PP travaria num teto — metas
 * acima dele seriam inalcançáveis por mais plays que se fizesse.
 *
 * Se `randomize` for true, cada play ainda varia aleatoriamente dentro de
 * +/- `spreadRatio` do próprio valor base (nunca abaixo de 1pp), então a
 * progressão continua valendo e as plays saem em valores irregulares — com
 * uma amplitude proporcional ao nível das plays, não fixa em pp.
 */
function simulatePlaysNeeded(currentPlays, bonus, targetPP, avgPP, randomize, spreadRatio) {
  let list = [...currentPlays].sort((a, b) => b.pp - a.pp).slice(0, 100);
  const generated = [];
  let count = 0;

  while (calcWeightedPP(list) + bonus < targetPP) {
    if (count >= MAX_SIMULATED_PLAYS) {
      return { possible: false, count, generated, finalPP: calcWeightedPP(list) + bonus };
    }

    let pp = avgPP + count * PROGRESSION_STEP;
    if (randomize) {
      const offset = (Math.random() * 2 - 1) * pp * spreadRatio;
      pp = Math.max(1, pp + offset);
    }

    generated.push(pp);
    list = [...list, { pp }].sort((a, b) => b.pp - a.pp).slice(0, 100);
    count++;
  }

  return { possible: true, count, generated, finalPP: calcWeightedPP(list) + bonus };
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
    .addNumberOption(opt =>
      opt
        .setName('avg_pp')
        .setDescription('If set, answers how many plays averaging this much pp are needed instead')
        .setDescriptionLocalizations({ 'pt-BR': 'Se definido, responde quantas plays com essa média de pp são necessárias' })
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(3000)
    )
    .addBooleanOption(opt =>
      opt
        .setName('randomize')
        .setDescription('Also vary each play, using the spread measured from the player\'s own top plays')
        .setDescriptionLocalizations({ 'pt-BR': 'Variar cada play usando a dispersão medida nas top plays do próprio jogador' })
        .setRequired(false)
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
    const s             = t(interaction);
    const targetPP      = interaction.options.getNumber('target');
    const avgPP  = interaction.options.getNumber('avg_pp');
    const randomize     = interaction.options.getBoolean('randomize') ?? false;
    const resolved      = resolvePlayer(interaction, 'player', 'server');

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

      // Modo "quantas plays de X pp": em vez de achar uma única play que
      // resolve tudo, simula quantas plays de ~avgPP pp são
      // necessárias, uma a uma, respeitando a ponderação do top 100.
      if (avgPP != null) {
        const spreadRatio = measureSpreadRatio(plays);
        const result = simulatePlaysNeeded(plays, bonus, targetPP, avgPP, randomize, spreadRatio);

        const embed = new EmbedBuilder()
          .setColor(result.possible ? 0x99ccff : 0xff9999)
          .setAuthor({
            name:    `${user.username}: ${stats.pp.toFixed(2)}pp (${rankDisplay}${countryPart})`,
            iconURL: `https://flagcdn.com/w20/${user.country_code.toLowerCase()}.png`,
            url:     osu.getUserUrl(user.id, mode),
          })
          .setThumbnail(user.avatar_url)
          .setTitle(s.pp_howmany_title(user.username, targetLabel))
          .setFooter({ text: s.footer_based_on(osu.getModeLabel(mode), plays.length) });

        // Valor base da última play — em ambos os modos a base sobe
        // PROGRESSION_STEP por play; o randomize só sacode em cima dela.
        const lastBase = avgPP + (result.count - 1) * PROGRESSION_STEP;

        if (!result.possible) {
          embed.setDescription(
            s.pp_howmany_impossible(user.username, avgPP.toFixed(2), MAX_SIMULATED_PLAYS)
          );
        } else if (randomize) {
          const min = Math.min(...result.generated);
          const max = Math.max(...result.generated);
          embed.setDescription(
            s.pp_howmany_desc_randomized(
              user.username, targetLabel, result.count,
              avgPP.toFixed(2), lastBase.toFixed(2), PROGRESSION_STEP,
              min.toFixed(2), max.toFixed(2), (spreadRatio * 100).toFixed(1)
            )
          );
        } else {
          embed.setDescription(
            s.pp_howmany_desc_progressive(
              user.username, targetLabel, result.count,
              avgPP.toFixed(2), lastBase.toFixed(2), PROGRESSION_STEP
            )
          );
        }

        return interaction.editReply({ embeds: [embed] });
      }

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
