/**
 * osu/rippleApi.js
 * Adaptador para servidores Ripple (front-end Hanayo) — Akatsuki e derivados.
 *
 * Implementa o mesmo contrato do officialApi e do banchoPyApi (`fetchUser`,
 * `bestScores`, `recentScores`, `beatmapScores`, `userUrl`, `mapUrl`), para o
 * osuClient escolher entre os três sem saber a diferença.
 *
 * ── Por que não deu para reaproveitar o adaptador de bancho.py ────────────────
 * Nada em comum além de serem "servidor privado de osu!". O Ripple serve tudo
 * de `<site>/api/v1`, no mesmo host; a convenção `api.<domínio>` do bancho.py
 * nem resolve DNS no Akatsuki. Os formatos de usuário e de score também são
 * outros.
 *
 * ── Relax é uma DIMENSÃO, não um modo de jogo ────────────────────────────────
 * Esta é a diferença que mais mexeu no registro. No bancho.py, Relax é o
 * "modo 4" — cabe no mesmo campo que osu!/taiko/catch/mania. No Ripple são dois
 * eixos independentes: `mode` (0-3) e `rx` (0 vanilla, 1 relax, 2 autopilot).
 *
 * Por isso o registro passou a carregar `rx` separado de `gameMode`, em vez de
 * o adaptador deduzir um do outro (ver relaxVariant em servers.js). O bot só
 * atende osu!standard, então `mode` é sempre 0 aqui — mas o eixo existe.
 *
 * As estatísticas seguem a mesma forma: `stats` vem como array indexado por
 * `rx`, e dentro dele um objeto por modo (`stats[rx].std`).
 */

const axios = require('axios');
const servers = require('../servers');
const rateLimiter = require('../rateLimiter');
const { decodeMods } = require('../mods');
const { idSegment, urlSegment } = require('../urlSafe');
const { withRetry } = require('../retry');

/** Base da API daquele servidor. O Ripple serve tudo do próprio host. */
function apiBase(mode) {
  return `${servers.get(mode).webUrl}/api/v1`;
}

async function rippleGet(mode, caminho, params = {}) {
  const server = servers.get(mode);

  return withRetry(async () => {
    await rateLimiter.acquire(`server:${server.key}`);
    const res = await axios.get(`${apiBase(mode)}${caminho}`, { params, timeout: 10000 });

    // O Ripple responde 200 com `code` no corpo — um 404 lógico não vira
    // status HTTP. Sem checar isto, "usuário não existe" viraria um objeto
    // meio preenchido em vez de null.
    if (res.data && Number(res.data.code) >= 400) {
      const err = new Error(`ripple: código ${res.data.code} em ${caminho}`);
      err.response = { status: Number(res.data.code), data: res.data };
      throw err;
    }
    return res.data;
  });
}

/** O eixo relax daquele registro: 0 vanilla, 1 relax, 2 autopilot. */
const rxOf = (mode) => Number(servers.get(mode).rx ?? 0);

// ─── Normalização: usuário ────────────────────────────────────────────────────

/**
 * `stats` é um array indexado por `rx`, e cada item tem um objeto por modo.
 * Ausência é possível (conta nova, modo nunca jogado) e não é erro.
 */
function statsFor(data, rx) {
  const porRx = Array.isArray(data?.stats) ? data.stats[rx] : data?.stats;
  return porRx?.std ?? null;
}

function normalizeUser(data, mode) {
  if (!data?.id) return null;

  const st = statsFor(data, rxOf(mode)) ?? {};

  return {
    id: data.id,
    username: data.username,
    avatar_url: `${servers.get(mode).avatars}/${data.id}`,
    country_code: (data.country || 'xx').toUpperCase(),
    // Já vêm em ISO, ao contrário do bancho.py, que manda epoch.
    join_date: data.registered_on ?? null,
    last_visit: data.latest_activity ?? null,
    is_online: false,
    statistics: {
      global_rank:  st.global_leaderboard_rank ?? null,
      country_rank: st.country_leaderboard_rank ?? null,
      pp: parseFloat(st.pp ?? 0),
      hit_accuracy: parseFloat(st.accuracy ?? 0),
      level: { current: Math.floor(st.level ?? 1) || 1 },
      maximum_combo: st.max_combo ?? 0,
      play_count: st.playcount ?? 0,
    },
    _private: true,
  };
}

