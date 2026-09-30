/**
 * Metadados de mapa em lote.
 *
 * O `fetchBeatmap` fazia um `GET /beatmaps/{id}` por mapa, e um /nochoke frio
 * pedia até 100 deles — medido em produção: 876 chamadas e 67s de espera
 * acumulada na fila do rate limiter em meia hora. O `GET /beatmaps?ids[]=`
 * aceita 50 ids, e é o agrupador (lib/batch.js) que transforma os pedidos
 * individuais em lote sem que quem chama perceba.
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const { criarLote } = require('../src/lib/batch');
const officialApi = require('../src/osu/officialApi');
const osu = require('../src/osuClient');

/**
 * Troca o officialGet por uma API falsa que conhece os ids de `conhecidos`,
 * guardando a lista de ids de cada requisição.
 */
async function comApiFalsa(fn, { conhecidos = () => true, falhar = false } = {}) {
  const requisicoes = [];
  const original = officialApi.officialGet;
  const originalErro = console.error;

  officialApi.officialGet = async (path, { params } = {}) => {
    assert.equal(path, '/beatmaps');
    requisicoes.push(params.ids);
    if (falhar) throw Object.assign(new Error('falha 502'), { response: { status: 502 } });
    return {
      beatmaps: params.ids.filter(conhecidos).map(id => ({
        id, max_combo: 1000 + (id % 1000), difficulty_rating: 5.5, version: 'Insane',
        beatmapset_id: id + 1, beatmapset: { title: `t${id}`, artist: 'a', covers: {} },
      })),
    };
  };
  console.error = () => {};

  try {
    await fn();
  } finally {
    officialApi.officialGet = original;
    console.error = originalErro;
  }
  return requisicoes;
}

/** Scores sem combo nem estrelas, como os de servidor privado chegam. */
const scoresCrus = ids => ids.map(id => ({ beatmap: { id }, beatmapset: {} }));

/** `n` ids consecutivos a partir de `base` — cada teste usa a sua faixa. */
const faixa = (base, n) => Array.from({ length: n }, (_, i) => base + i);

test('100 mapas frios geram exatamente 2 requisições', async () => {
  const ids = faixa(71_000_000, 100);
  let enriquecidos;

  const requisicoes = await comApiFalsa(async () => {
    enriquecidos = await osu.enrichBeatmapData(scoresCrus(ids));
  });

  assert.equal(requisicoes.length, 2);
  assert.deepEqual(requisicoes.map(r => r.length), [50, 50]);
  assert.deepEqual(requisicoes.flat().sort((a, b) => a - b), ids);

  // E o resultado de cada um volta para o score certo.
  for (const score of enriquecidos) {
    assert.equal(score.beatmap.max_combo, 1000 + (score.beatmap.id % 1000));
    assert.equal(score.beatmap.difficulty_rating, 5.5);
    assert.equal(score.beatmapset.title, `t${score.beatmap.id}`);
  }
});

test('mapa ausente do lote vira cache negativo', async () => {
  const [existe, sumiu] = faixa(72_000_000, 2);

  const requisicoes = await comApiFalsa(async () => {
    const [a, b] = await Promise.all([osu.getBeatmap(existe), osu.getBeatmap(sumiu)]);
    assert.equal(a.id, existe);
    assert.equal(b, null);

    // De novo: nenhum dos dois vai à API — um pelo cache, outro pelo negativo.
    assert.equal((await osu.getBeatmap(existe)).id, existe);
    assert.equal(await osu.getBeatmap(sumiu), null);
  }, { conhecidos: id => id === existe });

  assert.deepEqual(requisicoes, [[existe, sumiu]]);
});

test('erro na requisição não vira cache negativo', async () => {
  const id = 73_000_000;

  const requisicoes = await comApiFalsa(async () => {
    assert.equal(await osu.getBeatmap(id), null);
    assert.equal(await osu.getBeatmap(id), null);
  }, { falhar: true });

  assert.equal(requisicoes.length, 2, 'o 502 não deveria ter sido guardado');

  // E passada a falha, o mapa vem.
  const depois = await comApiFalsa(async () => {
    assert.equal((await osu.getBeatmap(id)).id, id);
  });
  assert.deepEqual(depois, [[id]]);
});

