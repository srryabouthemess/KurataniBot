/**
 * osuClient.js
 * Cliente unificado para a API do osu!
 *
 * Modos:
 *  - "official"    → osu! API v2 (OAuth)
 *  - "private"     → Daycore osu! standard (mode 0)
 *  - "private_rx"  → Daycore Relax (mode 4)
 */
 
require('dotenv').config();
const axios = require('axios');
const beatmapCache = require('./beatmapCache');
 
const DEFAULT_MODE = process.env.OSU_MODE || 'official';
const DAYCORE_V1 = 'https://daycore.org/api/v1';
const DAYCORE_V2 = 'https://api.daycore.org/v2';
 
// Mapeamento de modo interno → mode_arg numérico do Daycore
const DAYCORE_MODE = {
  private: 0,
  private_rx: 4,
};
 
// ─── Token cache (oficial) ────────────────────────────────────────────────────
let _token = null;
let _tokenExpiry = 0;
 
async function getOfficialToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await axios.post('https://osu.ppy.sh/oauth/token', {
    client_id: process.env.OSU_CLIENT_ID,
    client_secret: process.env.OSU_CLIENT_SECRET,
    grant_type: 'client_credentials',
    scope: 'public',
  });
  _token = res.data.access_token;
  _tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return _token;
}
 
// ─── Helpers de requisição ────────────────────────────────────────────────────
async function officialGet(path, params = {}) {
  const token = await getOfficialToken();
  const res = await axios.get(`https://osu.ppy.sh/api/v2${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return res.data;
}
 
async function daycoreV1Get(endpoint, params = {}) {
  const res = await axios.get(`${DAYCORE_V1}/${endpoint}`, { params });
  return res.data;
}
 
async function daycoreV2Get(path, params = {}) {
  const res = await axios.get(`${DAYCORE_V2}${path}`, { params });
  return res.data;
}
 
// ─── Normalização: usuário ────────────────────────────────────────────────────
function normalizeUserDaycore(playerData, statsData, mode, globalRank = null, countryRank = null) {
  if (!playerData) return null;
 
  return {
    id: playerData.id,
    username: playerData.name,
    avatar_url: `https://a.daycore.org/${playerData.id}`,
    country_code: (playerData.country || 'xx').toUpperCase(),
    join_date: playerData.creation_time
      ? new Date(playerData.creation_time * 1000).toISOString()
      : null,
    last_visit: playerData.latest_activity
      ? new Date(playerData.latest_activity * 1000).toISOString()
      : null,
    is_online: false,
    statistics: {
      global_rank:   globalRank,
      country_rank:  countryRank,
      pp: parseFloat(statsData?.pp ?? 0),
      hit_accuracy: parseFloat(statsData?.acc ?? statsData?.accuracy ?? 0),
      level: { current: 1 },
      maximum_combo: statsData?.max_combo ?? 0,
      play_count: statsData?.plays ?? statsData?.play_count ?? 0,
    },
    _private: true,
  };
}
 
// ─── Normalização: score ──────────────────────────────────────────────────────
// Bitmask de mods — usado tanto para decodificar scores quanto para simulação
const MOD_BITS = {
  NF: 1, EZ: 2, HD: 8, HR: 16, SD: 32,
  DT: 64, RX: 128, HT: 256, NC: 512, FL: 1024,
  SO: 4096, PF: 16384,
};
const MOD_MAP = Object.fromEntries(Object.entries(MOD_BITS).map(([name, bit]) => [bit, name]));

// CL (Classic) não tem bit legado — é um mod só-lazer que sinaliza que o
// score foi jogado com a mecânica antiga (stable) de sliders. Não entra no
// bitmask (MOD_BITS), mas precisa ser reconhecido como token válido.
const KNOWN_MOD_TOKENS = new Set([...Object.keys(MOD_BITS), 'CL']);

function decodeMods(bits) {
  return Object.entries(MOD_MAP)
    .filter(([bit]) => Number(bits) & Number(bit))
    .map(([, name]) => name);
}

/**
 * Converte uma string de mods (ex: "DT HR", "dthr", "hd,dt") em um array de
 * acrônimos válidos (ex: ["DT", "HR"]). Ignora tokens desconhecidos.
 */
