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
const { modsToBits } = require('./mods');
const { idSegment } = require('./urlSafe');
const { withRetry } = require('./retry');
const { logError } = require('./logger');

const DEFAULT_MODE = servers.defaultKey();

// ─── rosu-pp, carregado sob demanda ───────────────────────────────────────────
// A lib é nativa (Wasm) e opcional: sem ela o bot continua respondendo, só sem
// os valores de PP calculados localmente.
let _rosu;
let _rosuTried = false;

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

function loadRosu() {
  if (!_rosuTried) {
    _rosuTried = true;
    try { _rosu = require('rosu-pp-js'); } catch { _rosu = null; }
  }
  return _rosu;
}

/**
 * Calcula estrelas e combo máximo de um mapa com um dado conjunto de mods,
 * localmente via rosu-pp, e persiste o resultado.
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

  const rosu = loadRosu();
  if (!rosu) return null;

  try {
    const bytes = await getBeatmapFile(mapId);
    const beatmap = new rosu.Beatmap(bytes);
    try {
      const attrs = new rosu.Difficulty({ mods: modsBits, lazer }).calculate(beatmap);
      const result = { stars: attrs.stars, maxCombo: attrs.maxCombo ?? null };
      db.setMapDifficulty(mapId, modsBits, lazer, result.stars, result.maxCombo);
      return result;
    } finally {
      // free() em finally: se o calculate lançar, o buffer Wasm vazava.
      beatmap.free();
    }
  } catch {
    return null;
  }
}

// ─── Falha do Python: uma vez por processo ────────────────────────────────────
/**
 * O PP do Relax é opcional (ver README), e quem não instalou a lib tem SEMPRE
 * o mesmo erro. Como isto é chamado uma vez por play, um `/topplays` de RX
 * viraria cinco tracebacks idênticos por página — logar a cada chamada punia
 * justamente quem escolheu não instalar.
 *
 * Uma vez por processo é o que faltava para diagnosticar, sem virar ruído.
 * Mesma ideia do `_rosuTried` acima.
 */
const STDERR_MAX = 2000;
let _pythonFailureLogged = false;

function reportPythonFailure(context, detail) {
  if (!detail || _pythonFailureLogged) return;
  _pythonFailureLogged = true;
  logError(context, new Error(detail));
  console.error('[calcPPPython] PP do Relax indisponível; o erro acima é logado uma vez só.');
}

/**
 * Chama pp_calc.py como processo filho e retorna os atributos calculados pelo
 * akatsuki-pp-py — o mesmo sistema que o Daycore usa internamente para RX.
 *
 * O `stars` retornado já considera os mods e vem do mesmo algoritmo que
 * calculou o PP, então é mais fiel ao RX do que o difficulty_rating da API
 * oficial (que é sempre sem mods).
 *
 * @param {number} combo -1 = usar max_combo do mapa (assume FC)
 * @returns {Promise<{pp: number, stars: number, maxCombo: number}|null>}
 * Requer: pip install akatsuki-pp-py
 */
