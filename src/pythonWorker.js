/**
 * pythonWorker.js
 * O processo Python que calcula PP de Relax, mantido de pé entre chamadas.
 *
 * O PP do Relax sai do akatsuki-pp-py — o mesmo motor que os servidores usam —,
 * e não existe equivalente em JavaScript. Até aqui cada número custava um
 * `spawn`: medido só o spawn + startup do interpretador, SEM importar a lib,
 * **44ms por chamada** (Windows; na VPS Linux é menor), mais o import da
 * extensão compilada. Uma página de /topplays de RX são cinco.
 *
 * Agora o processo fica vivo e atende pedidos em sequência (o protocolo está
 * documentado em pp_calc.py). Este módulo é a ponta Node: subir, casar resposta
 * com pedido, e não deixar uma falha do Python virar problema do bot.
 *
 * ── Falhar barato ────────────────────────────────────────────────────────────
 * O Relax é opcional (ver README), e numa instalação sem a lib TODA chamada
 * falha do mesmo jeito. O código antigo pagava um spawn para descobrir isso a
 * cada play; aqui, um worker que morre sem ter respondido nada bloqueia novas
 * tentativas por um tempo — o custo vira quase zero, e a causa continua sendo
 * logada uma vez só.
 *
 * Nada daqui derruba o bot: falha de qualquer natureza vira `null`, e quem
 * chamou já trata isso como "PP do Relax indisponível".
 */

const { spawn } = require('child_process');
const path = require('path');
const { logErrorOnce } = require('./logger');

const SCRIPT = path.join(__dirname, 'pp_calc.py');

/**
 * Teto do stderr guardado por instância do worker.
 *
 * O mesmo cuidado do código antigo: um traceback repetido não pode virar
 * memória, e o pipe tem buffer — um filho que escreva mais do que cabe nele
 * fica bloqueado esperando alguém ler.
 */
const STDERR_MAX = 2000;

/** Mesmo teto do `spawn(..., { timeout })` que existia antes. */
const REQUEST_TIMEOUT_MS = 12_000;

/** Quanto esperar antes de tentar subir de novo um worker que nasceu morto. */
const RESTART_BACKOFF_MS = 60_000;

let _worker = null;
let _nextId = 1;
let _blockedUntil = 0;
const _stats = { spawns: 0, served: 0, failed: 0 };

/**
 * No Windows o instalador do python.org cria o binário "python"; na maioria das
 * distros Linux (PEP 394) só "python3" existe por padrão — sem isso o spawn
 * falha e o RX nunca calcula PP. PYTHON_BIN no .env sobrescreve em qualquer
 * plataforma.
 */
function pythonBin() {
  return process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}

// ─── Registro de falhas ───────────────────────────────────────────────────────
/**
 * Uma causa é logada uma vez só.
 *
 * O dedup em si vive no logger, porque os caminhos de PP do rosu precisam do
 * mesmo tratamento e pela mesma razão (ver logErrorOnce). O que sobra aqui é a
 * linha extra que explica ao operador por que ele não vai ver a mensagem de
 * novo — e ela só sai quando houve log, senão a explicação apareceria sozinha,
 * sem o erro que ela explica.
 */
function reportPythonFailure(context, detail) {
  if (!detail) return;

  if (logErrorOnce(context, new Error(detail))) {
    console.error('[pythonWorker] PP do Relax indisponível; esta causa é logada uma vez só.');
  }
}

// ─── Ciclo de vida ────────────────────────────────────────────────────────────

/**
 * Segurar o event loop SÓ enquanto houver pedido em voo.
 *
 * Os dois extremos quebram: um worker sempre referenciado deixaria um script
 * que não chame `close()` pendurado para sempre (o `npm run smoke` é
 * exatamente isso); um worker sempre desreferenciado deixaria o Node sair no
 * meio de um cálculo, porque uma promise pendente não segura o processo — e
 * ali não haveria nem resposta nem erro, só um encerramento silencioso. No bot
 * isso ficaria escondido atrás do socket do gateway, que segura o loop de
 * qualquer forma; num script solto, não.
 *
 * Referenciar o filho e o stdout basta: é por ele que a resposta chega.
 */
