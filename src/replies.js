/**
 * replies.js
 * Responder sem criar uma segunda falha.
 *
 * Todo comando termina o `catch` avisando a pessoa: `interaction.editReply(msg)`.
 * Só que a interação pode já ter expirado — e por causa da mesma lentidão que
 * causou o erro, já que o token vale 15 minutos e o retry da API come tempo.
 * A promise solta virava unhandled rejection: o processo não caía, porque o
 * index.js tem handler global, mas o log enchia e a pessoa não recebia nada.
 *
 * Aqui a falha de ENTREGA morre onde acontece. O erro original já foi para o
 * log pelo `logError` de quem chamou; não conseguir entregar o aviso é o fim
 * da linha, não um segundo evento a registrar — mesma escolha do
 * `pagination.js` e do adaptador do prefixo.
 */

/**
 * `editReply` que nunca rejeita. Use no caminho de erro, depois de um defer.
 *
 * @param {object} interaction interação ou o adaptador do modo texto
 * @param {string|object} payload igual ao que o editReply aceita
 */
async function safeEditReply(interaction, payload) {
  await interaction.editReply(payload).catch(() => {});
}

module.exports = { safeEditReply };
