/**
 * inflight.js
 * Compartilha requisições idênticas que estão acontecendo ao mesmo tempo.
 *
 * Duas plays da mesma página (ou duas pessoas ao mesmo tempo) pedem o mesmo
 * mapa com frequência. O cache só ajuda depois que a primeira requisição
 * termina — enquanto ela está em voo, as demais disparavam chamadas idênticas.
 * Aqui todas esperam a mesma promise.
 */

const _inFlight = new Map();

/**
 * @param {string} key    identifica a requisição (ex: `file:123`)
 * @param {() => Promise<any>} fn
 */
function dedupe(key, fn) {
  const existing = _inFlight.get(key);
  if (existing) return existing;

  const promise = fn().finally(() => _inFlight.delete(key));
  _inFlight.set(key, promise);
  return promise;
}

module.exports = { dedupe };
