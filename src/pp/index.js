/**
 * pp.js
 * Cálculo de performance points e tudo que ele precisa.
 *
 * Saiu do osuClient porque não é cliente de API nenhuma. O que sobrou aqui,
 * depois de os motores irem para fora do processo principal (wasmWorker.js) e o
 * download do .osu para o beatmapFile.js, é a decisão:
 * o que vale a pena calcular, com os mods em que forma, e onde o resultado fica
 * guardado. QUAL motor responde por cada servidor está no engines.js.
 *
 * A dependência é de mão única — o osuClient importa daqui, e não o contrário.
 */

const db = require('../db');
const servers = require('../servers');
const {
  modsToBits, stripClassic, stripImpliedDT, difficultyMods, canonicalMods,
  clockRate, modAcronym,
} = require('../mods');
const { logErrorOnce } = require('../lib/logger');
const { getBeatmapFile } = require('./beatmapFile');
const { TtlCache } = require('../lib/ttlCache');
const wasmWorker = require('./wasmWorker');
const { MOTORES, motorDe } = require('./engines');

const DEFAULT_MODE = servers.defaultKey();

// ─── Os motores de PP ─────────────────────────────────────────────────────────
// Cada servidor calcula no motor que ele próprio roda (ver engines.js):
//
//   rosu-pp (fork, Wasm)  — um build para o Bancho, que segue o osu!lazer master
//                           e confere com a API oficial em 1e-6; outro para o
//                           vanilla do Daycore e de quem não tem rework próprio.
//   akatsuki-pp (Wasm)    — o osuAkatsuki/akatsuki-pp-rs: um build no commit do
//                           Akatsuki, para os dois leaderboards dele; outro no do
//                           Relax do Daycore e de quem não tem rework próprio.
//
// A linha de informação do mapa (CS/AR/OD/HP, BPM, objetos) sai sempre do build
// do Bancho: ela não depende de rework nenhum.
//
// Todos rodam fora do processo principal, porque Wasm é síncrono e paralisaria
// o event loop. Os pacotes são opcionais — sem eles o bot continua respondendo,
// só sem os valores calculados localmente.

/**
 * Os mods como o motor de cálculo precisa vê-los.
 *
 * O que era um booleano `lazer` virou um mod de verdade. A mecânica de slider
 * agora se diz com o CL (Classic) na lista, que é como o próprio osu! a
 * representa — e é o que permite o cache ter uma chave só, em vez de uma coluna
 * de mods mais uma coluna `lazer` ao lado.
 *
 * A regra é a mesma de sempre, só escrita do outro lado:
 *  - bancho.py: nenhum servidor desses roda lazer, então o CL entra sempre.
 *  - Oficial: o score já chega com CL quando foi jogado na mecânica antiga, e
 *    quase todo score ranqueado é assim. Sem CL, é lazer de verdade.
 *
 * @returns {string[]} novo array; o de quem chamou não é tocado
 */
function engineMods(mode, mods) {
  const lista = mods ?? [];
  // Por acrônimo, porque o CL também pode chegar como objeto com ajustes
  // (`no_slider_head_accuracy` e afins): com `includes`, um CL desses não seria
  // reconhecido e a lista sairia daqui com dois.
  if (servers.isOfficial(mode) || lista.some(mod => modAcronym(mod) === 'CL')) return [...lista];
  return [...lista, 'CL'];
}

/**
 * Os mods como o motor vanilla precisa vê-los, que não é como o bitmask os guarda.
 *
 * Lá cada mod carrega o próprio ajuste de velocidade, então o `['DT','NC']` que
 * um score de nightcore de bancho.py produz pede DOIS aumentos: medido, 3.6362★
 * contra os 2.0619★ corretos, e o pp sai junto. O `stripImpliedDT` explica o
 * resto, inclusive por que o caminho do Relax NÃO passa por aqui.
 *
 * Ele entra antes da chave de cache, e não só antes da chamada, de propósito: a
 * `map_difficulty` não tem TTL, e uma estrela errada gravada com a chave antiga
 * valeria para sempre. Com a chave mudando junto, as linhas erradas que já
 * existem simplesmente deixam de ser encontradas.
 */
const lazerMods = (mods) => stripImpliedDT(mods);