function referenciar(worker) {
  worker.child.ref?.();
  worker.child.stdout.ref?.();
}

function desreferenciar(worker) {
  worker.child.unref?.();
  worker.child.stdout.unref?.();
}

/** Resolve como `null` tudo que estava esperando resposta. */
function encerrarPendentes(worker) {
  for (const pendente of worker.pending.values()) {
    clearTimeout(pendente.timer);
    pendente.resolve(null);
  }
  worker.pending.clear();
}

/** Encerra os pedidos em voo e esquece o worker atual. */
function derrubar(worker, motivo) {
  // Uma morte só chega por até três caminhos — 'error', 'close' e o close()
  // do shutdown —, e os três podem acontecer para o mesmo processo. Sem esta
  // trava a mesma morte relataria a causa duas vezes (com mensagens
  // diferentes, então nem o dedup por causa a segura) e estenderia o backoff
  // sem razão.
  if (worker.done) return;
  worker.done = true;

  if (_worker === worker) _worker = null;
  encerrarPendentes(worker);

  // Um worker que morreu SEM nunca ter respondido nada é quase sempre
  // instalação faltando, que não melhora tentando de novo na play seguinte.
  // Um que já serviu alguma coisa merece uma nova tentativa imediata: ali a
  // morte foi acidente, não configuração.
  if (worker.served === 0) {
    _blockedUntil = Date.now() + RESTART_BACKOFF_MS;
    reportPythonFailure('pythonWorker', `${motivo}${worker.stderr.trim() ? `: ${worker.stderr.trim()}` : ''}`);
  }

  try { worker.child.kill(); } catch { /* já morreu */ }
}