function parseModsString(input) {
  if (!input) return [];
  const clean = input.toUpperCase().replace(/[^A-Z]/g, '');
  const found = [];
  for (let i = 0; i < clean.length; i += 2) {
    const token = clean.slice(i, i + 2);
    if (KNOWN_MOD_TOKENS.has(token) && !found.includes(token)) found.push(token);
  }
  return found;
}

/**
 * Decide se o cálculo deve usar a mecânica lazer (sliders novos) ou
 * stable/classic (sliders antigos).
 *
 * - Daycore (private/private_rx): servidor não roda lazer, sempre stable.
 * - Bancho (official): lazer por padrão, EXCETO se o mod CL (Classic)
 *   estiver presente — nesse caso o score foi jogado com mecânica stable.
 */
function shouldUseLazer(mode, mods) {
  if (mode !== 'official') return false;
  return !(mods ?? []).includes('CL');
}

function modsToBits(mods) {
  return (mods ?? []).reduce((acc, m) => acc | (MOD_BITS[m] ?? 0), 0);
}
 
// Mescla dados da v1 (map info) com dados da v2 (score detalhado)
function normalizeScoreDaycore(v1, v2) {
  if (!v1) return null;
 
  const pp = parseFloat(v2?.pp ?? v1.pp ?? 0);
  const acc = parseFloat(v2?.acc ?? v1.acc ?? 0) / 100;
  const max_combo = v2?.max_combo ?? null;
  const grade = v2?.grade ?? v1.grade ?? 'F';
 
  const mods = v2
    ? decodeMods(v2.mods ?? 0)
    : (Array.isArray(v1.mods) ? v1.mods : decodeMods(v1.mods ?? 0));
 
  const playTimeRaw = v2?.play_time ?? v1.play_time;
  const playTime = playTimeRaw
    ? new Date(String(playTimeRaw).includes('T')
        ? playTimeRaw
        : playTimeRaw.replace(' ', 'T') + 'Z')
    : new Date();
 
  const mapName = v1.map_name ?? '';
  const diffMatch = mapName.match(/\[(.+?)\](?:\.osu)?$/);
  const titleMatch = mapName.match(/^(.+?)\s*\(([^)]+)\)\s*\[/);
  const version = diffMatch ? diffMatch[1] : '?';
  const title = titleMatch ? titleMatch[1].trim() : mapName.replace(/\.osu$/, '');

  // Hits: v2 tende a ter n300/n100/n50/nmiss, v1 pode ter count_300 etc.
  const count300  = v2?.n300  ?? v1.count_300  ?? v1.n300  ?? null;
  const count100  = v2?.n100  ?? v1.count_100  ?? v1.n100  ?? null;
  const count50   = v2?.n50   ?? v1.count_50   ?? v1.n50   ?? null;
  const countMiss = v2?.nmiss ?? v1.count_miss  ?? v1.nmiss ?? null;
 
  return {
    pp,
    accuracy: acc,
    rank: grade,
    max_combo,
    mods,
    passed: grade !== 'F',
    created_at: playTime.toISOString(),
    mode: 'osu',
    statistics: {
      count_300:  count300,
      count_100:  count100,
      count_50:   count50,
      count_miss: countMiss,
    },
    beatmap: {
      id: v1.map_id ?? null,
      version,
      max_combo: null,
      difficulty_rating: 0,
    },
    beatmapset: {
      id: v1.map_set_id ?? null,
      title,
      artist: '',
      covers: {
        list: `https://assets.ppy.sh/beatmaps/${v1.map_set_id ?? ''}/covers/list.jpg`,
      },
    },
  };
}
 
// Busca detalhes completos de cada score via v2
async function enrichScores(v1Scores) {
  return Promise.all(
    v1Scores.map(async (s) => {
      try {
        const res = await daycoreV2Get(`/scores/${s.score_id}`);
        return normalizeScoreDaycore(s, res?.data ?? null);
      } catch {
        return normalizeScoreDaycore(s, null);
      }
    })
  );
}
 
