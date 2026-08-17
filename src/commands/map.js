/**
 * commands/map.js
 * O mapa, e quanto ele paga.
 *
 * ── O que faltava ─────────────────────────────────────────────────────────────
 * O bot sabia responder tudo sobre a play de alguém e nada sobre o mapa sozinho.
 * Para saber quanto vale um FC de 98% era preciso o /simulate, que pede a
 * contagem de 100s — ou seja, exige que a pessoa já tenha feito a conta que ela
 * queria fazer.
 *
 * ── Nada aqui é novo ──────────────────────────────────────────────────────────
 * A tabela sai do `simulatePP`, os atributos ajustados por mod saem do
 * `getMapAttrs` (a mesma linha que os embeds de play já imprimem), o mapa do
 * canal sai do `mapContext` e as estrelas do `getAdjustedStars`. Este arquivo é
 * a moldura: escolher o mapa, pedir cinco números e desenhar.
 */

const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const mapContext = require('../mapContext');
const playEmbed = require('../embeds/play');
const { stripClassic, formatMods } = require('../mods');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

/**
 * As acurácias da tabela, da melhor para a pior.
 *
 * Cinco, e estas cinco, porque é a régua que a comunidade de osu! usa para medir
 * um mapa ("quanto dá um 98 aqui?"). Abaixo de 95% a pergunta deixa de ser sobre
 * o mapa e passa a ser sobre a play, e para isso já existe o /simulate.
 */
const ACCS = [100, 99, 98, 97, 95];

/**
 * Quantos 100s são precisos para chegar naquela acurácia, num FC.
 *
 * Sem 50 e sem miss, a acurácia do osu! vira `1 - (2 * n100) / (3 * objetos)` —
 * daí o n100 sair por inversão direta. O arredondamento é o motivo de a tabela
 * dizer "98%" e não "98.02%": nem toda acurácia é atingível num mapa com N
 * objetos, e o valor exibido é o alvo pedido, não o que o arredondamento deu.
 */
