/**
 * pagination.js
 * Navegação por páginas com os botões ◀️ ▶️.
 *
 * O `/recent`, o `/topplays` e o `/score` tinham cada um a sua cópia disto —
 * mesmo par de botões, mesmo cache de embed, mesmo coletor, mesma checagem de
 * dono, mesmo encerramento. Eram três lugares para corrigir cada defeito de
 * paginação, e as três cópias já tinham divergido em detalhes.
 *
 * Aqui o comando só diz quantas páginas existem e como montar uma; o resto é
 * igual para todos.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

// Inatividade, não tempo absoluto: o contador reinicia a cada clique, então uma
// pessoa navegando devagar não perde os botões no meio.
const IDLE_MS = 120_000;

function buildRow(id, page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${id}_prev`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`${id}_next`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === totalPages - 1),
  );
}

/**
 * Publica a primeira página e cuida da navegação até o coletor expirar.
 *
 * @param {object}   interaction
 * @param {object}   options
 * @param {string}   options.id           prefixo do customId dos botões
 * @param {number}   options.totalPages
 * @param {(page: number) => Promise<import('discord.js').EmbedBuilder>} options.buildEmbed
 * @param {object}   options.strings      i18n já resolvido (para o aviso de dono)
 * @param {(page: number) => void} [options.onPage]   chamado a cada página exibida
 * @param {(page: number) => void} [options.prefetch] aquece a página seguinte
 */
async function paginate(interaction, { id, totalPages, buildEmbed, strings, onPage, prefetch }) {
  // Memoiza a página montada: voltar para uma anterior não deve refazer o
  // enriquecimento nem o cálculo de PP.
  const cache = new Map();

  async function getEmbed(page) {
    if (!cache.has(page)) cache.set(page, await buildEmbed(page));
    // Fora do buildEmbed de propósito: uma página já vista não passa por lá de
    // novo, mas ainda precisa atualizar o contexto de mapa do canal.
    onPage?.(page);
    return cache.get(page);
  }

  /**
   * Adianta o trabalho da página seguinte enquanto a pessoa lê a atual.
   *
   * O gargalo de uma página nova não é CPU, é o limite de download de `.osu`
   * (o balde mais apertado do rate limiter). Sem esperar por isto: se der
   * errado, o clique no botão simplesmente faz o caminho normal.
   */
  function warmNext(page) {
    if (!prefetch || page + 1 >= totalPages) return;
    Promise.resolve(prefetch(page + 1)).catch(() => {});
  }

  let page = 0;
  const embed = await getEmbed(page);
  const message = await interaction.editReply({
    embeds: [embed],
    components: totalPages > 1 ? [buildRow(id, page, totalPages)] : [],
  });

  if (totalPages <= 1) return message;
  warmNext(page);

  const collector = message.createMessageComponentCollector({ idle: IDLE_MS });

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: strings.pagination_not_yours, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    if (i.customId === `${id}_prev` && page > 0) page--;
    if (i.customId === `${id}_next` && page < totalPages - 1) page++;

    await i.deferUpdate();
    const next = await getEmbed(page);
    await interaction.editReply({ embeds: [next], components: [buildRow(id, page, totalPages)] });
    warmNext(page);
  });

  collector.on('end', () => {
    interaction.editReply({ components: [] }).catch(() => {});
  });

  return message;
}

module.exports = { paginate, IDLE_MS };
