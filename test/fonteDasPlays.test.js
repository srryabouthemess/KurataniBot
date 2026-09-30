/**
 * De onde saem as plays de um servidor bancho.py, e quando o detalhe de score
 * deixa de ser buscado.
 *
 * ── O que mudou ───────────────────────────────────────────────────────────────
 * As top e as recentes do Daycore vinham do `get_player_scores` da Shiina-Web,
 * que manda pp e acc truncados em inteiro e nenhum acerto nem combo. Para
 * completar, o `enrichScores` buscava o `/v2/scores/{id}` de CADA play: ~100
 * requisições num /nc frio, na mesma fila de 10/s do servidor.
 *
 * A v1 do bancho.py tem o mesmo endpoint e traz tudo o que o detalhe traria
 * (conferido no Daycore em 30/09, VN e RX; ver
 * docs/investigacoes/2026-09-30-daycore-scores-v1.md). Agora ela é a fonte em
 * todo bancho.py, com Shiina-Web ou sem, e o detalhe só sai quando falta algo.
 *
 * ── Por que o teste dubla o axios ─────────────────────────────────────────────
 * O que precisa continuar valendo é qual ENDEREÇO é procurado e quantas
 * requisições SAEM. Um dublê do adaptador concordaria com o teste por
 * construção; o do transporte deixa a decisão onde ela mora.
 *
 * O registro é o da suíte (test/setup.js): `daycore` com o `webApi` padrão da
 * Shiina-Web — exatamente o caso em que a fonte antiga ainda seria escolhida.
 */
const test = require('node:test');
const assert = require('node:assert');

// ─── O formato real da v1 ─────────────────────────────────────────────────────

/**
 * Uma linha do `api.<domínio>/v1/get_player_scores` do bancho.py-ex, no formato
 * do handler de lá (app/api/v1/api.py). Duas marcas do formato real:
 *
 *   - o md5 do mapa só vem ANINHADO (ver scorewipe.test.js);
 *   - o `beatmap.max_combo` é o combo da PLAY, não o do mapa — bug do handler,
 *     que monta o dicionário com `row.get("max_combo")` em vez do
 *     `map_max_combo` que o próprio SELECT pediu. Conferido no Daycore.
 */
const linhaV1 = (id, extra = {}) => ({
  id,
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
  time_elapsed: 51234,
  perfect: 0,
  beatmap: {
    md5: '0aea82ae3ea9a64e154b2e24f7ecd62b',
    id: 5318548,
    set_id: 2438601,
    artist: 'SXLLX',
    title: 'MAMA MA',
    version: 'OG VERSION',
    creator: 'hearts',
    status: 2,
    diff: 7.723,
    total_length: 97,
    // O bug: igual ao `max_combo` da play acima, e não os 477 do mapa.
    max_combo: 179,
  },
  ...extra,
});

// ─── O transporte, trocado por um que só anota ────────────────────────────────

const chamadas = [];
let listaV1 = [];

/** O detalhe, como a v2 devolve — com números diferentes da v1, para denunciar quem ganhou. */
const DETALHE = { pp: 1, acc: 50, max_combo: 1, grade: 'D', mods: 0, n300: 1, n100: 1, n50: 1, nmiss: 1 };

function responder(url) {
  if (url.endsWith('/v1/get_player_scores') && !url.includes('/api/v1/')) {
    return { status: 200, data: { status: 'success', scores: listaV1, player: { id: 42, name: 'pudim2', clan: null } } };
  }
  if (url.includes('/v2/scores/')) return { status: 200, data: { status: 'success', data: DETALHE } };
  // O mapa responde vazio: o assunto aqui é o detalhe, não a mescla do mapa.
  if (url.includes('/v2/maps/')) return { status: 200, data: { status: 'success', data: null } };
  // A Shiina-Web (`<site>/api/v1/...`) e qualquer outra coisa.
  return { status: 200, data: { status: 'success', scores: [] } };
}

const axiosPath = require.resolve('axios');
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: {
    get: async (url, config = {}) => {
      chamadas.push({ url, params: config.params ?? {} });
      return responder(url);
    },
  },
};

const banchoPy = require('../src/osu/banchoPyApi');
const servers = require('../src/servers');

const listas    = () => chamadas.filter(c => c.url.endsWith('/get_player_scores'));
const detalhes  = () => chamadas.filter(c => c.url.includes('/v2/scores/'));

