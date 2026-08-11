const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const mapContext = require('../mapContext');
const { t } = require('../i18n');
const { logError } = require('../logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('simulate')
    .setDescription('Simulate the pp value of a hypothetical score on a map')
    .setDescriptionLocalizations({ 'pt-BR': 'Simula o valor de PP de uma play hipotética em um mapa' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(opt =>
      opt
        .setName('map')
        .setDescription('Beatmap ID or link (e.g. https://osu.ppy.sh/beatmapsets/123#osu/456)')
        .setDescriptionLocalizations({ 'pt-BR': 'ID ou link do beatmap (ex: https://osu.ppy.sh/beatmapsets/123#osu/456)' })
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('mods')
        .setDescription('Mods (e.g. DT HR)')
        .setDescriptionLocalizations({ 'pt-BR': 'Mods (ex: DT HR)' })
        .setRequired(false)
    )
    .addIntegerOption(opt =>
      opt
        .setName('n100')
        .setDescription('Number of 100s')
        .setDescriptionLocalizations({ 'pt-BR': 'Quantidade de 100s' })
        .setRequired(false)
        .setMinValue(0)
        // Nenhum mapa de osu! chega perto disso (os maiores têm ~40k objetos).
        // O teto evita entregar um inteiro gigante à lib nativa de cálculo.
        .setMaxValue(100000)
    )
    .addIntegerOption(opt =>
      opt
        .setName('n50')
        .setDescription('Number of 50s')
        .setDescriptionLocalizations({ 'pt-BR': 'Quantidade de 50s' })
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(100000)
    )
    .addIntegerOption(opt =>
      opt
        .setName('miss')
        .setDescription('Number of misses')
        .setDescriptionLocalizations({ 'pt-BR': 'Quantidade de misses' })
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(100000)
    )
    .addIntegerOption(opt =>
      opt
        .setName('combo')
        .setDescription('Max combo reached (default: full combo)')
        .setDescriptionLocalizations({ 'pt-BR': 'Combo máximo atingido (padrão: full combo)' })
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(100000)
    )
    .addStringOption(opt =>
      opt
        .setName('server')
        .setDescription('Which server/algorithm to use? (default: official)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor/algoritmo usar? (padrão: oficial)' })
        .setRequired(false)
        .addChoices(...servers.choices())
    ),

  async execute(interaction) {
    const s = t(interaction);

    const mapInput  = interaction.options.getString('map');
    const modsInput = interaction.options.getString('mods');
    const n100      = interaction.options.getInteger('n100') ?? 0;
    const n50       = interaction.options.getInteger('n50') ?? 0;
    const miss      = interaction.options.getInteger('miss') ?? 0;
    const comboOpt  = interaction.options.getInteger('combo');
    const mode      = interaction.options.getString('server') || osu.DEFAULT_MODE;

    const beatmapId = osu.parseBeatmapId(mapInput);
    if (!beatmapId) {
      return interaction.reply({ content: s.simulate_invalid_map, flags: MessageFlags.Ephemeral });
    }

    const mods = osu.parseModsString(modsInput);

    await interaction.deferReply();

    try {
      const beatmap = await osu.getBeatmap(beatmapId);
      if (!beatmap) return interaction.editReply(s.simulate_map_not_found);

      const result = await osu.simulatePP(
        beatmapId,
        mods,
        { n100, n50, misses: miss, combo: comboOpt ?? undefined },
        mode
      );

      if (!result || result.pp == null) {
        return interaction.editReply(s.simulate_calc_error);
      }

      const maxCombo = result.maxCombo ?? beatmap.max_combo ?? null;

      // Um combo maior que o máximo do mapa é impossível; a lib de cálculo já
      // trata como o máximo, então exibimos o valor real usado em vez de
      // repetir de volta o número inválido que o usuário digitou.
      const comboUsed = (comboOpt != null && maxCombo) ? Math.min(comboOpt, maxCombo) : comboOpt;

      // Sem combo informado, o cálculo assume o combo máximo do mapa. Com
      // misses isso não é um FC de verdade (não existe FC com miss), então o
      // rótulo muda para deixar claro que é uma suposição.
      const comboLabel = miss > 0 ? s.simulate_combo_assumed : s.simulate_combo_fc;
      const comboText = comboUsed != null
        ? `${comboUsed}x${maxCombo ? `/${maxCombo}x` : ''}`
        : (maxCombo ? `${maxCombo}x/${maxCombo}x (${comboLabel})` : comboLabel);

      const modsText = mods.length > 0 ? `+${mods.join('')}` : s.simulate_mods_none;
      const stars = result.stars != null ? parseFloat(result.stars).toFixed(2) : '?';

      const title = beatmap.beatmapset?.title ?? '???';
      const artist = beatmap.beatmapset?.artist ?? '';
      const version = beatmap.version ?? '';
      const mapUrl = osu.getMapUrl(beatmap.id, beatmap.beatmapset_id ?? beatmap.beatmapset?.id, mode);
      const cover = beatmap.beatmapset?.covers?.list ?? null;

      const embed = new EmbedBuilder()
        .setColor(0x99ccff)
        .setTitle(`${artist ? `${artist} - ` : ''}${title} [${version}] [${stars}★]`)
        .setURL(mapUrl)
        .setDescription(
          `**Mods:** ${modsText}\n` +
          `**Combo:** ${comboText}\n` +
          `**Hits:** { 100: ${n100} / 50: ${n50} / miss: ${miss} }\n\n` +
          `**PP: ${result.pp.toFixed(2)}pp**`
        )
        .setFooter({ text: s.simulate_footer(osu.getModeLabel(mode)) });

      if (cover) embed.setThumbnail(cover);

      await interaction.editReply({ embeds: [embed] });

      // Deixa o mapa como contexto do canal: quem viu a simulação pode rodar
      // /score direto para comparar com o que realmente já foi jogado.
      mapContext.remember(interaction, beatmapId, mode);
    } catch (error) {
      logError('simulate', error);
      interaction.editReply(s.simulate_error);
    }
  },
};
