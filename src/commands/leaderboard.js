/**
 * commands/leaderboard.js
 * O ranking de pp de um servidor, dez colocados por página.
 *
 * ── Por que a lista inteira vem de uma vez ────────────────────────────────────
 * O /topplays busca 100 plays e enriquece só a página exibida, porque cada play
 * custa requisições extras (estrelas, pp de FC, metadados do mapa). Aqui não há
 * nada a enriquecer: a resposta do ranking já traz tudo que a linha mostra.
 *
 * E o limite das APIs é por REQUISIÇÃO, não por linha de resposta: as 100
 * posições cabem num parâmetro (`limit=100` no bancho.py, `l=100` no Ripple),
 * então buscá-las custa UMA chamada nos servidores privados e duas no oficial,
 * cuja página é fixa em 50. Medido pelos contadores do rateLimiter, uma execução
 * de cada, processo novo:
 *
 *   /leaderboard  Bancho      2 requisições  (+1 de OAuth, que vale ~1h)
 *   /leaderboard  Daycore     1
 *   /leaderboard  Akatsuki    1
 *   /topplays     Daycore    11              ← uma página, para comparar
 *
 * Contra baldes de 8/s (`osuApi`) e 10/s por servidor privado, nenhuma das
 * medições esperou na fila.
 *
 * Buscar tudo de uma vez é o que gasta MENOS. Uma requisição por clique em ▶️
 * daria até dez para quem folheia até o fim, e repetiria a busca ao voltar para
 * uma página já vista; assim, folhear custa zero — e o `prefetch` da paginação
 * não tem serventia nenhuma. Repetido dentro do TTL do cache, o comando inteiro
 * custa zero: 3, 0 e 0 requisições em três execuções seguidas.
 *
 * ── O número da esquerda é a POSIÇÃO NA LISTA ────────────────────────────────
 * E não o rank que a API mandou, que nem sempre existe e nem sempre significa o
 * mesmo: o bancho.py não devolve rank; o osu! oficial e o Ripple devolvem o
 * rank GLOBAL mesmo quando a consulta é de um país só (o #1 do Brasil chega
 * como #51). Contar a posição é o único jeito de a coluna dizer a mesma coisa
 * nos três — ver os adaptadores em osu/.
 */

const { SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType, InteractionContextType, MessageFlags } = require('discord.js');
const osu = require('../osuClient');
const servers = require('../servers');
const { getPreferredServer } = require('../db');
const { paginate } = require('../pagination');
const { ppLegivel } = require('../embeds/play');
const { md } = require('../markdown');
const { t } = require('../i18n');
const { logError } = require('../logger');
const { safeEditReply } = require('../replies');

const PAGE_SIZE   = 10;
// Teto dos três adaptadores: o bancho.py recusa acima disso (422) e o Ripple
// serve no máximo isso por página. Dez páginas de dez.
const FETCH_LIMIT = 100;

const COLOR = 0xff66aa;

/** Código ISO de duas letras — o formato que os três servidores aceitam. */
const PAIS = /^[A-Za-z]{2}$/;

/**
 * 'BR' → 🇧🇷, montado a partir dos indicadores regionais.
 *
 * Não é `:flag_br:` porque o atalho depende da tabela de emojis do Discord: um
 * código que não esteja lá apareceria como texto cru no meio da linha. Somar os
 * dois code points funciona para qualquer par de letras.
 *
 * 'XX' é o que o bancho.py grava para conta sem país, e viraria 🇽🇽 — uma
 * bandeira que não existe. Sem país, a linha simplesmente não tem bandeira.
 */
