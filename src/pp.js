/**
 * pp.js
 * Cálculo de performance points e tudo que ele precisa.
 *
 * Saiu do osuClient porque não é cliente de API nenhuma: são dois motores de
 * cálculo local (rosu-pp para o algoritmo oficial, akatsuki-pp via Python para
 * o Relax), o download do arquivo .osu que os alimenta e os caches dos dois.
 *
 * A dependência é de mão única — o osuClient importa daqui, e não o contrário.
 */

require('dotenv').config();
const axios = require('axios');
const db = require('./db');
const servers = require('./servers');
const rateLimiter = require('./rateLimiter');
const { dedupe } = require('./inflight');
const { modsToBits, stripClassic } = require('./mods');
const { idSegment } = require('./urlSafe');
const { withRetry } = require('./retry');
const { logErrorOnce } = require('./logger');
const pythonWorker = require('./pythonWorker');
const rosuWorker = require('./rosuWorker');

const DEFAULT_MODE = servers.defaultKey();

// ─── rosu-pp ──────────────────────────────────────────────────────────────────
// A lib é nativa (Wasm), síncrona e opcional. Ela roda num worker thread, e não
// aqui: o cálculo parava o event loop, e uma página de mapas inéditos são vinte
// paradas dessas seguidas — inclusive para o heartbeat do gateway. O
// rosuWorker.js explica o desenho; o que sobra neste arquivo é decidir O QUE
// calcular, e onde guardar o resultado.
//
// Sem a lib instalada, o worker relata uma vez e passa a devolver null: o bot
// continua respondendo, só sem os valores calculados localmente.

/**
 * Decide se o cálculo deve usar a mecânica lazer (sliders novos) ou
 * stable/classic (sliders antigos).
 *
 * - bancho.py: nenhum servidor desses roda lazer, então sempre stable.
 * - Oficial: lazer por padrão, EXCETO se o mod CL (Classic) estiver presente —
 *   nesse caso o score foi jogado com mecânica stable.
 */
function shouldUseLazer(mode, mods) {
  if (!servers.isOfficial(mode)) return false;
  return !(mods ?? []).includes('CL');
}

// ─── Arquivo .osu ─────────────────────────────────────────────────────────────
/**
 * Retorna os bytes do arquivo .osu, servindo do cache em disco quando possível.
 *
 * Antes, todo cálculo de PP (getFCpp, simulatePP) baixava o arquivo de novo —
 * ~50KB por chamada. No /topplays isso acontecia para as 5 plays da página, e
 * de novo a cada clique de botão, já que o embed é reconstruído do zero.
 * Equivale à tabela osu_map_file_content do BathBot.
 *
 * @returns {Promise<Uint8Array>}
 * @throws se o download falhar em todas as tentativas
 */
