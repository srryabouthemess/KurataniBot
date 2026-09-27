/**
 * wasmThread.js
 * O que as threads dos motores Wasm têm em comum: carregar o pacote, guardar os
 * mapas parseados e falar o protocolo com o wasmWorker.js. **Não importe este
 * arquivo do processo principal** — ele só faz sentido dentro de um Worker.
 *
 * Cada motor (rosuWorkerThread.js, akatsukiWorkerThread.js) só diz quais
 * operações sabe fazer; o transporte é o mesmo para todos.
 *
 * ── Por que o LRU de mapa mora AQUI ───────────────────────────────────────────
 * Guardar o mapa parseado deste lado é o que permite o processo principal mandar
 * os bytes UMA vez por mapa, em vez de 50–300KB por cálculo — e o que evita
 * reparsear o mesmo .osu no caminho das estrelas e de novo no do FC pp.
 *
 * A memória de um Beatmap é do Wasm, e o coletor do JS não a recolhe: cada um
 * precisa de `free()` explícito, inclusive ao ser descartado pelo teto.
 */

const { parentPort, workerData } = require('node:worker_threads');

/**
 * Teto de mapas parseados guardados.
 *
 * Pequeno de propósito: o que se quer cobrir é uma página (5 plays) e o vaivém
 * entre páginas vizinhas, não o histórico inteiro. Cada Beatmap parseado ocupa
 * memória Wasm da ordem do .osu que o gerou, então um teto generoso aqui é
 * dezenas de MB parados para servir um acerto raro — o cache em disco é quem
 * cobre o longo prazo.
 */
const MAX_MAPAS = 12;

/** mapId → Beatmap. A ordem de inserção é a ordem de uso (LRU). */
const _mapas = new Map();

function pegarMapa(mapId) {
  const beatmap = _mapas.get(mapId);
  if (!beatmap) return null;

  // Reinserir move para o fim: no Map, reatribuir uma chave NÃO muda a posição
  // dela, e é a ordem de inserção que o descarte abaixo lê como "mais antigo".
  _mapas.delete(mapId);
  _mapas.set(mapId, beatmap);
  return beatmap;
}

function guardarMapa(mapId, beatmap) {
  const anterior = _mapas.get(mapId);
  if (anterior) {
    _mapas.delete(mapId);
    anterior.free();
  }

  _mapas.set(mapId, beatmap);

  while (_mapas.size > MAX_MAPAS) {
    const [maisAntigo, descartado] = _mapas.entries().next().value;
    _mapas.delete(maisAntigo);
    // Sem este free() a memória Wasm fica presa até o processo morrer: o
    // coletor do JS não sabe nada sobre ela.
    descartado.free();
  }
}

/**
 * Carrega o pacote do `workerData.pacote` e passa a atender pedidos.
 *
 * @param {(lib: object) => Record<string, (beatmap: object, args: object) => object>} montar
 *   recebe a lib carregada e devolve as operações que o motor sabe fazer. Toda
 *   operação recebe um Beatmap já parseado e devolve valores simples — o que
 *   atravessa a fronteira da thread precisa ser serializável.
 */
function servir(montar) {
  // A lib é opcional: sem ela o bot continua respondendo, só sem os valores de
  // PP calculados localmente. O erro vai na primeira resposta, para o lado de lá
  // poder relatá-lo uma vez e parar de tentar.
  let lib = null;
  let operacoes = null;
  let erroDeCarga = null;
  try {
    lib = require(workerData.pacote);
    operacoes = montar(lib);
  } catch (error) {
    erroDeCarga = `${workerData?.pacote} indisponível: ${error.message}`;
  }

  // ─── Protocolo ──────────────────────────────────────────────────────────────
  // Pedido:  { id, op, mapId, args, bytes? }
  // Resposta: { id, value }            deu certo
  //           { id, needBytes: true }  o mapa não está parseado aqui; reenvie com bytes
  //           { id, error }            não deu, e o motivo
  parentPort.on('message', (pedido) => {
    const { id, op, mapId, args, bytes } = pedido;

    if (!lib) {
      return parentPort.postMessage({ id, error: erroDeCarga });
    }

    try {
      let beatmap = pegarMapa(mapId);

      if (!beatmap) {
        // Pedir os bytes só quando faltam é o que evita mandar 50–300KB por
        // cálculo: numa página, as 5 plays de mapas distintos viajam uma vez
        // cada, e virar a página de volta não faz nenhuma viajar de novo.
        if (!bytes) return parentPort.postMessage({ id, needBytes: true });

        beatmap = new lib.Beatmap(bytes);
        guardarMapa(mapId, beatmap);
      }

      const executar = operacoes[op];
      if (!executar) return parentPort.postMessage({ id, error: `operação desconhecida: ${op}` });

      parentPort.postMessage({ id, value: executar(beatmap, args) });
    } catch (error) {
      // Mapa problemático responde erro e a thread continua de pé: derrubá-la
      // puniria as outras plays da mesma página.
      parentPort.postMessage({ id, error: error?.message ?? String(error) });
    }
  });
}

module.exports = { servir };