function bandeira(codigo) {
  const cc = String(codigo ?? '').toUpperCase();
  if (!PAIS.test(cc) || cc === 'XX') return '';
  return String.fromCodePoint(...[...cc].map(letra => 0x1F1E6 + letra.charCodeAt(0) - 65));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription("Show a server's pp ranking")
    .setDescriptionLocalizations({ 'pt-BR': 'Mostra o ranking de pp de um servidor' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .addStringOption(option =>
      option
        .setName('server')
        .setDescription('Which server to use? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(...servers.choices())
    )
    .addStringOption(option =>
      option
        .setName('country')
        .setDescription('Country code, two letters (ex: BR)')
        .setDescriptionLocalizations({ 'pt-BR': 'Código do país, duas letras (ex: BR)' })
        .setRequired(false)
    ),

  async execute(interaction) {
    const s = t(interaction);

    // Mesma prioridade do resolvePlayer (userLink.js) — opção, preferido, padrão
    // —, mas sem exigir link: um ranking não é de ninguém, e cobrar `/link set`
    // para ver a lista do servidor não faria sentido.
    //
    // O `resolveKey` traduz nome antigo para a chave atual antes de a `mode`
    // seguir adiante: sem isso, `private` e `daycore` seriam dois pedidos
    // distintos para o mesmo servidor, cada um com sua entrada no cache.
    const escolhido = interaction.options.getString('server')
      || getPreferredServer(interaction.user.id)
      || osu.DEFAULT_MODE;
    const mode = servers.resolveKey(escolhido) ?? osu.DEFAULT_MODE;

    const paisBruto = interaction.options.getString('country');
    if (paisBruto && !PAIS.test(paisBruto.trim())) {
      return interaction.reply({ content: s.leaderboard_invalid_country, flags: MessageFlags.Ephemeral });
    }
    const pais = paisBruto ? paisBruto.trim().toUpperCase() : null;

    const label = osu.getModeLabel(mode);
    await interaction.deferReply();

    try {
      const entradas = await osu.getLeaderboard(mode, { limit: FETCH_LIMIT, country: pais });

      if (entradas.length === 0) {
        return interaction.editReply(
          pais ? s.leaderboard_none_country(label, pais) : s.leaderboard_none(label)
        );
      }

      const totalPages = Math.ceil(entradas.length / PAGE_SIZE);

      /**
       * Duas linhas por colocado, como o item de lista de uma play: a primeira
       * diz quem é, a segunda o que ele tem. Os números começam sempre na mesma
       * coluna, e não depois de um nick de comprimento variável.
       *
       * 'plays' fica em inglês pela mesma razão que os rótulos do /compare:
       * é jargão de osu! e sai igual em qualquer idioma do jogo.
       */
      function linha(entrada, posicao) {
        const flag = bandeira(entrada.country);
        // Nome de jogador é texto de terceiro em posição de link (markdown.js).
        // Sem id não há perfil para onde apontar, e o nome sai sem link em vez
        // de virar um `/users/null` clicável.
        const nome = entrada.id
          ? `[${md(entrada.username)}](${osu.getUserUrl(entrada.id, mode)})`
          : md(entrada.username);

        // A acurácia também passa pelo idioma, e não pelo `toFixed(2)` que o
        // embed de play usa: aqui ela divide a linha com um pp de cinco dígitos
        // e com o número de plays, os dois já formatados assim. Em pt-BR o
        // toFixed daria "32.138,70pp • 98.26%" — dois separadores decimais
        // diferentes na mesma linha.
        const acc = entrada.accuracy.toLocaleString(s.locale, {
          minimumFractionDigits: 2, maximumFractionDigits: 2,
        });

        return `**#${posicao}** ${flag ? `${flag} ` : ''}${nome}\n` +
               `${ppLegivel(entrada.pp, s.locale)}pp • ${acc}% • ` +
               `${entrada.playCount.toLocaleString(s.locale)} plays`;
      }

      function buildEmbed(page) {
        const inicio = page * PAGE_SIZE;
        const blocos = entradas
          .slice(inicio, inicio + PAGE_SIZE)
          .map((entrada, i) => linha(entrada, inicio + i + 1));

        return new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(pais ? s.leaderboard_title_country(label, pais) : s.leaderboard_title(label))
          .setDescription(blocos.join('\n'))
          .setFooter({ text: s.leaderboard_footer(page + 1, totalPages, label) });
      }

      // Sem `prefetch`: a lista inteira já está em memória, então não há página
      // seguinte para aquecer.
      await paginate(interaction, {
        id: 'leaderboard',
        totalPages,
        buildEmbed,
        strings: s,
      });
    } catch (error) {
      logError('leaderboard', error);
      return safeEditReply(interaction, s.leaderboard_error);
    }
  },

  // Exportada para o teste: a soma dos code points é fácil de errar por um, e o
  // resultado ainda seria uma bandeira — só que de outro país.
  bandeira,
};
