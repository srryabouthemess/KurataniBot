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
 * Quase tudo são contadores: o que se quer é ordem de grandeza e proporção
 * ("o cache de FC acerta 90%?"), não distribuição. A exceção é o tempo por
 * comando (`duration`), onde a média esconde justamente o que importa — um
 * /nochoke frio de 20s some no meio de cem de 0,3s.
 *
 * ── Custo ─────────────────────────────────────────────────────────────────────
 * Um `Map.get` e um `Map.set` por evento, em caminhos que já fazem I/O ou
 * cálculo de milissegundos. O conjunto de chaves é FECHADO — vem do código, não
 * de dado de usuário —, então não cresce sozinho.
 */

const _contadores = new Map();

/**
 * Quantas durações por comando entram no p50/p95. Janela e não histograma:
 * com 500 amostras o percentil é exato e o custo é fixo (4KB por comando), e
 * baldes fixos obrigariam a adivinhar a escala antes de medir — que é o que
 * ainda não se sabe.
 */
const JANELA = 500;

/** nome → { n, erros, max, amostras: Float64Array, prox } */
const _duracoes = new Map();

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

/**
 * Registra quanto uma execução de comando levou.
 *
 * `n`, `erros` e `max` são do processo inteiro; o p50/p95 sai das últimas
 * `JANELA` amostras, num anel que sobrescreve a mais antiga. O nome tem que vir
 * de conjunto fechado (o nome do comando registrado), nunca de dado de usuário:
 * cada nome novo é um anel novo.
 *
 * @param {string}  name
 * @param {number}  segundos
 * @param {boolean} [erro] a execução terminou lançando
 */
function duration(name, segundos, erro = false) {
  let d = _duracoes.get(name);
  if (!d) {
    d = { n: 0, erros: 0, max: 0, amostras: new Float64Array(JANELA), prox: 0 };
    _duracoes.set(name, d);
  }

  d.amostras[d.prox] = segundos;
  d.prox = (d.prox + 1) % JANELA;
  d.n += 1;
  if (erro) d.erros += 1;
  if (segundos > d.max) d.max = segundos;
}

/**
 * Roda `fn` cronometrando, e registra em `duration`. Devolve o que `fn`
 * devolver e relança o que ela lançar — o mesmo erro, sem embrulho —, então
 * quem chama trata a falha exatamente como antes.
 *
 * O registro acontece no `finally`, antes do `catch` de quem chamou: o tempo
 * de responder "erro ao executar" ao usuário não entra na conta do comando.
 */
async function timed(name, fn) {
  const inicio = process.hrtime.bigint();
  let erro = false;
  try {
    return await fn();
  } catch (e) {
    erro = true;
    throw e;
  } finally {
    duration(name, Number(process.hrtime.bigint() - inicio) / 1e9, erro);
  }
}

/** Percentil por posição mais próxima: sempre um valor que de fato ocorreu. */
function percentil(ordenadas, q) {
  return ordenadas[Math.max(0, Math.ceil(q * ordenadas.length) - 1)];
}

function get(name) {
  return _contadores.get(name) ?? 0;
}

/**
 * Tudo que foi contado, mais a taxa de acerto de cada cache.
 *
 * Tempos de `comandos` em segundos; `amostras` é quantas entraram no p50/p95.
 *
 * @returns {{uptimeMs: number, contadores: object, caches: object, comandos: object}}
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

  const comandos = {};
  for (const [nome, d] of [..._duracoes].sort(([a], [b]) => a.localeCompare(b))) {
    const amostras = Math.min(d.n, JANELA);
    const ordenadas = d.amostras.slice(0, amostras).sort();
    comandos[nome] = {
      n:     d.n,
      erros: d.erros,
      amostras,
      p50:   percentil(ordenadas, 0.5),
      p95:   percentil(ordenadas, 0.95),
      max:   d.max,
    };
  }

  return { uptimeMs: Date.now() - INICIO, contadores, caches, comandos };
}

/** Só para teste: o estado é de processo, e um caso não deve contaminar o outro. */
function reset() {
  _contadores.clear();
  _duracoes.clear();
}

module.exports = { count, cache, duration, timed, get, snapshot, reset, JANELA };
