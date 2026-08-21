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
 *   2. Servidor preferido do usuário (definido pelo último /link set)
 *   3. DEFAULT_MODE
 *
 * Prioridade do MODO (VN/RX), aplicado sobre o servidor acima:
 *   1. Opção `modo` do comando
 *   2. Modo preferido do usuário (definido pelo /link)
 *   3. Nenhum — a chave vale como está (ver `modo.apply`)
 *
 * Prioridade do JOGADOR:
 *   1. Nome passado na opção `player` do comando
 *   2. Link do usuário para o servidor resolvido acima
 *   3. Erro — o usuário não tem link para aquele servidor especificamente
 */

const { getLink, getPreferredServer, getPreferredModo } = require('./db');
const { t } = require('./i18n');
const modo = require('./modo');
const servers = require('./servers');
const osu = require('./osuClient');

/**
 * A chave de servidor que o comando vai usar: servidor e modo, resolvidos.
 *
 * O `/link` e os comandos perguntam as duas coisas separadamente — o servidor
 * numa opção, VN/RX em outra —, mas o resto do bot trabalha com UMA chave, e
 * `daycore_rx` é a forma de dizer "Daycore, leaderboard de Relax". Esta função
 * é a costura entre as duas perguntas, e é o que faz a preferência do `/link`
 * valer em todo comando: sem ela, escolher RX ali não teria efeito no
 * `/topplays` nem no `/profile`, que não sabem o que é um modo.
 *
 * O `modo:` do comando ganha do salvo (é o mais específico), e o salvo só é
 * consultado quando o comando não disse nada — nessa ordem, "eu jogo Relax"
 * pode ser configurado uma vez sem impedir de ver o vanilla numa consulta
 * avulsa.
 *
 * Vive aqui, e não copiado nos comandos, porque a prioridade já estava escrita
 * três vezes (`leaderboard.js`, `compare.js`, `topscores.js`) com o comentário
 * "mesma prioridade do resolvePlayer" em cima — o tipo de duplicata que só
 * fica de pé enquanto ninguém mexe numa das cópias.
 *
 * @param {object} interaction
 * @param {string} serverOptionName nome da opção de servidor no comando
 * @param {string|null} modoOptionName nome da opção de modo, ou null se o
 *   comando não tem uma (o `/wipe` tem um `mode` que é ruleset, não isto)
 * @param {string|null} padrao chave usada quando não há opção nem preferência
 */
function resolveServer(interaction, serverOptionName = 'server', modoOptionName = 'modo', padrao = null) {
  const escolhido = interaction.options.getString(serverOptionName);
  const modoDoComando = modoOptionName ? interaction.options.getString(modoOptionName) : null;

  const base = escolhido
    || getPreferredServer(interaction.user.id)
    || padrao
    || osu.DEFAULT_MODE;

  return modo.apply(base, modoDoComando ?? getPreferredModo(interaction.user.id));
}

/**
 * O servidor do SEGUNDO lado, num comando que fala de dois jogadores.
 *
 * Só o /compare tem dois lados hoje, e ali o par `server2:`/`modo2:` é o que
 * deixa escrever "kuratani no Bancho contra ckz no Akatsuki". Vazias as duas,
 * o segundo lado é o primeiro — o comando se comporta como sempre se comportou
 * para quem nunca tocar nelas.
 *
 * A herança é do `primeiro`, e NÃO uma segunda passada pelo `resolveServer`.
 * A prioridade de lá (`opção || preferência || padrão`) está certa para o
 * primeiro lado e errada para este: com `server2:` vazio, ela cairia no
 * servidor preferido do usuário, e aí `/compare user1:a user2:b
 * server:akatsuki` mandaria o `b` para o Bancho de quem tem o Bancho como
 * preferido. Dois jogadores do mesmo servidor viram comparação cruzada sem
 * ninguém ter pedido.
 *
 * O atalho de devolver `primeiro` inteiro quando nada foi dito também não é só
 * economia: a chave herdada tem que ser a MESMA, e refazer a conta perderia o
 * `_rx` de quem tem `daycore_rx` salvo como preferido sem preferência de modo
 * nenhuma (ver `modo.apply` com modo nulo).
 *
 * @param {object} interaction
 * @param {string} primeiro a chave que o `resolveServer` deu para o outro lado
 */
function resolveSecondServer(interaction, primeiro, serverOptionName = 'server2', modoOptionName = 'modo2', modoHerdadoOptionName = 'modo') {
  const escolhido      = interaction.options.getString(serverOptionName);
  const modoDoComando  = modoOptionName ? interaction.options.getString(modoOptionName) : null;

  if (!escolhido && !modoDoComando) return primeiro;

  // Só o servidor foi trocado: o modo do primeiro lado vale para os dois, que é
  // o que faz `server2:` sozinho comparar RX com RX em quem joga Relax.
  const herdado = (modoHerdadoOptionName ? interaction.options.getString(modoHerdadoOptionName) : null)
    ?? getPreferredModo(interaction.user.id);

  return modo.apply(escolhido ?? servers.rootKey(primeiro), modoDoComando ?? herdado);
}

/**
 * @returns {{username: string|number, displayName?: string, mode: string, fromLink: boolean}
 *           | {error: string}}
 *   Em caso de falha devolve `{ error }` com a mensagem já traduzida — assim
 *   os comandos não precisam decidir entre "sem link nenhum" e "sem link para
 *   este servidor", que exigem orientações diferentes.
 */
function resolvePlayer(interaction, playerOptionName = 'player', serverOptionName = 'server', modoOptionName = 'modo') {
  const manualPlayer = interaction.options.getString(playerOptionName);
  const mode = resolveServer(interaction, serverOptionName, modoOptionName);

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

module.exports = { resolveServer, resolveSecondServer, resolvePlayer, fetchPlayer };