// ─── Normalização: score ──────────────────────────────────────────────────────

/**
 * `song_name` chega como "Artista - Título [Dificuldade]", num campo só.
 *
 * O adaptador de bancho.py faz o mesmo tipo de extração sobre `map_name`, e
 * pela mesma razão: é o único lugar onde esses três dados existem. Título com
 * hífen ou colchete no nome quebra a separação — daí o corte no PRIMEIRO " - "
 * e no ÚLTIMO "[", que é o que erra menos.
 */
function parseSongName(songName) {
  const bruto = String(songName ?? '');

  const fimDif = bruto.lastIndexOf('[');
  const version = fimDif >= 0 ? bruto.slice(fimDif + 1).replace(/\]\s*$/, '') : '?';
  const semDif  = fimDif >= 0 ? bruto.slice(0, fimDif).trim() : bruto.trim();

  const sep = semDif.indexOf(' - ');
  return sep >= 0
    ? { artist: semDif.slice(0, sep).trim(), title: semDif.slice(sep + 3).trim(), version }
    : { artist: '', title: semDif, version };
}

function normalizeScore(raw) {
  if (!raw) return null;

  const bm = raw.beatmap ?? {};
  const { artist, title, version } = parseSongName(bm.song_name);

  return {
    pp: parseFloat(raw.pp ?? 0),
    // A API manda 0-100; o resto do bot trabalha com 0-1.
    accuracy: parseFloat(raw.accuracy ?? 0) / 100,
    rank: raw.rank ?? 'F',
    max_combo: raw.max_combo ?? null,
    mods: decodeMods(raw.mods ?? 0),
    // `completed`: 0 falhou, 1 não passou, 2 passou, 3 é o melhor do jogador.
    // Qualquer coisa a partir de 2 significa que a play foi até o fim.
    passed: Number(raw.completed ?? 0) >= 2,
    created_at: raw.time ?? null,
    mode: 'osu',
    statistics: {
      count_300:  raw.count_300  ?? null,
      count_100:  raw.count_100  ?? null,
      count_50:   raw.count_50   ?? null,
      count_miss: raw.count_miss ?? null,
    },
    beatmap: {
      id: bm.beatmap_id ?? null,
      version,
      // O Ripple manda o combo máximo do mapa, que o bancho.py não manda —
      // é o que o cálculo de FC precisa para saber se houve choke.
      max_combo: bm.max_combo ?? null,
      difficulty_rating: parseFloat(bm.difficulty ?? 0),
    },
    beatmapset: {
      id: bm.beatmapset_id ?? null,
      title,
      artist,
      covers: {
        list: `https://assets.ppy.sh/beatmaps/${bm.beatmapset_id ?? ''}/covers/list.jpg`,
      },
    },
  };
}

const normalizeScores = (lista) => (Array.isArray(lista) ? lista.map(normalizeScore).filter(Boolean) : []);

/**
 * Score no formato legado da API v1 do osu! (endpoint `/api/get_scores`).
 *
 * Tudo chega como string, e não há dado nenhum do beatmap — o osuClient
 * completa depois pela API oficial (`enrichBeatmapData`), que é o mesmo caminho
 * dos scores de bancho.py.
 *
 * A data vem como datetime de SQL ("2021-12-22 05:34:00"), sem fuso. É UTC; o
 * `T` e o `Z` explícitos evitam o JS interpretar como horário local — meio dia
 * de diferença conforme quem roda o bot.
 */