test('mapa já em cache não entra no lote', async () => {
  const [quente, ...frios] = faixa(74_000_000, 4);

  await comApiFalsa(() => osu.getBeatmap(quente));
  const requisicoes = await comApiFalsa(() => osu.enrichBeatmapData(scoresCrus([quente, ...frios])));

  assert.deepEqual(requisicoes, [frios]);
});

test('pedidos simultâneos do mesmo mapa saem uma vez só', async () => {
  const id = 75_000_000;

  const requisicoes = await comApiFalsa(async () => {
    const respostas = await Promise.all([
      osu.getBeatmap(id),
      osu.getBeatmap(id),
      osu.getBeatmap(String(id)),
      osu.enrichBeatmapData(scoresCrus([id, id])),
    ]);
    assert.equal(respostas[0].id, id);
    assert.equal(respostas[1], respostas[0]);
  });

  assert.deepEqual(requisicoes, [[id]]);
});

test('mapa custom do Daycore não vai para a API oficial', async () => {
  // A faixa de 100_000_000 para cima é do custom-maps: o osu! oficial não tem
  // esses ids, e pedi-los só gastaria uma vaga do lote para ouvir "não existe".
  const custom = 100_000_007;
  const oficial = 76_000_000;

  const requisicoes = await comApiFalsa(async () => {
    assert.equal(await osu.getBeatmap(custom), null);
    await osu.enrichBeatmapData(scoresCrus([custom, oficial]));
  });

  assert.deepEqual(requisicoes, [[oficial]]);
});

test('o array de ids sai como ids[]=1&ids[]=2 na URL', async () => {
  // É a forma que o PHP do osu-web lê como lista. Um `ids=1,2` ou um
  // `ids[0]=1` faria a API responder com lista vazia — e tudo viraria cache
  // negativo sem erro nenhum aparecer.
  const originalGet  = axios.get;
  const originalPost = axios.post;
  let url = null;

  axios.post = async () => ({ data: { access_token: 'x', expires_in: 3600 } });
  axios.get = async (endereco, config) => {
    url = axios.getUri({ url: endereco, params: config.params });
    return { data: { beatmaps: [] } };
  };

  try {
    await officialApi.officialGet('/beatmaps', { params: { ids: [77_000_001, 77_000_002] } });
  } finally {
    axios.get  = originalGet;
    axios.post = originalPost;
  }

  assert.equal(url, 'https://osu.ppy.sh/api/v2/beatmaps?ids%5B%5D=77000001&ids%5B%5D=77000002');
  assert.equal(decodeURIComponent(new URL(url).search), '?ids[]=77000001&ids[]=77000002');
});

// ─── O agrupador em si ────────────────────────────────────────────────────────

test('o agrupador fatia pelo teto e resolve cada chave com o seu valor', async () => {
  const fatias = [];
  const carregar = criarLote({
    max: 3,
    buscar: async chaves => {
      fatias.push(chaves);
      return new Map(chaves.filter(c => c !== 5).map(c => [c, c * 10]));
    },
  });

  const valores = await Promise.all([1, 2, 3, 4, 5, 2].map(carregar));

  assert.deepEqual(fatias, [[1, 2, 3], [4, 5]]);
  assert.deepEqual(valores, [10, 20, 30, 40, null, 20]);
});

test('erro numa fatia rejeita só os pedidos dela', async () => {
  const carregar = criarLote({
    max: 2,
    buscar: async chaves => {
      if (chaves.includes(3)) throw new Error('fatia ruim');
      return new Map(chaves.map(c => [c, c]));
    },
  });

  const resultados = await Promise.allSettled([1, 2, 3, 4, 5].map(carregar));

  assert.deepEqual(resultados.map(r => r.status),
    ['fulfilled', 'fulfilled', 'rejected', 'rejected', 'fulfilled']);
  assert.equal(resultados[2].reason.message, 'fatia ruim');
  assert.equal(resultados[4].value, 5);
});

test('pedidos em janelas diferentes saem em requisições diferentes', async () => {
  const fatias = [];
  const carregar = criarLote({
    max: 50,
    janelaMs: 1,
    buscar: async chaves => {
      fatias.push(chaves);
      return new Map();
    },
  });

  await carregar(1);
  await carregar(2);

  assert.deepEqual(fatias, [[1], [2]]);
});