async function getBeatmapFile(mapId) {
  const cached = db.getBeatmapFile(mapId);
  if (cached) return new Uint8Array(cached);

  return dedupe(`file:${mapId}`, async () => {
    const bytes = await withRetry(async () => {
      await rateLimiter.acquire('osuMapFile');
      const res = await axios.get(`https://osu.ppy.sh/osu/${idSegment(mapId)}`, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      const arr = new Uint8Array(res.data);
      if (arr.length === 0) {
        // Acontece logo após reupload de mapa; costuma resolver na retentativa.
        const err = new Error(`arquivo .osu vazio para o mapa ${mapId}`);
        err.retryable = true;
        throw err;
      }
      return arr;
    }, { attempts: 5, baseMs: 500, maxMs: 10000 });

    db.setBeatmapFile(mapId, bytes);
    return bytes;
  });
}

/**
 * Manda uma operação para a thread do rosu-pp.
 *
 * Os bytes do mapa só são buscados se a thread não tiver aquele mapa parseado —
 * ela pede, e só então o download/cache é consultado (ver rosuWorker.js).
 */
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
async function getDifficultyAttrs(mapId, modsBits, lazer) {
  const cached = db.getMapDifficulty(mapId, modsBits, lazer);
  if (cached) return cached;

  const attrs = await noRosu('difficulty', mapId, { mods: modsBits, lazer });
  if (!attrs || !Number.isFinite(attrs.stars)) return null;

  // Combo zero quer dizer "mapa sem objeto nenhum", que não existe de verdade.
  // O rosu-pp NÃO recusa um .osu corrompido: ele parseia o que der e devolve um
  // mapa degenerado — medido com lixo puro na entrada, 0.14★ e combo 0, sem
  // erro nenhum. Sem esta guarda, um download truncado virava estrela sem
  // sentido E ficava gravado no cache, onde não vence nunca (a map_difficulty
  // não tem TTL, porque o resultado deveria ser função pura do arquivo).
  if (!attrs.maxCombo) return null;

  db.setMapDifficulty(mapId, modsBits, lazer, attrs.stars, attrs.maxCombo);
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
function fcCacheKey({ beatmapId, modsBits, useLazer, relax, n300, n100, n50, misses }) {
  if (n300 === null || n100 === null || n50 === null) return null;

  return {
    mapId:  beatmapId,
    modsBits,
    engine: relax ? 'akatsuki' : (useLazer ? 'rosu-lazer' : 'rosu-stable'),
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

  // Bitmask de mods — ambas as libs usam o mesmo formato
  const modsBits = modsToBits(score.mods);
  const useLazer = shouldUseLazer(mode, score.mods);
  const relax    = servers.get(mode).relax;

  const cacheKey = fcCacheKey({ beatmapId, modsBits, useLazer, relax, n300, n100, n50, misses });
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
      const result = await calcPPPython(beatmapId, modsBits, n300, n100, n50, misses);
      return rememberFCpp(cacheKey, result?.pp);
    }

    // ── Oficial / bancho.py vanilla: rosu-pp-js (algoritmo oficial) ───────────
    // O arquivo .osu (público no Bancho, mesmo para mapa exclusivo de servidor
    // privado) vem do cache em disco quando a thread pedir por ele.
    const resultado = await noRosu('fc', beatmapId, {
      mods: modsBits,
      lazer: useLazer,
      n300, n100, n50, misses,
      // Só usado quando os hits reais não vieram. `score.accuracy` ausente vira
      // NaN, que o rosu aceita sem reclamar — o rememberFCpp faz a guarda.
      accuracy: score.accuracy * 100,
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
 * - servidor vanilla → rosu-pp-js (algoritmo oficial osu!lazer, via Wasm)
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
 * @param {string} mode
 * @param {object} [opts]
 * @param {boolean} [opts.lazer] força a mecânica em vez de deduzi-la dos mods.
 *   Existe para o /simulate: uma play hipotética não tem mod CL para consultar,
 *   e sem CL o `shouldUseLazer` conclui "lazer" — modo em que o rosu-pp ignora
 *   o combo, deixando a opção `combo` do comando sem efeito nenhum.
 * @returns {Promise<{pp: number, stars: number, maxCombo: number}|null>}
 */
async function simulatePP(beatmapId, mods, hits, mode = DEFAULT_MODE, { lazer } = {}) {
  const modsBits = modsToBits(mods);
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
      return await calcPPPython(beatmapId, modsBits, n300 ?? -1, n100, n50, misses, combo);
    }

    const useLazer = lazer ?? shouldUseLazer(mode, mods);

    const resultado = await noRosu('simulate', beatmapId, {
      mods: modsBits,
      lazer: useLazer,
      n300, n100, n50, misses, combo,
      // Play interrompida: a dificuldade passa a ser a do trecho jogado.
      passedObjects: passed,
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
  // Sem mod de dificuldade, quem manda é a API: o `difficulty_rating` que o
  // enrichBeatmapData já trouxe é o mesmo número que o site mostra, e é mais
  // exato que o nosso — o rosu-pp está dois reworks atrás do osu! (medido: 6%
  // de diferença no DT, 0,7% sem mods).
  //
  // O `stripClassic` aqui não é cosmético. Todo score de stable chega com o mod
  // CL desde que passamos a pedir o formato novo à API, e um `mods.length === 0`
  // deixou de ser verdade para score sem mods nenhum — de um dia para o outro o
  // bot passou a calcular localmente o que antes vinha pronto, e a estrela
  // exibida deixou de bater com o site (7.08★ contra 7.13★). O CL é exibido nos
  // scores, mas não conta como mod de dificuldade.
  if (stripClassic(mods).length === 0) return null;

  // Com mods a API não ajuda: ela só publica o valor sem mods. Aí é cálculo
  // local, na mesma mecânica que o PP exibido ao lado usa (shouldUseLazer),
  // para os dois números não saírem de bases diferentes.
  const attrs = await getDifficultyAttrs(
    beatmapId,
    modsToBits(mods),
    shouldUseLazer(mode, mods)
  );
  return attrs ? attrs.stars.toFixed(2) : null;
}

module.exports = {
  shouldUseLazer,
  getBeatmapFile,
  // Mora no pythonWorker desde que o cálculo do Relax virou processo de vida
  // longa, mas continua saindo daqui: é a porta de PP do bot, e o teste que
  // cobre o registro de falhas já pedia por este caminho.
  reportPythonFailure: pythonWorker.reportPythonFailure,
  closePythonWorker:   pythonWorker.close,
  closeRosuWorker:     rosuWorker.close,
  workerStats:         () => ({ python: pythonWorker.stats(), rosu: rosuWorker.stats() }),
  getDifficultyAttrs,
  getAdjustedStars,
  getFCpp,
  simulatePP,

  // Exportado para teste: é a chave que decide quando dois scores DIFERENTES
  // compartilham o mesmo FC pp. Errar para o lado frouxo é mostrar o número de
  // um mapa no outro, e nada na tela denunciaria — sai um pp plausível.
  fcCacheKey,
};