/**
 * Manda uma operação para a thread do build daquele motor.
 *
 * Os bytes do mapa só são buscados se a thread não tiver aquele mapa parseado —
 * ela pede, e só então o download/cache é consultado (ver wasmWorker.js).
 */
const noMotor = (motor, op, mapId, args) =>
  wasmWorker.calcular(motor, op, mapId, args, () => getBeatmapFile(mapId));

/**
 * Os mods na forma que o motor recebe, que também é a forma da chave de cache.
 *
 * O akatsuki-pp é bitmask e lê a velocidade só do bit do DT, então o nightcore
 * vai com o DT junto — tirá-lo apagaria o mod inteiro, e é o que o stable manda
 * e o bancho.py do Daycore garante (ver akatsukiWorkerThread.js). O rosu-pp
 * precisa do corte contrário (ver lazerMods).
 */
function modsDoMotor(motor, mods) {
  if (motor.tipo !== 'akatsuki') return lazerMods(mods);
  const lista = [...(mods ?? [])];
  const tem = (acr) => lista.some(mod => modAcronym(mod) === acr);
  if (tem('NC') && !tem('DT')) lista.push('DT');
  return lista;
}

/**
 * Calcula estrelas e combo máximo de um mapa com um dado conjunto de mods,
 * e persiste o resultado.
 *
 * Isto substitui o POST em /beatmaps/{id}/attributes que o getAdjustedStars
 * fazia a cada exibição: o rosu-pp já estava no projeto e o simulatePP já
 * lia diffAttrs.stars daqui. Cacheado por (mapa, mods, motor), como a
 * osu_map_difficulty do BathBot.
 *
 * ── Qual motor ────────────────────────────────────────────────────────────────
 * O mesmo que calcula o PP exibido ao lado (ver engines.js): a estrela de um
 * rework não é a do outro. No Relax isso é gritante — o lazer TEM um caminho
 * para o RX (zera a velocidade e corta o flashlight), mas é o RX do osu!lazer,
 * não o dos servidores de Relax, e era ele que estava na tela.
 *
 * @param {string} [mode] chave do servidor, que decide o motor
 * @returns {Promise<{stars: number, maxCombo: number|null}|null>}
 */
async function getDifficultyAttrs(mapId, mods, mode = DEFAULT_MODE) {
  const motor = motorDe(mode);
  // Entra ANTES da chave, ver lazerMods.
  const modsMotor = modsDoMotor(motor, mods);
  const chaveMods = canonicalMods(modsMotor);

  const cached = db.getMapDifficulty(mapId, chaveMods, motor.cache);
  if (cached) return cached;

  // O akatsuki-pp é bitmask; o rosu-pp leva a lista (ver modsDoMotor).
  const attrs = await noMotor(motor, 'difficulty', mapId, {
    mods: motor.tipo === 'akatsuki' ? modsToBits(modsMotor) : modsMotor,
  });
  if (!attrs || !Number.isFinite(attrs.stars)) return null;

  // Combo zero quer dizer "mapa sem objeto nenhum", que não existe de verdade.
  // O rosu-pp NÃO recusa um .osu corrompido: ele parseia o que der e devolve um
  // mapa degenerado — medido com lixo puro na entrada, 0.14★ e combo 0, sem
  // erro nenhum. Sem esta guarda, um download
  // truncado virava estrela sem sentido E ficava gravado no cache, onde não
  // vence nunca (a map_difficulty não tem TTL, porque o resultado deveria ser
  // função pura do arquivo).
  if (!attrs.maxCombo) return null;

  // Só os dois campos, e não o `attrs` inteiro: um campo que a primeira chamada
  // tem e a seguinte, vinda do cache, não tem é pior do que não existir.
  const resultado = { stars: attrs.stars, maxCombo: attrs.maxCombo };

  db.setMapDifficulty(mapId, chaveMods, motor.cache, resultado.stars, resultado.maxCombo);
  return resultado;
}

