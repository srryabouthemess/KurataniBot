/**
 * ttlCache.js
 * Cache em memória com prazo de validade e teto de entradas.
 *
 * Três lugares do bot já tinham esta mesma estrutura escrita à mão — o cache de
 * usuário e o de mapa inexistente (osuClient) e o contexto de mapa por canal
 * (mapContext) —, e as duas armadilhas dela custaram correção em cada cópia:
 *
 *   1. **Reatribuir uma chave não a move para o fim.** No Map, `set` numa chave
 *      existente mantém a posição da PRIMEIRA inserção, e é a ordem de inserção
 *      que a evicção lê como "mais antigo". Sem o `delete` antes, a entrada
 *      consultada o tempo todo é descartada como se estivesse fria.
 *
 *   2. **O TTL sozinho não é teto.** Com tráfego suficiente para encher a
 *      tabela dentro da janela, tudo está fresco, nada expira e o Map cresce
 *      sem limite — a condição volta a ser verdadeira na inserção seguinte, e
 *      assim por diante. É invisível num bot pequeno e é vazamento num grande.
 *
 * A poda é preguiçosa: só corre a lista quando ela passa do teto, para não
 * acrescentar um timer por cache num processo que fica semanas no ar.
 */

class TtlCache {
  /**
   * @param {object} opts
   * @param {number} opts.ttlMs prazo de validade de cada entrada
   * @param {number} opts.max   teto de entradas
   */
  constructor({ ttlMs, max }) {
    this.ttlMs = ttlMs;
    this.max = max;
    this._map = new Map();
  }

  get size() {
    return this._map.size;
  }

  /** @returns {*} o valor, ou `undefined` se ausente ou vencido. */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.at > this.ttlMs) {
      this._map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  set(key, value) {
    // Ver armadilha 1 no cabeçalho: sem o delete, a reinserção não muda a
    // posição e a evicção trata uma chave quente como a mais antiga.
    this._map.delete(key);
    this._map.set(key, { value, at: Date.now() });
    this._prune();
  }

  delete(key) {
    return this._map.delete(key);
  }

  clear() {
    this._map.clear();
  }

  _prune() {
    if (this._map.size <= this.max) return;

    const cutoff = Date.now() - this.ttlMs;
    for (const [key, entry] of this._map) {
      if (entry.at < cutoff) this._map.delete(key);
    }

    // Ver armadilha 2: descartar o vencido não basta quando nada venceu.
    for (const key of this._map.keys()) {
      if (this._map.size <= this.max) break;
      this._map.delete(key);
    }
  }
}

module.exports = { TtlCache };
