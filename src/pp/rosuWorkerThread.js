/**
 * rosuWorkerThread.js
 * O corpo do worker thread que calcula estrelas, PP e atributos de mapa pelo
 * rosu-pp. **Não importe este arquivo do processo principal** — ele só faz
 * sentido dentro de um Worker.
 *
 * ── Qual rosu-pp ──────────────────────────────────────────────────────────────
 * O build vem no `workerData.pacote`: cada servidor calcula no rosu-pp que ele
 * roda (ver engines.js), e cada build tem a sua thread. Os dois são do fork
 * (srryabouthemess/rosu-pp) e moram em `vendor/` (ver docs/OPCIONAIS.md para
 * refazer o build):
 *
 *   rosu-pp-bancho  → branch `pp-update-lazer-master`, que segue o osu!lazer
 *                     master: medido contra a API oficial em 613 scores dos
 *                     quatro modos, o erro relativo fica na casa de 1e-6.
 *   rosu-pp-daycore → o commit que o bancho.py do Daycore usa no vanilla.
 *
 * ── Por que uma thread ────────────────────────────────────────────────────────
 * O rosu-pp é Wasm síncrono: enquanto ele calcula, o event loop não anda. Uma
 * página de mapas inéditos são cinco parses e cinco cálculos seguidos — com o
 * bot sem responder a ninguém e sem mandar heartbeat para o gateway no meio.
 *
 * ── Por que o LRU de mapa mora AQUI ───────────────────────────────────────────
 * Guardar o mapa parseado deste lado é o que permite o processo principal mandar
 * os bytes UMA vez por mapa, em vez de 50–300KB por cálculo — e o que evita
 * reparsear o mesmo .osu no caminho das estrelas e de novo no do FC pp.
 *
 * A memória de um Beatmap é do Wasm, e o coletor do JS não a recolhe: cada um
 * precisa de `free()` explícito, inclusive ao ser descartado pelo teto. O mesmo
 * vale para os calculadores e os atributos que eles devolvem (ver `usar`).
 */

const { parentPort, workerData } = require('node:worker_threads');

const { modAcronym, modsToBits, clockRate } = require('../mods');

