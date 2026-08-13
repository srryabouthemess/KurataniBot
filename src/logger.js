/**
 * logger.js
 * Log de erro seguro para chamadas HTTP (axios).
 *
 * Nunca loga o objeto de erro cru: um AxiosError carrega `.config` (que
 * inclui os headers da requisição, ex. `Authorization: Bearer <token>`) como
 * propriedade enumerável — `console.error(error)` imprime isso junto do
 * stack trace e vaza credenciais nos logs. Aqui só passam campos seguros.
 */

/**
 * Teto do corpo da resposta no log.
 *
 * Sem ele, dois casos reais enchiam disco sozinhos: um 502 de proxy devolve
 * página HTML inteira, e o download de `.osu` usa `responseType: 'arraybuffer'`
 * — um Buffer no `JSON.stringify` vira `{"type":"Buffer","data":[...]}`, com um
 * número por byte. Multiplicado pelas tentativas do retry, uma queda da API
 * escrevia megabytes por comando.
 */
const BODY_MAX = 500;

/** Corpo da resposta em texto, sem expandir o que não vale a pena. */
function bodyOf(data) {
  if (data === null || data === undefined || data === '') return null;
  if (typeof data === 'string') return data;
  // Corpo binário: o tamanho diz tudo que o log precisa saber.
  if (Buffer.isBuffer(data)) return `<${data.length} bytes>`;

  try {
    return JSON.stringify(data);
  } catch {
    // Corpo que não serializa (circular, BigInt) não deve derrubar o log de um
    // erro que já estava acontecendo.
    return String(data);
  }
}

function logError(context, error) {
  const status = error?.response?.status;
  const parts  = [`[${context}]`, error?.message ?? String(error)];
  if (status) parts.push(`status=${status}`);

  const body = bodyOf(error?.response?.data);
  if (body) {
    parts.push(body.length > BODY_MAX
      ? `${body.slice(0, BODY_MAX)}… (+${body.length - BODY_MAX} caracteres)`
      : body);
  }

  // Só quando NÃO houve resposta HTTP. Um 404 da API do osu! é resposta
  // esperada e a mensagem já diz tudo — o stack ali seria ruído em log que
  // enche sozinho. O que sobra neste ramo é o que precisa de endereço: erro de
  // programação (um TypeError dentro de um comando) e falha de rede.
  //
  // O stack é seguro de imprimir: são nomes de função e posições de arquivo. O
  // que este módulo existe para não vazar é o `.config` do axios, com o header
  // Authorization — e esse continua fora.
  if (!error?.response && error?.stack) parts.push(`\n${error.stack}`);

  console.error(...parts);
}

module.exports = { logError, BODY_MAX };