function normalizeLegacyScore(raw, beatmapId) {
  if (!raw?.score_id) return null;

  const n = (v) => (v == null ? null : Number(v));
  const acertos = {
    count_300:  n(raw.count300),
    count_100:  n(raw.count100),
    count_50:   n(raw.count50),
    count_miss: n(raw.countmiss),
  };

  // O legado não manda accuracy: calculamos dos acertos, como o próprio osu!.
  const total = (acertos.count_300 ?? 0) + (acertos.count_100 ?? 0)
              + (acertos.count_50 ?? 0) + (acertos.count_miss ?? 0);
  const pontos = (acertos.count_300 ?? 0) * 300 + (acertos.count_100 ?? 0) * 100
               + (acertos.count_50 ?? 0) * 50;
  const accuracy = total > 0 ? pontos / (total * 300) : 0;

  const data = String(raw.date ?? '').trim();
  const iso = data ? `${data.replace(' ', 'T')}Z` : null;

  return {
    pp: parseFloat(raw.pp ?? 0),
    accuracy,
    rank: raw.rank ?? 'F',
    max_combo: n(raw.maxcombo),
    mods: decodeMods(n(raw.enabled_mods) ?? 0),
    // O legado não diz se passou; um score registrado com grade que não seja F
    // é uma play concluída.
    passed: (raw.rank ?? 'F') !== 'F',
    created_at: iso,
    mode: 'osu',
    statistics: acertos,
    beatmap: {
      id: Number(beatmapId),
      version: '?',
      max_combo: null,
      difficulty_rating: 0,
    },
    beatmapset: {
      id: null,
      title: '',
      artist: '',
      covers: {},
    },
  };
}

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * Aceita nome ou ID. A API tem parâmetros distintos para cada um, e mandar um
 * ID no campo `name` faz o Ripple procurar um jogador chamado "1001".
 */
async function fetchUser(username, mode) {
  const bruto = String(username).trim();
  const params = /^\d+$/.test(bruto) ? { id: Number(bruto) } : { name: bruto };

  try {
    const data = await rippleGet(mode, '/users/full', params);
    return normalizeUser(data, mode);
  } catch (error) {
    // Mesmo contrato dos outros adaptadores: jogador inexistente é null, não
    // exceção — é resultado normal de nick digitado errado.
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

const consultaScores = (userId, mode, limite) => ({
  id: idSegment(userId),
  mode: Number(servers.get(mode).gameMode ?? 0),
  rx: rxOf(mode),
  l: limite,
});

async function bestScores(userId, limit, mode) {
  const data = await rippleGet(mode, '/users/scores/best', consultaScores(userId, mode, limit));
  return normalizeScores(data?.scores);
}

async function recentScores(userId, limit, mode) {
  const data = await rippleGet(mode, '/users/scores/recent', consultaScores(userId, mode, limit));
  return normalizeScores(data?.scores);
}

/**
 * Score daquele jogador naquele mapa.
 *
 * ── Por que este método usa outro endpoint, e outro formato ──────────────────
 * O `/api/v1/scores?b=` devolve o leaderboard do MAPA e **não aceita filtro por
 * jogador**: testados `userid`, `user_id`, `id` e `name`, todos devolvem os
 * mesmos 50 primeiros colocados. Usá-lo faria o /score mostrar o score de
 * outra pessoa como se fosse o de quem perguntou.
 *
 * O Ripple também expõe `/api/get_scores`, no formato legado da API v1 do osu!,
 * e esse filtra de verdade (`u=`). O preço é um segundo formato para traduzir:
 * campos como string, `enabled_mods` em vez de `mods`, `maxcombo` sem
 * underscore, e nenhum dado do beatmap — que o osuClient completa depois pela
 * API oficial, como já faz para os outros servidores.
 */
async function beatmapScores(userId, beatmapId, mode) {
  const server = servers.get(mode);
  await rateLimiter.acquire(`server:${server.key}`);

  const res = await axios.get(`${server.webUrl}/api/get_scores`, {
    params: {
      b: idSegment(beatmapId),
      u: idSegment(userId),
      // `type=id` evita o Ripple interpretar o número como nome de jogador.
      type: 'id',
      m: Number(server.gameMode ?? 0),
      rx: rxOf(mode),
    },
    timeout: 10000,
  });

  const lista = Array.isArray(res.data) ? res.data : [];
  return lista.map(s => normalizeLegacyScore(s, beatmapId)).filter(Boolean);
}

const userUrl = (userId, mode) => `${servers.get(mode).webUrl}/u/${urlSegment(userId)}`;
const mapUrl  = (mapId, _setId, mode) => `${servers.get(mode).webUrl}/b/${urlSegment(mapId)}`;

module.exports = {
  fetchUser,
  bestScores,
  recentScores,
  beatmapScores,
  userUrl,
  mapUrl,

  // Exportados para teste: são as duas traduções onde um erro passa despercebido
  // — o score sai plausível, só que com o campo errado.
  normalizeScore,
  normalizeLegacyScore,
  normalizeUser,
  parseSongName,
};
