/**
 * pp.js
 * Cálculo de performance points e tudo que ele precisa.
 *
 * Saiu do osuClient porque não é cliente de API nenhuma. O que sobrou aqui,
 * depois de os dois motores irem para processos próprios (rosuWorker.js,
 * pythonWorker.js) e o download do .osu para o beatmapFile.js, é a decisão:
 * QUAL motor usa cada servidor, o que vale a pena calcular, e onde o resultado
 * fica guardado.
 *
 * A dependência é de mão única — o osuClient importa daqui, e não o contrário.
 */

require('dotenv').config({ quiet: true });
const db = require('./db');
const servers = require('./servers');
const { modsToBits, stripClassic, stripImpliedDT, difficultyMods, canonicalMods } = require('./mods');
const { logErrorOnce } = require('./logger');
const { getBeatmapFile } = require('./beatmapFile');
const { TtlCache } = require('./ttlCache');
const pythonWorker = require('./pythonWorker');
const rosuWorker = require('./rosuWorker');
const lazerWorker = require('./lazerWorker');

const DEFAULT_MODE = servers.defaultKey();

// ─── Os dois motores de PP vanilla ────────────────────────────────────────────
// Estrelas e PP saem do @tosuapp/lazer-calculator, que compila o C# do próprio
// osu!lazer: conferido contra a API oficial, ele reproduz o número publicado com
// erro 0,00% — em 3 mapas de star rating e nos 12 top plays reais que testamos,
// choke incluído. O rosu-pp que fazia isso antes ficava 3,9% fora em média (até
// 10% em casos isolados), porque está um rework atrás.
//
// O rosu-pp CONTINUA no projeto, para uma coisa só: CS/AR/OD/HP ajustados por
// mod, BPM e contagem de objetos (ver getMapAttrs). O lazer-calculator não expõe
// BPM nem clock rate, e essa linha do embed é informação de mapa, não de PP —
// não vale um segundo motor exato para ela.
//
// Cada um roda fora do processo principal, e por razões diferentes: o rosu-pp é
// Wasm síncrono e paralisava o event loop; o lazer-calculator, além de lento, TEM
// de ser processo separado porque o runtime .NET dele termina em segfault (ver
// lazerWorkerChild.js). As duas libs são opcionais — sem elas o bot continua
// respondendo, só sem os valores calculados localmente.

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
  if (servers.isOfficial(mode) || lista.includes('CL')) return [...lista];
  return [...lista, 'CL'];
}

/**
 * Os mods como o LAZER precisa vê-los, que não é como o bitmask os guarda.
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
 * Manda uma operação para o processo do lazer-calculator.
 *
 * Os bytes do mapa só são buscados se o processo não tiver aquele mapa parseado —
 * ele pede, e só então o download/cache é consultado (ver lazerWorker.js).
 */
const noLazer = (op, mapId, args) =>
  lazerWorker.calcular(op, mapId, args, () => getBeatmapFile(mapId));

/** O mesmo, para a thread do rosu-pp (hoje só os atributos de mapa). */
const noRosu = (op, mapId, args) =>
  rosuWorker.calcular(op, mapId, args, () => getBeatmapFile(mapId));

/**
 * Calcula estrelas e combo máximo de um mapa com um dado conjunto de mods,
 * e persiste o resultado.
 *
 * Isto substitui o POST em /beatmaps/{id}/attributes que o getAdjustedStars
 * fazia a cada exibição: o rosu-pp já estava no projeto e o simulatePP já
 * lia diffAttrs.stars daqui. Cacheado por (mapa, mods, mecânica), como a
 * osu_map_difficulty do BathBot.
 *
 * @returns {Promise<{stars: number, maxCombo: number|null}|null>}
 */
async function getDifficultyAttrs(mapId, mods) {
  // Colapsado ANTES da chave: ver lazerMods. Este caminho é sempre o do lazer.
  const modsMotor = lazerMods(mods);
  const chaveMods = canonicalMods(modsMotor);

  const cached = db.getMapDifficulty(mapId, chaveMods);
  if (cached) return cached;

  const attrs = await noLazer('difficulty', mapId, { mods: modsMotor });
  if (!attrs || !Number.isFinite(attrs.stars)) return null;

  // Combo zero quer dizer "mapa sem objeto nenhum", que não existe de verdade.
  // A guarda nasceu com o rosu-pp, que NÃO recusa um .osu corrompido: ele
  // parseia o que der e devolve um mapa degenerado — medido com lixo puro na
  // entrada, 0.14★ e combo 0, sem erro nenhum. Fica valendo com o motor novo
  // porque o risco é o mesmo, e a consequência também: sem ela, um download
  // truncado virava estrela sem sentido E ficava gravado no cache, onde não
  // vence nunca (a map_difficulty não tem TTL, porque o resultado deveria ser
  // função pura do arquivo).
  if (!attrs.maxCombo) return null;

  db.setMapDifficulty(mapId, chaveMods, attrs.stars, attrs.maxCombo);
  return attrs;
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
 * @param {string[]} mods acrônimos, como vêm do score
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
  const modsBits = modsToBits(stripClassic(mods));
  const chave = `${beatmapId}:${modsBits}`;

  const cached = _mapAttrs.get(chave);
  if (cached) return cached;

  const attrs = await noRosu('attributes', beatmapId, { mods: modsBits });
  // Mapa que não deu para baixar volta null; o degenerado que o rosu-pp aceita
  // sem reclamar (ver getDifficultyAttrs) vem sem objeto nenhum.
  if (!Number.isFinite(attrs?.ar) || !attrs.objects) return null;

  _mapAttrs.set(chave, attrs);
  return attrs;
}

