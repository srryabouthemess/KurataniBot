/**
 * /matchcost — o desempenho de cada jogador numa partida multiplayer.
 *
 * Porte do comando homônimo do Bathbot: a fórmula está em logic.js, e sai
 * idêntica à de lá de propósito (ver o cabeçalho de lá). O que muda é de onde
 * vem a partida — o Bancho pela API v2 (bancho.js) e o Daycore pelo MySQL do
 * servidor (daycore.js), que o bancho.py não expõe por API nenhuma.
 *
 * Link diz o servidor; id sozinho usa o servidor preferido de quem chamou,
 * como nos outros comandos. Servidor privado sem as tabelas de partida (o
 * Akatsuki, o EZPP) responde que o comando não está disponível lá, em vez de
 * procurar a partida no lugar errado.
 */

const { SlashCommandBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../../../osuClient');
const servers = require('../../../servers');
const { getLink } = require('../../../db');
const { resolveServer } = require('../../../userLink');
const { paginate } = require('../../../pagination');
const { t } = require('../../../i18n');
const { logError } = require('../../../lib/logger');
const { safeEditReply } = require('../../../replies');
const { parseMatchInput, calcularMatchCost, DEFAULTS } = require('./logic');
const bancho = require('./bancho');
const daycore = require('./daycore');
const { montarEmbeds } = require('./embed');

/**
 * O servidor cujas partidas estão no MySQL: o privado do `SERVERS` do `.env`,
 * que é o mesmo dono do DAYCORE_MYSQL_* (ver o `private` em servers.js).
 */
function chaveDoDaycore() {
  const key = servers.resolveKey('private');
  return key ? servers.rootKey(key) : null;
}

/**
 * O MySQL respondeu? Depois do `deferReply`, e não antes como no /invitecode:
 * o `connectTimeout` é de 5s e a interação só espera 3s pela primeira resposta
 * — com o banco lento, a pessoa veria "a interação falhou" em vez do aviso.
 */
async function mysqlNoAr(interaction, s, label) {
  const check = await daycore.checkConnection();
  if (check.ok) return true;

  logError('matchcost:mysql', new Error(check.error ?? check.reason));
  await interaction.editReply(s.matchcost_unreachable(label));
  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matchcost')
    .setDescription('Performance rating of each player in a multiplayer match')
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra o desempenho de cada jogador numa partida multiplayer' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(option =>
      option
        .setName('match')
        .setDescription('Match link or id')
        .setDescriptionLocalizations({ 'pt-BR': 'Link ou id da partida' })
        .setRequired(true)
        .setMaxLength(200)
    )
    .addIntegerOption(option =>
      option
        .setName('warmups')
        .setDescription('How many maps at the start to ignore (default: 0)')
        .setDescriptionLocalizations({ 'pt-BR': 'Quantos mapas do começo ignorar (padrão: 0)' })
        .setMinValue(0)
    )
    .addIntegerOption(option =>
      option
        .setName('skip_last')
        .setDescription('How many maps at the end to ignore (default: 0)')
        .setDescriptionLocalizations({ 'pt-BR': 'Quantos mapas do fim ignorar (padrão: 0)' })
        .setMinValue(0)
    )
    .addNumberOption(option =>
      option
        .setName('ez_mult')
        .setDescription('Multiplier for EZ scores (suggested: 1.0-2.0)')
        .setDescriptionLocalizations({ 'pt-BR': 'Multiplicador dos scores com EZ (sugerido: 1.0-2.0)' })
        .setMaxValue(100)
    ),

  async execute(interaction) {
    const s = t(interaction);
    const input = interaction.options.getString('match');
    const opcoes = {
      warmups:  interaction.options.getInteger('warmups') ?? DEFAULTS.warmups,
      skipLast: interaction.options.getInteger('skip_last') ?? DEFAULTS.skipLast,
      ezMult:   interaction.options.getNumber('ez_mult') ?? DEFAULTS.ezMult,
    };

    const alvo = parseMatchInput(input, servers.all().filter(server => !server.relax));
    if (!alvo) {
      return interaction.reply({ content: s.matchcost_bad_input, flags: MessageFlags.Ephemeral });
    }

    // Link manda; id sozinho vai para o servidor preferido (sem opção
    // `server:` no comando, é a preferência do /link ou o padrão do bot). A
    // variante RX é o mesmo servidor — partida não tem modo.
    const key = alvo.key ?? servers.rootKey(resolveServer(interaction, 'server', null));
    const server = servers.get(key);
    const ehBancho = key === servers.OFFICIAL_KEY;

    if (!ehBancho && key !== chaveDoDaycore()) {
      return interaction.reply({ content: s.matchcost_unsupported(server.label), flags: MessageFlags.Ephemeral });
    }

    if (!ehBancho && !daycore.isConfigured()) {
      return interaction.reply({ content: s.matchcost_unconfigured(server.label), flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();

    try {
      if (!ehBancho && !(await mysqlNoAr(interaction, s, server.label))) return;

      let partida;

      if (ehBancho) {
        const r = await bancho.buscarPartida(alvo.id);
        if (r.erro === 'private') return interaction.editReply(s.matchcost_private);
        if (r.erro) return interaction.editReply(s.matchcost_not_found(alvo.id));
        partida = bancho.normalizarPartida(r.partida);
      } else {
        // Só para a regra de partida privada: quem jogou nela pode ver.
        const link = getLink(interaction.user.id, key);
        const quem = link ? { id: link.osu_id, name: link.osu_user } : null;

        const r = await daycore.buscarPartida(alvo.id, quem);
        if (r.erro) return interaction.editReply(s.matchcost_not_found(alvo.id));
        partida = daycore.normalizarPartida(r.linhas, { avatars: server.avatars });
      }

      const resultado = calcularMatchCost(partida, opcoes);
      const embeds = montarEmbeds({
        partida,
        resultado,
        server,
        id: alvo.id,
        opcoes,
        urlDoJogador: userId => osu.getUserUrl(userId, key),
      }, s);

      await paginate(interaction, {
        id: 'matchcost',
        totalPages: embeds.length,
        buildEmbed: page => embeds[page],
        strings: s,
      });
    } catch (error) {
      logError('matchcost', error);
      return safeEditReply(interaction, s.matchcost_error);
    }
  },
};
