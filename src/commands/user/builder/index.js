/**
 * commands/user/builder/index.js
 * /builder — quais pedaços do embed do /recent aparecem, com prévia ao vivo.
 *
 * A escolha vale para os próximos /recent de quem a gravou (ver embedLayout.js
 * e db/users.js). A prévia é uma play fixa desenhada pelo mesmo código do
 * /recent (ver format.js), então cada clique no menu responde sem rede.
 *
 * Os componentes seguem o padrão da paginação: só quem abriu o comando mexe,
 * o coletor expira pela mesma inatividade (ver pagination.js) e, ao expirar, os
 * componentes ficam na tela desabilitados — a resposta é efêmera, e sumir com
 * eles sem aviso pareceria defeito.
 */

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags,
} = require('discord.js');
const { getEmbedLayout, setEmbedLayout, resetEmbedLayout, getScoreFormat } = require('../../../db');
const embedLayout = require('../../../embedLayout');
const osu = require('../../../osuClient');
const playEmbed = require('../../../embeds/play');
const { IDLE_MS } = require('../../../pagination');
const { t } = require('../../../i18n');
const { logError } = require('../../../lib/logger');
const { previa, JOGADOR } = require('./format');

const ID = {
  select: 'builder_select',
  save:   'builder_save',
  reset:  'builder_reset',
};

const mesmoConjunto = (a, b) => a.size === b.size && [...a].every(chave => b.has(chave));

/**
 * O embed da prévia, montado como o /recent monta o dele (ver
 * commands/osu/recent.js). Sem `setURL` e sem link no autor: o mapa e o
 * jogador do exemplo não existem, e um link levaria a uma página de erro.
 */
function embedDaPrevia(layout, { s, scoreFormat, agora, capa }) {
  const mode  = osu.DEFAULT_MODE;
  const bloco = previa(layout, { s, scoreFormat, agora, capa, mode });
  const { name, iconURL } = playEmbed.author(JOGADOR, mode, s);

  return new EmbedBuilder()
    .setAuthor({ name, iconURL })
    .setTitle(bloco.title)
    .setColor(bloco.color)
    .setThumbnail(bloco.thumbnail)
    .setDescription(bloco.description)
    .setFooter({ text: s.recent_footer(1, 1, osu.getModeLabel(mode), bloco.status, bloco.creator, '3') });
}

/**
 * O menu com os pedaços (marcados os ligados) e, abaixo, Salvar e Restaurar.
 *
 * Duas linhas de componentes, das cinco que o Discord aceita; o menu tem uma
 * opção por chave — dez, das 25 que cabem.
 */
function componentes(layout, s, desabilitado = false) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(ID.select)
    .setPlaceholder(s.builder_placeholder)
    // Zero é escolha válida: só título, grade e mods.
    .setMinValues(0)
    .setMaxValues(embedLayout.CHAVES.length)
    .setDisabled(desabilitado)
    .addOptions(embedLayout.CHAVES.map(chave => ({
      label:   s.builder_element(chave),
      value:   chave,
      default: layout.has(chave),
    })));

  const botoes = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.save)
      .setLabel(s.builder_save)
      .setStyle(ButtonStyle.Success)
      .setDisabled(desabilitado),
    new ButtonBuilder()
      .setCustomId(ID.reset)
      .setLabel(s.builder_reset)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(desabilitado),
  );

  return [new ActionRowBuilder().addComponents(menu), botoes];
}

module.exports = {
  // Só lê e grava preferência no banco local, mas a resposta é de quem chamou:
  // ninguém mais precisa ver o layout de outra pessoa sendo montado.
  defer: 'ephemeral',

  // Efêmero não existe no modo texto (ver test/slashOnly.test.js).
  prefix: { slashOnly: true },

  data: new SlashCommandBuilder()
    .setName('builder')
    .setDescription('Choose which parts of the /recent embed you see')
    .setDescriptionLocalizations({ 'pt-BR': 'Escolhe o que aparece no embed do /recent' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel]),

  async execute(interaction) {
    const s    = t(interaction);
    const dono = interaction.user.id;

    // Fixos durante toda a edição: a play de exemplo não "envelhece" a cada
    // clique, e o formato do score é o que o /recent dela usaria agora.
    const scoreFormat = getScoreFormat(dono);
    const agora = Date.now();
    const capa  = interaction.client?.user?.displayAvatarURL?.() ?? null;

    let salvo   = new Set(getEmbedLayout(dono) ?? embedLayout.CHAVES);
    let selecao = new Set(salvo);
    let nota    = null;

    const conteudo = () => [
      s.builder_intro,
      mesmoConjunto(selecao, salvo) ? null : s.builder_unsaved,
      nota,
    ].filter(Boolean).join('\n');

    const tela = () => ({
      content:    conteudo(),
      embeds:     [embedDaPrevia(selecao, { s, scoreFormat, agora, capa })],
      components: componentes(selecao, s),
    });

    const message   = await interaction.editReply(tela());
    const collector = message.createMessageComponentCollector({ idle: IDLE_MS });

    collector.on('collect', async (i) => {
      if (i.user.id !== dono) {
        return i.reply({ content: s.builder_not_yours, flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      try {
        if (i.customId === ID.select) {
          // O Discord só manda valores que estavam no menu; o filtro é para não
          // depender disso.
          selecao = new Set((i.values ?? []).filter(chave => embedLayout.CHAVES.includes(chave)));
          nota = null;
        } else if (i.customId === ID.save) {
          setEmbedLayout(dono, selecao);
          salvo = new Set(selecao);
          nota = s.builder_saved;
        } else if (i.customId === ID.reset) {
          resetEmbedLayout(dono);
          salvo = new Set(embedLayout.CHAVES);
          selecao = new Set(salvo);
          nota = s.builder_reset_done;
        } else {
          return i.deferUpdate().catch(() => {});
        }
      } catch (error) {
        logError('builder', error);
        return i.reply({ content: s.builder_error, flags: MessageFlags.Ephemeral }).catch(() => {});
      }

      await i.update(tela()).catch(error => logError('builder:update', error));
    });

    collector.on('end', () => {
      // A prévia fica como estava; só os componentes param de responder. O
      // editReply falha se a resposta já passou dos 15 minutos de vida do
      // token — aí a mensagem fica como está, e não há o que fazer.
      // O aviso de alteração não salva continua: quem não salvou precisa saber
      // que a escolha na tela não foi gravada.
      nota = s.builder_expired;
      interaction.editReply({
        content:    conteudo(),
        components: componentes(selecao, s, true),
      }).catch(() => {});
    });
  },
};