/**
 * CS/AR/OD/HP, BPM e contagem de objetos do mapa, já com os mods aplicados.
 * É o que a linha de informação do mapa mostra nos embeds.
 *
 * Cache em memória, e não no cache.db como as estrelas: o cálculo é uma conta
 * sobre o mapa que a thread já tem parseado — barato o bastante para não valer
 * uma tabela nova (que ainda teria de ser migrada em toda instalação). O que se
 * quer evitar aqui é repetir a viagem até a thread a cada virada de página do
 * mesmo mapa.
 *
 * @param {number} beatmapId
 * @param {Array<string|{acronym: string, settings?: object}>} mods como vêm do
 *   score: acrônimo puro, ou com os ajustes quando a play mudou algum
 * @returns {Promise<{cs: number, ar: number, od: number, hp: number,
 *                    clockRate: number, bpm: number, objects: number}|null>}
 */
const MAP_ATTRS_TTL_MS = 6 * 60 * 60 * 1000;
const MAP_ATTRS_MAX    = 500;
const _mapAttrs = new TtlCache({ ttlMs: MAP_ATTRS_TTL_MS, max: MAP_ATTRS_MAX });

async function getMapAttrs(beatmapId, mods) {
  if (!beatmapId) return null;

  // O CL não muda mapa nenhum (ver stripClassic em mods.js): mantê-lo na chave
  // só separaria em duas entradas o que é o mesmo cálculo.
  const semCL = stripClassic(mods);

  // A chave deixou de ser o bitmask porque ele não distingue um DT a 1,4x de um
  // a 1,5x — e a linha do mapa é justamente onde a diferença aparece (168 BPM
  // contra 180, AR 10.14 contra 10.33).
  const chave = `${beatmapId}:${canonicalMods(semCL)}`;

  const cached = _mapAttrs.get(chave);
  if (cached) return cached;

  // O rate viaja como número ao lado do bitmask: é o que o bit não sabe dizer,
  // e mandar os mods como objeto arriscaria o rosu-pp recusar a lista inteira
  // por um acrônimo que ele não conhece (ver rosuWorkerThread.js).
  //
  // Build do Bancho para qualquer servidor: CS/AR/OD/BPM não dependem de rework.
  const attrs = await noMotor(MOTORES.bancho, 'attributes', beatmapId, {
    mods: modsToBits(semCL),
    clockRate: clockRate(semCL),
  });
  // Mapa que não deu para baixar volta null; o degenerado que o rosu-pp aceita
  // sem reclamar (ver getDifficultyAttrs) vem sem objeto nenhum.
  if (!Number.isFinite(attrs?.ar) || !attrs.objects) return null;

  _mapAttrs.set(chave, attrs);
  return attrs;
}

// ─── FC PP ────────────────────────────────────────────────────────────────────

/**
 * Chave do FC pp em cache, ou null quando o resultado não é cacheável.
 *
 * O número é função pura de quatro coisas: o arquivo do mapa, os mods, o motor
 * que calcula e a distribuição de hits que o FC teria. Nada disso muda entre
 * duas exibições do mesmo score, e nada disso depende de QUAL score é — dois
 * scores diferentes com o mesmo FC pela frente compartilham a entrada.
 *
 * É por isso que a chave soma os misses ao n300: é exatamente o que os dois
 * motores fazem antes de calcular (o `fc` do rosuWorkerThread.js e o do
 * akatsukiWorkerThread.js). Um score com 2 misses e
 * outro com 5 no mesmo mapa caem na mesma linha quando o total bate — o que é
 * correto, porque o FC dos dois é o mesmo FC.
 *
 * O motor entra pela chave de cache dele, que nos builds do rosu-pp carrega a
 * versão (ver engines.js): um rework novo não herda os números do anterior.
 *
 * Sem os três hits não há chave: é o ramo em que o cálculo cai na accuracy
 * bruta, e ela é um float que não serve de chave. Ele acontece quando o
 * servidor não informou os acertos, que é justamente o caso em que o resultado
 * também é o menos confiável — melhor recalcular do que guardar.
 */
function fcCacheKey({ beatmapId, mods, engine, n300, n100, n50, misses }) {
  if (n300 === null || n100 === null || n50 === null) return null;

  return {
    mapId:  beatmapId,
    // O CL mora AQUI dentro desde a troca de motor, e é por isso que a chave
    // deixou de ter uma dimensão `lazer` própria: a mecânica é um mod como os
    // outros, e dois cálculos que diferem só nela já diferem nos mods.
    mods:   canonicalMods(mods),
    engine,
    n300:   n300 + misses,
    n100,
    n50,
  };
}

