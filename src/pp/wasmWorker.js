/**
 * wasmWorker.js
 * O lado do processo principal das threads que calculam PP pelos motores Wasm:
 * os builds do rosu-pp e os do akatsuki-pp.
 *
 * Um recurso de vida longa, pedidos casados por id, e nenhuma falha dele
 * chegando a derrubar o bot.
 *
 * O porquê da thread está no rosuWorkerThread.js; o do cache de mapas
 * parseados, no wasmThread.js.
 *
 * ── Threads por build ─────────────────────────────────────────────────────────
 * Cada servidor calcula no motor que ele roda (ver engines.js), e os builds são
 * pacotes Wasm diferentes. Cada um ganha as suas threads, com o seu backoff: um
 * build que não carrega não derruba o outro. Uma thread só nasce no primeiro
 * pedido que cai nela, então um build que nenhum servidor configurado usa nunca
 * é carregado. O script da thread sai do tipo do motor: as operações do rosu-pp
 * e as do akatsuki-pp são outras.
 *
 * São `PP_THREADS` por build (ver config.js). Era uma: duas pessoas ao mesmo
 * tempo, ou as 100 plays de um /nochoke frio, entravam na mesma fila — no
 * Bathbot o cálculo roda em todas as threads do tokio. O mapa escolhe a thread
 * (`mapId % N`), para o mesmo mapa cair sempre na mesma: é lá que estão o mapa
 * parseado e os atributos de dificuldade dele (ver wasmThread.js e
 * atributosCache.js).
 *
 * ── Bytes só quando faltam ────────────────────────────────────────────────────
 * O `.osu` tem 50–300KB, e mandá-lo em todo cálculo seria trocar um custo de CPU
 * por um de cópia. Então o pedido vai primeiro sem nada: se a thread não tiver o
 * mapa parseado, ela responde `needBytes` e o pedido é refeito com os bytes
 * anexados. Uma viagem extra na primeira vez, nenhuma nas seguintes.
 */

const path = require('path');
const { Worker } = require('node:worker_threads');

const { logErrorOnce } = require('../lib/logger');
const config = require('../config');

/** Tipo do motor (ver engines.js) → corpo da thread. */
const SCRIPTS = {
  rosu:     path.join(__dirname, 'rosuWorkerThread.js'),
  akatsuki: path.join(__dirname, 'akatsukiWorkerThread.js'),
};

/**
 * Teto por pedido. Generoso porque um mapa muito longo passa de 30ms de
 * cálculo, e o que se quer pegar aqui é thread travada, não cálculo demorado.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Quanto esperar antes de tentar subir de novo uma thread que nasceu morta. */
const RESTART_BACKOFF_MS = 60_000;

let _nextId = 1;

/**
 * pacote → { pacote, script, threads, blockedUntil, stats }. `threads` tem uma
 * vaga por thread, null enquanto ela não nasceu (ou depois que morreu).
 */
const _pools = new Map();

function poolDe({ pacote, tipo }) {
  let pool = _pools.get(pacote);
  if (!pool) {
    pool = {
      pacote,
      script: SCRIPTS[tipo],
      threads: new Array(config.pp.threads).fill(null),
      blockedUntil: 0,
      stats: { spawns: 0, served: 0, failed: 0, bytesEnviados: 0 },
    };
    _pools.set(pacote, pool);
  }
  return pool;
}

// ─── Ciclo de vida ────────────────────────────────────────────────────────────

/**
 * Segurar o event loop só enquanto houver pedido em voo — mesma razão do
 * processo: uma thread ociosa não é motivo para o processo seguir de pé, e
 * uma desreferenciada durante o cálculo deixaria o Node sair no meio dele.
 */
function referenciar(worker) {
  worker.thread.ref?.();
}

function desreferenciar(worker) {
  worker.thread.unref?.();
}

function encerrarPendentes(worker) {
  for (const pendente of worker.pending.values()) {
    clearTimeout(pendente.timer);
    pendente.resolve(null);
  }
  worker.pending.clear();
}

function derrubar(pool, worker, motivo) {
  // 'error' e 'exit' chegam os dois para a mesma thread, e o close() do shutdown
  // chega antes. Sem esta trava a mesma morte relataria a causa duas vezes e
  // estenderia o backoff sem razão.
  if (worker.done) return;
  worker.done = true;

  const vaga = pool.threads.indexOf(worker);
  if (vaga >= 0) pool.threads[vaga] = null;
  encerrarPendentes(worker);

  // Uma thread que morreu SEM nunca ter respondido nada é quase sempre lib
  // faltando, que não melhora tentando de novo na play seguinte.
  if (worker.served === 0) {
    pool.blockedUntil = Date.now() + RESTART_BACKOFF_MS;
    logErrorOnce(`wasmWorker:${pool.pacote}`, new Error(motivo));
  }

  worker.thread.terminate().catch(() => {});
}

function iniciar(pool) {
  let thread;
  try {
    thread = new Worker(pool.script, { workerData: { pacote: pool.pacote } });
  } catch (error) {
    pool.blockedUntil = Date.now() + RESTART_BACKOFF_MS;
    logErrorOnce(`wasmWorker:spawn:${pool.pacote}`, error);
    return null;
  }

  const worker = { thread, pending: new Map(), served: 0, done: false };
  pool.stats.spawns++;

  desreferenciar(worker);

  thread.on('message', (resposta) => receber(pool, worker, resposta));
  thread.on('error', (error) => derrubar(pool, worker, `a thread do ${pool.pacote} falhou: ${error.message}`));
  thread.on('exit', () => derrubar(pool, worker, `a thread do ${pool.pacote} encerrou`));

  return worker;
}

