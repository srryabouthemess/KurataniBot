/**
 * metrics.js
 * Contadores em memória, para responder "onde o tempo está indo" sem chutar.
 *
 * ── Por que existe ────────────────────────────────────────────────────────────
 * Todo ajuste de desempenho deste bot até aqui foi medido com script de bancada:
 * copiar o cache.db, cronometrar um caminho, comparar. Isso serve para decidir
 * uma mudança, e não serve para nada depois dela — em produção não há como saber
 * se o cache está acertando, se o rate limiter virou fila, ou se a thread do
 * rosu está sendo usada.
 *
 * São contadores, não histogramas: o que se quer é ordem de grandeza e
 * proporção ("o cache de FC acerta 90%?"), não distribuição.
 *
 * ── Custo ─────────────────────────────────────────────────────────────────────
 * Um `Map.get` e um `Map.set` por evento, em caminhos que já fazem I/O ou
 * cálculo de milissegundos. O conjunto de chaves é FECHADO — vem do código, não
 * de dado de usuário —, então não cresce sozinho.
 */

const _contadores = new Map();

const INICIO = Date.now();

/** Soma `n` ao contador. */
function count(name, n = 1) {
  _contadores.set(name, (_contadores.get(name) ?? 0) + n);
}

/**
 * Registra acerto ou erro de um cache.
 * Vira duas chaves, `<nome>.hit` e `<nome>.miss`, que o snapshot junta.
 */
function cache(name, acertou) {
  count(`cache.${name}.${acertou ? 'hit' : 'miss'}`);
}

function get(name) {
  return _contadores.get(name) ?? 0;
}

/**
 * Tudo que foi contado, mais a taxa de acerto de cada cache.
 *
 * @returns {{uptimeMs: number, contadores: object, caches: object}}
 */
function snapshot() {
  const contadores = {};
  const caches = {};

  for (const [chave, valor] of [..._contadores].sort()) {
    const m = chave.match(/^cache\.(.+)\.(hit|miss)$/);
    if (!m) {
      contadores[chave] = valor;
      continue;
    }

    const [, nome, tipo] = m;
    caches[nome] ??= { hit: 0, miss: 0 };
    caches[nome][tipo] = valor;
  }

  for (const dados of Object.values(caches)) {
    const total = dados.hit + dados.miss;
    dados.total = total;
    dados.taxa = total > 0 ? dados.hit / total : null;
  }

  return { uptimeMs: Date.now() - INICIO, contadores, caches };
}

/** Só para teste: o estado é de processo, e um caso não deve contaminar o outro. */
function reset() {
  _contadores.clear();
}

module.exports = { count, cache, get, snapshot, reset };
