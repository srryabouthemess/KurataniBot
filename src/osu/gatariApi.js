/**
 * osu/gatariApi.js
 * Adaptador para o Gatari (gatari.pw).
 *
 * Implementa o mesmo contrato dos outros adaptadores (`fetchUser`,
 * `bestScores`, `recentScores`, `beatmapScores`, `leaderboard`, `userUrl`,
 * `mapUrl`) — ver o cabeçalho do osuClient.
 *
 * ── Por que um adaptador próprio ─────────────────────────────────────────────
 * O Gatari nasceu do Ripple, mas a API pública dele (`api.gatari.pw`) já não é
 * a do Ripple: outro host, outros caminhos (`/users/get`, `/user/stats`,
 * `/user/scores/best`), datas em epoch em vez de ISO, e o usuário vem em duas
 * chamadas — identidade de um lado, estatísticas do outro. Os formatos se
 * parecem o bastante para um adaptador "quase igual" parecer funcionar e trocar
 * um campo em silêncio.
 *
 * ── Relax ─────────────────────────────────────────────────────────────────────
 * Como no Ripple, é um eixo separado do modo de jogo — aqui chamado `special`
 * (0 vanilla, 1 relax, 2 autopilot), que é o que o próprio site manda. O
 * registro guarda o eixo em `rx` (ver relaxVariant em servers.js).
 *
 * As exceções, conferidas contra a API em 2026-09-26:
 *   - as estatísticas não vêm separadas por eixo: é um objeto só, com sufixo
 *     (`pp_rx`, `rank_rx`, `avg_accuracy_rx`);
 *   - o ranking ignora `special` e muda pelo CAMINHO (`/leaderboard/rx`).
 */

const axios = require('axios');
const servers = require('../servers');
const rateLimiter = require('../rateLimiter');
const { decodeMods } = require('../mods');
const { gradeCounts } = require('./userStats');
const { idSegment, urlSegment } = require('../lib/urlSafe');
const { withRetry } = require('../lib/retry');

async function gatariGet(mode, caminho, params = {}) {
  const server = servers.get(mode);

  return withRetry(async () => {
    await rateLimiter.acquire(`server:${server.namespace}`);
    const res = await axios.get(`${server.api}${caminho}`, { params, timeout: 10000 });

    // Como o Ripple, o erro lógico vem com HTTP 200 e `code` no corpo.
    if (res.data && Number(res.data.code) >= 400) {
      const err = new Error(`gatari: código ${res.data.code} em ${caminho}`);
      err.response = { status: Number(res.data.code), data: res.data };
      throw err;
    }
    return res.data;
  });
}

/** O eixo do registro: 0 vanilla, 1 relax, 2 autopilot. */
const specialOf = (mode) => Number(servers.get(mode).rx ?? 0);

/** Sufixo das estatísticas daquele eixo: `pp`, `pp_rx`, `pp_ap`. */
const SUFIXO = { 0: '', 1: '_rx', 2: '_ap' };

/** Epoch em segundos → ISO. Zero e ausência viram null, não 1970. */
function epochIso(segundos) {
  const n = Number(segundos);
  return n > 0 ? new Date(n * 1000).toISOString() : null;
}

// ─── Normalização: usuário ────────────────────────────────────────────────────

/**
 * `info` sai do `/users/get` e `stats` do `/user/stats`. Conta sem nenhuma play
 * naquele modo devolve `stats: {}` — não é erro, é perfil zerado.
 */
