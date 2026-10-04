/**
 * pp/atributosCache.js
 * Atributos de dificuldade guardados por (mapa, mods), dentro da thread do motor.
 *
 * A dificuldade é a parte cara do cálculo: medido no Wasm, 2,7–30 ms por mapa,
 * contra 0,04 ms do pp a partir de atributos prontos. Sem isto, o `Performance`
 * recebia o mapa e refazia a dificuldade a cada pedido — uma play de servidor
 * privado sem FC pagava três vezes a mesma conta (pp da play, FC pp, estrelas).
 * O Bathbot guarda os atributos e deriva deles todos os pp (`PpManager` em
 * manager/pp.rs).
 *
 * A entrada lembra de qual Beatmap saiu: a thread reparseia o mapa quando o
 * `.osu` muda, e os atributos do arquivo velho não servem ao novo — a chave
 * sozinha não vê a troca.
 *
 * Como o Beatmap, os atributos são memória Wasm que o coletor do JS não conhece
 * a tempo: quem sai daqui é liberado com `free()`.
 */

/**
 * Pequeno como o LRU de mapas do wasmThread.js (12): cobre os mods das plays de
 * uma página e o vaivém entre páginas vizinhas. Cada entrada são alguns números.
 */
const MAX_PADRAO = 64;

function criarCacheAtributos({ max = MAX_PADRAO } = {}) {
  /** chave → { beatmap, attrs }. A ordem de inserção é a ordem de uso (LRU). */
  const entradas = new Map();

  function remover(chave) {
    const entrada = entradas.get(chave);
    if (!entrada) return;
    entradas.delete(chave);
    entrada.attrs.free?.();
  }

  /**
   * Os atributos daquela chave para aquele Beatmap, calculando só se faltam.
   *
   * @param {string} chave mapa + mods + mecânica, na forma que o motor recebe
   * @param {object} beatmap o Beatmap parseado que `calcular` vai usar
   * @param {() => object} calcular devolve os DifficultyAttributes
   */
  function obter(chave, beatmap, calcular) {
    const entrada = entradas.get(chave);
    if (entrada && entrada.beatmap === beatmap) {
      // Reinserir move para o fim (ver pegarMapa no wasmThread.js).
      entradas.delete(chave);
      entradas.set(chave, entrada);
      return entrada.attrs;
    }

    remover(chave);
    const attrs = calcular();
    entradas.set(chave, { beatmap, attrs });

    while (entradas.size > max) remover(entradas.keys().next().value);
    return attrs;
  }

  return {
    obter,
    get tamanho() { return entradas.size; },
  };
}

module.exports = { criarCacheAtributos };
