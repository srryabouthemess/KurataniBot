/**
 * Os pedaços do perfil que cada servidor manda num formato. As amostras são
 * respostas reais, cortadas: Akatsuki (Ripple), Gatari e Daycore (bancho.py).
 */
const test = require('node:test');
const assert = require('node:assert');

const { levelFromScore, levelFromFloat, gradeCounts } = require('../src/osu/userStats');
const ripple  = require('../src/osu/rippleApi');
const gatari  = require('../src/osu/gatariApi');
const { normalizeUserPrivate } = require('../src/osu/banchoPyApi/normalize');
const servers = require('../src/servers');

test('o level sai do score total pela curva do osu!', () => {
  // A Akatsuki manda os dois: 29.261.595.431 de score total, level 100.0233.
  assert.deepEqual(levelFromScore(29261595431), { current: 100, progress: 2 });
  assert.deepEqual(levelFromScore(0), { current: 1, progress: 0 });
  assert.deepEqual(levelFromScore(undefined), { current: 1, progress: 0 });
  // Acima de 100, cada nível custa 99.999.999.999.
  assert.deepEqual(levelFromScore(26931190827 + 99999999999 * 1.5), { current: 101, progress: 50 });
});

test('level em ponto flutuante vira nível e progresso', () => {
  assert.deepEqual(levelFromFloat(100.07), { current: 100, progress: 7 });
  assert.deepEqual(levelFromFloat(null), { current: 1, progress: 0 });
});

test('sem contagem de notas é null, e não zero de tudo', () => {
  assert.equal(gradeCounts(null), null);
  assert.equal(gradeCounts({ pp: 1 }), null);
  assert.deepEqual(
    gradeCounts({ xh_count: 9, x_count: 6, sh_count: 126, s_count: 55, a_count: 1043 }),
    { ssh: 9, ss: 6, sh: 126, s: 55, a: 1043 },
  );
});

test('Ripple: notas, tempo de jogo e level do leaderboard pedido', () => {
  const u = ripple.normalizeUser({
    id: 1001, username: 'x', country: 'BR',
    stats: [{ std: {
      playcount: 22945, playtime: 17379981, level: 100.02330404602, pp: 8272,
      grades: { xh_count: 9, x_count: 6, sh_count: 126, s_count: 55, a_count: 1043 },
    } }],
  }, 'akatsuki').statistics;
  assert.equal(u.play_time, 17379981);
  assert.deepEqual(u.level, { current: 100, progress: 2 });
  assert.deepEqual(u.grade_counts, { ssh: 9, ss: 6, sh: 126, s: 55, a: 1043 });
});

test('Gatari: o Relax não herda tempo de jogo nem notas do vanilla', () => {
  const INFO  = { id: 1000, username: 'mixa_zxc', country: 'RU' };
  const STATS = {
    pp: 8755, pp_rx: 1768, level: 101, level_progress: 48, playtime: 8469187,
    xh_count: 6, x_count: 30, sh_count: 44, s_count: 592, a_count: 1861,
  };

  const vn = gatari.normalizeUser(INFO, STATS, 'gatari').statistics;
  assert.deepEqual(vn.level, { current: 101, progress: 48 });
  assert.equal(vn.play_time, 8469187);
  assert.deepEqual(vn.grade_counts, { ssh: 6, ss: 30, sh: 44, s: 592, a: 1861 });

  const rx = gatari.normalizeUser(INFO, STATS, servers.relaxKey('gatari')).statistics;
  assert.equal(rx.play_time, null);
  assert.equal(rx.grade_counts, null);
});

test('bancho.py: level calculado do tscore, notas e tempo de jogo', () => {
  const u = normalizeUserPrivate(
    { id: 3, name: 'x', country: 'br' },
    { tscore: 29261595431, plays: 1920, playtime: 127500,
      xh_count: 0, x_count: 0, sh_count: 1, s_count: 12, a_count: 85 },
    'daycore',
  ).statistics;
  assert.deepEqual(u.level, { current: 100, progress: 2 });
  assert.equal(u.play_time, 127500);
  assert.deepEqual(u.grade_counts, { ssh: 0, ss: 0, sh: 1, s: 12, a: 85 });
});
