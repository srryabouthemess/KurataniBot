/**
 * De onde saem as dificuldades de um set na hora de nomear.
 *
 * O bot recusava qualquer mapa que o servidor administrado não tivesse no
 * banco — e o servidor é menos exigente que isso: ao receber o publish no canal
 * `rank`, o `Beatmap.from_bid` dele busca na API oficial e cacheia o set
 * inteiro. Mapa novo, que ninguém no servidor jogou ainda, é o caso comum; era
 * exatamente o que a recusa pegava.
 *
 * O que estes casos travam: que o servidor continue tendo prioridade, que a API
 * oficial só entre quando ele não conhece o mapa, e que erro de rede não seja
 * confundido com "não existe" — esse último manda publicar num servidor que não
 * dá para reler depois.
 */
const test = require('node:test');
const assert = require('node:assert');

// O osuClient precisa estar trocado ANTES de o comando ser carregado: ele
// resolve o módulo uma vez, no require do topo.
const clientPath = require.resolve('../src/osuClient');
const osuMock = {};
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true, exports: osuMock,
};

// Só o que o resolveSet usa. `parseBeatmapId` fica com o comportamento real —
// é ele que separa "isto é uma dificuldade" de "isto é outra coisa".
function setupMock({ serverSets = {}, serverMaps = {}, officialSets = {}, officialMaps = {} } = {}) {
  osuMock.parseBeatmapId = raw => {
    const link = String(raw).match(/#osu\/(\d+)/) ?? String(raw).match(/\/b\/(\d+)/);
    if (link) return Number(link[1]);
    return /^\d+$/.test(String(raw).trim()) ? Number(raw) : null;
  };
  osuMock.getServerMapsBySet = async id => serverSets[id] ?? [];
  osuMock.getServerMap = async id => {
    const found = serverMaps[id];
    if (found instanceof Error) throw found;
    if (!found) {
      const err = new Error('Request failed with status code 404');
      err.response = { status: 404 };
      throw err;
    }
    return found;
  };
  osuMock.getOfficialMapsBySet = async id => officialSets[id] ?? [];
  osuMock.getBeatmap = async id => officialMaps[id] ?? null;
}

const { resolveSet } = require('../src/commands/nominate');

const diff = (id, setId) => ({ id, set_id: setId, artist: 'a', title: 't', creator: 'c' });

test('o servidor administrado tem prioridade', async () => {
  setupMock({
    serverSets:   { 99: [diff(1, 99), diff(2, 99)] },
    officialSets: { 99: [diff(1, 99), diff(2, 99), diff(3, 99)] },
  });

  const r = await resolveSet('https://osu.ppy.sh/beatmapsets/99');
  assert.equal(r.setId, 99);
  assert.equal(r.onServer, true);
  // Se tivesse ido na API oficial viriam 3.
  assert.equal(r.diffs.length, 2);
});

test('set que o servidor não conhece vem do osu!', async () => {
  setupMock({ officialSets: { 2158809: [diff(4551343, 2158809)] } });

  const r = await resolveSet('https://osu.ppy.sh/beatmapsets/2158809#osu/4551343');
  assert.equal(r.setId, 2158809);
  assert.equal(r.onServer, false);
  assert.equal(r.diffs[0].id, 4551343);
});

test('ID de dificuldade solto sobe para o set pela API oficial', async () => {
  // O 404 do servidor na dificuldade é resposta, não falha: o fluxo tem que
  // seguir para descobrir o set no osu!.
  setupMock({
    officialMaps: { 4551343: { id: 4551343, beatmapset_id: 2158809 } },
    officialSets: { 2158809: [diff(4551343, 2158809)] },
  });

  const r = await resolveSet('4551343');
  assert.equal(r.setId, 2158809);
  assert.equal(r.onServer, false);
});

test('dificuldade conhecida pelo servidor traz o set inteiro de lá', async () => {
  setupMock({
    serverMaps: { 10: diff(10, 55) },
    serverSets: { 55: [diff(10, 55), diff(11, 55)] },
  });

  const r = await resolveSet('https://daycore.org/b/10');
  assert.equal(r.setId, 55);
  assert.equal(r.onServer, true);
  assert.equal(r.diffs.length, 2);
});

test('servidor conhece a dificuldade mas não devolve o set: fica com a que tem', async () => {
  setupMock({ serverMaps: { 10: diff(10, 55) } });

  const r = await resolveSet('https://daycore.org/b/10');
  assert.equal(r.setId, 55);
  assert.equal(r.diffs.length, 1);
  assert.equal(r.onServer, true);
});

test('número solto que não é dificuldade é tentado como set', async () => {
  setupMock({ serverSets: { 2140158: [diff(1, 2140158)] } });

  const r = await resolveSet('2140158');
  assert.equal(r.setId, 2140158);
  assert.equal(r.onServer, true);
});

test('não existe em lugar nenhum → not_found', async () => {
  setupMock();
  assert.equal((await resolveSet('123456')).error, 'not_found');
});

test('entrada que não é mapa → invalid', async () => {
  setupMock();
  assert.equal((await resolveSet('')).error, 'invalid');
  assert.equal((await resolveSet('nada disso')).error, 'invalid');
});

test('erro de rede no servidor sobe, não vira not_found', async () => {
  // O contrário publicaria num servidor que não conseguimos reler para
  // confirmar o efeito — pior que recusar.
  const boom = new Error('socket hang up');
  boom.response = { status: 502 };
  setupMock({ serverMaps: { 777: boom } });

  await assert.rejects(() => resolveSet('777'), /socket hang up/);
});

test('falha da API oficial recusa em vez de estourar', async () => {
  setupMock();
  osuMock.getOfficialMapsBySet = async () => { throw new Error('osu! fora do ar'); };

  assert.equal((await resolveSet('https://osu.ppy.sh/beatmapsets/999')).error, 'not_found');
});
