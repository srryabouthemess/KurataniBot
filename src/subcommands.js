/**
 * subcommands.js
 * Guarda contra subcomando sem tratamento no `execute`.
 *
 * ── O problema ────────────────────────────────────────────────────────────────
 * Comando com subcomando costuma ser escrito como uma escada de `if (sub === …)`,
 * e o último ramo acaba virando o "tudo que sobrou". Isso é invisível enquanto o
 * código e o builder concordam — e o dia em que alguém acrescenta um
 * `addSubcommand` e esquece o ramo, o comando faz **outra coisa** em silêncio:
 *
 *   /link      caía no `set`, que escreve — criava vínculo sem ninguém pedir;
 *   /nominate  caía no `add`, que registra nomeação e pode aplicar no servidor;
 *   /moderate  caía no `else` do restrict, que publica um UNRESTRICT no Redis;
 *   /staff     caía no `register`, emitindo código de vínculo;
 *   /language  não caía em lugar nenhum: o execute terminava sem responder, a
 *              interação expirava e quem usou via "O aplicativo não respondeu".
 *
 * Pelo Discord nada disso acontece — ele só envia subcomando declarado —, e o
 * parser do modo texto também recusa antes de chegar no execute (ver
 * prefix/parseArgs.js). O caso real é o código divergir da declaração.
 *
 * ── Por que deriva do builder ─────────────────────────────────────────────────
 * A lista de subcomandos conhecidos sai do `data.toJSON()` do próprio comando,
 * e não de um array escrito à mão ao lado. Uma lista à mão seria mais uma coisa
 * para esquecer de atualizar — teria exatamente o defeito que esta guarda existe
 * para pegar.
 *
 * ── São DUAS camadas, e a daqui é a menos importante ──────────────────────────
 * Há dois jeitos de o código e a declaração divergirem, e eles pedem guardas
 * diferentes:
 *
 *   1. subcomando que o builder NÃO declara chega ao execute. Só acontece por
 *      um chamador que não é o Discord nem o parser de texto (um harness, um
 *      teste). É este que a função abaixo pega.
 *
 *   2. subcomando DECLARADO no builder sem ramo no execute. É o caso provável —
 *      alguém acrescenta o `addSubcommand` e esquece o `if` —, e a função abaixo
 *      **não pega**: para ela o subcomando é conhecido, porque está declarado.
 *
 * O que pega o caso 2 é uma guarda explícita no ramo de queda de cada comando
 * (`if (sub !== 'set') throw`, `if (sub !== 'add') throw`, e assim por diante),
 * que existe em todos os cinco. A daqui vale por falhar CEDO — antes de resolver
 * privilégio, de conferir o Redis e do deferReply —, o que importa nos
 * administrativos, onde o ramo de queda fica depois de tudo isso.
 */

const { ApplicationCommandOptionType: OptionType } = require('discord.js');

// Memoiza por comando: o toJSON() do builder monta objeto novo a cada chamada, e
// isto roda uma vez por invocação de comando.
const _conhecidos = new WeakMap();

function conhecidosDe(command) {
  let nomes = _conhecidos.get(command);
  if (nomes) return nomes;

  const options = command.data.toJSON().options ?? [];
  nomes = new Set(
    options.filter(o => o.type === OptionType.Subcommand).map(o => o.name)
  );

  _conhecidos.set(command, nomes);
  return nomes;
}

/**
 * O subcomando pedido, ou lança se ele não estiver declarado no builder.
 *
 * Lançar em vez de responder é deliberado: o destino é o `catch` do
 * interactionCreate (index.js), que põe a causa no log COM o nome do subcomando
 * e responde o erro genérico traduzido. Uma resposta bonita aqui esconderia do
 * log justamente a divergência que precisa ser corrigida.
 *
 * @param {object} command o módulo do comando (`module.exports` dele)
 * @param {object} interaction
 * @returns {string}
 */
function exigirSubcomando(command, interaction) {
  const sub = interaction.options.getSubcommand();
  if (conhecidosDe(command).has(sub)) return sub;

  throw new Error(`/${command.data.name}: subcomando sem tratamento: "${sub}"`);
}

module.exports = { exigirSubcomando, conhecidosDe };