async function calcPPPython(beatmapId, modsBits, n300, n100, n50, nmiss, combo = -1) {
  // Os bytes do mapa vão por stdin. O script baixava o .osu por conta própria,
  // o que escapava do rate limiter e do cache — cada cálculo de RX fazia uma
  // requisição extra e não controlada a osu.ppy.sh.
  let beatmapBytes;
  try {
    beatmapBytes = await getBeatmapFile(beatmapId);
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const path = require('path');

    const scriptPath = path.join(__dirname, 'pp_calc.py');

    // Valores seguros: se hits não disponíveis, passa -1 (script trata como null)
    const args = [
      scriptPath,
      String(beatmapId),
      String(modsBits),
      String(n300  ?? -1),
      String(n100  ?? -1),
      String(n50   ?? -1),
      String(nmiss ?? 0),
      String(combo ?? -1),
    ];

    // No Windows o instalador do python.org cria o binário "python"; na
    // maioria das distros Linux (PEP 394) só "python3" existe por padrão —
    // sem isso o spawn falha silenciosamente e o RX nunca calcula PP.
    // PYTHON_BIN no .env permite sobrescrever em qualquer plataforma.
    const pythonBin = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
    const proc = spawn(pythonBin, args, { timeout: 12000 });

    // Se o processo morrer antes de ler tudo (ex: akatsuki-pp-py ausente), a
    // escrita no stdin lança EPIPE — que sem handler viraria uncaughtException.
    proc.stdin.on('error', () => {});
    proc.stdin.end(Buffer.from(beatmapBytes));

    let output = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });

    // Consumir o stderr não é só diagnóstico: o pipe tem buffer, e um filho que
    // escreva mais do que cabe nele fica BLOQUEADO até o timeout matar o
    // processo. O teto aqui é para um traceback repetido não virar memória.
    proc.stderr.on('data', (d) => {
      if (stderr.length < STDERR_MAX) stderr += d.toString();
    });

    proc.on('close', () => {
      let data = null;
      try {
        const data = JSON.parse(output.trim());
        // O script imprime `null` quando não consegue calcular
        if (!data || typeof data.pp !== 'number') return resolve(null);
        resolve({ pp: data.pp, stars: data.stars, maxCombo: data.max_combo });

      if (data && typeof data.pp === 'number') {
        return resolve({ pp: data.pp, stars: data.stars, maxCombo: data.max_combo });
      }

      // ATENÇÃO ao mexer aqui: o pp_calc.py trata os próprios erros — escreve a
      // causa no stderr E imprime `null` no stdout. Ou seja, no caso mais comum
      // o JSON.parse ACIMA FUNCIONA, e reportar só quando ele estoura deixaria
      // no chão a mensagem que interessa: "akatsuki-pp-py nao instalado.
      // Execute: pip install akatsuki-pp-py", que é a causa em toda instalação
      // nova. Por isso o relato fica no caminho de "não veio número", não no
      // catch do parse.
      reportPythonFailure('calcPPPython', stderr.trim());
      resolve(null);
      } catch {
        // Saída ilegível: o motivo, se houver, está no stderr.
      }
    });
    proc.on('error', (err) => {
      reportPythonFailure('calcPPPython:spawn', `falha ao iniciar "${pythonBin}": ${err.message}`);
      resolve(null);
    });
  });
}

