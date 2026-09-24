/**
 * concurrency.js
 * Rodar N coisas ao mesmo tempo, mas nunca mais que N.
 *
 * ── Por que não é `Promise.all` em lotes ──────────────────────────────────────
 * O jeito óbvio é fatiar a lista e dar `Promise.all` em cada fatia, que foi como
 * o `enrichBeatmapData` nasceu. O problema é que a fatia só termina quando o
 * **mais lento** dela termina: com quatro mapas em 50ms e um em 3s, os quatro
 * lugares ficam parados 3s esperando o quinto, e a fatia seguinte nem começou.
 *
 * Aqui as posições são reaproveitadas assim que vagam, então o lento atrasa só
 * a si mesmo.
 *
 * ── Por que existe um teto ────────────────────────────────────────────────────
 * Não é para proteger o rate limiter — ele já segura a vazão sozinho
 * (rateLimiter.js). É para não empilhar centenas de requisições em voo
 * esperando na fila dele, cada uma com o seu socket e o seu timeout: um set de
 * 100 dificuldades viraria 100 conexões simultâneas para o mesmo host.
 */

/**
 * Aplica `fn` a cada item, com no máximo `limit` chamadas em voo.
 *
 * Os resultados vêm NA ORDEM DA ENTRADA, e não na ordem em que ficaram prontos —
 * quem chama costuma casar `items[i]` com `results[i]`.
 *
 * `fn` deve tratar os próprios erros: uma rejeição aqui interrompe o conjunto,
 * e as chamadas já em voo continuam rodando sem ninguém esperando por elas.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let proximo = 0;

  async function trabalhador() {
    // `proximo++` é atômico o bastante: o event loop não interrompe uma
    // expressão síncrona, então dois trabalhadores nunca pegam o mesmo índice.
    for (let i = proximo++; i < items.length; i = proximo++) {
      results[i] = await fn(items[i], i);
    }
  }

  const vagas = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: vagas }, trabalhador));

  return results;
}

module.exports = { mapLimit };