const cemPara = (acc, objetos) => Math.round((3 * objetos * (1 - acc / 100)) / 2);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('map')
    .setDescription('Show a beatmap and what a FC on it would pay')
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra um mapa e quanto um FC nele pagaria' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(opt =>
      opt
        .setName('map')
        .setDescription('Beatmap ID or link (default: last map shown in this channel)')
        .setDescriptionLocalizations({ 'pt-BR': 'ID ou link do beatmap (padrão: último mapa mostrado no canal)' })
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('mods')
        .setDescription('Mods (e.g. DT HR, or DT1.4 for an adjusted rate)')
        .setDescriptionLocalizations({ 'pt-BR': 'Mods (ex: DT HR, ou DT1.4 para rate ajustado)' })
        .setRequired(false)
        .setMaxLength(20)
    )
    .addStringOption(opt =>
      opt
        .setName('server')
        .setDescription('Which server/algorithm to use? (default: official)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor/algoritmo usar? (padrão: oficial)' })
        .setRequired(false)
        .addChoices(...servers.choices())
    ),

  prefix: {
    // Mesma guarda do /score: sem ela, `k!map dt` leria "dt" como mapa e
    // responderia que não deu para identificar — em vez de deixar o token
    // passar para a opção de mods.
    guards: { map: value => osu.parseBeatmapId(value) !== null },
  },

  async execute(interaction) {
    const s         = t(interaction);
    const mapInput  = interaction.options.getString('map');
    const modsInput = interaction.options.getString('mods');
    const mode      = interaction.options.getString('server') || osu.DEFAULT_MODE;

    // Sem a opção `map`, o mapa é o da mensagem respondida ou o último do canal
    // — é o que faz `/map` logo depois de um `/rs` de outra pessoa funcionar.
    const beatmapId = mapInput
      ? osu.parseBeatmapId(mapInput)
      : (await mapContext.recall(interaction))?.mapId ?? null;

    if (!beatmapId) {
      return interaction.reply({
        content: mapInput ? s.simulate_invalid_map : s.score_no_map,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Pelo mesmo motivo do /simulate: a linha de atributos e a tabela de pp são
    // calculadas em cima destes mods, então um token descartado em silêncio vira
    // um mapa que não é o que foi pedido.
    const { mods, unknown } = osu.parseModTokens(modsInput);
    if (unknown.length > 0) {
      return interaction.reply({ content: s.mods_bad(modsInput), flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      const beatmap = await osu.getBeatmap(beatmapId);
      if (!beatmap) return interaction.editReply(s.simulate_map_not_found);

      // O mapa embrulhado como play, que é a forma que o embeds/play sabe ler
      // (mesmo desenho do /score). Com os mods dentro, porque aqui eles mudam o
      // que a linha de atributos mostra: com DT a duração encolhe e o AR sobe.
      const mapaComoPlay = {
        beatmap:    { ...beatmap, id: beatmapId },
        beatmapset: beatmap.beatmapset ?? {},
        mods,
      };

      const [estrelas, meta, attrs] = await Promise.all([
        osu.getAdjustedStars(beatmapId, mods, mode),
        playEmbed.mapMeta(mapaComoPlay),
        osu.getMapAttrs(beatmapId, mods),
      ]);

      // Sem o .osu não há contagem de objetos, e sem ela não há tabela: é o
      // único pedaço obrigatório desta tela. Acontece com mapa que a API
      // oficial conhece mas cujo arquivo não baixou.
      if (!attrs?.objects) return interaction.editReply(s.map_no_file);

      // Em paralelo: são cinco chamadas ao mesmo mapa, que o processo do
      // lazer-calculator só parseia na primeira (ver lazerWorker.js).
      //
      // `classic: true` pelo mesmo motivo do /simulate: é a mecânica que
      // praticamente todo mundo joga, e é a que o resto do bot assume ao
      // calcular o pp de um FC.
      //
      // O NOME da opção é a parte que já custou caro. Ela era `lazer: false`
      // até a mecânica virar o mod CL, quando o `simulatePP` passou a ler
      // `classic` — e o nome antigo ficou aqui sem dar erro nenhum, porque uma
      // chave que ninguém desestrutura é simplesmente ignorada. O resultado é
      // que esta tabela saía em mecânica de lazer enquanto o /simulate
      // respondia em clássica: no FREEDOM DiVE +HR a 98%, 765.23pp aqui contra
      // 751.58pp lá, o mesmo mapa com dois números.
      const linhas = await Promise.all(ACCS.map(async acc => {
        const resultado = await osu.simulatePP(
          beatmapId,
          mods,
          { n100: cemPara(acc, attrs.objects) },
          mode,
          { classic: true },
        );
        return { acc, resultado };
      }));

      const tabela = linhas
        .filter(linha => Number.isFinite(linha.resultado?.pp))
        .map(({ acc, resultado }, i) =>
          // O 100% em negrito: é o teto do mapa, e o número que a pessoa
          // procura quando abre isto sem pensar muito.
          `\`${acc}%\` ${i === 0 ? `**${resultado.pp.toFixed(2)}pp**` : `${resultado.pp.toFixed(2)}pp`}`
        );

      if (tabela.length === 0) return interaction.editReply(s.simulate_calc_error);

      const maxCombo = linhas.find(l => l.resultado?.maxCombo)?.resultado.maxCombo
        ?? beatmap.max_combo ?? null;

      const atributos = await playEmbed.mapLine(mapaComoPlay, { length: meta.length });
      const descricao = [
        [atributos, maxCombo ? `\`${maxCombo}x\`` : null].filter(Boolean).join(' • '),
        `**${formatMods(stripClassic(mods))}**`,
        tabela.join(' • '),
      ].filter(Boolean).join('\n');

      const embed = new EmbedBuilder()
        .setColor(playEmbed.COLOR)
        .setTitle(playEmbed.mapTitle(mapaComoPlay, {
          stars: estrelas ?? (beatmap.difficulty_rating > 0 ? Number(beatmap.difficulty_rating).toFixed(2) : null),
        }))
        .setURL(osu.getMapUrl(beatmapId, beatmap.beatmapset_id ?? beatmap.beatmapset?.id, mode))
        .setDescription(descricao)
        .setFooter({ text: s.map_footer(osu.getModeLabel(mode), meta.status, meta.creator) });

      const capa = beatmap.beatmapset?.covers?.list ?? null;
      if (capa) embed.setThumbnail(capa);

      await interaction.editReply({ embeds: [embed] });

      // Quem viu o mapa costuma querer ver os próprios scores nele em seguida.
      mapContext.remember(interaction, beatmapId, mode);
    } catch (error) {
      logError('map', error);
      return safeEditReply(interaction, s.map_error);
    }
  },
};
