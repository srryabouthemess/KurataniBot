/**
 * As melhores plays do servidor — a tradução e a capacidade.
 *
 * São dois riscos diferentes:
 *
 *   1. a linha da tabela de scores vira uma play exibível pela mescla de DUAS
 *      respostas (o score, do /v2/scores; o mapa, do get_map_info), e o erro
 *      típico aqui não estoura — sai uma play plausível com o mapa de outra;
 *   2. só o bancho.py sabe responder essa pergunta, e é a presença do método no
 *      adaptador que o osuClient usa para decidir. Um `topScores` que aparecesse
 *      no adaptador errado faria o comando prometer o que a API não entrega.
 */
const test = require('node:test');
const assert = require('node:assert');

const banchoPy = require('../src/osu/banchoPyApi');
const oficial  = require('../src/osu/officialApi');
const ripple   = require('../src/osu/rippleApi');

// Uma linha real de /v2/scores?status=2 e o mapa dela, do get_map_info.
const SCORE = {
  id: 174, map_md5: 'c9557c9d6cc35fb6a0a43c37e226703e', userid: 7,
  score: 1719660, pp: 147.99, acc: 92.372, max_combo: 201, mods: 88,
  n300: 393, n100: 32, n50: 0, nmiss: 12,
  grade: 'B', status: 2, mode: 0, play_time: '2026-05-17T21:05:49', perfect: false,
};

const MAPA = {
  md5: 'c9557c9d6cc35fb6a0a43c37e226703e', id: 1805627, set_id: 863227,
  artist: 'Brian The Sun', title: 'Lonely Go! (TV Size)', version: 'Jougan',
  creator: 'Nevo', max_combo: 575, diff: 6.664, bpm: 204, mode: 0,
};

test('a metade do score é preservada', () => {
  const p = banchoPy.normalizeServerScore(SCORE, MAPA);
  assert.equal(p.pp, 147.99);
  // A API manda 0-100; o resto do bot lê acurácia de score entre 0 e 1.
  assert.ok(Math.abs(p.accuracy - 0.92372) < 1e-9, `acc ${p.accuracy}`);
  assert.equal(p.rank, 'B');
  assert.deepEqual(p.mods.sort(), ['DT', 'HD', 'HR']); // 88 = HD+HR+DT
  assert.equal(p.statistics.count_300, 393);
  assert.equal(p.statistics.count_miss, 12);
});

test('a metade do mapa vem em campos separados, sem passar por regex', () => {
  // É a diferença para o resto do adaptador: lá o mapa chega como nome de
  // ARQUIVO ("Artista - Título (mapper) [Dif]") e é desmontado por expressão
  // regular, que cola o artista no título. Aqui o get_map_info já entrega os
  // três campos, e o embed sai com o artista no lugar certo.
  const p = banchoPy.normalizeServerScore(SCORE, MAPA);
  assert.equal(p.beatmapset.artist, 'Brian The Sun');
  assert.equal(p.beatmapset.title, 'Lonely Go! (TV Size)');
  assert.doesNotMatch(p.beatmapset.title, /Brian The Sun/, 'o artista vazou para o título');
  assert.equal(p.beatmap.version, 'Jougan');
});

test('estrelas e combo do mapa chegam preenchidos', () => {
  // Sem os dois, o osuClient pediria o mapa à API oficial de novo
  // (precisaEnriquecer) — e mapa exclusivo de servidor privado não existe lá.
  const p = banchoPy.normalizeServerScore(SCORE, MAPA);
  assert.equal(p.beatmap.difficulty_rating, 6.664, '`diff` é a estrela');
  assert.equal(p.beatmap.max_combo, 575);
});

test('mapa que o servidor não conhece não derruba a play', () => {
  const p = banchoPy.normalizeServerScore(SCORE, null);
  assert.equal(p.pp, 147.99, 'os números do score continuam lá');
  assert.equal(p.beatmap.id, null);
  assert.equal(p.beatmap.difficulty_rating, 0, 'zero é o sinal de "não sei"');
});

test('só o adaptador de bancho.py responde melhores scores do servidor', () => {
  // É a presença do método que o supportsTopScores consulta. O osu! oficial não
  // tem endpoint disso (o `top-plays` do site é HTML, não API) e o Ripple exige
  // um mapa — prometer nos três faria o comando falhar em dois.
  assert.equal(typeof banchoPy.topScores, 'function');
  assert.equal(typeof oficial.topScores, 'undefined');
  assert.equal(typeof ripple.topScores, 'undefined');
});