// O cache do detalhe é do módulo e sobrevive entre os casos. Cada caso usa uma
// faixa de id de score só dele, para não começar com o cache de outro.
test.beforeEach(() => {
  chamadas.length = 0;
  listaV1 = [linhaV1(5959556)];
});

// ─── A fonte ──────────────────────────────────────────────────────────────────

test('o servidor da suíte tem Shiina-Web configurada', () => {
  // Sem isto os casos abaixo não afirmariam nada: seria o caminho que já lia a v1.
  assert.ok(servers.get('daycore').webApi, 'o daycore da suíte precisa ter webApi');
  assert.equal(servers.get('ezpp').webApi, null);
});

test('as plays saem da v1 do bancho.py mesmo com Shiina-Web', async t => {
  await t.test('top', async () => {
    await banchoPy.bestScores(42, 100, 'daycore');

    assert.deepEqual(listas().map(c => c.url), ['https://api.daycore.org/v1/get_player_scores']);
    assert.equal(listas()[0].params.scope, 'best');
    assert.equal(listas()[0].params.id, 42);
  });

  await t.test('recentes', async () => {
    await banchoPy.recentScores(42, 50, 'daycore');

    assert.deepEqual(listas().map(c => c.url), ['https://api.daycore.org/v1/get_player_scores']);
    assert.equal(listas()[0].params.scope, 'recent');
  });

  await t.test('nada vai para o front-end', async () => {
    await banchoPy.bestScores(42, 100, 'daycore');
    await banchoPy.recentScores(42, 50, 'daycore_rx');

    const noFront = chamadas.filter(c => c.url.startsWith('https://daycore.org/'));
    assert.deepEqual(noFront, [], 'alguma chamada ainda foi para a Shiina-Web');
  });

  await t.test('e sem Shiina-Web continua igual', async () => {
    await banchoPy.bestScores(42, 100, 'ezpp');
    assert.deepEqual(listas().map(c => c.url), ['https://api.ez-pp.farm/v1/get_player_scores']);
  });
});

test('o Relax continua separado pelo mode 4', async () => {
  await banchoPy.bestScores(42, 100, 'daycore');
  await banchoPy.bestScores(42, 100, 'daycore_rx');
  await banchoPy.recentScores(42, 50, 'daycore_rx');

  assert.deepEqual(listas().map(c => c.params.mode), [0, 4, 4]);
});

test('o limit é clampado em 100', async t => {
  // Acima de 100 a v1 responde 422, e o banchoV1Get lê isso como "sem
  // resultado": a lista sairia vazia, sem erro nenhum.
  await t.test('acima do teto, pede o teto', async () => {
    await banchoPy.bestScores(42, 150, 'daycore');
    assert.equal(listas()[0].params.limit, 100);
  });

  await t.test('abaixo, pede o que foi pedido', async () => {
    await banchoPy.recentScores(42, 50, 'daycore');
    await banchoPy.bestScores(42, 100, 'daycore');
    assert.deepEqual(listas().map(c => c.params.limit), [50, 100]);
  });
});

test('a lista sai no formato que o resto do bot lê', async () => {
  const [play] = await banchoPy.bestScores(42, 100, 'daycore');

  assert.equal(play.score_id, 5959556);
  // Sem truncar: era isso que a Shiina-Web perdia.
  assert.equal(play.pp, 1933.694);
  assert.equal(play.acc, 97.272);
  assert.deepEqual(
    [play.n300, play.n100, play.n50, play.nmiss, play.max_combo],
    [271, 7, 0, 3, 179],
  );
});

// ─── O detalhe ────────────────────────────────────────────────────────────────

test('com os acertos e o combo na lista, o detalhe não é buscado', async () => {
  listaV1 = [linhaV1(7001), linhaV1(7002, { mods: 88 | 128, mode: 4 })];
  const cruas = await banchoPy.bestScores(42, 100, 'daycore');
  chamadas.length = 0;

  const [vn, rx] = await banchoPy.enrichScores(cruas, 'daycore');

  assert.equal(detalhes().length, 0, 'saiu requisição de detalhe para score que já tinha tudo');

  // E os números são os da v1, e não os do detalhe (que o dublê faria diferentes).
  assert.equal(vn.pp, 1933.694);
  assert.equal(vn.accuracy, 0.97272);
  assert.equal(vn.rank, 'A');
  assert.equal(vn.max_combo, 179);
  assert.equal(vn.score, 992678);
  assert.deepEqual(vn.statistics, { count_300: 271, count_100: 7, count_50: 0, count_miss: 3 });
  assert.deepEqual(vn.mods, ['HD', 'HR', 'DT']);
  // O RX é o bit 128 na mesma bitmask, e sai decodificado junto dos outros.
  assert.ok(rx.mods.includes('RX'), rx.mods.join(','));
});