// ─── Busca ID do jogador pelo nome (via api v2) ──────────────────────────────
async function resolvePlayerId(username) {
  // /^\d+$/ em vez de !isNaN(): isNaN('   ') é false (Number('   ') === 0),
  // então uma string só de espaços virava silenciosamente o ID 0.
  if (/^\d+$/.test(username.trim())) return Number(username);
 
  const res = await daycoreV2Get('/players', { name: username });
  const results = res?.data ?? [];
  const match = results.find(
    u => u.name.toLowerCase() === username.toLowerCase() ||
         u.safe_name === username.toLowerCase().replace(/ /g, '_')
  ) ?? results[0];
 
  return match?.id ?? null;
}

// ─── Enriquece scores do Daycore com dados do beatmap (stars + max_combo) ─────
/**
 * A API do Daycore não retorna difficulty_rating nem max_combo nos scores.
 * Buscamos esses dados diretamente na API pública do Bancho, que não requer
 * autenticação para beatmaps individuais — funciona para qualquer servidor.
 *
 * @param {object[]} scores - scores normalizados (resultado de normalizeScoreDaycore)
 * @returns {Promise<object[]>} scores com beatmap.difficulty_rating e beatmap.max_combo preenchidos
 */
// Busca um beatmap na API oficial, com 1 retry em caso de rate limit (429).
async function fetchBeatmap(id) {
  const cached = beatmapCache.get(id);
  if (cached) return cached;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await getOfficialToken();
      const res = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 6000,
      });
      beatmapCache.set(id, res.data);
      return res.data;
    } catch (err) {
      if (err.response?.status === 429 && attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      return null;
    }
  }
  return null;
}

// Máximo de requisições simultâneas à API do osu! por chamada — evita
// rajadas grandes (ex: uma página de topplays) estourarem o rate limit.
const BEATMAP_BATCH_SIZE = 5;

async function enrichBeatmapData(scores) {
  // Pula mapas que já têm max_combo (ex: modo oficial já traz tudo pronto,
  // ou o mapa já foi enriquecido antes) — evita requisição desnecessária.
  const idsNeeded = [...new Set(
    scores
      .filter(s => !s.beatmap?.max_combo)
      .map(s => s.beatmap?.id)
      .filter(Boolean)
  )];

  const fetched = {};
  for (let i = 0; i < idsNeeded.length; i += BEATMAP_BATCH_SIZE) {
    const batch = idsNeeded.slice(i, i + BEATMAP_BATCH_SIZE);
    const results = await Promise.all(batch.map(fetchBeatmap));
    batch.forEach((id, idx) => { fetched[id] = results[idx]; });
  }

  // Aplica os dados aos scores
  return scores.map(score => {
    if (score.beatmap?.max_combo) return score;
    const bm = fetched[score.beatmap?.id];
    if (!bm) return score;
    return {
      ...score,
      beatmap: {
        ...score.beatmap,
        max_combo: bm.max_combo ?? score.beatmap.max_combo,
        difficulty_rating: bm.difficulty_rating ?? score.beatmap.difficulty_rating,
      },
      beatmapset: {
        ...score.beatmapset,
        // Aproveita para pegar título e artista corretos também
        title: bm.beatmapset?.title ?? score.beatmapset.title,
        artist: bm.beatmapset?.artist ?? score.beatmapset.artist,
      },
    };
  });
}


/**
 * Chama pp_calc.py como processo filho e retorna o PP calculado pelo
 * akatsuki-pp-py — o mesmo sistema que o Daycore usa internamente para RX.
 *
 * @param {number} combo -1 = usar max_combo do mapa (assume FC)
 * Requer: pip install akatsuki-pp-py
 */
function calcPPPython(beatmapId, modsBits, n300, n100, n50, nmiss, combo = -1) {
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

    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.on('close', () => {
      const val = parseFloat(output.trim());
      resolve(isNaN(val) ? null : val);
    });
    proc.on('error', (err) => {
      console.error(`[calcPPPython] falha ao iniciar "${pythonBin}":`, err.message);
      resolve(null);
    });
  });
}

