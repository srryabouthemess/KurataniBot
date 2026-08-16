/**
 * lazerWorkerChild.js
 * O corpo do processo que calcula estrelas e PP pelo lazer-calculator.
 * **Não importe este arquivo do processo principal** — ver o aviso abaixo.
 *
 * ── Por que um PROCESSO, e não um worker thread como o rosu-pp ────────────────
 * O @tosuapp/lazer-calculator é uma binding NAPI para o C# do osu!lazer,
 * compilado em NativeAOT. O runtime .NET que ele carrega NÃO descarrega: o
 * simples `require()` da lib, sem calcular nada, faz o processo terminar em
 * segfault. Medido nas quatro formas:
 *
 *   require só, e sai            → SIGSEGV
 *   worker thread, saída natural → SIGSEGV
 *   worker thread + terminate()  → SIGSEGV, e ANTES do db.close() do shutdown
 *   processo-filho + exit        → pai sai 0, íntegro
 *
 * O cálculo em si é correto e completo — o que quebra é só a descida. Num worker
 * thread isso derruba o bot inteiro, e no meio do encerramento gracioso, com o
 * banco ainda aberto. Num processo separado o estrago fica todo do lado de lá,
 * que é exatamente o desenho que o pythonWorker.js já usa pelo mesmo motivo.
 *
 * ── Por que o LRU de mapa mora AQUI ───────────────────────────────────────────
 * Igual ao rosuWorkerThread: guardar o mapa parseado deste lado é o que permite
 * o processo principal mandar os bytes UMA vez por mapa em vez de 50–300KB por
 * cálculo, e o que evita reparsear o mesmo .osu no caminho das estrelas e de
 * novo no do FC pp. Aqui o parse custa ~18ms (contra 1,5ms do rosu-pp), então
 * repetir sai bem mais caro do que saía antes.
 */

const lz = require('@tosuapp/lazer-calculator-prebuilt');

// ─── Mapas já parseados ───────────────────────────────────────────────────────

/**
 * Teto de mapas parseados guardados.
 *
 * Mesmo raciocínio do rosuWorkerThread — cobrir uma página (5 plays) e o vaivém
 * entre páginas vizinhas —, mas o teto é menor: cada PlayBeatmap aqui é objeto
 * gerenciado pelo .NET, e o processo já nasce com ~90MB de runtime. O cache em
 * disco continua sendo quem cobre o longo prazo.
 */
const MAX_MAPAS = 8;

/** mapId → lz.PlayBeatmap. A ordem de inserção é a ordem de uso (LRU). */
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
  _mapas.delete(mapId);
  _mapas.set(mapId, beatmap);

  // Sem free() explícito, ao contrário do rosu-pp: a memória aqui é do heap do
  // .NET, e o coletor de lá a recolhe sozinho quando a referência sai do Map.
  while (_mapas.size > MAX_MAPAS) {
    _mapas.delete(_mapas.entries().next().value[0]);
  }
}

// ─── Mods ─────────────────────────────────────────────────────────────────────

/**
 * Acrônimos → o formato que a lib espera.
 *
 * A diferença para o rosu-pp é o fim de uma perda de informação: lá os mods
 * viravam bitmask (`modsToBits`), que não tem onde guardar AJUSTE de mod — um
 * DT a 1,3x e um DT a 1,5x davam o mesmo bit e o mesmo número. Aqui cada mod
 * carrega os próprios ajustes, e o CL deixa de ser um booleano à parte para ser
 * o mod que ele é de verdade.
 *
 * @param {Array<string|{acronym: string, settings?: object}>} mods
 */
function traduzirMods(mods) {
  return (mods ?? []).map((mod) => {
    const acronym = typeof mod === 'string' ? mod : mod.acronym;
    const settings = typeof mod === 'string' ? null : mod.settings;
    return { acronym, settings: new Map(Object.entries(settings ?? {})) };
  });
}

