/**
 * userLink.js
 * Resolve "qual jogador e qual servidor usar" para os comandos.
 *
 * O usuário pode ter um link por conta (Bancho e Daycore são cadastros
 * distintos, com nicks potencialmente diferentes) e um servidor preferido,
 * usado quando o comando não especifica um.
 *
 * Prioridade do SERVIDOR:
 *   1. Opção `server` do comando
 *   2. Servidor preferido do usuário (definido pelo último /link set),
 *      com o modo preferido aplicado sobre ele (ver `comModoPreferido`)
 *   3. DEFAULT_MODE
 *
 * Prioridade do JOGADOR:
 *   1. Nome passado na opção `player` do comando
 *   2. Link do usuário para o servidor resolvido acima
 *   3. Erro — o usuário não tem link para aquele servidor especificamente
 */

const { getLink, getPreferredServer, getPreferredModo } = require('./db');
const { t } = require('./i18n');
const servers = require('./servers');
const osu = require('./osuClient');

/**
 * O servidor preferido, já apontando para VN ou RX conforme o modo preferido.
 *
 * O `/link` pergunta as duas coisas separadamente — o servidor numa opção, o
 * modo (VN/RX/VN+RX) em outra —, mas o resto do bot trabalha com UMA chave, e
 * `daycore_rx` é a forma de dizer "Daycore, leaderboard de Relax". Esta função
 * é a costura entre os dois: sem ela, escolher RX no `/link` não teria efeito
 * em nenhum comando, porque só o `/recent` sabe o que fazer com um modo.
 *
 * `both` não vira chave nenhuma: combinar as duas listas é coisa que só o
 * `/recent` e o `/rs` fazem, e eles leem a preferência direto. Para todos os
 * outros comandos, que mostram um leaderboard só, `both` cai no vanilla.
 */
function comModoPreferido(discordId) {
  const preferido = getPreferredServer(discordId);
  if (!preferido) return null;

  const modo = getPreferredModo(discordId);
  if (modo === 'vn' || modo === 'both') return servers.rootKey(preferido);
  if (modo === 'rx') return servers.relaxKey(preferido) ?? preferido;

  // Sem preferência de modo, a chave salva vale como está — inclusive o
  // `daycore_rx` de quem escolheu RX quando o `server:` ainda listava as
  // variantes, que continua valendo sem precisar reconfigurar nada.
  return preferido;
}

/**
 * @returns {{username: string|number, displayName?: string, mode: string, fromLink: boolean}
 *           | {error: string}}
 *   Em caso de falha devolve `{ error }` com a mensagem já traduzida — assim
 *   os comandos não precisam decidir entre "sem link nenhum" e "sem link para
 *   este servidor", que exigem orientações diferentes.
 */
function resolvePlayer(interaction, playerOptionName = 'player', serverOptionName = 'server') {
  const manualPlayer = interaction.options.getString(playerOptionName);
  const manualServer = interaction.options.getString(serverOptionName);

  const mode = manualServer
    || comModoPreferido(interaction.user.id)
    || osu.DEFAULT_MODE;

  if (manualPlayer) {
    return { username: manualPlayer, displayName: manualPlayer, mode, fromLink: false };
  }

  const link = getLink(interaction.user.id, mode);
  if (!link) {
    const s = t(interaction);
    return { error: s.no_link_for_server(osu.getModeLabel(mode)) };
  }

  // Prefere o ID numérico quando disponível: sobrevive a troca de nick e, no
  // Daycore, evita a chamada extra de resolvePlayerId a cada comando.
  return {
    username: link.osu_id ?? link.osu_user,
    displayName: link.osu_user,
    mode,
    fromLink: true,
  };
}

/**
 * O jogador e os scores dele, numa viagem só quando dá.
 *
 * Todo comando de jogador fazia `getUser(nome)` e só então `getBestScores(user.id)`
 * — a segunda esperando a primeira porque precisa do id. Só que quem usou `/link`
 * **já entrega o id**: o `resolvePlayer` acima devolve `link.osu_id` de propósito,
 * justamente para não pagar um `resolvePlayerId` a cada comando. Nesse caso a
 * espera pela primeira chamada não comprava nada.
 *
 * Medido em três rodadas, do perfil até a lista de 100 top plays:
 *
 *   Bancho    638ms em sequência  →  367ms juntas   (-271ms)
 *   Daycore   388ms em sequência  →  175ms juntas   (-213ms)
 *
 * ── Por que allSettled, e não Promise.all ─────────────────────────────────────
 * Em paralelo a busca de scores parte de um id que ainda não foi validado, e o
 * caso comum de id inválido (conta apagada, link antigo) é justamente ela
 * estourar. Com `Promise.all` esse erro venceria a corrida e o comando
 * responderia "erro ao buscar" no lugar de "jogador não encontrado" — trocando
 * uma resposta que explica o que fazer por uma que não explica nada.
 *
 * Então a ordem de quem manda é explícita: perfil que falha sobe (é falha de
 * verdade), perfil vazio encerra ali (o erro do outro lado é consequência, não
 * causa), e só com o jogador existindo é que a falha dos scores importa.
 *
 * @param {{username: string|number, mode: string}} resolved o que o resolvePlayer devolveu
 * @param {(osuId: number) => Promise<Array>} buscarScores recebe o id já resolvido
 * @returns {Promise<{user: object|null, scores: Array}>}
 */
async function fetchPlayer({ username, mode }, buscarScores) {
  const idConhecido = /^\d+$/.test(String(username)) ? Number(username) : null;

  if (idConhecido === null) {
    const user = await osu.getUser(username, mode);
    return { user, scores: user ? await buscarScores(user.id) : [] };
  }

  const [perfil, scores] = await Promise.allSettled([
    osu.getUser(idConhecido, mode),
    buscarScores(idConhecido),
  ]);

  if (perfil.status === 'rejected') throw perfil.reason;
  if (!perfil.value) return { user: null, scores: [] };
  if (scores.status === 'rejected') throw scores.reason;

  return { user: perfil.value, scores: scores.value };
}

module.exports = { resolvePlayer, fetchPlayer };