// ─── FC PP ────────────────────────────────────────────────────────────────────
/**
 * Calcula o PP que o score teria rendido em Full Combo (sem misses).
 *
 * - official / private  → rosu-pp-js (algoritmo oficial osu!lazer, via Wasm)
 * - private_rx          → akatsuki-pp-js (algoritmo oppai-2019, via Neon/Rust)
 *
 * O arquivo .osu é público em https://osu.ppy.sh/osu/{beatmap_id}, então
 * funciona para Bancho e Daycore.
 *
 * Retorna null se a lib não estiver instalada, beatmap_id for desconhecido,
 * o score já for FC, ou qualquer erro de rede/parse.
 *
 * @param {object} score  - score normalizado
 * @param {string} mode   - 'official' | 'private' | 'private_rx'
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
    // ── Relax: akatsuki-pp-py via Python (oppai-2019, mesmo sistema do Daycore) ─
    // O script Python baixa o .osu internamente, então não precisamos fazer
    // o download aqui — evita que uma falha de rede neste trecho mate o PPFC.
    if (mode === 'private_rx') {
      return await calcPPPython(beatmapId, modsBits, n300, n100, n50, misses);
    }

    // ── Bancho / Daycore vanilla: rosu-pp-js (algoritmo oficial) ──────────────
    // Baixa o arquivo .osu (público no Bancho, mesmo para mapas do Daycore)
    const response = await axios.get(`https://osu.ppy.sh/osu/${beatmapId}`, {
      responseType: 'arraybuffer',
      timeout: 8000,
    });
    const beatmapBytes = new Uint8Array(response.data);

    let rosu;
    try { rosu = require('rosu-pp-js'); } catch { return null; }

    const useLazer = shouldUseLazer(mode, score.mods);

    const beatmap    = new rosu.Beatmap(beatmapBytes);
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
    beatmap.free();

    return result.pp ?? null;
  } catch {
    return null;
  }
}

/**
 * Simula o PP de um score hipotético em um mapa específico, dado mods e hits.
 *
 * - official / private  → rosu-pp-js (algoritmo oficial osu!lazer, via Wasm)
 * - private_rx          → akatsuki-pp-py via Python (oppai-2019, mesmo sistema do Daycore)
 *
 * @param {number} beatmapId
 * @param {string[]} mods       - acrônimos de mods, ex: ['DT', 'HR']
 * @param {object} hits
 * @param {number} [hits.n100=0]
 * @param {number} [hits.n50=0]
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
  const combo    = hits.combo  ?? -1;

  try {
    if (mode === 'private_rx') {
      const bm = await fetchBeatmap(beatmapId);
      const pp = await calcPPPython(beatmapId, modsBits, -1, n100, n50, misses, combo);
      if (pp === null) return null;
      return { pp, stars: bm?.difficulty_rating ?? null, maxCombo: bm?.max_combo ?? null };
    }

    const response = await axios.get(`https://osu.ppy.sh/osu/${beatmapId}`, {
      responseType: 'arraybuffer',
      timeout: 8000,
    });
    const beatmapBytes = new Uint8Array(response.data);

    let rosu;
    try { rosu = require('rosu-pp-js'); } catch { return null; }

    const useLazer = shouldUseLazer(mode, mods);

    const beatmap    = new rosu.Beatmap(beatmapBytes);
    const difficulty = new rosu.Difficulty({ mods: modsBits, lazer: useLazer });
    const diffAttrs  = difficulty.calculate(beatmap);

    const perfParams = { mods: modsBits, n100, n50, misses, lazer: useLazer };
    if (combo >= 0) perfParams.combo = combo;

    const perf   = new rosu.Performance(perfParams);
    const result = perf.calculate(diffAttrs);
    const stars  = diffAttrs.stars;
    const maxCombo = diffAttrs.maxCombo;
    beatmap.free();

    if (result.pp == null) return null;
    return { pp: result.pp, stars, maxCombo };
  } catch {
    return null;
  }
}

/** Extrai o ID numérico de um beatmap a partir de um link ou ID puro. */
function parseBeatmapId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  // https://osu.ppy.sh/beatmapsets/123#osu/456  → 456
  // https://osu.ppy.sh/b/456 ou /beatmaps/456     → 456
  // https://daycore.org/b/456                     → 456
  const hashMatch = trimmed.match(/#\w+\/(\d+)/);
  if (hashMatch) return Number(hashMatch[1]);

  const pathMatch = trimmed.match(/\/(?:b|beatmaps)\/(\d+)/);
  if (pathMatch) return Number(pathMatch[1]);

  return null;
}

// ─── API pública ──────────────────────────────────────────────────────────────