function iniciar() {
  const bin = pythonBin();

  let child;
  try {
    child = spawn(bin, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    _blockedUntil = Date.now() + RESTART_BACKOFF_MS;
    reportPythonFailure('pythonWorker:spawn', `falha ao iniciar "${bin}": ${error.message}`);
    return null;
  }

  const worker = { child, pending: new Map(), stderr: '', served: 0, buffer: '' };
  _stats.spawns++;

  // Nasce sem segurar o event loop: um worker ocioso não é motivo para o
  // processo seguir de pé, e sem isto um script que use o bot como biblioteca
  // (o `npm run smoke`, por exemplo) nunca terminaria sozinho.
  desreferenciar(worker);

  // Sem handler, um EPIPE (o filho morreu no meio de uma escrita) viraria
  // uncaughtException.
  child.stdin.on('error', () => {});

  child.stdout.on('data', (chunk) => {
    worker.buffer += chunk.toString();

    // O protocolo é uma resposta por linha; um chunk pode trazer várias, ou
    // meia. O resto fica no buffer para o próximo chunk completar.
    let quebra;
    while ((quebra = worker.buffer.indexOf('\n')) >= 0) {
      const linha = worker.buffer.slice(0, quebra);
      worker.buffer = worker.buffer.slice(quebra + 1);
      if (linha.trim()) receber(worker, linha);
    }
  });

  child.stderr.on('data', (chunk) => {
    if (worker.stderr.length < STDERR_MAX) worker.stderr += chunk.toString();
  });

  child.on('error', (error) => derrubar(worker, `falha ao iniciar "${bin}": ${error.message}`));
  child.on('close', () => derrubar(worker, 'o worker do Python encerrou'));

  return worker;
}

/** O worker de pé, ou null quando não dá para ter um agora. */
function garantir() {
  if (_worker) return _worker;
  if (Date.now() < _blockedUntil) return null;

  _worker = iniciar();
  return _worker;
}

// ─── Pedido e resposta ────────────────────────────────────────────────────────

function receber(worker, linha) {
  let resposta;
  try {
    resposta = JSON.parse(linha);
  } catch {
    // Linha que não é JSON no canal de respostas: algo escreveu no stdout que
    // não deveria, e o fluxo deixou de ser confiável.
    derrubar(worker, `resposta ilegível do Python: ${linha.slice(0, 200)}`);
    return;
  }

  const pendente = worker.pending.get(resposta.id);
  // Resposta sem dono é o caso normal de um pedido que já expirou — descartar
  // é o certo, e é por isso que cada pedido leva um id.
  if (!pendente) return;

  worker.pending.delete(resposta.id);
  clearTimeout(pendente.timer);
  if (worker.pending.size === 0) desreferenciar(worker);

  if (resposta.error) {
    _stats.failed++;
    // Erro de UM pedido (mapa problemático) não derruba o worker, então
    // `served` não conta — mas a causa merece o mesmo relato de sempre.
    reportPythonFailure('pythonWorker:calc', String(resposta.error));
    return pendente.resolve(null);
  }

  worker.served++;
  _stats.served++;
  pendente.resolve(resposta);
}

/**
 * Calcula o PP de um score no motor do Relax.
 *
 * @param {Uint8Array} mapBytes bytes do .osu, que quem chama já tem em cache
 * @param {object} params {mapId, mods, n300, n100, n50, nmiss, combo}
 * @returns {Promise<{pp: number, stars: number, maxCombo: number}|null>}
 */
function calcular(mapBytes, { mapId, mods, n300, n100, n50, nmiss, combo }) {
  const worker = garantir();
  if (!worker) return Promise.resolve(null);

  const id = _nextId++;
  const cabecalho = JSON.stringify({
    id,
    map_id: mapId,
    bytes:  mapBytes.length,
    mods,
    n300, n100, n50, nmiss, combo,
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      _stats.failed++;
      // Um pedido que não voltou significa worker travado ou fora de sincronia
      // com o fluxo de bytes — e nada depois dele seria confiável. Derrubar faz
      // a chamada seguinte subir um limpo.
      derrubar(worker, `o Python não respondeu em ${REQUEST_TIMEOUT_MS}ms`);
      resolve(null);
    }, REQUEST_TIMEOUT_MS);

    // O timer não precisa segurar o loop: enquanto o pedido está em voo, quem
    // segura é o próprio worker (ver referenciar).
    timer.unref?.();

    worker.pending.set(id, { resolve, timer });
    referenciar(worker);

    // Cabeçalho e corpo em escritas separadas, mas na ordem: o Python lê uma
    // linha e depois exatamente `bytes` bytes.
    //
    // Sob try/catch pelo mesmo motivo do `child.send` do lazerWorker: um filho
    // que morreu entre o `garantir()` e aqui faz a escrita falhar. Sem isto o
    // pedido não falhava — ficava pendurado até o timeout de 12s para dar o
    // mesmo `null` que se pode dar agora, e a causa real se perdia.
    try {
      worker.child.stdin.write(`${cabecalho}\n`);
      worker.child.stdin.write(Buffer.from(mapBytes));
    } catch (error) {
      worker.pending.delete(id);
      clearTimeout(timer);
      derrubar(worker, `não deu para falar com o Python: ${error.message}`);
      resolve(null);
    }
  });
}

/** Encerra o worker. Chamado no shutdown do bot (ver index.js). */
function close() {
  if (!_worker) return;

  const worker = _worker;
  _worker = null;

  // Marcado ANTES de mexer no processo: o 'close' do filho chega depois, e sem
  // isto um encerramento normal do bot passaria pelo `derrubar` — que, numa
  // sessão em que nenhum cálculo de RX aconteceu (`served === 0`), relataria
  // "PP do Relax indisponível" e ligaria o backoff por causa de um shutdown
  // que deu certo.
  worker.done = true;
  encerrarPendentes(worker);

  // Fechar o stdin é o fim normal do protocolo: o readline do Python devolve
  // vazio e ele sai sozinho, com código 0. O kill fica para quem não sair.
  try {
    worker.child.stdin.end();
    worker.child.kill();
  } catch { /* já morreu */ }
}

/** Contadores, para diagnóstico. */
function stats() {
  return { ..._stats, vivo: Boolean(_worker), bloqueadoAte: _blockedUntil };
}

module.exports = {
  calcular,
  close,
  stats,
  reportPythonFailure,
};