// ─── Motor do Relax ───────────────────────────────────────────────────────────
/**
 * Manda o cálculo para o worker Python (akatsuki-pp-py, o mesmo motor que os
 * servidores usam para RX).
 *
 * O `stars` retornado já considera os mods e vem do mesmo algoritmo que
 * calculou o PP, então é mais fiel ao RX do que o difficulty_rating da API
 * oficial (que é sempre sem mods).
 *
 * Os bytes do mapa saem daqui, do mesmo `getBeatmapFile` do caminho do rosu-pp:
 * o script já baixou o .osu por conta própria um dia, o que escapava do rate
 * limiter E do cache — cada cálculo de RX fazia uma requisição extra e não
 * controlada a osu.ppy.sh.
 *
 * @param {number} combo -1 = usar max_combo do mapa (assume FC)
 * @returns {Promise<{pp: number, stars: number, maxCombo: number}|null>}
 * Requer: pip install akatsuki-pp-py
 */
async function calcPPPython(beatmapId, modsBits, n300, n100, n50, nmiss, combo = -1) {
  let beatmapBytes;
  try {
    beatmapBytes = await getBeatmapFile(beatmapId);
  } catch (error) {
    logErrorOnce('pp:beatmapFile', error);
    return null;
  }

  const resposta = await pythonWorker.calcular(beatmapBytes, {
    mapId: beatmapId,
    mods:  modsBits,
    // -1 é o "não sei" que o pp_calc.py entende.
    n300:  n300  ?? -1,
    n100:  n100  ?? -1,
    n50:   n50   ?? -1,
    nmiss: nmiss ?? 0,
    combo: combo ?? -1,
  });

  // isFinite e não `typeof === 'number'`: NaN e Infinity passam no typeof, e um
  // deles escapando daqui vira "NaN pp" no embed lá na frente.
  if (!resposta || !Number.isFinite(resposta.pp)) return null;

  return { pp: resposta.pp, stars: resposta.stars, maxCombo: resposta.max_combo };
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
 * motores fazem antes de calcular (`perfParams.n300 = n300 + misses` aqui, e
 * `calc_kwargs["n300"] = n300 + nmiss` no pp_calc.py). Um score com 2 misses e
 * outro com 5 no mesmo mapa caem na mesma linha quando o total bate — o que é
 * correto, porque o FC dos dois é o mesmo FC.
 *
 * Sem os três hits não há chave: é o ramo em que o cálculo cai na accuracy
 * bruta, e ela é um float que não serve de chave. Ele acontece quando o
 * servidor não informou os acertos, que é justamente o caso em que o resultado
 * também é o menos confiável — melhor recalcular do que guardar.
 */
function fcCacheKey({ beatmapId, mods, relax, n300, n100, n50, misses }) {
  if (n300 === null || n100 === null || n50 === null) return null;

  return {
    mapId:  beatmapId,
    // O CL mora AQUI dentro desde a troca de motor, e é por isso que a chave
    // deixou de ter uma dimensão `lazer` própria: a mecânica é um mod como os
    // outros, e dois cálculos que diferem só nela já diferem nos mods.
    mods:   canonicalMods(mods),
    engine: relax ? 'akatsuki' : 'lazer',
    n300:   n300 + misses,
    n100,
    n50,
  };
}

/**
 * Devolve o pp e o guarda no cache, quando ele é um número de verdade.
 *
 * Falha não é gravada de propósito: uma queda de rede ou um Python ausente são
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
 * - servidor vanilla → rosu-pp-js (algoritmo oficial osu!lazer, via Wasm)
 * - servidor com RX  → akatsuki-pp-py via Python (oppai-2019, o mesmo do Daycore)
 *
 * O arquivo .osu é público em https://osu.ppy.sh/osu/{beatmap_id}, então
 * funciona para Bancho e para servidor privado.
 *
 * Retorna null se a lib não estiver instalada, beatmap_id for desconhecido,
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
  const relax = servers.get(mode).relax;

  // A chave descreve o que o MOTOR vai receber, e os dois recebem coisas
  // diferentes: o akatsuki-pp leva o bitmask cru (com o DT que o NC arrasta), e
  // o lazer leva a lista colapsada. Guardar os dois sob a mesma chave faria
  // `['DT','NC']` e `['NC']` colidirem no lado do Relax, onde eles dão 96.99pp
  // e 39.21pp — o mesmo mapa com dois números legítimos e uma linha só.
  const modsMotor = relax ? mods : lazerMods(mods);

  const cacheKey = fcCacheKey({ beatmapId, mods: modsMotor, relax, n300, n100, n50, misses });
  if (cacheKey) {
    const cached = db.getCachedFCpp(cacheKey);
    // Só número entra na tabela, então um acerto é sempre um valor válido —
    // e um `null` guardado seria "falhou uma vez, falha para sempre".
    if (cached !== null) return cached;
  }

  try {
    // ── Relax: akatsuki-pp-py via Python (oppai-2019, o mesmo dos servidores) ──
    // O download do .osu acontece dentro do calcPPPython, pelo mesmo
    // getBeatmapFile do caminho do rosu-pp: cache em disco e rate limiter
    // valem para os dois, e os bytes vão para o script por stdin. (O script
    // já baixou por conta própria, o que escapava de ambos.)
    if (relax) {
      // O akatsuki-pp continua em bitmask: é outro motor, com outra API, e ele
      // não conhece nada que não caiba num bit.
      const result = await calcPPPython(beatmapId, modsToBits(score.mods), n300, n100, n50, misses);
      return rememberFCpp(cacheKey, result?.pp);
    }

    // ── Oficial / bancho.py vanilla: lazer-calculator (o C# do próprio osu!) ──
    // O arquivo .osu (público no Bancho, mesmo para mapa exclusivo de servidor
    // privado) vem do cache em disco quando o processo pedir por ele.
    //
    // Sem `accuracy`: o motor calcula a dele a partir dos acertos (ver
    // montarScore no lazerWorkerChild). Quando os acertos reais não vieram, os
    // 300 são deduzidos da contagem de objetos, o que descreve o FC do mesmo
    // jeito — e a accuracy bruta do score, que o rosu-pp usava nesse ramo, seria
    // justamente a do score COM choke, não a do FC que se quer estimar.
    const resultado = await noLazer('fc', beatmapId, {
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
 * - servidor vanilla → lazer-calculator (o C# do próprio osu!lazer)
 * - servidor com RX  → akatsuki-pp-py via Python (oppai-2019, o mesmo do Daycore)
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
 *   estimativa por combo deve operar.
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

  try {
    if (servers.get(mode).relax) {
      // stars/maxCombo vêm do próprio akatsuki-pp (já ajustados pelos mods),
      // então não precisamos consultar a API oficial aqui.
      // O akatsuki-pp trabalha sempre com o mapa inteiro — não há como dizer
      // "parei no objeto N". Devolver o valor do mapa completo para uma play
      // interrompida seria inventar; melhor admitir que não sabe.
      if (passed !== null) return null;
      // -1 é o "não sei" que o pp_calc.py entende (ver src/pp_calc.py).
      return await calcPPPython(beatmapId, modsToBits(mods), n300 ?? -1, n100, n50, misses, combo);
    }

    // `classic` força o CL na lista; sem ele, vale a regra normal do servidor.
    // O lazerMods fecha o caminho do /simulate e do /score pelo mesmo motivo do
    // getFCpp: `-nc` digitado junto de `-dt`, ou um score de nightcore relido
    // daqui, chegaria com os dois e o motor aceleraria duas vezes.
    const modsMotor = lazerMods(classic
      ? engineMods(mode, [...(mods ?? []), 'CL'])
      : engineMods(mode, mods));

    const resultado = await noLazer('simulate', beatmapId, {
      mods: modsMotor,
      n300, n100, n50, misses, combo,
      // Play interrompida: a dificuldade passa a ser a do trecho jogado.
      passedObjects: passed,
      legacyTotalScore: hits.legacyTotalScore ?? null,
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
  // Sem mod de dificuldade, quem manda é a API. O motivo mudou com a troca de
  // motor: antes o `difficulty_rating` era usado por ser MAIS EXATO que o nosso
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
  if (difficultyMods(mods).length === 0) return null;

  // Com mods a API não ajuda: ela só publica o valor sem mods. Aí é cálculo
  // local, com os mesmos mods que o PP exibido ao lado usa (engineMods), para os
  // dois números não saírem de bases diferentes.
  const attrs = await getDifficultyAttrs(beatmapId, engineMods(mode, mods));
  return attrs ? attrs.stars.toFixed(2) : null;
}

module.exports = {
  engineMods,
  getBeatmapFile,
  // Mora no pythonWorker desde que o cálculo do Relax virou processo de vida
  // longa, mas continua saindo daqui: é a porta de PP do bot, e o teste que
  // cobre o registro de falhas já pedia por este caminho.
  reportPythonFailure: pythonWorker.reportPythonFailure,
  closePythonWorker:   pythonWorker.close,
  closeRosuWorker:     rosuWorker.close,
  closeLazerWorker:    lazerWorker.close,
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
