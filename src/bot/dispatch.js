/**
 * bot/dispatch.js
 * O defer que todo comando recebe antes do `execute`.
 *
 * ── O problema ────────────────────────────────────────────────────────────────
 * O Discord espera a primeira resposta de uma interação por 3s. Cada comando
 * chamava o próprio `deferReply`, e um comando novo que esquecesse a linha
 * funcionava no teste local (API rápida, cache quente) e estourava em produção
 * como "O aplicativo não respondeu". Aqui o defer passa a ser o padrão, e o
 * comando é que declara quando não quer.
 *
 * ── A declaração ──────────────────────────────────────────────────────────────
 * O módulo do comando pode exportar `defer`:
 *
 *   (ausente) / true   defer público antes do execute. O execute responde com
 *                      `editReply`/`followUp` — `reply` e `deferReply` lançam
 *                      InteractionAlreadyReplied.
 *   'ephemeral'        o mesmo, efêmero.
 *   false              nenhum defer: o comando responde direto ou faz o
 *                      próprio defer.
 *
 * ── Por que a maioria dos comandos atuais é `defer: false` ────────────────────
 * Quase todos validam a entrada ANTES do defer e respondem o erro em efêmero
 * (jogador sem link, mapa inválido, mods que não existem). Depois de um defer
 * público a resposta é pública e não vira efêmera: o erro de uma pessoa
 * passaria a aparecer no canal para todo mundo. Esses comandos seguem com o
 * próprio defer até a validação sair do execute.
 *
 * Os administrativos efêmeros (/role, /wipe, /scorewipe, /moderate,
 * /invitecode) usam 'ephemeral': o erro deles já era efêmero, então sai igual,
 * e a checagem de privilégio (HTTP na API do Daycore) e a do Redis/MySQL, que
 * vinham antes do defer, passam a correr com a interação já respondida.
 *
 * O mesmo vale para o modo texto: o adaptador (prefix/MessageCommand.js) trata
 * o `deferReply` como "digitando..." e ignora o efêmero, então a declaração é
 * respeitada pelos dois caminhos sem código a mais.
 */

const { MessageFlags } = require('discord.js');
const scoreStore = require('../scoreStore');

const MODOS = new Set([true, false, 'ephemeral']);

/** A declaração é uma das que o despacho entende? Ausente vale. */
function deferValido(command) {
  return command.defer === undefined || MODOS.has(command.defer);
}

/**
 * Faz o defer que o comando declarou e roda o `execute`.
 *
 * Um defer que falha (interação expirada, já respondida) lança daqui, e o
 * `execute` não roda: é o mesmo caminho de quando o `deferReply` do próprio
 * comando lançava — cai no catch de quem despacha (index.js e
 * prefixCommands.js), que loga e tenta avisar a pessoa.
 */
async function executar(command, interaction) {
  const defer = command.defer ?? true;

  if (defer === 'ephemeral') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } else if (defer) {
    await interaction.deferReply();
  }

  // O escopo é o que põe a gravação dos scores DEPOIS da resposta: o que o
  // osuClient registrar durante o `execute` só vai para o banco quando ele
  // terminar, e ele termina depois do `editReply` (ver scoreStore.js).
  return scoreStore.escopo(() => command.execute(interaction));
}

module.exports = { executar, deferValido };