// ─── FC PP ────────────────────────────────────────────────────────────────────
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

  try {
    // ── Relax: akatsuki-pp-py via Python (oppai-2019, o mesmo dos servidores) ──
    // O download do .osu acontece dentro do calcPPPython, pelo mesmo
    // getBeatmapFile do caminho do rosu-pp: cache em disco e rate limiter
    // valem para os dois, e os bytes vão para o script por stdin. (O script
    // já baixou por conta própria, o que escapava de ambos.)
    if (servers.get(mode).relax) {
      const result = await calcPPPython(beatmapId, modsBits, n300, n100, n50, misses);
      return result?.pp ?? null;
    }

    // ── Oficial / bancho.py vanilla: rosu-pp-js (algoritmo oficial) ───────────
    // O arquivo .osu (público no Bancho, mesmo para mapa exclusivo de servidor
    // privado) vem do cache em disco quando já foi baixado antes.
    const rosu = loadRosu();
    if (!rosu) return null;

    const beatmapBytes = await getBeatmapFile(beatmapId);
    const useLazer     = shouldUseLazer(mode, score.mods);

    const beatmap = new rosu.Beatmap(beatmapBytes);
    try {
      const difficulty = new rosu.Difficulty({ mods: modsBits, lazer: useLazer });
      const diffAttrs  = difficulty.calculate(beatmap);

      const perfParams = { mods: modsBits, misses: 0, lazer: useLazer };
      if (n300 !== null && n100 !== null && n50 !== null) {
        perfParams.n300 = n300 + misses;
        perfParams.n100 = n100;
        perfParams.n50  = n50;
      } else {
        perfParams.accuracy = score.accuracy * 100;
      }

      const perf   = new rosu.Performance(perfParams);
      const result = perf.calculate(diffAttrs);

      return result.pp ?? null;
    } finally {
      beatmap.free();
    }
  } catch {
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
 * @param {number} [hits.n300]   - omitido, a lib DEDUZ pela contagem de objetos
 *   do mapa, assumindo que todos foram jogados. Serve para play completa e para
 *   simulação hipotética; numa play interrompida no meio, a dedução inventa um
 *   300 para cada objeto que a pessoa nunca chegou a ver. Informe o valor real
 *   nesse caso.
 * @param {string[]} mods       - acrônimos de mods, ex: ['DT', 'HR']
 * @param {object} hits
 * @param {number} [hits.n100=0]
 * @param {number} [hits.n50=0]
 * @param {number} [hits.passedObjects] - quantos objetos a pessoa chegou a
 *   jogar. Para play interrompida é o que torna o número honesto: a dificuldade
 *   passa a ser a do TRECHO jogado, e não a do mapa inteiro. Sem isto, uma
 *   desistência aos 120 de 1833 objetos era avaliada contra o mapa completo e o
 *   `combo` não fazia diferença nenhuma no resultado — medido: 332.6pp contra os
 *   101.3pp corretos.
 * @param {number} [hits.misses=0]
 * @param {number} [hits.combo]  - se omitido, assume full combo
 * @param {string} mode
 * @returns {Promise<{pp: number, stars: number, maxCombo: number}|null>}
 */
async function simulatePP(beatmapId, mods, hits, mode = DEFAULT_MODE) {
  const modsBits = modsToBits(mods);
  const n100     = hits.n100   ?? 0;
  const n50      = hits.n50    ?? 0;
  const misses   = hits.misses ?? 0;
  const n300     = hits.n300   ?? null;
  const combo    = hits.combo  ?? -1;

  try {
    if (servers.get(mode).relax) {
  const passed   = hits.passedObjects ?? null;
      // stars/maxCombo vêm do próprio akatsuki-pp (já ajustados pelos mods),
      // então não precisamos consultar a API oficial aqui.
      // O akatsuki-pp trabalha sempre com o mapa inteiro — não há como dizer
      // "parei no objeto N". Devolver o valor do mapa completo para uma play
      // interrompida seria inventar; melhor admitir que não sabe.
      if (passed !== null) return null;
      // -1 é o "não sei" que o pp_calc.py entende (ver src/pp_calc.py).
      return await calcPPPython(beatmapId, modsBits, n300 ?? -1, n100, n50, misses, combo);
    }

    const rosu = loadRosu();
    if (!rosu) return null;

    const beatmapBytes = await getBeatmapFile(beatmapId);
    const useLazer     = shouldUseLazer(mode, mods);

    const beatmap = new rosu.Beatmap(beatmapBytes);
    try {
      const diffArgs = { mods: modsBits, lazer: useLazer };
      // Play interrompida: a dificuldade é a do trecho jogado, não a do mapa.
      if (passed !== null) diffArgs.passedObjects = passed;

      const difficulty = new rosu.Difficulty(diffArgs);
      const diffAttrs  = difficulty.calculate(beatmap);

      const perfParams = { mods: modsBits, n100, n50, misses, lazer: useLazer };
      if (combo >= 0) perfParams.combo = combo;

      const perf     = new rosu.Performance(perfParams);
      const result   = perf.calculate(diffAttrs);
      // Só quando quem chamou soube dizer: sem isto a lib deduz, e a dedução
      // é justamente o que estraga o número de uma play interrompida.
      if (n300 !== null) perfParams.n300 = n300;
      const stars    = diffAttrs.stars;
      const maxCombo = diffAttrs.maxCombo;

      if (result.pp == null) return null;
      return { pp: result.pp, stars, maxCombo };
    } finally {
      beatmap.free();
    }
  } catch {
    return null;
  }
}

async function getAdjustedStars(beatmapId, mods, mode = DEFAULT_MODE) {
  // Sem mods: o enrichBeatmapData já trouxe o difficulty_rating base, não precisa recalcular
  if (!mods || mods.length === 0) return null;

  // Com mods: calculado localmente pelo rosu-pp a partir do .osu em cache, em
  // vez de um POST em /beatmaps/{id}/attributes por play a cada exibição.
  //
  // Também corrige uma inconsistência: as estrelas vinham sempre da API
  // oficial (lazer), enquanto o PP de FC exibido ao lado é calculado com a
  // mecânica do servidor (shouldUseLazer). Agora os dois usam a mesma base.
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
  getDifficultyAttrs,
  getAdjustedStars,
  getFCpp,
  simulatePP,
};
