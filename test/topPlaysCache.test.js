/**
 * O cache das top plays.
 *
 * Quatro comandos pedem a mesma lista — /topplays, /whatif e /pp buscam as 100,
 * o /profile busca a primeira —, e olhar o próprio perfil costuma ser exatamente
 * essa sequência. Medido antes do cache: 375ms (Bancho) ou 194–262ms (Daycore)
 * por comando, pela lista que o anterior acabou de buscar.
 *
 * O que este arquivo trava é o que separa um cache útil de um cache errado:
 *
 *   - o LIMITE faz parte da chave. Servir a lista do /profile (1 play) para o
 *     /topplays (100) cortaria 99 plays em silêncio, e o /whatif responderia com
 *     uma conta feita sobre uma play só — número plausível, resposta errada;
 *   - falha não é guardada;
 *   - as plays RECENTES continuam sem cache, que é o único caso em que a
 *     resposta certa é sempre a mais nova.
 *
 * O adaptador oficial é trocado por um dublê: aqui o que se conta é quantas
 * buscas SAEM, não o que a API responde.
 */
const test = require('node:test');
const assert = require('node:assert');

// Trocados ANTES de carregar o osuClient, que resolve os módulos no require do
// topo. O `pp` entra dublê só para não arrastar banco e workers para um teste
// que não usa nenhum dos dois.
const stubs = {
  '../src/osu/officialApi': {
    bestScores:   async (userId, limit) => { chamadas.best.push(`${userId}:${limit}`); return listaDe(limit); },
    recentScores: async (userId, limit) => { chamadas.recent.push(`${userId}:${limit}`); return listaDe(limit); },
    userUrl: () => '', mapUrl: () => '',
  },
  '../src/pp': {},
};

const chamadas = { best: [], recent: [] };
const listaDe = (n) => Array.from({ length: n }, (_, i) => ({ pp: 1000 - i }));

for (const [caminho, exports] of Object.entries(stubs)) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

const osu = require('../src/osuClient');

test.beforeEach(() => { chamadas.best.length = 0; chamadas.recent.length = 0; });

test('a mesma lista não é buscada duas vezes', async () => {
  const primeira = await osu.getBestScores(101, 100, 'official');
  const segunda  = await osu.getBestScores(101, 100, 'official');

  assert.equal(chamadas.best.length, 1, 'o segundo comando repetiu a busca');
  assert.equal(primeira.length, 100);
  assert.equal(segunda, primeira, 'deveria ser a mesma lista, não uma cópia empobrecida');
});

test('pedir 100 depois de 1 busca de verdade — o limite está na chave', async () => {
  // O caso que o cache errado esconderia: o /profile pede 1, o /topplays pede
  // 100 logo depois e receberia uma lista de UMA play, sem nada denunciando.
  const doProfile  = await osu.getBestScores(102, 1, 'official');
  const doTopplays = await osu.getBestScores(102, 100, 'official');

  assert.equal(doProfile.length, 1);
  assert.equal(doTopplays.length, 100);
  assert.deepEqual(chamadas.best, ['102:1', '102:100']);
});

test('jogadores diferentes não dividem a entrada', async () => {
  await osu.getBestScores(103, 100, 'official');
  await osu.getBestScores(104, 100, 'official');

  assert.equal(chamadas.best.length, 2);
});

test('falha não vira entrada no cache', async () => {
  const original = stubs['../src/osu/officialApi'].bestScores;
  stubs['../src/osu/officialApi'].bestScores = async () => { throw new Error('500 na API'); };

  await assert.rejects(() => osu.getBestScores(105, 100, 'official'), /500 na API/);

  stubs['../src/osu/officialApi'].bestScores = original;
  const depois = await osu.getBestScores(105, 100, 'official');

  assert.equal(depois.length, 100, 'a falha ficou guardada e a lista nunca mais foi buscada');
});

test('lista vazia é um resultado, e também é guardada', async () => {
  // Conta sem play nenhuma: repetir a busca a cada comando não traria nada.
  const original = stubs['../src/osu/officialApi'].bestScores;
  stubs['../src/osu/officialApi'].bestScores = async (userId, limit) => {
    chamadas.best.push(`${userId}:${limit}`);
    return [];
  };

  await osu.getBestScores(106, 100, 'official');
  await osu.getBestScores(106, 100, 'official');

  stubs['../src/osu/officialApi'].bestScores = original;
  assert.equal(chamadas.best.length, 1);
});

test('as plays recentes continuam SEM cache', async () => {
  // O /rs existe para responder "o que eu acabei de fazer". Um cache aqui
  // responderia "o que você fez antes" — e é o único comando em que isso é
  // pior do que a requisição economizada.
  await osu.getRecentScores(107, 50, 'official');
  await osu.getRecentScores(107, 50, 'official');

  assert.equal(chamadas.recent.length, 2, 'as plays recentes passaram a vir de cache');
});
