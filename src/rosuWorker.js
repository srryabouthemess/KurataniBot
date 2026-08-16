/**
 * rosuWorker.js
 * O lado do processo principal da thread que calcula PP pelo rosu-pp.
 *
 * Mesmo desenho do pythonWorker, e pela mesma razão: um recurso de vida longa,
 * pedidos casados por id, e nenhuma falha dele chegando a derrubar o bot. A
 * diferença é o meio — ali é um processo Python, aqui é um worker thread —, e
 * por isso os dois não compartilham código: o que muda entre eles é justamente
 * o transporte, que é quase tudo que estes arquivos fazem.
 *
 * O porquê da thread e do cache de mapas parseados está no rosuWorkerThread.js.
 *
 * ── Bytes só quando faltam ────────────────────────────────────────────────────
 * O `.osu` tem 50–300KB, e mandá-lo em todo cálculo seria trocar um custo de CPU
 * por um de cópia. Então o pedido vai primeiro sem nada: se a thread não tiver o
 * mapa parseado, ela responde `needBytes` e o pedido é refeito com os bytes
 * anexados. Uma viagem extra na primeira vez, nenhuma nas seguintes.
 */

const path = require('path');
const { Worker } = require('node:worker_threads');

const { logErrorOnce } = require('./logger');

const SCRIPT = path.join(__dirname, 'rosuWorkerThread.js');

/**
 * Teto por pedido. Generoso porque um mapa muito longo passa de 30ms de
 * cálculo, e o que se quer pegar aqui é thread travada, não cálculo demorado.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Quanto esperar antes de tentar subir de novo uma thread que nasceu morta. */
const RESTART_BACKOFF_MS = 60_000;

let _worker = null;
let _nextId = 1;
let _blockedUntil = 0;
const _stats = { spawns: 0, served: 0, failed: 0, bytesEnviados: 0 };

// ─── Ciclo de vida ────────────────────────────────────────────────────────────

/**
 * Segurar o event loop só enquanto houver pedido em voo — mesma razão do
 * pythonWorker: uma thread ociosa não é motivo para o processo seguir de pé, e
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

function derrubar(worker, motivo) {
  // 'error' e 'exit' chegam os dois para a mesma thread, e o close() do shutdown
  // chega antes. Sem esta trava a mesma morte relataria a causa duas vezes e
  // estenderia o backoff sem razão.
  if (worker.done) return;
  worker.done = true;

  if (_worker === worker) _worker = null;
  encerrarPendentes(worker);

  // Uma thread que morreu SEM nunca ter respondido nada é quase sempre lib
  // faltando, que não melhora tentando de novo na play seguinte.
  if (worker.served === 0) {
    _blockedUntil = Date.now() + RESTART_BACKOFF_MS;
    logErrorOnce('rosuWorker', new Error(motivo));
  }

  worker.thread.terminate().catch(() => {});
}

function iniciar() {
  let thread;
  try {
    thread = new Worker(SCRIPT);
  } catch (error) {
    _blockedUntil = Date.now() + RESTART_BACKOFF_MS;
    logErrorOnce('rosuWorker:spawn', error);
    return null;
  }

  const worker = { thread, pending: new Map(), served: 0, done: false };
  _stats.spawns++;

  desreferenciar(worker);

  thread.on('message', (resposta) => receber(worker, resposta));
  thread.on('error', (error) => derrubar(worker, `a thread do rosu-pp falhou: ${error.message}`));
  thread.on('exit', () => derrubar(worker, 'a thread do rosu-pp encerrou'));

  return worker;
}

function garantir() {
  if (_worker) return _worker;
  if (Date.now() < _blockedUntil) return null;

  _worker = iniciar();
  return _worker;
}

// ─── Pedido e resposta ────────────────────────────────────────────────────────

function receber(worker, resposta) {
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
    _stats.failed++;
    logErrorOnce('rosuWorker:calc', new Error(resposta.error));
    return pendente.resolve(null);
  }

  worker.served++;
  _stats.served++;
  pendente.resolve({ value: resposta.value });
}

function enviar(worker, pedido) {
  const id = _nextId++;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      _stats.failed++;
      derrubar(worker, `o rosu-pp não respondeu em ${REQUEST_TIMEOUT_MS}ms`);
      resolve(null);
    }, REQUEST_TIMEOUT_MS);

    timer.unref?.();

    worker.pending.set(id, { resolve, timer });
    referenciar(worker);

    worker.thread.postMessage({ id, ...pedido });
  });
}

/**
 * Executa uma operação do rosu-pp na thread.
 *
 * @param {'attributes'} op
 * @param {number} mapId
 * @param {object} args parâmetros da operação (ver rosuWorkerThread.js)
 * @param {() => Promise<Uint8Array>} obterBytes chamado só quando a thread não
 *   tem o mapa parseado — é o que evita mandar o .osu em todo cálculo
 * @returns {Promise<object|null>} null em qualquer falha
 */
async function calcular(op, mapId, args, obterBytes) {
  const worker = garantir();
  if (!worker) return null;

  const primeira = await enviar(worker, { op, mapId, args });
  if (!primeira) return null;
  if (!primeira.needBytes) return primeira.value;

  let bytes;
  try {
    bytes = await obterBytes();
  } catch (error) {
    logErrorOnce('rosuWorker:bytes', error);
    return null;
  }
  if (!bytes) return null;

  // A thread pode ter morrido entre as duas viagens.
  const vivo = garantir();
  if (!vivo) return null;

  _stats.bytesEnviados += bytes.length;
  const segunda = await enviar(vivo, { op, mapId, args, bytes });

  // Um segundo `needBytes` significaria que a thread descartou o mapa entre
  // guardar e usar, o que não acontece — o cálculo é síncrono do lado de lá.
  // Tratado como falha em vez de virar laço.
  if (!segunda || segunda.needBytes) return null;
  return segunda.value;
}

/** Encerra a thread. Chamado no shutdown do bot (ver index.js). */
function close() {
  if (!_worker) return;

  const worker = _worker;
  _worker = null;

  // Marcado antes de terminar: o 'exit' chega depois, e sem isto um shutdown
  // normal seria relatado como falha da thread.
  worker.done = true;
  encerrarPendentes(worker);
  worker.thread.terminate().catch(() => {});
}

function stats() {
  return { ..._stats, vivo: Boolean(_worker), bloqueadoAte: _blockedUntil };
}

module.exports = { calcular, close, stats };
