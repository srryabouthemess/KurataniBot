/**
 * batch.js
 * Junta pedidos por chave feitos numa janela curta numa busca só.
 *
 * Quem chama continua pedindo um item por vez — `carregar(id)` —, e é aqui que
 * N pedidos viram ceil(N / max) requisições. O caso que motivou: o
 * `enrichBeatmapData` pedia os metadados de 100 mapas um a um, e cada um era um
 * GET na API oficial, na fila do rate limiter (8/s ≈ 12s de espera num /nochoke
 * frio). O endpoint em lote da API aceita 50 ids por vez: 100 pedidos, 2
 * requisições.
 *
 * ── A janela ──────────────────────────────────────────────────────────────────
 * Os pedidos de um mesmo comando chegam no mesmo tick (um `Promise.all` sobre
 * a lista de ids), então qualquer janela os pegaria juntos. Os poucos
 * milissegundos a mais são para dois comandos simultâneos dividirem o lote.
 *
 * ── O que isto não faz ────────────────────────────────────────────────────────
 * Não guarda nada: cache e deduplicação de quem já está em voo ficam com quem
 * chama (ver fetchBeatmap no osuClient). A mesma chave pedida duas vezes DENTRO
 * da janela vai uma vez só na requisição, mas é só isso.
 */

/**
 * @template K, V
 * @param {object} opts
 * @param {number} opts.max       teto de chaves por requisição
 * @param {number} [opts.janelaMs] quanto esperar por mais pedidos antes de sair
 * @param {(chaves: K[]) => Promise<Map<K, V>>} opts.buscar  busca uma fatia;
 *   chave que não vier no Map resolve como `null`
 * @returns {(chave: K) => Promise<V|null>}
 */
function criarLote({ max, janelaMs = 5, buscar }) {
  let pendentes = new Map(); // chave → [{ resolve, reject }]
  let timer = null;

  async function buscarFatia(fatia, esperando) {
    try {
      const achados = await buscar(fatia);
      for (const chave of fatia) {
        const valor = achados.get(chave) ?? null;
        esperando.get(chave).forEach(w => w.resolve(valor));
      }
    } catch (error) {
      // Só a fatia que falhou é rejeitada: as outras são requisições à parte e
      // podem ter dado certo.
      for (const chave of fatia) esperando.get(chave).forEach(w => w.reject(error));
    }
  }

  function disparar() {
    const esperando = pendentes;
    pendentes = new Map();
    timer = null;

    // As fatias saem juntas, e não uma depois da outra: a vazão já é
    // controlada por quem faz a requisição (o rate limiter do officialGet), e
    // esperar a primeira terminar só somaria a latência dela à da segunda.
    const chaves = [...esperando.keys()];
    for (let i = 0; i < chaves.length; i += max) {
      buscarFatia(chaves.slice(i, i + max), esperando);
    }
  }

  return function carregar(chave) {
    return new Promise((resolve, reject) => {
      if (!pendentes.has(chave)) pendentes.set(chave, []);
      pendentes.get(chave).push({ resolve, reject });
      timer ??= setTimeout(disparar, janelaMs);
    });
  };
}

module.exports = { criarLote };
