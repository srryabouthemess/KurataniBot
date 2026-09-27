/**
 * Adaptador do Gatari.
 *
 * Quarto tipo de servidor, ao lado de `official`, `banchopy` e `ripple`. O
 * Gatari veio do Ripple e os formatos se parecem — é justamente o risco: um
 * campo com o nome do Ripple (`rank` no lugar de `ranking`, `max_combo` no
 * lugar de `fc`) não estoura, só sai vazio ou zerado na tela.
 *
 * As amostras abaixo são respostas reais de `api.gatari.pw`, cortadas.
 */
const test = require('node:test');
const assert = require('node:assert');

const gatari = require('../src/osu/gatariApi');
const servers = require('../src/servers');

// ─── Score das listas ─────────────────────────────────────────────────────────

const SCORE = {
  accuracy: 99.555557250977,
  beatmap: {
    artist: 'MIMI feat. Hatsune Miku', beatmap_id: 2014469, beatmapset_id: 962088,
    difficulty: 5.50566, fc: 433, title: 'Marshmary', version: 'Horizon',
    song_name: 'MIMI feat. Hatsune Miku - Marshmary [Horizon]',
  },
  completed: 3, count_100: 2, count_300: 298, count_50: 0, count_miss: 0,
  id: 61839458, max_combo: 433, mods: 64, pp: 512.09, ranking: 'S',
  score: 4590136, time: 1608160529,
};

test('score traduzido mantém os números certos', () => {
  const s = gatari.normalizeScore(SCORE);
  assert.equal(s.score_id, 61839458);
  assert.equal(s.pp, 512.09);
  assert.ok(Math.abs(s.accuracy - 0.99555557250977) < 1e-9, `acc ${s.accuracy}`);
  // O Gatari chama a nota de `ranking`, e não `rank` como o Ripple.
  assert.equal(s.rank, 'S');
  assert.deepEqual(s.mods, ['DT']);
  assert.equal(s.passed, true);
});

test('o combo máximo do mapa vem de `fc`', () => {
  // É o que o cálculo de FC usa para saber se houve choke; sem ele todo score
  // pareceria incompleto e o osuClient iria à API oficial à toa.
  const s = gatari.normalizeScore(SCORE);
  assert.equal(s.beatmap.id, 2014469);
  assert.equal(s.beatmap.max_combo, 433);
  assert.equal(s.beatmap.difficulty_rating, 5.50566);
  assert.equal(s.beatmap.version, 'Horizon');
  assert.equal(s.beatmapset.title, 'Marshmary');
  assert.equal(s.beatmapset.artist, 'MIMI feat. Hatsune Miku');
});

test('a data chega em epoch e sai em ISO', () => {
  assert.equal(gatari.normalizeScore(SCORE).created_at, '2020-12-16T23:15:29.000Z');
  assert.equal(gatari.normalizeScore({ ...SCORE, time: 0 }).created_at, null);
});

test('play falhada não passa', () => {
  const s = gatari.normalizeScore({ ...SCORE, completed: 0, ranking: 'F', pp: 0 });
  assert.equal(s.passed, false);
  assert.equal(s.rank, 'F');
});

// ─── Score do mapa ────────────────────────────────────────────────────────────

test('o score do mapa usa `rank` e completa o beatmap pelo id pedido', () => {
  const s = gatari.normalizeMapScore({
    accuracy: 99.555557250977, count_100: 2, count_300: 298, count_50: 0, count_miss: 0,
    id: 61839458, max_combo: 433, mods: 64, pp: 512.09, rank: 'S', score: 4590136, time: 1608160529,
  }, 2014469);
  assert.equal(s.rank, 'S');
  assert.equal(s.passed, true);
  assert.equal(s.beatmap.id, 2014469);
  assert.equal(gatari.normalizeMapScore(null, 1), null);
});

// ─── Usuário ──────────────────────────────────────────────────────────────────

const INFO  = { id: 1000, username: 'mixa_zxc', country: 'RU', registered_on: 1484068800, latest_activity: 1789172178 };
const STATS = {
  pp: 8755, pp_rx: 1768, pp_ap: 50,
  rank: 508, rank_rx: 2607, rank_ap: 975,
  country_rank: 104, country_rank_rx: 1191,
  avg_accuracy: 98.78, avg_accuracy_rx: 91.51,
  level: 101, max_combo: 4151, playcount: 161067,
};

test('o vanilla lê os campos sem sufixo, o Relax os `_rx`', () => {
  const vn = gatari.normalizeUser(INFO, STATS, 'gatari').statistics;
  assert.equal(vn.pp, 8755);
  assert.equal(vn.global_rank, 508);
  assert.equal(vn.hit_accuracy, 98.78);

  const rx = gatari.normalizeUser(INFO, STATS, servers.relaxKey('gatari')).statistics;
  assert.equal(rx.pp, 1768);
  assert.equal(rx.global_rank, 2607);
  assert.equal(rx.country_rank, 1191);
  assert.equal(rx.hit_accuracy, 91.51);
});

test('conta sem plays no modo sai zerada, sem rank', () => {
  // A API responde `stats: {}`; rank 0 seria "primeiro lugar" na tela.
  const u = gatari.normalizeUser(INFO, {}, 'gatari');
  assert.equal(u.statistics.pp, 0);
  assert.equal(u.statistics.global_rank, null);
  assert.equal(u.join_date, '2017-01-10T17:20:00.000Z');
  assert.equal(gatari.normalizeUser(null, STATS, 'gatari'), null);
});

// ─── Endereços e ranking ─────────────────────────────────────────────────────

test('o perfil de Relax tem página própria', () => {
  assert.equal(gatari.userUrl(1000, 'gatari'), 'https://osu.gatari.pw/u/1000');
  assert.equal(gatari.userUrl(1000, servers.relaxKey('gatari')), 'https://osu.gatari.pw/u/1000/rx');
  assert.equal(gatari.mapUrl(2014469, null, 'gatari'), 'https://osu.gatari.pw/b/2014469');
});

test('linha do ranking usa `user` como id', () => {
  const r = gatari.normalizeRankingEntry({
    user: 29826, username: 'kaan', country: 'de', pp: 18862, accuracy: 94.66, playcount: 1914,
  });
  assert.deepEqual(r, { id: 29826, username: 'kaan', country: 'DE', pp: 18862, accuracy: 94.66, playCount: 1914 });
});
