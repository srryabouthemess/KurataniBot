/**
 * rosuWorkerThread.js
 * O corpo do worker thread que lê os atributos de mapa pelo rosu-pp. **Não
 * importe este arquivo do processo principal** — ele só faz sentido dentro de um
 * Worker.
 *
 * ── O que sobrou aqui ─────────────────────────────────────────────────────────
 * Estrelas e PP saíram deste arquivo quando o cálculo passou para o
 * lazer-calculator, que reproduz o número oficial exatamente (ver pp.js). O que
 * ficou é a única coisa que o motor novo NÃO expõe: CS/AR/OD/HP ajustados por
 * mod, o BPM na velocidade do clock e a contagem de objetos. É informação de
 * mapa, não de PP — a linha que o embed imprime ao lado do título —, e para ela
 * o rosu-pp serve inteiro: essas contas não mudam entre reworks.
 *
 * ── Por que uma thread ────────────────────────────────────────────────────────
 * O rosu-pp é Wasm síncrono: enquanto ele calcula, o event loop não anda. O
 * cálculo que sobrou é o barato dos dois, mas o parse (1,54ms nos 12 maiores
 * .osu do cache) continua acontecendo aqui, e uma página de mapas inéditos são
 * cinco deles seguidos — com o bot sem responder a ninguém e sem mandar
 * heartbeat para o gateway no meio.
 *
 * ── Por que o LRU de mapa mora AQUI ───────────────────────────────────────────
 * Guardar o mapa parseado deste lado é o que permite o processo principal mandar
 * os bytes UMA vez por mapa, em vez de 50–300KB por cálculo — e o que evita
 * reparsear o mesmo .osu a cada virada de página.
 *
 * A memória de um Beatmap é do Wasm, e o coletor do JS não a recolhe: cada um
 * precisa de `free()` explícito, inclusive ao ser descartado pelo teto.
 */

const { parentPort } = require('node:worker_threads');

// A lib é opcional: sem ela o bot continua respondendo, só sem os valores de PP
// calculados localmente. O erro vai na primeira resposta, para o lado de lá
// poder relatá-lo uma vez e parar de tentar.
let rosu = null;
let erroDeCarga = null;
try {
  rosu = require('rosu-pp-js');
} catch (error) {
  erroDeCarga = `rosu-pp-js indisponível: ${error.message}`;
}

// ─── Mapas já parseados ───────────────────────────────────────────────────────

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

/** mapId → rosu.Beatmap. A ordem de inserção é a ordem de uso (LRU). */
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

// ─── Operações ────────────────────────────────────────────────────────────────
// Todas recebem um Beatmap já parseado e devolvem valores simples — o que
// atravessa a fronteira da thread precisa ser serializável.

/**
 * Os números do mapa como quem jogou os sentiu: CS/AR/OD/HP já ajustados pelos
 * mods, o BPM na velocidade do clock, e quantos objetos o mapa tem.
 *
 * A conta dos mods não é uma multiplicação. AR e OD viram janela de tempo em
 * milissegundos, a janela é dividida pelo clock (1,5 no DT, 0,75 no HT) e o
 * resultado volta a ser AR/OD — passo que o `BeatmapAttributesBuilder` já faz.
 * Reescrevê-la em JS seria uma segunda implementação da mesma regra, livre para
 * divergir do número que o cálculo de PP exibido ao lado usa.
 *
 * `objects` sai daqui pelo mesmo motivo que o resto: o mapa já está parseado.
 * Ele é o denominador do "@47%" de uma play interrompida, e buscá-lo na API
 * seria uma requisição a mais por um dado que está a uma propriedade de
 * distância.
 *
 * Sem `lazer` de propósito: CS/AR/OD/HP não dependem da mecânica de slider, e o
 * builder não aceita o campo — mandá-lo à toa arrisca uma recusa da lib.
 */
function attributes(beatmap, { mods }) {
  const attrs = new rosu.BeatmapAttributesBuilder({ map: beatmap, mods }).build();

  return {
    cs: attrs.cs,
    ar: attrs.ar,
    od: attrs.od,
    hp: attrs.hp,
    clockRate: attrs.clockRate,
    bpm: beatmap.bpm * attrs.clockRate,
    objects: beatmap.nObjects,
  };
}

const OPERACOES = { attributes };

// ─── Protocolo ────────────────────────────────────────────────────────────────
// Pedido:  { id, op, mapId, args, bytes? }
// Resposta: { id, value }            deu certo
//           { id, needBytes: true }  o mapa não está parseado aqui; reenvie com bytes
//           { id, error }            não deu, e o motivo

parentPort.on('message', (pedido) => {
  const { id, op, mapId, args, bytes } = pedido;

  if (!rosu) {
    return parentPort.postMessage({ id, error: erroDeCarga });
  }

  try {
    let beatmap = pegarMapa(mapId);

    if (!beatmap) {
      // Pedir os bytes só quando faltam é o que evita mandar 50–300KB por
      // cálculo: numa página, as 5 plays de mapas distintos viajam uma vez cada,
      // e virar a página de volta não faz nenhuma viajar de novo.
      if (!bytes) return parentPort.postMessage({ id, needBytes: true });

      beatmap = new rosu.Beatmap(bytes);
      guardarMapa(mapId, beatmap);
    }

    const executar = OPERACOES[op];
    if (!executar) return parentPort.postMessage({ id, error: `operação desconhecida: ${op}` });

    parentPort.postMessage({ id, value: executar(beatmap, args) });
  } catch (error) {
    // Mapa problemático responde erro e a thread continua de pé: derrubá-la
    // puniria as outras plays da mesma página.
    parentPort.postMessage({ id, error: error?.message ?? String(error) });
  }
});