/**
 * Devolve o pp e o guarda no cache, quando ele é um número de verdade.
 *
 * Falha não é gravada de propósito: uma queda de rede ou um pacote ausente são
 * passageiros, e guardá-los transformaria "falhou uma vez" em "falha para
 * sempre" naquele mapa.
 *
 * @returns {number|null}
 */
function rememberFCpp(cacheKey, pp) {
  if (!Number.isFinite(pp)) return null;
  if (cacheKey) db.setCachedFCpp(cacheKey, pp);
  return pp;
}

/**
 * Calcula o PP que o score teria rendido em Full Combo (sem misses).
 *
 * No motor do servidor (ver engines.js): um build do rosu-pp ou do akatsuki-pp.
 *
 * O arquivo .osu é público em https://osu.ppy.sh/osu/{beatmap_id}, então
 * funciona para Bancho e para servidor privado.
 *
 * Retorna null se o pacote do motor não carregar, beatmap_id for desconhecido,
 * o score já for FC, ou qualquer erro de rede/parse.
 *
 * @param {object} score  - score normalizado
 * @param {string} mode   - chave de servidor do registro (ver servers.js)
 * @returns {Promise<number|null>}
 */
async function getFCpp(score, mode = DEFAULT_MODE) {
  const beatmapId = score?.beatmap?.id;
  if (!beatmapId) return null;

  const stats      = score.statistics ?? {};
  const misses     = stats.count_miss ?? stats.miss ?? 0;
  const scoreCombo = score.max_combo ?? 0;
  const mapCombo   = score.beatmap?.max_combo ?? null;

  // Já é FC? Não precisa calcular
  const isFC = misses === 0 && (mapCombo === null || scoreCombo >= mapCombo);
  if (isFC) return null;

  // Hits reais do score — muito mais preciso do que usar a accuracy bruta
  // (que pode ser baixa por ser um quit no meio do mapa)
  const n300 = stats.count_300 ?? stats.great ?? null;
  const n100 = stats.count_100 ?? stats.ok    ?? null;
  const n50  = stats.count_50  ?? stats.meh   ?? null;

  const mods  = engineMods(mode, score.mods);
  const motor = motorDe(mode);

  // A chave descreve o que o MOTOR vai receber, e os dois tipos recebem coisas
  // diferentes: o akatsuki-pp leva o bitmask com o DT que o NC exige, e o
  // rosu-pp leva a lista colapsada (ver modsDoMotor).
  const modsMotor = modsDoMotor(motor, mods);

  const cacheKey = fcCacheKey({
    beatmapId, mods: modsMotor, engine: motor.cache, n300, n100, n50, misses,
  });
  if (cacheKey) {
    const cached = db.getCachedFCpp(cacheKey);
    // Só número entra na tabela, então um acerto é sempre um valor válido —
    // e um `null` guardado seria "falhou uma vez, falha para sempre".
    if (cached !== null) return cached;
  }

  try {
    // O arquivo .osu (público no Bancho, mesmo para mapa exclusivo de servidor
    // privado) vem do cache em disco quando a thread pedir por ele.
    if (motor.tipo === 'akatsuki') {
      // O akatsuki-pp continua em bitmask: é outro motor, com outra API, e ele
      // não conhece nada que não caiba num bit — inclusive o ajuste de rate do
      // lazer, que some aqui. Não é perda de verdade: quem usa este motor é
      // bancho.py ou Ripple, e os dois guardam o score em bitmask, então um DT
      // ajustado não tem por onde chegar.
      const result = await noMotor(motor, 'fc', beatmapId, {
        mods: modsToBits(modsMotor), n300, n100, n50, misses, viaAcc: motor.viaAcc,
      });
      return rememberFCpp(cacheKey, result?.pp);
    }

    //
    // Sem `accuracy`: o motor calcula a dele a partir dos acertos. Quando os
    // acertos reais não vieram, os 300 são deduzidos da contagem de objetos, o
    // que descreve o FC do mesmo jeito — e a accuracy bruta do score seria
    // justamente a do score COM choke, não a do FC que se quer estimar.
    const resultado = await noMotor(motor, 'fc', beatmapId, {
      mods: modsMotor,
      n300, n100, n50, misses,
    });

    return rememberFCpp(cacheKey, resultado?.pp);
  } catch (error) {
    // Sem isto, o "(FC: ~Xpp)" simplesmente não aparece na linha da play e não
    // há como distinguir "não era choke" de "o cálculo quebrou".
    logErrorOnce('pp:fc', error);
    return null;
  }
}