/**
 * Atributos de dificuldade do mapa com os mods aplicados.
 *
 * `passedObjects` é o que torna honesta uma play interrompida: o cálculo gradual
 * para no objeto em que a pessoa parou, e a dificuldade passa a ser a do TRECHO
 * jogado. Conferido que `skip(nObjects)` devolve exatamente o mesmo que
 * `skipToEnd()`, então o caminho é um só — não há ramo especial para o mapa
 * inteiro que possa divergir do parcial.
 */
function dificuldade(beatmap, mods, passedObjects) {
  beatmap.applyMods(traduzirMods(mods));

  const gradual = beatmap.createGradualDifficulty();
  if (passedObjects != null) gradual.skip(passedObjects);
  else gradual.skipToEnd();

  return gradual.createDifficultyAttrs();
}

const contarObjetos = (d) => d.nCircles + d.nSliders + d.nSpinners;

// ─── Montagem do score ────────────────────────────────────────────────────────

/**
 * Monta o ScoreInfoData que o calculador de performance espera.
 *
 * TODOS os campos são obrigatórios: omitir um só derruba a chamada com
 * "A number was expected" vindo do marshalling do .NET, e não com um erro que
 * diga qual campo falta. Daí o objeto ser montado inteiro num lugar só.
 *
 * ── `legacyTotalScore` não é detalhe ──────────────────────────────────────────
 * Para score de mecânica clássica (mod CL), o campo `totalScore` vira
 * `LegacyTotalScore` lá dentro, e alimenta a estimativa de miss POR SCORE — que
 * o osu! usa junto da estimativa por combo, ficando com a maior das duas. Passar
 * o score do lazer no lugar do legado, ou zero, derruba o resultado num choke:
 * medido num top play do mrekk, 1052.16pp contra os 1781.65pp corretos, −41%.
 *
 * Zero é o valor certo para score HIPOTÉTICO (FC e /simulate), que não tem score
 * total nenhum: aí só a estimativa por combo opera, que é o que se quer.
 */
function montarScore({ beatmap, diffAttrs, mods, n300, n100, n50, misses,
                       combo, sliderEndHits, largeTickHits, legacyTotalScore }) {
  const dados = diffAttrs.getData();
  const objetos = contarObjetos(dados);
  const classico = (mods ?? []).some((m) => (typeof m === 'string' ? m : m.acronym) === 'CL');

  // Sem os 300s informados, sobra deduzir: todo objeto que não foi 100, 50 ou
  // miss foi 300. Vale para play completa e para simulação hipotética. Numa play
  // INTERROMPIDA a dedução inventaria um 300 para cada objeto que a pessoa nunca
  // viu — por isso quem chama informa o valor real nesse caso (ver scorePP.js).
  const greats = n300 ?? Math.max(0, objetos - (n100 ?? 0) - (n50 ?? 0) - (misses ?? 0));

  const score = {
    totalScore: legacyTotalScore ?? 0,
    isLegacyScore: classico,
    maxCombo: combo ?? dados.maxCombo,

    // Na mecânica clássica os fins de slider não são rastreados e contam todos
    // como acertados; no lazer eles são resultado de verdade, e quem chama passa
    // o número real quando o servidor informou.
    sliderEndHits: sliderEndHits ?? dados.nSliders,
    largeTickHits: largeTickHits ?? 0,

    comboBreaks: 0, ignoreHits: 0, ignoreMisses: 0,
    largeBonuses: 0, smallBonuses: 0,
    largeTickMisses: 0, smallTickHits: 0, smallTickMisses: 0,
    perfects: 0, goods: 0,

    greats,
    oks: n100 ?? 0,
    mehs: n50 ?? 0,
    misses: misses ?? 0,

    // Placeholder: a accuracy correta sai do próprio calculador, logo abaixo.
    accuracy: 0,
  };

  // A accuracy é função dos acertos E dos mods, e a fórmula muda por modo de
  // jogo. Calcular aqui em vez de aceitar a do servidor evita duas bases
  // diferentes para o mesmo score — e é obrigatório para score hipotético, que
  // não tem accuracy nenhuma para informar.
  score.accuracy = beatmap.calculateAccuracy(score);
  return score;
}