/** A vaga da thread daquele mapa: o mesmo mapa cai sempre na mesma (ver cabeçalho). */
function vagaDe(pool, mapId) {
  const id = Math.abs(Math.trunc(Number(mapId)));
  return Number.isFinite(id) ? id % pool.threads.length : 0;
}

function garantir(pool, vaga) {
  if (pool.threads[vaga]) return pool.threads[vaga];
  if (Date.now() < pool.blockedUntil) return null;

  pool.threads[vaga] = iniciar(pool);
  return pool.threads[vaga];
}

/** As threads de pé de um build. */
const vivas = (pool) => pool.threads.filter(worker => worker && !worker.done);

// ─── Pedido e resposta ────────────────────────────────────────────────────────

function receber(pool, worker, resposta) {
  const pendente = worker.pending.get(resposta.id);
  // Resposta sem dono é o caso normal de um pedido que já expirou.
  if (!pendente) return;

  worker.pending.delete(resposta.id);
  clearTimeout(pendente.timer);
  if (worker.pending.size === 0) desreferenciar(worker);

  // `needBytes` não é sucesso nem falha: é a thread dizendo que precisa do mapa.
  // Quem espera resolve com o marcador e refaz o pedido (ver calcular).
  if (resposta.needBytes) return pendente.resolve({ needBytes: true });

  if (resposta.error) {
    pool.stats.failed++;
    logErrorOnce(`wasmWorker:calc:${pool.pacote}`, new Error(resposta.error));
    return pendente.resolve(null);
  }

  worker.served++;
  pool.stats.served++;
  pendente.resolve({ value: resposta.value });
}

function enviar(pool, worker, pedido) {
  const id = _nextId++;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      pool.stats.failed++;
      derrubar(pool, worker, `o ${pool.pacote} não respondeu em ${REQUEST_TIMEOUT_MS}ms`);
      resolve(null);
    }, REQUEST_TIMEOUT_MS);

    timer.unref?.();

    worker.pending.set(id, { resolve, timer });
    referenciar(worker);

    worker.thread.postMessage({ id, ...pedido });
  });
}

/**
 * Executa uma operação na thread do build pedido que cuida daquele mapa.
 *
 * @param {{pacote: string, tipo: 'rosu'|'akatsuki'}} motor o build (ver engines.js)
 * @param {'attributes'|'difficulty'|'fc'|'simulate'} op
 * @param {number} mapId
 * @param {object} args parâmetros da operação (ver rosuWorkerThread.js e
 *   akatsukiWorkerThread.js; `attributes` só o rosu-pp tem)
 * @param {() => Promise<Uint8Array>} obterBytes chamado só quando a thread não
 *   tem o mapa parseado — é o que evita mandar o .osu em todo cálculo
 * @returns {Promise<object|null>} null em qualquer falha
 */
async function calcular(motor, op, mapId, args, obterBytes) {
  const pool = poolDe(motor);
  const vaga = vagaDe(pool, mapId);
  const worker = garantir(pool, vaga);
  if (!worker) return null;

  const primeira = await enviar(pool, worker, { op, mapId, args });
  if (!primeira) return null;
  if (!primeira.needBytes) return primeira.value;

  let bytes;
  try {
    bytes = await obterBytes();
  } catch (error) {
    logErrorOnce('wasmWorker:bytes', error);
    return null;
  }
  if (!bytes) return null;

  // A thread pode ter morrido entre as duas viagens.
  const vivo = garantir(pool, vaga);
  if (!vivo) return null;

  pool.stats.bytesEnviados += bytes.length;
  const segunda = await enviar(pool, vivo, { op, mapId, args, bytes });

  // Um segundo `needBytes` significaria que a thread descartou o mapa entre
  // guardar e usar, o que não acontece — o cálculo é síncrono do lado de lá.
  // Tratado como falha em vez de virar laço.
  if (!segunda || segunda.needBytes) return null;
  return segunda.value;
}

/**
 * Faz toda thread viva largar o mapa parseado (ver `esquecer` no wasmThread.js).
 *
 * Thread que não está de pé não tem o que largar: a próxima nasce sem nada.
 */
async function esquecerMapa(mapId) {
  await Promise.all([..._pools.values()].flatMap(pool =>
    vivas(pool).map(worker => enviar(pool, worker, { op: 'esquecer', mapId }))));
}

/** Encerra todas as threads. Chamado no shutdown do bot (ver index.js). */
function close() {
  for (const pool of _pools.values()) {
    for (const [vaga, worker] of pool.threads.entries()) {
      if (!worker) continue;
      pool.threads[vaga] = null;

      // Marcado antes de terminar: o 'exit' chega depois, e sem isto um shutdown
      // normal seria relatado como falha da thread.
      worker.done = true;
      encerrarPendentes(worker);
      worker.thread.terminate().catch(() => {});
    }
  }
}

/** Por build, só dos que já receberam algum pedido. */
function stats() {
  return Object.fromEntries([..._pools.values()].map(pool => [
    pool.pacote,
    {
      ...pool.stats,
      vivo: vivas(pool).length > 0,
      threads: vivas(pool).length,
      bloqueadoAte: pool.blockedUntil,
    },
  ]));
}

module.exports = { calcular, esquecerMapa, close, stats };