function normalizeUser(info, stats, mode) {
  if (!info?.id) return null;

  const st = stats ?? {};
  const sx = SUFIXO[specialOf(mode)] ?? '';
  const campo = (nome) => st[`${nome}${sx}`];

  return {
    id: info.id,
    username: info.username,
    avatar_url: servers.avatarUrl(servers.get(mode).avatars, info.id),
    country_code: (info.country || 'xx').toUpperCase(),
    join_date: epochIso(info.registered_on),
    last_visit: epochIso(info.latest_activity),
    is_online: Boolean(info.is_online),
    statistics: {
      // Rank 0 é "sem posição" (conta inativa ou sem plays), não primeiro lugar.
      global_rank:  Number(campo('rank')) || null,
      country_rank: Number(campo('country_rank')) || null,
      pp: parseFloat(campo('pp') ?? 0),
      hit_accuracy: parseFloat(campo('avg_accuracy') ?? 0),
      level: { current: Math.floor(st.level ?? 1) || 1, progress: Number(st.level_progress) || 0 },
      maximum_combo: st.max_combo ?? 0,
      play_count: st.playcount ?? 0,
      // Tempo de jogo e notas não têm versão `_rx`/`_ap`: a API só manda os do
      // vanilla. No Relax, mostrar esses seria contar a história de outro
      // leaderboard — melhor não mostrar.
      play_time: sx ? null : (st.playtime ?? null),
      grade_counts: sx ? null : gradeCounts(st),
    },
    _private: true,
  };
}

// ─── Normalização: score ──────────────────────────────────────────────────────

/**
 * Score das listas (best/recent), que já vêm com o beatmap embutido.
 *
 * O beatmap aqui é mais completo que o do Ripple: artista, título e dificuldade
 * chegam em campos próprios, e o combo máximo vem como `fc`.
 */
function normalizeScore(raw) {
  if (!raw) return null;

  const bm = raw.beatmap ?? {};

  return {
    // O refresh do /recent casa a play por este id (ver scoreIdOf lá).
    score_id: raw.id ?? null,
    pp: parseFloat(raw.pp ?? 0),
    // A API manda 0-100; o resto do bot trabalha com 0-1.
    accuracy: parseFloat(raw.accuracy ?? 0) / 100,
    rank: raw.ranking ?? raw.rank ?? 'F',
    max_combo: raw.max_combo ?? null,
    mods: decodeMods(raw.mods ?? 0),
    score: Number(raw.score ?? 0) || null,
    // Um número só, e é o do stable: ninguém joga lazer num servidor privado.
    // A escala standardised não existe aqui (ver o normalizeScore oficial).
    score_classic:      Number(raw.score ?? 0) || null,
    score_standardised: null,
    // Mesma escala do Ripple: 0 falhou, 1 não passou, 2 passou, 3 melhor.
    passed: Number(raw.completed ?? 0) >= 2,
    created_at: epochIso(raw.time),
    mode: 'osu',
    statistics: {
      count_300:  raw.count_300  ?? null,
      count_100:  raw.count_100  ?? null,
      count_50:   raw.count_50   ?? null,
      count_miss: raw.count_miss ?? null,
    },
    beatmap: {
      id: bm.beatmap_id ?? null,
      version: bm.version ?? '?',
      max_combo: bm.fc ?? null,
      difficulty_rating: parseFloat(bm.difficulty ?? 0),
    },
    beatmapset: {
      id: bm.beatmapset_id ?? null,
      title: bm.title ?? '',
      artist: bm.artist ?? '',
      covers: {
        list: `https://assets.ppy.sh/beatmaps/${bm.beatmapset_id ?? ''}/covers/list.jpg`,
      },
    },
  };
}

const normalizeScores = (lista) => (Array.isArray(lista) ? lista.map(normalizeScore).filter(Boolean) : []);

/**
 * O score de `/beatmap/user/score`: o melhor do jogador naquele mapa, sem o
 * beatmap junto e sem `completed` — só existe score ali se ele passou. O
 * osuClient completa o mapa pela API oficial, como faz com o do Ripple.
 */
function normalizeMapScore(raw, beatmapId) {
  if (!raw) return null;

  const score = normalizeScore({ ...raw, completed: 3, beatmap: null });
  score.beatmap = { id: Number(beatmapId), version: '?', max_combo: null, difficulty_rating: 0 };
  score.beatmapset = { id: null, title: '', artist: '', covers: {} };
  return score;
}

// ─── Contrato ─────────────────────────────────────────────────────────────────