/**
 * Simula o PP de um score hipotético em um mapa específico, dado mods e hits.
 *
 * No motor do servidor (ver engines.js), como o getFCpp.
 *
 * @param {number} beatmapId
 * @param {string[]} mods       - acrônimos de mods, ex: ['DT', 'HR']
 * @param {object} hits
 * @param {number} [hits.n300]   - omitido, a lib DEDUZ pela contagem de objetos
 *   do mapa, assumindo que todos foram jogados. Serve para play completa e para
 *   simulação hipotética; numa play interrompida no meio, a dedução inventa um
 *   300 para cada objeto que a pessoa nunca chegou a ver. Informe o valor real
 *   nesse caso.
 * @param {number} [hits.n100=0]
 * @param {number} [hits.n50=0]
 * @param {number} [hits.misses=0]
 * @param {number} [hits.combo]  - se omitido, assume full combo
 * @param {number} [hits.passedObjects] - quantos objetos a pessoa chegou a
 *   jogar. Para play interrompida é o que torna o número honesto: a dificuldade
 *   passa a ser a do TRECHO jogado, e não a do mapa inteiro. Sem isto, uma
 *   desistência aos 120 de 1833 objetos era avaliada contra o mapa completo e o
 *   `combo` não fazia diferença nenhuma no resultado — medido: 332.6pp contra os
 *   101.3pp corretos.
 * @param {number} [hits.legacyTotalScore] score total NO PLACAR ANTIGO, para
 *   play de mecânica clássica que realmente aconteceu. É o que alimenta a
 *   estimativa de miss por score, que o osu! usa junto da estimativa por combo
 *   ficando com a MAIOR das duas — sem ele, um choke sai bem abaixo do valor
 *   oficial (medido num top play do mrekk: 1052.16pp contra os 1781.65pp
 *   corretos). Não informe em play hipotética: ali não existe placar, e só a
 *   estimativa por combo deve operar. Só chega ao motor que o usa (ver
 *   `scoreLegado` no engines.js): o bancho.py do Daycore não o passa, e dar a
 *   ele o número do Bancho num choke seria mostrar um pp que o servidor não dá.
 * @param {number} [hits.sliderEndHits] fins de slider acertados, e
 * @param {number} [hits.largeTickHits] ticks grandes, e
 * @param {number} [hits.smallTickHits] ticks pequenos: só pesam em play de
 *   lazer (sem CL), e omitidos o motor supõe que foram todos acertados.
 * @param {string} mode
 * @param {object} [opts]
 * @param {boolean} [opts.classic] força a mecânica clássica em vez de deduzi-la
 *   dos mods. Existe para o /simulate: uma play hipotética não tem mod CL para
 *   consultar, e sem CL o cálculo assume lazer — modo em que o combo pesa
 *   diferente, deixando a opção `combo` do comando quase sem efeito.
 * @returns {Promise<{pp: number, stars: number, maxCombo: number}|null>}
 */
