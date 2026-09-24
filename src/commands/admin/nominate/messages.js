/**
 * commands/admin/nominate/messages.js
 * O texto que o /nominate devolve: o resultado da aplicação, os avisos do que
 * falhou localmente e o sufixo de auditoria. Puro.
 */

/** Recorta texto vindo do banco/API antes de renderizar num embed. */
function truncate(text, max) {
  const str = String(text ?? '');
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

/**
 * Sufixo de auditoria quando a publicação parou no meio.
 *
 * Vai para o `detail` do admin_actions porque é a única pista de que o servidor
 * recebeu parte das dificuldades: quem ler o log depois precisa saber que o
 * estado ficou pela metade por falha de transporte, e não porque alguém pediu
 * assim.
 */
function failureDetail(result) {
  if (!result.failure) return '';
  return ` | publicacao interrompida em ${result.published.length}/${result.total}: ${result.failure.message}`;
}

function resultLine(s, confirmed, pending) {
  if (pending.length === 0) return s.nom_all_confirmed(confirmed.length);
  if (confirmed.length === 0) return s.nom_none_confirmed(pending.length);
  return s.nom_partial(confirmed.length, confirmed.length + pending.length, pending.join(', '));
}

/**
 * Resultado como quem rodou o comando precisa ler.
 *
 * "Não confirmou" e "nem chegou a ser publicado" são coisas diferentes: a
 * primeira pode ser o bancho ainda processando, a segunda é certeza de que
 * aquela dificuldade não vai mudar sozinha. Sem separar, uma queda do Redis no
 * meio do set se parecia com lentidão do servidor.
 */
function resultBlock(s, result) {
  return resultLine(s, result.confirmed, result.pending) +
    (result.failure ? `\n${s.nom_publish_interrupted(result.published.length, result.total)}` : '');
}

/**
 * Os avisos da papelada local que falhou DEPOIS de o servidor já ter mudado.
 *
 * Nenhuma das duas desfaz a ação, então elas entram como ressalva ao lado do
 * resultado e não como negação no lugar dele — é o mesmo princípio do
 * adminLog.js. Separadas porque a consequência é diferente: sem o registro, a
 * ação não aparece no `/moderate log`; sem a limpeza, a fila continua contando
 * votos de um estado que já mudou.
 */
function avisosLocais(s, registrado, filaLimpa) {
  return (registrado ? '' : '\n\n' + s.admin_log_failed) +
         (filaLimpa  ? '' : '\n\n' + s.nom_queue_not_cleared);
}

module.exports = {
  truncate,
  failureDetail,
  resultLine,
  resultBlock,
  avisosLocais,
};