/** Aceita nome ou ID: o `u=` do Gatari resolve os dois, sem diferenciar caixa. */
async function fetchUser(username, mode) {
  const bruto = String(username).trim();
  if (!bruto) return null;

  const data = await gatariGet(mode, '/users/get', { u: bruto });
  // Jogador inexistente é `users: []` — null, como nos outros adaptadores.
  const info = Array.isArray(data?.users) ? data.users[0] : null;
  if (!info?.id) return null;

  const stats = await gatariGet(mode, '/user/stats', {
    u: info.id,
    mode: Number(servers.get(mode).gameMode ?? 0),
  });
  return normalizeUser(info, stats?.stats, mode);
}

const consultaScores = (userId, mode, limite) => ({
  id: idSegment(userId),
  mode: Number(servers.get(mode).gameMode ?? 0),
  special: specialOf(mode),
  l: limite,
  p: 1,
});

async function bestScores(userId, limit, mode) {
  const data = await gatariGet(mode, '/user/scores/best', consultaScores(userId, mode, limit));
  return normalizeScores(data?.scores);
}

async function recentScores(userId, limit, mode) {
  // `f=1` inclui as falhas: sem ele o recent só mostra o que foi até o fim, e
  // um fail — o caso mais comum de "o que acabei de jogar?" — nem apareceria.
  const data = await gatariGet(mode, '/user/scores/recent', { ...consultaScores(userId, mode, limit), f: 1 });
  return normalizeScores(data?.scores);
}

async function beatmapScores(userId, beatmapId, mode) {
  try {
    const data = await gatariGet(mode, '/beatmap/user/score', {
      b: idSegment(beatmapId),
      u: idSegment(userId),
      mode: Number(servers.get(mode).gameMode ?? 0),
      special: specialOf(mode),
    });
    // Sem score, vem `score: null` com code 200.
    const score = normalizeMapScore(data?.score, beatmapId);
    return score ? [score] : [];
  } catch (error) {
    // Id de jogador que não existe responde `code: 400` ("wrong userid").
    if (error?.response?.status === 400) return [];
    throw error;
  }
}

/** Colocados por página no Gatari: fixo em 50, o `l=` é ignorado. */
const RANKING_POR_PAGINA = 50;

/** Caminho do ranking por eixo — aqui o `special` não vale, é a URL que muda. */
const CAMINHO_RANKING = { 0: '/leaderboard/pp', 1: '/leaderboard/rx', 2: '/leaderboard/ap' };

function normalizeRankingEntry(linha) {
  return {
    id:        linha.user ?? null,
    username:  linha.username ?? '?',
    country:   (linha.country || '').toUpperCase() || null,
    pp:        Number(linha.pp ?? 0),
    accuracy:  Number(linha.accuracy ?? 0),
    playCount: Number(linha.playcount ?? 0),
  };
}

async function leaderboard(mode, { limit = 50, country = null } = {}) {
  const caminho = CAMINHO_RANKING[specialOf(mode)] ?? CAMINHO_RANKING[0];
  const paginas = Math.max(1, Math.ceil(limit / RANKING_POR_PAGINA));
  const linhas = [];

  for (let p = 1; p <= paginas; p++) {
    const data = await gatariGet(mode, caminho, {
      mode: Number(servers.get(mode).gameMode ?? 0),
      p,
      ...(country ? { country: String(country).toUpperCase() } : {}),
    });
    const pagina = Array.isArray(data?.leaderboard) ? data.leaderboard : [];
    linhas.push(...pagina);
    if (pagina.length < RANKING_POR_PAGINA) break;
  }

  return linhas.slice(0, limit).map(normalizeRankingEntry);
}

/** O perfil do Gatari tem uma página por eixo (`/u/1000/rx`). */
function userUrl(userId, mode) {
  const sufixo = { 1: '/rx', 2: '/ap' }[specialOf(mode)] ?? '';
  return `${servers.get(mode).webUrl}/u/${urlSegment(userId)}${sufixo}`;
}

const mapUrl = (mapId, _setId, mode) => `${servers.get(mode).webUrl}/b/${urlSegment(mapId)}`;

module.exports = {
  fetchUser,
  bestScores,
  recentScores,
  beatmapScores,
  leaderboard,
  userUrl,
  mapUrl,

  // Exportados para teste, pelo mesmo motivo do rippleApi.
  normalizeScore,
  normalizeMapScore,
  normalizeUser,
  normalizeRankingEntry,
};