test('o combo do MAPA não sai do beatmap aninhado da v1', async () => {
  // O `beatmap.max_combo` da v1 é o combo da play (bug do bancho.py-ex). Se ele
  // passasse, toda play pareceria FC para o /nc e o combo sairia "179/179x".
  // O `/v2/maps/{id}` responde vazio aqui, então o campo fica sem valor.
  listaV1 = [linhaV1(7101)];
  const [crua] = await banchoPy.bestScores(42, 100, 'daycore');
  const [play] = await banchoPy.enrichScores([crua], 'daycore');

  assert.equal(play.beatmap.max_combo, null);
  assert.equal(play.beatmap.id, 5318548);
  assert.equal(play.beatmap.version, 'OG VERSION');
});

test('faltando qualquer um dos cinco, o detalhe é buscado como antes', async t => {
  const casos = [
    ['n300', undefined],
    ['n100', null],
    ['n50', undefined],
    ['nmiss', null],
    ['max_combo', null],
    // Número em texto não conta: o normalizador leria, mas "tem o dado" quer
    // dizer que ele veio no formato que a v1 manda.
    ['nmiss', '3'],
  ];

  for (const [i, [campo, valor]] of casos.entries()) {
    await t.test(`${campo} = ${JSON.stringify(valor)}`, async () => {
      chamadas.length = 0;
      const crua = { ...banchoPy.nativeScore(linhaV1(7200 + i)), [campo]: valor };

      const [play] = await banchoPy.enrichScores([crua], 'daycore');

      assert.equal(detalhes().length, 1);
      assert.ok(detalhes()[0].url.endsWith(`/v2/scores/${7200 + i}`));
      // A mescla continua preferindo o detalhe, como sempre.
      assert.equal(play.pp, DETALHE.pp);
    });
  }
});

test('uma fonte sem acertos (o formato da Shiina-Web) ainda busca o detalhe', async () => {
  const shiina = {
    score_id: 7301, user_id: 42, map_md5: '0aea82ae3ea9a64e154b2e24f7ecd62b',
    map_id: 5318548, map_set_id: 2438601, map_name: 'SXLLX - MAMA MA (hearts) [OG VERSION].osu',
    weight: 100, weight_pp: 1933, max_score: 992678,
    pp: 1933, acc: 97, mods: ['HD', 'HR', 'DT'], grade: 'A', play_time: '2026-07-07 11:01:00',
  };

  await banchoPy.enrichScores([shiina], 'daycore');
  assert.equal(detalhes().length, 1);
});

// ─── O refresh do /rs ─────────────────────────────────────────────────────────

test('o refresh do /rs continua achando a mesma play pelo score_id', async () => {
  // O recent.js casa a play da página com a da lista nova por
  // `score?.score_id ?? score?.id` (o `scoreIdOf` de lá). O que isto trava é o
  // lado do adaptador: o id do score chega em `score_id`, e nenhum OUTRO `id`
  // (o do mapa, por exemplo) fica solto no topo para o `?? id` pegar errado.
  const scoreIdOf = (score) => score?.score_id ?? score?.id ?? null;

  listaV1 = [linhaV1(7402), linhaV1(7401)];
  const antes = await banchoPy.recentScores(42, 50, 'daycore');
  const exibida = antes[1];

  assert.equal(exibida.id, undefined, 'um `id` no topo desviaria o casamento');
  assert.equal(scoreIdOf(exibida), 7401);

  // Entrou uma play nova no topo, e a exibida mudou de posição e de pp (um
  // recálculo, que é o motivo de existir o refresh).
  listaV1 = [linhaV1(7403), linhaV1(7402), linhaV1(7401, { pp: 2000.5 })];
  const depois = await banchoPy.recentScores(42, 50, 'daycore');
  const match = depois.find(s => scoreIdOf(s) === scoreIdOf(exibida));

  assert.ok(match, 'a play não foi achada na lista nova');
  assert.equal(match.pp, 2000.5);
  assert.equal(depois.indexOf(match), 2);
});
