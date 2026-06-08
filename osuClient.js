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
function decodeMods(bits) {
  const MOD_MAP = {
    1: 'NF', 2: 'EZ', 8: 'HD', 16: 'HR', 32: 'SD',
    64: 'DT', 128: 'RX', 256: 'HT', 512: 'NC', 1024: 'FL',
    4096: 'SO', 16384: 'PF',
  };
  return Object.entries(MOD_MAP)
    .filter(([bit]) => Number(bits) & Number(bit))
    .map(([, name]) => name);
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
  if (!isNaN(username)) return Number(username);
 
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
async function enrichBeatmapData(scores) {
  // Coleta IDs únicos para não fazer requisições duplicadas
  const uniqueIds = [...new Set(scores.map(s => s.beatmap?.id).filter(Boolean))];

  // Busca todos em paralelo
  const beatmapCache = {};
  await Promise.all(
    uniqueIds.map(async (id) => {
      try {
        const token = await getOfficialToken();
        const res = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 6000,
        });
        beatmapCache[id] = res.data;
      } catch {
        beatmapCache[id] = null;
      }
    })
  );

  // Aplica os dados aos scores
  return scores.map(score => {
    const bm = beatmapCache[score.beatmap?.id];
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
 * Chama pp_calc.py como processo filho e retorna o PP de FC calculado pelo
 * akatsuki-pp-py — o mesmo sistema que o Daycore usa internamente para RX.
 *
 * Requer: pip install akatsuki-pp-py
 */
function getFCppPython(beatmapId, modsBits, n300, n100, n50, nmiss) {
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
      String(-1),  // combo: -1 = usar max_combo do mapa
    ];

    const proc = spawn('python', args, { timeout: 12000 });

    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.on('close', () => {
      const val = parseFloat(output.trim());
      resolve(isNaN(val) ? null : val);
    });
    proc.on('error', () => resolve(null));
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
  const MOD_BITS = {
    NF: 1, EZ: 2, HD: 8, HR: 16, SD: 32,
    DT: 64, RX: 128, HT: 256, NC: 512, FL: 1024,
    SO: 4096, PF: 16384,
  };
  const modsBits = (score.mods ?? []).reduce((acc, m) => acc | (MOD_BITS[m] ?? 0), 0);

  try {
    // Baixa o arquivo .osu (público no Bancho, mesmo para mapas do Daycore)
    const response = await axios.get(`https://osu.ppy.sh/osu/${beatmapId}`, {
      responseType: 'arraybuffer',
      timeout: 8000,
    });
    const beatmapBytes = new Uint8Array(response.data);

    // ── Relax: akatsuki-pp-py via Python (oppai-2019, mesmo sistema do Daycore) ─
    if (mode === 'private_rx') {
      return await getFCppPython(beatmapId, modsBits, n300, n100, n50, misses);
    }

    // ── Bancho / Daycore vanilla: rosu-pp-js (algoritmo oficial) ──────────────
    let rosu;
    try { rosu = require('rosu-pp-js'); } catch { return null; }

    const beatmap    = new rosu.Beatmap(beatmapBytes);
    const difficulty = new rosu.Difficulty({ mods: modsBits });
    const diffAttrs  = difficulty.calculate(beatmap);

    const perfParams = { mods: modsBits, misses: 0 };
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

  const scores = await enrichScores(res.scores ?? []);
  return enrichBeatmapData(scores);
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

  const scores = await enrichScores(res.scores ?? []);
  return enrichBeatmapData(scores);
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
  getUserUrl,
  getMapUrl,
  getModeLabel,
  DEFAULT_MODE,
};
