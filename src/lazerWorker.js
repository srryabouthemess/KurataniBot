/**
 * lazerWorker.js
 * O lado do processo principal do calculador de PP do osu!lazer.
 *
 * Mesmo desenho do pythonWorker e do rosuWorker — recurso de vida longa, pedidos
 * casados por id, nenhuma falha dele chegando a derrubar o bot. O transporte
 * aqui é `fork` com canal de IPC, que é o que o Node oferece para falar com
 * outro Node sem inventar enquadramento de mensagem (o pythonWorker precisa de
 * um porque do outro lado está um script Python lendo linhas).
 *
 * O porquê de ser PROCESSO e não thread está no lazerWorkerChild.js, e é a razão
 * de este arquivo existir separado do rosuWorker: em resumo, o runtime .NET da
 * lib termina em segfault, e num worker thread isso levaria o bot junto.
 *
 * ── Bytes só quando faltam ────────────────────────────────────────────────────
 * O `.osu` tem 50–300KB, e mandá-lo em todo cálculo seria trocar um custo de CPU
 * por um de cópia. Então o pedido vai primeiro sem nada: se o filho não tiver o
 * mapa parseado, ele responde `needBytes` e o pedido é refeito com os bytes
 * anexados. Uma viagem extra na primeira vez, nenhuma nas seguintes.
 */

const path = require('path');
const { fork } = require('node:child_process');

const { logErrorOnce } = require('./logger');

const SCRIPT = path.join(__dirname, 'lazerWorkerChild.js');

/**
 * Teto por pedido. Mais folgado que o do rosu-pp (15s) porque este motor é bem
 * mais lento: ~18ms de parse e ~33ms de dificuldade, contra 1,5ms e 4,3ms. O que
 * se quer pegar aqui continua sendo processo travado, não cálculo demorado.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** Quanto esperar antes de tentar subir de novo um processo que nasceu morto. */
const RESTART_BACKOFF_MS = 60_000;

let _worker = null;
let _nextId = 1;
let _blockedUntil = 0;
const _stats = { spawns: 0, served: 0, failed: 0, bytesEnviados: 0 };

// ─── Ciclo de vida ────────────────────────────────────────────────────────────

/**
 * Segurar o event loop só enquanto houver pedido em voo — mesma razão dos outros
 * dois workers: um processo ocioso não é motivo para o bot seguir de pé, e um
 * desreferenciado durante o cálculo deixaria o Node sair no meio dele.
 *
 * O canal de IPC precisa do mesmo tratamento do filho: é por ele que a resposta
 * chega, e sozinho ele já segura o loop.
 */
function referenciar(worker) {
  worker.child.ref?.();
  worker.child.channel?.ref?.();
}

function desreferenciar(worker) {
  worker.child.unref?.();
  worker.child.channel?.unref?.();
}

function encerrarPendentes(worker) {
  for (const pendente of worker.pending.values()) {
    clearTimeout(pendente.timer);
    pendente.resolve(null);
  }
  worker.pending.clear();
}

function derrubar(worker, motivo) {
  // 'error', 'exit' e o close() do shutdown chegam todos para o mesmo processo.
  // Sem esta trava a mesma morte relataria a causa duas vezes e estenderia o
  // backoff sem razão.
  if (worker.done) return;
  worker.done = true;

  if (_worker === worker) _worker = null;
  encerrarPendentes(worker);

  // Um processo que morreu SEM nunca ter respondido nada é quase sempre a lib
  // faltando (ela é opcional, ver docs/OPCIONAIS.md), e isso não melhora
  // tentando de novo na play seguinte.
  if (worker.served === 0) {
    _blockedUntil = Date.now() + RESTART_BACKOFF_MS;
    const causa = causaDoStderr(worker.stderr);
    logErrorOnce('lazerWorker', new Error(causa ? `${motivo}: ${causa}` : motivo));
  }

  try { worker.child.kill(); } catch { /* já morreu */ }
}

/** Teto do stderr guardado, pela mesma razão do pythonWorker: o pipe tem buffer. */
const STDERR_MAX = 2000;

/**
 * A linha do stderr que explica a morte, sem o resto.
 *
 * O caso comum aqui é a lib não estar instalada — ela é opcional, e não existe
 * binário para toda plataforma. O Node responde a isso com um MODULE_NOT_FOUND
 * de vinte linhas de stack, das quais uma só interessa a quem opera o bot. Sem
 * este recorte, o log de um bot funcionando (só que sem PP local) fica com um
 * despejo de stack trace que parece coisa muito pior.
 */
