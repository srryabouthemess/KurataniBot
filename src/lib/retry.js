/**
 * retry.js
 * Retry com backoff exponencial para chamadas HTTP.
 *
 * Antes só o fetchBeatmap tinha retry (1 tentativa, sleep fixo de 1s). Todo o
 * resto — getUser, getFCpp, simulatePP, atributos de mapa — tratava um 429 ou
 * um blip de rede como falha definitiva, retornando null silenciosamente e
 * deixando o embed sair com dados faltando.
 *
 * O jitter evita que várias chamadas que tomaram 429 ao mesmo tempo voltem
 * todas juntas no mesmo instante e tomem 429 de novo.
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Erros que vale a pena tentar de novo: rate limit, erro transitório do servidor, rede. */
function isRetryable(error) {
  // Quem chama pode marcar um erro de aplicação como transitório — ex: a API
  // devolveu 200 com corpo vazio, que acontece com .osu logo após um reupload.
  if (error?.retryable === true) return true;

  const status = error?.response?.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (status !== undefined) return false; // 4xx (exceto 429) não melhora com retry

  // Sem resposta HTTP: timeout, DNS, conexão recusada, socket fechado
  const code = error?.code;
  return ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code);
}

/**
 * Executa `fn` com retry exponencial. Relança o último erro se todas as
 * tentativas falharem — quem chama decide se vira null ou propaga.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {object} [opts]
 * @param {number} [opts.attempts=4]  total de tentativas (inclui a primeira)
 * @param {number} [opts.baseMs=400]  atraso da primeira espera
 * @param {number} [opts.maxMs=8000]  teto do atraso
 * @returns {Promise<T>}
 */
async function withRetry(fn, { attempts = 4, baseMs = 400, maxMs = 8000 } = {}) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1 || !isRetryable(error)) throw error;

      const backoff = Math.min(baseMs * Math.pow(2, attempt), maxMs);
      // Jitter de ±25% para dessincronizar chamadas concorrentes
      const jitter  = backoff * (0.75 + Math.random() * 0.5);
      await sleep(Math.round(jitter));
    }
  }

  throw lastError;
}

module.exports = { withRetry, isRetryable };