async function getUser(username, mode = DEFAULT_MODE) {
  if (mode === 'official') {
    return await officialGet(`/users/${username}/osu`);
  }
 
  const playerId = await resolvePlayerId(username);
  if (!playerId) return null;
 
  const modeNum = DAYCORE_MODE[mode] ?? 0;
 
  const [playerRes, statsRes] = await Promise.all([
    daycoreV2Get(`/players/${playerId}`),
    daycoreV2Get(`/players/${playerId}/stats/${modeNum}`),
  ]);
 
  const playerData = playerRes?.data ?? null;
  const statsData  = statsRes?.data ?? null;

  // O endpoint de stats não retorna rank — buscamos via leaderboard.
  // A posição do jogador é o índice dele no ranking global do modo.
  let globalRank  = null;
  let countryRank = null;
  try {
    const rankRes = await daycoreV1Get('get_rank_cache', { id: playerId, mode: modeNum });
    if (Array.isArray(rankRes) && rankRes.length > 0) {
      globalRank = rankRes[rankRes.length - 1].rank ?? null;
    }
  } catch {
    // Conta nova ou sem cache ainda — rank fica como null (exibido como "Unranked")
  }
 
  return normalizeUserDaycore(playerData, statsData, mode, globalRank, countryRank);
}
 
async function getBestScores(userId, limit = 10, mode = DEFAULT_MODE) {
  if (mode === 'official') {
    return await officialGet(`/users/${userId}/scores/best`, { limit });
  }
 
  const res = await daycoreV1Get('get_player_scores', {
    id: userId,
    mode: DAYCORE_MODE[mode] ?? 0,
    scope: 'best',
    limit,
  });

  // Retorna os scores crus (v1), sem enriquecer com detalhes (v2) nem com
  // dados de beatmap — isso dispararia uma rajada de requisições pra API
  // pra TODAS as scores buscadas de uma vez (estourando rate limit quando o
  // limit é alto). Quem chama enriquece só o que vai exibir (ex: a página
  // atual) via enrichScores() + enrichBeatmapData().
  return res.scores ?? [];
}
 
async function getRecentScores(userId, limit = 1, mode = DEFAULT_MODE) {
  if (mode === 'official') {
    return await officialGet(`/users/${userId}/scores/recent`, { limit, include_fails: 1 });
  }
 
  const res = await daycoreV1Get('get_player_scores', {
    id: userId,
    mode: DAYCORE_MODE[mode] ?? 0,
    scope: 'recent',
    limit,
  });

  // Idem getBestScores: retorna cru, enriquecimento fica por conta de
  // quem chama, aplicado só na página exibida.
  return res.scores ?? [];
}
 
async function getAdjustedStars(beatmapId, mods, mode = DEFAULT_MODE) {
  // Sem mods: o enrichBeatmapData já trouxe o difficulty_rating base, não precisa recalcular
  if (!mods || mods.length === 0) return null;

  // Com mods: usa o endpoint oficial do Bancho para ambos os modos —
  // os IDs de beatmap são os mesmos no Daycore e no Bancho
  try {
    const token = await getOfficialToken();
    const res = await axios.post(
      `https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}/attributes`,
      { mods, ruleset: 'osu' },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return res.data.attributes.star_rating.toFixed(2);
  } catch {
    return null;
  }
}
 
function getUserUrl(userId, mode = DEFAULT_MODE) {
  return mode === 'official'
    ? `https://osu.ppy.sh/users/${userId}`
    : `https://daycore.org/u/${userId}`;
}
 
function getMapUrl(mapId, mapSetId, mode = DEFAULT_MODE) {
  return mode === 'official'
    ? `https://osu.ppy.sh/beatmapsets/${mapSetId}#osu/${mapId}`
    : `https://daycore.org/b/${mapId}`;
}
 
function getModeLabel(mode = DEFAULT_MODE) {
  const labels = {
    official: 'Bancho',
    private: 'Daycore',
    private_rx: 'Daycore RX',
  };
  return labels[mode] ?? 'Bancho';
}
 
module.exports = {
  getUser,
  getBestScores,
  getRecentScores,
  getAdjustedStars,
  getFCpp,
  enrichScores,
  enrichBeatmapData,
  getUserUrl,
  getMapUrl,
  getModeLabel,
  getBeatmap: fetchBeatmap,
  simulatePP,
  parseBeatmapId,
  parseModsString,
  DEFAULT_MODE,
};
