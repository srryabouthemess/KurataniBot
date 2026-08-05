/**
 * logger.js
 * Log de erro seguro para chamadas HTTP (axios).
 *
 * Nunca loga o objeto de erro cru: um AxiosError carrega `.config` (que
 * inclui os headers da requisição, ex. `Authorization: Bearer <token>`) como
 * propriedade enumerável — `console.error(error)` imprime isso junto do
 * stack trace e vaza credenciais nos logs. Aqui só passam campos seguros.
 */

function logError(context, error) {
  const status = error?.response?.status;
  const data   = error?.response?.data;
  const parts  = [`[${context}]`, error?.message ?? String(error)];
  if (status) parts.push(`status=${status}`);
  if (data) parts.push(typeof data === 'string' ? data : JSON.stringify(data));
  console.error(...parts);
}

module.exports = { logError };