// A lib é opcional: sem ela o bot continua respondendo, só sem os valores de PP
// calculados localmente. O erro vai na primeira resposta, para o lado de lá
// poder relatá-lo uma vez e parar de tentar.
let rosu = null;
let erroDeCarga = null;
try {
  rosu = require(workerData.pacote);
} catch (error) {
  erroDeCarga = `${workerData?.pacote} indisponível: ${error.message}`;
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

// ─── Mods ─────────────────────────────────────────────────────────────────────

const classico = (mods) => (mods ?? []).some((mod) => modAcronym(mod) === 'CL');

/**
 * Roda `calcular` com os mods inteiros e, se o rosu-pp recusar a lista, de novo
 * com bitmask + rate.
 *
 * Os mods vão como objeto porque é o único jeito de o ajuste de cada um (um DT a
 * 1,4x, o `no_slider_head_accuracy` do CL) chegar ao motor. Só que o rosu-pp
 * recusa a lista INTEIRA quando encontra um acrônimo ou ajuste que não conhece
 * (`failed to deserialize mods`), e os mods vêm da API oficial, que ganha mod
 * novo sem avisar. Sem o segundo caminho, um mod inédito apagaria a estrela e o
 * pp da play. O bitmask perde o que não tem bit, mas o rate viaja ao lado e o
 * CL vira o `lazer: false` que os dois caminhos já mandam.
 */
function comMods(mods, calcular) {
  try {
    return calcular({ mods: mods ?? [], clockRate: null });
  } catch (error) {
    if (!/deserialize mods/i.test(error?.message ?? '')) throw error;
    return calcular({ mods: modsToBits(mods), clockRate: clockRate(mods) });
  }
}

/** Executa `fn` com um objeto Wasm e o libera em seguida, dê certo ou não. */
function usar(objeto, fn) {
  try {
    return fn(objeto);
  } finally {
    objeto.free();
  }
}

/**
 * Calcula a performance e devolve só números — o resultado é memória Wasm, e
 * não atravessa a fronteira da thread.
 *
 * `lazer` sai do CL: sem ele o rosu-pp assume mecânica de lazer, que conta fim de
 * slider e pesa o combo de outro jeito. É o mesmo "CL na lista quer dizer
 * stable" que o pp.js já garante no engineMods.
 *
 * ── `legacyTotalScore` só em score clássico ───────────────────────────────────
 * Ele alimenta a estimativa de miss POR SCORE, que o osu! usa junto da
 * estimativa por combo ficando com a maior das duas. Passar o score do lazer no
 * lugar do legado derruba o resultado num choke (medido num top play do mrekk:
 * 1052.16pp contra os 1781.65pp corretos). Score hipotético manda null, e aí só
 * a estimativa por combo opera. (No lazer master, zero passou a valer o mesmo
 * que null; no lazer-calculator de antes, 0 achava miss de mais.)
 */
function performance(beatmap, mods, estado) {
  const lazer = !classico(mods);

  return comMods(mods, (argsMods) => usar(
    new rosu.Performance({
      ...argsMods,
      lazer,
      n300:   estado.n300   ?? null,
      n100:   estado.n100   ?? null,
      n50:    estado.n50    ?? null,
      misses: estado.misses ?? null,
      combo:  estado.combo  ?? null,
      passedObjects: estado.passedObjects ?? null,
      legacyTotalScore: lazer ? null : (estado.legacyTotalScore ?? null),
      sliderEndHits: estado.sliderEndHits ?? null,
      largeTickHits: estado.largeTickHits ?? null,
      smallTickHits: estado.smallTickHits ?? null,
    }),
    (calc) => usar(calc.calculate(beatmap), (attrs) => ({
      pp: attrs.pp,
      stars: attrs.difficulty.stars,
      maxCombo: attrs.difficulty.maxCombo,
    })),
  ));
}

// ─── Operações ────────────────────────────────────────────────────────────────
// Todas recebem um Beatmap já parseado e devolvem valores simples — o que
// atravessa a fronteira da thread precisa ser serializável.

function difficulty(beatmap, { mods }) {
  const lazer = !classico(mods);

  return comMods(mods, (argsMods) => usar(
    new rosu.Difficulty({ ...argsMods, lazer }),
    (calc) => usar(calc.calculate(beatmap), (attrs) => ({
      stars: attrs.stars,
      maxCombo: attrs.maxCombo ?? null,
    })),
  ));
}

/**
 * PP de um FC hipotético: os misses viram 300 (é o que "se tivesse sido FC"
 * quer dizer) e o combo é o máximo do mapa.
 *
 * Sem os 300 reais, o rosu-pp deduz: tudo que não foi 100, 50 ou miss é 300, o
 * que descreve o FC do mesmo jeito.
 */
function fc(beatmap, { mods, n300, n100, n50, misses }) {
  const { pp } = performance(beatmap, mods, {
    n300: n300 == null ? null : n300 + (misses ?? 0),
    n100, n50,
    misses: 0,
  });
  return { pp };
}

/**
 * PP de um score hipotético ou já jogado.
 *
 * `passedObjects` é o que torna honesta uma play interrompida: a dificuldade
 * passa a ser a do TRECHO jogado, e o combo máximo devolvido também.
 */
function simulate(beatmap, { mods, n300, n100, n50, misses, combo, passedObjects,
                             legacyTotalScore, sliderEndHits, largeTickHits, smallTickHits }) {
  return performance(beatmap, mods, {
    n300, n100, n50, misses,
    // Combo negativo é o "não sei" que vem do pp.js; aí vale o máximo do mapa.
    combo: combo != null && combo >= 0 ? combo : null,
    passedObjects, legacyTotalScore, sliderEndHits, largeTickHits, smallTickHits,
  });
}

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
 *
 * ── Por que o rate vem de fora, e não dos mods ────────────────────────────────
 * O `clockRate` explícito é como o ajuste de velocidade do lazer (um DT a 1,4x)
 * chega até aqui: o bitmask não tem onde guardá-lo, e o DC nem bit tem.
 *
 * O rosu-pp aceitaria os mods como OBJETO, com os ajustes dentro, e daria o
 * mesmo número — conferido, AR 10.1429 e OD 8.8095 pelos dois caminhos. Mas ele
 * recusa a lista INTEIRA quando encontra um acrônimo ou um nome de ajuste que
 * não conhece (medido: `all modes failed to deserialize mods`), e aí o
 * getMapAttrs volta null e a linha do mapa some do embed. Como os mods vêm da
 * API oficial, que ganha mod novo sem avisar, o bitmask + um número é o caminho
 * que não quebra por vocabulário.
 */
function attributes(beatmap, { mods, clockRate }) {
  const attrs = new rosu.BeatmapAttributesBuilder({
    map: beatmap,
    mods,
    // null é o "deduza dos mods" do próprio rosu-pp, e é o que vale para quem
    // não tem mod de velocidade nenhum.
    clockRate: Number.isFinite(clockRate) ? clockRate : null,
  }).build();

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

const OPERACOES = { attributes, difficulty, fc, simulate };

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
