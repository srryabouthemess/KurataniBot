/**
 * Servidor bancho.py SEM o front-end Shiina-Web (o EZPP Farm é um).
 *
 * O `get_player_scores` existe nos dois serviços, com o mesmo nome e os mesmos
 * parâmetros, e devolve formatos DIFERENTES: a Shiina-Web achata o mapa
 * (`map_id`, `map_set_id`, `map_name`) e chama o id de `score_id`; o bancho.py
 * aninha o mapa em `beatmap` e chama o id de `id`.
 *
 * O `nativeScore` é a tradução de um no outro, e o estrago dele seria mudo: os
 * campos que ele errasse não estouram nada, só chegariam vazios no embed — mapa
 * "???", dificuldade "?", capa quebrada. Daí cada caso aqui olhar um campo.
 */
const test = require('node:test');
const assert = require('node:assert');

const { nativeScore, normalizeRankingEntry } = require('../src/osu/banchoPyApi');

/** Uma play como o `api.<domínio>/v1/get_player_scores` a devolve. */
const SCORE_NATIVO = {
  id: 5959556,
  score: 992678,
  pp: 1933.694,
  acc: 97.272,
  max_combo: 179,
  mods: 88,
  n300: 271, n100: 7, n50: 0, nmiss: 3,
  ngeki: 123, nkatu: 7,
  grade: 'A',
  status: 2,
  mode: 0,
  play_time: '2026-07-07T11:01:00',
  beatmap: {
    md5: '0aea82ae3ea9a64e154b2e24f7ecd62b',
    id: 5318548,
    set_id: 2438601,
    artist: 'SXLLX',
    title: 'MAMA MA',
    version: 'OG VERSION',
    creator: 'hearts',
    max_combo: 477,
    diff: 7.723,
  },
};

test('o mapa sai de dentro do beatmap aninhado', async t => {
  const traduzido = nativeScore(SCORE_NATIVO);

  await t.test('o id do score muda de nome', () => {
    // Sem isto o enrichScores não teria o que buscar e toda play viria sem
    // combo — ele desvia para o caminho "sem detalhe" quando o id falta.
    assert.equal(traduzido.score_id, 5959556);
  });

  await t.test('id do mapa e do conjunto sobem um nível', () => {
    assert.equal(traduzido.map_id, 5318548);
    // O map_set_id é o que monta a URL da capa no embed.
    assert.equal(traduzido.map_set_id, 2438601);
  });

  await t.test('o nome remontado é o que a regex do normalizador espera', () => {
    // Formato de nome de arquivo: é dele que saem título e dificuldade.
    assert.equal(traduzido.map_name, 'SXLLX - MAMA MA (hearts) [OG VERSION]');
  });

  await t.test('o combo vem junto, e não só do detalhe da v2', () => {
    assert.equal(traduzido.max_combo, 179);
  });

  await t.test('acertos passam com o mesmo nome, sem tradução', () => {
    assert.deepEqual(
      { n300: traduzido.n300, n100: traduzido.n100, n50: traduzido.n50, nmiss: traduzido.nmiss },
      { n300: 271, n100: 7, n50: 0, nmiss: 3 },
    );
  });

  await t.test('pp, acurácia, mods e nota seguem crus', () => {
    assert.equal(traduzido.pp, 1933.694);
    assert.equal(traduzido.acc, 97.272);
    // Bitmask — quem traduz para HD,HR,DT é o mods.js, depois.
    assert.equal(traduzido.mods, 88);
    assert.equal(traduzido.grade, 'A');
    assert.equal(traduzido.play_time, '2026-07-07T11:01:00');
  });
});

test('resposta incompleta não vira campo inventado', async t => {
  await t.test('score sem beatmap não estoura', () => {
    const traduzido = nativeScore({ id: 1, pp: 10, acc: 90, grade: 'B' });
    assert.equal(traduzido.map_id, null);
    assert.equal(traduzido.map_set_id, null);
    // Vazio, e não "undefined - undefined [?]": o normalizador trata string
    // vazia como mapa desconhecido, e esse texto viraria o título na tela.
    assert.equal(traduzido.map_name, '');
  });

  await t.test('mapa sem mapper ainda fecha o formato', () => {
    const traduzido = nativeScore({
      id: 2,
      beatmap: { id: 9, set_id: 8, artist: 'A', title: 'T', version: 'V' },
    });
    assert.equal(traduzido.map_name, 'A - T [V]');
  });
});

test('o ranking não mudou de forma', () => {
  // O get_leaderboard sempre foi do bancho.py, e não da Shiina-Web — é o
  // endpoint que já funcionava em servidor com qualquer front-end.
  assert.deepEqual(
    normalizeRankingEntry({ player_id: 17854, name: 'thatonelegendary', country: 'us', pp: 27054, acc: 94.906, plays: 865 }),
    { id: 17854, username: 'thatonelegendary', country: 'US', pp: 27054, accuracy: 94.906, playCount: 865 },
  );
});
