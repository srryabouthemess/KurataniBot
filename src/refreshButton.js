/**
 * refreshButton.js
 * Um botão 🔄 sozinho, para o comando que não pagina (o /profile).
 *
 * O `paginate()` já resolve o refresh de quem tem páginas, e continua sendo o
 * caminho deles. O que falta a quem só tem UMA tela é o mesmo miolo sem o resto:
 * a checagem de dono, a trava contra clique em sequência, o erro que preserva o
 * embed e o coletor que para quando o modo texto reroda o comando. Estas regras
 * são as mesmas do paginate de propósito — quem clica não deveria notar que são
 * dois códigos.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { logError } = require('./lib/logger');
const { IDLE_MS } = require('./pagination');

function buildRow(id, refreshing) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${id}_refresh`)
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
      // Apagado durante a própria busca: clique de spam não empilha requisição
      // em cima de requisição.
      .setDisabled(refreshing),
  );
}

/**
 * Publica a resposta com o botão 🔄 e cuida dele até o coletor expirar.
 *
 * @param {object} interaction
 * @param {object} payload    o que iria no `editReply` sem o botão (embeds, files)
 * @param {object} options
 * @param {string} options.id       prefixo do customId
 * @param {object} options.strings  i18n já resolvido (aviso de dono)
 * @param {string} options.errorMessage aviso efêmero de quando o refresh falha
 * @param {() => Promise<object>} options.refresh
 *   busca dados novos e devolve o payload do `editReply` que os mostra. Lançar
 *   deixa a tela como está e avisa a pessoa; o botão volta a funcionar.
 */
async function withRefreshButton(interaction, payload, { id, strings, errorMessage, refresh }) {
  const message = await interaction.editReply({ ...payload, components: [buildRow(id, false)] });

  const collector = message.createMessageComponentCollector({ idle: IDLE_MS });

  // Mesma razão do paginate: no modo texto, editar o comando roda ele de novo
  // NA MESMA resposta, e o botão passa a ser o da execução nova.
  interaction.onSuperseded?.(() => collector.stop('superseded'));

  let refreshing = false;

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: strings.pagination_not_yours, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    // Clique extra com uma busca em voo: só confirma a interaction, para não
    // sobrar "falhou" na tela do Discord.
    if (i.customId !== `${id}_refresh` || refreshing) return i.deferUpdate().catch(() => {});

    refreshing = true;
    await i.deferUpdate().catch(() => {});
    // Feedback imediato de que começou, antes da rede responder.
    await interaction.editReply({ components: [buildRow(id, true)] }).catch(() => {});

    try {
      const next = await refresh();
      await interaction.editReply({ ...next, components: [buildRow(id, false)] });
    } catch (error) {
      logError('refresh', error);
      // Embed atual preservado — nada de sobrescrever com dado inválido.
      await interaction.editReply({ components: [buildRow(id, false)] }).catch(() => {});
      await i.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
    } finally {
      refreshing = false;
    }
  });

  collector.on('end', (_coletados, motivo) => {
    // Superado, o botão na tela já é o da execução nova.
    if (motivo === 'superseded') return;
    interaction.editReply({ components: [] }).catch(() => {});
  });

  return message;
}

module.exports = { withRefreshButton };