function causaDoStderr(stderr) {
  const linhas = (stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return linhas.find((l) => /^[A-Za-z]*Error:/.test(l)) ?? linhas[0] ?? '';
}

function iniciar() {
  let child;
  try {
    // 'advanced' usa o algoritmo de clonagem estruturada em vez de JSON: sem
    // isto, os bytes do .osu viajariam como array de números decimais em texto,
    // que é ordens de grandeza mais caro do que o Buffer que eles já são.
    child = fork(SCRIPT, [], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  } catch (error) {
    _blockedUntil = Date.now() + RESTART_BACKOFF_MS;
    logErrorOnce('lazerWorker:spawn', error);
    return null;
  }

  const worker = { child, pending: new Map(), served: 0, done: false, stderr: '' };
  _stats.spawns++;

  desreferenciar(worker);

  child.stderr?.on('data', (chunk) => {
    if (worker.stderr.length < STDERR_MAX) worker.stderr += chunk.toString();
  });

  child.on('message', (resposta) => receber(worker, resposta));
  child.on('error', (error) => derrubar(worker, `o processo do lazer-calculator falhou: ${error.message}`));
  child.on('exit', (code, signal) => derrubar(worker, `o lazer-calculator encerrou (code=${code} signal=${signal})`));

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

  // `needBytes` não é sucesso nem falha: é o filho dizendo que precisa do mapa.
  // Quem espera resolve com o marcador e refaz o pedido (ver calcular).
  if (resposta.needBytes) return pendente.resolve({ needBytes: true });

  if (resposta.error) {
    _stats.failed++;
    logErrorOnce('lazerWorker:calc', new Error(resposta.error));
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
      derrubar(worker, `o lazer-calculator não respondeu em ${REQUEST_TIMEOUT_MS}ms`);
      resolve(null);
    }, REQUEST_TIMEOUT_MS);

    timer.unref?.();

    worker.pending.set(id, { resolve, timer });
    referenciar(worker);

    // Um filho que morreu entre o garantir() e aqui faz o send lançar; sem o
    // catch isso viraria exceção não tratada em vez de "não deu para calcular".
    try {
      worker.child.send({ id, ...pedido });
    } catch (error) {
      worker.pending.delete(id);
      clearTimeout(timer);
      derrubar(worker, `não deu para falar com o lazer-calculator: ${error.message}`);
      resolve(null);
    }
  });
}

/**
 * Executa uma operação do lazer-calculator no processo filho.
 *
 * @param {'difficulty'|'fc'|'simulate'} op
 * @param {number} mapId
 * @param {object} args parâmetros da operação (ver lazerWorkerChild.js)
 * @param {() => Promise<Uint8Array>} obterBytes chamado só quando o filho não
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
    logErrorOnce('lazerWorker:bytes', error);
    return null;
  }
  if (!bytes) return null;

  // O processo pode ter morrido entre as duas viagens.
  const vivo = garantir();
  if (!vivo) return null;

  _stats.bytesEnviados += bytes.length;
  const segunda = await enviar(vivo, { op, mapId, args, bytes });

  // Um segundo `needBytes` significaria que o filho descartou o mapa entre
  // guardar e usar, o que não acontece — o cálculo é síncrono do lado de lá.
  // Tratado como falha em vez de virar laço.
  if (!segunda || segunda.needBytes) return null;
  return segunda.value;
}

/**
 * Encerra o processo. Chamado no shutdown do bot (ver index.js).
 *
 * `disconnect()` fecha o canal de IPC, e o filho sai sozinho ao ver isso. O kill
 * fica para quem não sair — e o `done` é marcado ANTES de qualquer uma das duas
 * coisas, porque o 'exit' chega depois: sem ele, um encerramento normal do bot
 * passaria pelo `derrubar` e, numa sessão em que nenhum PP foi calculado
 * (`served === 0`), ligaria o backoff e logaria um erro por um shutdown que deu
 * certo.
 *
 * O segfault do runtime .NET acontece justamente aqui, na descida do filho, e é
 * exatamente por isso que ele é um processo: o código de saída dele não importa
 * para nada, e o bot já terminou de usá-lo quando isso ocorre.
 */
function close() {
  if (!_worker) return;

  const worker = _worker;
  _worker = null;

  worker.done = true;
  encerrarPendentes(worker);

  try {
    worker.child.disconnect();
    worker.child.kill();
  } catch { /* já morreu */ }
}

function stats() {
  return { ..._stats, vivo: Boolean(_worker), bloqueadoAte: _blockedUntil };
}

module.exports = { calcular, close, stats };