async function simulatePP(beatmapId, mods, hits, mode = DEFAULT_MODE, { classic } = {}) {
  const n300     = hits.n300   ?? null;
  const n100     = hits.n100   ?? 0;
  const n50      = hits.n50    ?? 0;
  const misses   = hits.misses ?? 0;
  const combo    = hits.combo  ?? -1;
  const passed   = hits.passedObjects ?? null;

  const motor = motorDe(mode);

  try {
    if (motor.tipo === 'akatsuki') {
      // stars/maxCombo vêm do próprio akatsuki-pp (já ajustados pelos mods),
      // então não precisamos consultar a API oficial aqui.
      // Play interrompida fica sem número: nenhum dos dois servidores calcula
      // pp de trecho (e o `passed_objects` do osu_2019 no commit do Akatsuki
      // nem funciona), então qualquer valor seria inventado.
      if (passed !== null) return null;
      const resultado = await noMotor(motor, 'simulate', beatmapId, {
        mods: modsToBits(mods), n300, n100, n50, misses, combo, viaAcc: motor.viaAcc,
      });
      if (!resultado || !Number.isFinite(resultado.pp)) return null;
      return resultado;
    }

    // `classic` força o CL na lista; sem ele, vale a regra normal do servidor.
    // O lazerMods fecha o caminho do /simulate e do /score pelo mesmo motivo do
    // getFCpp: `-nc` digitado junto de `-dt`, ou um score de nightcore relido
    // daqui, chegaria com os dois e o motor aceleraria duas vezes.
    const modsMotor = lazerMods(classic
      ? engineMods(mode, [...(mods ?? []), 'CL'])
      : engineMods(mode, mods));

    const resultado = await noMotor(motor, 'simulate', beatmapId, {
      mods: modsMotor,
      n300, n100, n50, misses, combo,
      // Play interrompida: a dificuldade passa a ser a do trecho jogado.
      passedObjects: passed,
      legacyTotalScore: motor.scoreLegado ? (hits.legacyTotalScore ?? null) : null,
      sliderEndHits: hits.sliderEndHits ?? null,
      largeTickHits: hits.largeTickHits ?? null,
      smallTickHits: hits.smallTickHits ?? null,
    });

    if (!resultado || !Number.isFinite(resultado.pp)) return null;
    return resultado;
  } catch (error) {
    // O /simulate e o /whatif respondem "não consegui calcular" a partir daqui,
    // e o motivo ficava só na cabeça de quem escreveu o catch.
    logErrorOnce('pp:simulate', error);
    return null;
  }
}

async function getAdjustedStars(beatmapId, mods, mode = DEFAULT_MODE) {
  // Sem mod de dificuldade, no motor do Bancho, quem manda é a API. O motivo
  // mudou com a troca de motor: antes o `difficulty_rating` era usado por ser MAIS EXATO que o nosso
  // (o rosu-pp estava reworks atrás — 6% de diferença no DT); agora é o mesmo
  // número, e continua valendo porque sai de graça. O enrichBeatmapData já o
  // trouxe, enquanto calcular aqui custaria baixar o .osu e ~33ms de cálculo
  // para chegar ao mesmo lugar.
  //
  // O filtro aqui não é cosmético, e já custou dois números errados na tela.
  // Todo score de stable chega com o mod CL desde que passamos a pedir o
  // formato novo à API, e um `mods.length === 0` deixou de ser verdade para
  // score sem mod nenhum: de um dia para o outro o bot passou a calcular o que
  // antes vinha pronto (7.08★ contra os 7.13★ do site). O HD, que também estava
  // na lista de cosméticos, SAIU dela quando o rework de reading passou a mexer
  // na estrela — ver mods.js.
  //
  // Nos outros motores o atalho não existe: a estrela que a API publica é a do
  // rework do Bancho, e o akatsuki-pp ou um rosu-pp de outro commit dão outra.
  // No Relax o RX já estaria na lista de qualquer forma; a guarda pelo motor é
  // também para o score de Relax que chegar sem o mod na lista.
  if (motorDe(mode).id === 'bancho' && difficultyMods(mods).length === 0) return null;

  // Com mods a API não ajuda: ela só publica o valor sem mods. Aí é cálculo
  // local, com os mesmos mods que o PP exibido ao lado usa (engineMods), para os
  // dois números não saírem de bases diferentes.
  const attrs = await getDifficultyAttrs(beatmapId, engineMods(mode, mods), mode);
  return attrs ? attrs.stars.toFixed(2) : null;
}

module.exports = {
  engineMods,
  getBeatmapFile,
  closeWasmWorker: wasmWorker.close,
  getDifficultyAttrs,
  getMapAttrs,
  getAdjustedStars,
  getFCpp,
  simulatePP,

  // Exportado para teste: é a chave que decide quando dois scores DIFERENTES
  // compartilham o mesmo FC pp. Errar para o lado frouxo é mostrar o número de
  // um mapa no outro, e nada na tela denunciaria — sai um pp plausível.
  fcCacheKey,
};
