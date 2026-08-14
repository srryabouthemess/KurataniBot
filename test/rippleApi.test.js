/**
 * Adaptador Ripple (Akatsuki e derivados).
 *
 * Terceiro tipo de servidor do bot, ao lado de `official` e `banchopy`. Nada em
 * comum com o bancho.py além de servir osu!: outro host de API, outro formato
 * de usuário, outro de score — e, dentro do próprio Ripple, **dois** formatos de
 * score, porque o endpoint que filtra por jogador é o legado.
 *
 * O que estes casos travam é a tradução. Um normalizador errado não estoura:
 * ele devolve um score plausível com o campo trocado, e isso só aparece quando
 * alguém estranha o número na tela.
 */
const test = require('node:test');
const assert = require('node:assert');

const ripple = require('../src/osu/rippleApi');

// ─── song_name → artista / título / dificuldade ──────────────────────────────
// Os três dados vêm num campo só, e é a única fonte deles.

test('separa artista, título e dificuldade', () => {
  const r = ripple.parseSongName('Dough - Yousei-zoku no Ayaya! [AYAYA]');
  assert.equal(r.artist, 'Dough');
  assert.equal(r.title, 'Yousei-zoku no Ayaya!');
  assert.equal(r.version, 'AYAYA');
});

test('título com hífen não vira artista', () => {
  // Corta no PRIMEIRO " - ": o que vem antes é o artista, o resto é título.
  const r = ripple.parseSongName('ONE OK ROCK - Bombs away - remix [Detonation]');
  assert.equal(r.artist, 'ONE OK ROCK');
  assert.equal(r.title, 'Bombs away - remix');
});

test('colchete no título não vira dificuldade', () => {
  // Corta no ÚLTIMO "[": a dificuldade é sempre a última.
  const r = ripple.parseSongName('Artista - Musica [TV Size] [Insane]');
  assert.equal(r.title, 'Musica [TV Size]');
  assert.equal(r.version, 'Insane');
});

test('formato inesperado não derruba nada', () => {
  assert.deepEqual(ripple.parseSongName(''), { artist: '', title: '', version: '?' });
  assert.equal(ripple.parseSongName(null).version, '?');
  assert.equal(ripple.parseSongName('sem separador nenhum').title, 'sem separador nenhum');
});

// ─── Score do /api/v1 ────────────────────────────────────────────────────────

const SCORE_V1 = {
  id: '519553671', score: 2407324, max_combo: 299, mods: 24,
  count_300: 236, count_100: 2, count_50: 0, count_miss: 1,
  time: '2021-12-22T05:34:00Z', accuracy: 99.024, pp: 477.41, rank: 'A',
  completed: 3,
  beatmap: {
    beatmap_id: 2361328, beatmapset_id: 1130415,
    song_name: 'Dough - Yousei-zoku no Ayaya! [AYAYA]',
    max_combo: 314, difficulty: 0,
  },
};

test('score traduzido mantém os números certos', () => {
  const s = ripple.normalizeScore(SCORE_V1);
  assert.equal(s.pp, 477.41);
  // A API manda 0-100; o resto do bot trabalha com 0-1.
  assert.ok(Math.abs(s.accuracy - 0.99024) < 1e-9, `acc ${s.accuracy}`);
  assert.equal(s.rank, 'A');
  assert.equal(s.beatmap.id, 2361328);
  assert.equal(s.beatmap.max_combo, 314);
  assert.equal(s.beatmapset.id, 1130415);
});

test('mods viram acrônimos', () => {
  // 24 = HD (8) + HR (16). Bitmask, como no bancho.py.
  assert.deepEqual(ripple.normalizeScore(SCORE_V1).mods.sort(), ['HD', 'HR']);
});

test('completed decide se a play passou', () => {
  // 0 falhou, 1 não passou, 2 passou, 3 é o melhor do jogador.
  const passou = (c) => ripple.normalizeScore({ ...SCORE_V1, completed: c }).passed;
  assert.equal(passou(0), false);
  assert.equal(passou(1), false);
  assert.equal(passou(2), true);
  assert.equal(passou(3), true);
});

// ─── Score do /api/get_scores (formato legado) ───────────────────────────────
// É o único endpoint que filtra por jogador; o /api/v1/scores devolve o
// leaderboard do mapa inteiro, o que faria o /score mostrar score alheio.

const SCORE_LEGADO = {
  score_id: '519553671', username: 'cmyui', score: '2407324', maxcombo: '299',
  count50: '0', count100: '2', count300: '236', countmiss: '1',
  enabled_mods: '24', user_id: '1001', date: '2021-12-22 05:34:00',
  rank: 'A', pp: '477.41',
};

test('formato legado: strings viram números', () => {
  const s = ripple.normalizeLegacyScore(SCORE_LEGADO, 2361328);
  assert.equal(s.pp, 477.41);
  assert.equal(s.max_combo, 299);
  assert.equal(s.statistics.count_300, 236);
  assert.equal(typeof s.max_combo, 'number');
});

test('formato legado: accuracy é calculada, porque não vem', () => {
  const s = ripple.normalizeLegacyScore(SCORE_LEGADO, 2361328);
  // (236*300 + 2*100) / (239*300) — a mesma fórmula do osu!.
  const esperado = (236 * 300 + 2 * 100) / (239 * 300);
  assert.ok(Math.abs(s.accuracy - esperado) < 1e-9, `acc ${s.accuracy}`);
});

test('formato legado: a data é lida como UTC', () => {
  // Vem como datetime de SQL, sem fuso. Sem o Z explícito, o JS assumiria o
  // horário local de quem roda o bot — até meio dia de diferença.
  const s = ripple.normalizeLegacyScore(SCORE_LEGADO, 2361328);
  assert.equal(new Date(s.created_at).toISOString(), '2021-12-22T05:34:00.000Z');
});

test('formato legado: mods também são bitmask', () => {
  assert.deepEqual(ripple.normalizeLegacyScore(SCORE_LEGADO, 2361328).mods.sort(), ['HD', 'HR']);
});

test('formato legado: o beatmap fica para o osuClient completar', () => {
  // O endpoint não manda nada do mapa além do id que já passamos.
  const s = ripple.normalizeLegacyScore(SCORE_LEGADO, 2361328);
  assert.equal(s.beatmap.id, 2361328);
  assert.equal(s.beatmap.max_combo, null, 'null é o sinal de "enriqueça isto"');
});

test('linha sem score_id é descartada', () => {
  assert.equal(ripple.normalizeLegacyScore({}, 1), null);
  assert.equal(ripple.normalizeLegacyScore(null, 1), null);
});

// ─── Enriquecimento: o combo não pode mascarar a falta de estrelas ───────────
// O Ripple manda `max_combo` no score e nenhuma dificuldade. O osuClient
// buscava metadados só quando faltava o combo, então com Ripple ele pulava o
// enriquecimento e a estrela ficava em zero — o embed saía "?★".

test('score do Ripple ainda precisa de enriquecimento, apesar do combo', () => {
  const s = ripple.normalizeScore(SCORE_V1);
  assert.ok(s.beatmap.max_combo > 0, 'o combo vem do servidor');
  assert.equal(s.beatmap.difficulty_rating, 0, 'a dificuldade não vem');

  // É esta combinação que a condição do enrichBeatmapData precisa pegar.
  const precisa = !s.beatmap.max_combo || !s.beatmap.difficulty_rating;
  assert.equal(precisa, true, 'testar só o combo deixaria a estrela em zero');
});
