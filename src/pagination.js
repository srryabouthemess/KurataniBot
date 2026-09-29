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
const { logError } = require('./lib/logger');

// Inatividade, não tempo absoluto: o contador reinicia a cada clique, então uma
// pessoa navegando devagar não perde os botões no meio.
const IDLE_MS = 120_000;

function buildRow(id, page, totalPages, { onRefresh, refreshing } = {}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${id}_prev`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
  );

  // Só existe quando o comando passa `onRefresh` — o /score continua com o par
  // de botões de sempre até decidir pedir o refresh também.
  if (onRefresh) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${id}_refresh`)
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
        // Desabilitado durante a própria busca — clique de spam não empilha
        // requisição em cima de requisição.
        .setDisabled(!!refreshing),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${id}_next`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === totalPages - 1),
  );

  return row;
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
 * @param {(page: number) => Promise<void|{totalPages: number}>} [options.onRefresh]
 *   busca dados novos e atualiza o estado de onde `buildEmbed` lê. Sem isto o
 *   botão 🔄 nem aparece — e com ele aparece mesmo com uma página só.
 *
 *   Devolvendo nada, só a página atual foi renovada (ex: o /rs troca a play
 *   correspondente no array já buscado) e só ela sai do cache. Devolvendo
 *   `{ totalPages }`, a lista INTEIRA foi recarregada (ex: o /topplays, onde uma
 *   play nova muda a ordem, as posições e até o número de páginas): o cache todo
 *   é descartado e a página atual é presa ao novo limite.
 *
 *   Erros aqui não derrubam a página: o embed atual fica como está e a pessoa
 *   recebe um aviso discreto. Quem lança deve fazê-lo ANTES de mexer no estado.
 * @param {string} [options.refreshError] aviso do refresh que falhou, quando o
 *   `strings.pagination_refresh_error` ("essa play") não serve ao comando
 */
async function paginate(interaction, {
  id, totalPages, buildEmbed, strings, onPage, prefetch, onRefresh, refreshError,
}) {
  // Memoiza a página montada: voltar para uma anterior não deve refazer o
  // enriquecimento nem o cálculo de PP.
  const cache = new Map();

  // Muda a cada recarga completa (ver `onRefresh`). Um embed que começou a ser
  // montado antes dela lê o estado antigo, e guardá-lo devolveria à tela, na
  // próxima visita, exatamente o que o refresh acabou de trocar.
  let geracao = 0;

  async function getEmbed(page) {
    if (!cache.has(page)) {
      const g = geracao;
      const montado = await buildEmbed(page);
      if (g !== geracao) return montado;
      cache.set(page, montado);
    }
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
  // true enquanto um 🔄 está em voo — trava o próprio botão pra clique de spam
  // não empilhar requisição em cima de requisição (ver o ramo `_refresh`).
  let refreshing = false;
  const row = (p) => buildRow(id, p, totalPages, { onRefresh, refreshing });

  // Com refresh, a linha aparece até numa página só: ◀️ e ▶️ ficam apagados e o
  // 🔄 é o que sobra para usar. Sem refresh, uma página só continua sem botões.
  const comBotoes = () => totalPages > 1 || !!onRefresh;

  const embed = await getEmbed(page);
  const message = await interaction.editReply({
    embeds: [embed],
    components: comBotoes() ? [row(page)] : [],
  });

  if (!comBotoes()) return message;
  warmNext(page);

  const collector = message.createMessageComponentCollector({ idle: IDLE_MS });

  // No modo texto, editar a mensagem do comando roda ele de novo na MESMA
  // resposta (ver prefixCommands.js). Os botões passam a ser da execução nova,
  // e este coletor precisa parar — senão os dois responderiam a cada clique.
  interaction.onSuperseded?.(() => collector.stop('superseded'));

  // Cliques seguidos rodam handlers concorrentes: o coletor não espera um
  // terminar para entregar o próximo. Sem saber quem é o mais recente, um
  // handler antigo que demora podia sobrescrever a tela com uma página velha,
  // e — pior — um que falhasse revertia o cursor por cima do avanço de outro
  // que tinha dado certo. O contador diz quem ainda manda.
  let clique = 0;

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({ content: strings.pagination_not_yours, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    if (i.customId === `${id}_refresh`) {
      if (!onRefresh) return i.deferUpdate().catch(() => {});
      // Já tem uma busca em andamento: o clique extra não dispara outra —
      // só confirma a interaction pra não sobrar "falhou" na tela do Discord.
      if (refreshing) return i.deferUpdate().catch(() => {});

      refreshing = true;
      const meu = ++clique;
      await i.deferUpdate().catch(() => {});
      // Feedback imediato de que o refresh começou, antes da rede responder.
      await interaction.editReply({ components: [row(page)] }).catch(() => {});

      let fresh = null;
      let failed = false;
      let recarregou = false;
      try {
        // O comando atualiza o estado de onde `buildEmbed` lê (ex: substitui
        // a play no array já buscado); a página em cache não pode sobreviver
        // a isso, senão o refresh mostraria o mesmo dado de antes.
        const recarga = await onRefresh(page);

        if (recarga?.totalPages !== undefined) {
          if (!Number.isInteger(recarga.totalPages) || recarga.totalPages < 1) {
            throw new Error(`refresh devolveu totalPages inválido: ${recarga.totalPages}`);
          }
          // A lista inteira mudou: nenhuma página em cache vale, e a atual pode
          // nem existir mais (o top encolheu, ou o filtro passou a pegar menos).
          recarregou = true;
          geracao++;
          cache.clear();
          totalPages = recarga.totalPages;
          page = Math.min(page, totalPages - 1);
        } else {
          cache.delete(page);
        }

        fresh = await getEmbed(page);
      } catch (error) {
        logError('pagination:refresh', error);
        failed = true;
      }

      refreshing = false;
      // Quem navegou pra outra página enquanto isto buscava já viu a página
      // certa por outro handler — nada aqui deveria sobrescrever a tela dela.
      // Exceto numa recarga completa: aí o dado na tela, seja de que página for,
      // é o antigo, e o cursor já foi preso ao limite novo.
      if (meu !== clique && !recarregou) return;

      if (failed) {
        // Embed atual preservado — nada de sobrescrever com dado inválido.
        await interaction.editReply({ components: [row(page)] }).catch(() => {});
        await i
          .followUp({
            content: refreshError ?? strings.pagination_refresh_error,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      } else {
        await interaction.editReply({ embeds: [fresh], components: [row(page)] }).catch(() => {});
      }
      return;
    }

    // Guardado antes de mexer no cursor: montar a página seguinte faz rede e
    // cálculo de PP, e pode falhar. Sem voltar atrás, o `page` ficaria numa
    // página que nunca chegou à tela e o clique seguinte partiria do lugar
    // errado — pular uma página a cada falha.
    const shown = page;
    const meu   = ++clique;

    if (i.customId === `${id}_prev` && page > 0) page--;
    if (i.customId === `${id}_next` && page < totalPages - 1) page++;

    await i.deferUpdate().catch(() => {});

    try {
      const g = geracao;
      let next = await getEmbed(page);
      // Uma recarga completa terminou enquanto esta página era montada: o que
      // saiu é do estado antigo, e a página pode ter deixado de existir.
      if (g !== geracao) {
        page = Math.min(page, totalPages - 1);
        next = await getEmbed(page);
      }
      // Outro clique assumiu enquanto esta página era montada: quem chegou
      // depois é que representa o que a pessoa quer ver agora.
      if (meu !== clique) return;

      await interaction.editReply({ embeds: [next], components: [row(page)] });
      warmNext(page);
    } catch (error) {
      // Sem este catch a promise do handler rejeitava solta: o clique já tinha
      // sido confirmado pelo deferUpdate, então a pessoa via a mensagem parada
      // sem nenhum aviso, e o erro só aparecia no unhandledRejection global.
      logError('pagination', error);
      if (meu !== clique) return;

      // Presa ao limite atual: uma recarga completa pode ter encolhido a lista
      // enquanto esta página falhava.
      page = Math.min(shown, totalPages - 1);
      // A página em cache não falha de novo; devolve os botões ao estado certo.
      await interaction
        .editReply({ components: [row(page)] })
        .catch(() => {});
    }
  });

  collector.on('end', (_coletados, motivo) => {
    // Superado, os botões na tela já são os da execução nova.
    if (motivo === 'superseded') return;
    interaction.editReply({ components: [] }).catch(() => {});
  });

  return message;
}

module.exports = { paginate, IDLE_MS };