// ─── Operações ────────────────────────────────────────────────────────────────
// Todas recebem um PlayBeatmap já parseado e devolvem valores simples — o que
// atravessa a fronteira do processo precisa ser serializável.

function difficulty(beatmap, { mods }) {
  const dados = dificuldade(beatmap, mods).getData();
  return { stars: dados.stars, maxCombo: dados.maxCombo ?? null };
}

/**
 * PP de um FC hipotético: os misses viram 300 (é o que "se tivesse sido FC"
 * quer dizer) e o combo é o máximo do mapa.
 */
function fc(beatmap, { mods, n300, n100, n50, misses }) {
  const diffAttrs = dificuldade(beatmap, mods);

  const score = montarScore({
    beatmap, diffAttrs, mods,
    // Sem os acertos reais não há o que somar, e a dedução do montarScore (tudo
    // que não foi 100/50/miss é 300) já descreve o FC corretamente.
    n300: n300 === null || n300 === undefined ? null : n300 + (misses ?? 0),
    n100, n50,
    misses: 0,
    combo: null,      // null = combo máximo do mapa, que é o que FC significa
  });

  return { pp: beatmap.calculatePerformance(diffAttrs, score).pp };
}

/** PP de um score hipotético ou já jogado. */
function simulate(beatmap, { mods, n300, n100, n50, misses, combo,
                             passedObjects, sliderEndHits, largeTickHits, legacyTotalScore }) {
  const diffAttrs = dificuldade(beatmap, mods, passedObjects);
  const dados = diffAttrs.getData();

  const score = montarScore({
    beatmap, diffAttrs, mods, n300, n100, n50, misses,
    // Combo negativo é o "não sei" que vem do pp.js; aí vale o máximo do mapa.
    combo: combo != null && combo >= 0 ? combo : null,
    sliderEndHits, largeTickHits, legacyTotalScore,
  });

  return {
    pp: beatmap.calculatePerformance(diffAttrs, score).pp,
    stars: dados.stars,
    maxCombo: dados.maxCombo,
  };
}

const OPERACOES = { difficulty, fc, simulate };

// ─── Protocolo ────────────────────────────────────────────────────────────────
// Idêntico ao do rosuWorker, e de propósito: o que muda entre os dois motores é
// o transporte e o motor, não a conversa.
//
// Pedido:   { id, op, mapId, args, bytes? }
// Resposta: { id, value }            deu certo
//           { id, needBytes: true }  o mapa não está parseado aqui; reenvie com bytes
//           { id, error }            não deu, e o motivo

process.on('message', (pedido) => {
  const { id, op, mapId, args, bytes } = pedido;

  try {
    let beatmap = pegarMapa(mapId);

    if (!beatmap) {
      // Pedir os bytes só quando faltam é o que evita mandar 50–300KB por
      // cálculo: numa página, as 5 plays de mapas distintos viajam uma vez cada,
      // e virar a página de volta não faz nenhuma viajar de novo.
      if (!bytes) return process.send({ id, needBytes: true });

      // A lib parseia texto, não bytes — daí o toString, que o rosu-pp não
      // precisava. O .osu é UTF-8 por especificação.
      beatmap = lz.PlayBeatmap.parse(Buffer.from(bytes).toString('utf8'));
      guardarMapa(mapId, beatmap);
    }

    const executar = OPERACOES[op];
    if (!executar) return process.send({ id, error: `operação desconhecida: ${op}` });

    process.send({ id, value: executar(beatmap, args) });
  } catch (error) {
    // Mapa problemático responde erro e o processo continua de pé: derrubá-lo
    // puniria as outras plays da mesma página, e subir outro custa ~90MB e o
    // reparse de tudo que estava guardado.
    process.send({ id, error: error?.message ?? String(error) });
  }
});

// O pai fecha o canal de IPC para pedir a saída (ver lazerWorker.close). Sem
// isto o processo ficaria vivo à toa depois de o bot encerrar.
process.on('disconnect', () => process.exit(0));
