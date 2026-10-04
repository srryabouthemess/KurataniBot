/**
 * Mapa frio: metadados e `.osu` ao mesmo tempo.
 *
 * A página de um mapa nunca visto esperava o `/beatmaps` voltar e só então o
 * cálculo de pp pedia o `.osu` — duas idas e voltas em fila, quando uma não
 * depende da outra. O Bathbot dispara as duas juntas (`try_join!` em
 * manager/osu_map.rs). Com `aquecerArquivos`, o `enrichBeatmapData` faz o
 * mesmo: o download sai junto do lote, e o `dedupe` do beatmapFile.js entrega
 * à thread de cálculo o mesmo download em voo.
 *
 * A opção é de quem renderiza UMA página. O /nochoke e o /topif enriquecem as
 * 100 plays de uma vez, e aquecer ali pediria 100 arquivos ao balde de 4/s —
 * inclusive de play FC, que nem chega a calcular.
 */
const test = require('node:test');
const assert = require('node:assert');

const officialApi = require('../src/osu/officialApi');
const pp = require('../src/pp');
const osu = require('../src/osuClient');

/** Falha o teste em vez de pendurar o runner quando as chamadas serializam. */
const comPrazo = (promessa, aviso, ms = 1000) => Promise.race([
  promessa,
  new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error(aviso)), ms).unref?.()),
]);

/** API falsa que só responde depois de `liberada`, e `.osu` falso que registra. */
function dublês(t, { arquivo = async () => new Uint8Array() } = {}) {
  const arquivos = [];
  let liberar;
  const liberada = new Promise(resolve => { liberar = resolve; });

  const originalGet = officialApi.officialGet;
  const originalArquivo = pp.getBeatmapFile;
  officialApi.officialGet = async (_path, { params }) => {
    await liberada;
    return {
      beatmaps: params.ids.map(id => ({
        id, max_combo: 1234, difficulty_rating: 6.1, version: 'Insane',
        beatmapset_id: id + 1, beatmapset: { title: 't', artist: 'a', covers: {} },
      })),
    };
  };
  pp.getBeatmapFile = async (id) => { arquivos.push(id); return arquivo(id); };

  t.after(() => {
    officialApi.officialGet = originalGet;
    pp.getBeatmapFile = originalArquivo;
  });

  return { arquivos, liberar };
}

const scoresCrus = ids => ids.map(id => ({ beatmap: { id }, beatmapset: {} }));

test('com aquecerArquivos, o .osu do mapa frio sai antes de o /beatmaps voltar', async t => {
  const ids = [73_000_001, 73_000_002];
  const { arquivos, liberar } = dublês(t, {
    // O /beatmaps só responde quando os dois downloads já começaram: em fila,
    // isso seria um impasse, e o prazo transforma o impasse em falha legível.
    arquivo: async () => { if (arquivos.length === ids.length) liberar(); return new Uint8Array(); },
  });

  const enriquecidos = await comPrazo(
    osu.enrichBeatmapData(scoresCrus(ids), { aquecerArquivos: true }),
    'o .osu esperou os metadados, em vez de sair junto',
  );

  assert.deepEqual(arquivos.sort(), ids);
  assert.equal(enriquecidos[0].beatmap.max_combo, 1234);
});

test('sem a opção, nenhum .osu é pedido (é o enriquecimento em massa)', async t => {
  const { arquivos, liberar } = dublês(t);
  liberar();

  await osu.enrichBeatmapData(scoresCrus([73_000_101, 73_000_102]));

  assert.deepEqual(arquivos, []);
});

test('mapa com metadado guardado não é aquecido: não há ida e volta para sobrepor', async t => {
  const id = 73_000_201;
  const { arquivos, liberar } = dublês(t);
  liberar();

  await osu.enrichBeatmapData(scoresCrus([id]));   // aquece o cache de metadados
  await osu.enrichBeatmapData(scoresCrus([id]), { aquecerArquivos: true });

  assert.deepEqual(arquivos, []);
});

test('mapa custom do Daycore não é aquecido: o osu! oficial não o tem', async t => {
  const { arquivos, liberar } = dublês(t);
  liberar();

  await osu.enrichBeatmapData(scoresCrus([100_000_042]), { aquecerArquivos: true });

  assert.deepEqual(arquivos, []);
});

test('falha no aquecimento não derruba o enriquecimento nem escapa como rejeição solta', async t => {
  const soltas = [];
  const pegar = (motivo) => soltas.push(motivo);
  process.on('unhandledRejection', pegar);
  t.after(() => process.off('unhandledRejection', pegar));

  const { liberar } = dublês(t, { arquivo: async () => { throw new Error('503 no .osu'); } });
  liberar();

  const [score] = await osu.enrichBeatmapData(scoresCrus([73_000_301]), { aquecerArquivos: true });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(score.beatmap.max_combo, 1234);
  assert.deepEqual(soltas, []);
});

test('as páginas do /recent e do /topplays aquecem; o enriquecimento em massa não', () => {
  const { commandSource } = require('./helpers');
  const comAquecimento = /enrichBeatmapData\([^;]*aquecerArquivos: true/g;

  // Página exibida e prefetch da próxima, nos dois.
  for (const comando of ['osu/recent', 'osu/topplays']) {
    const chamadas = commandSource(comando).match(/enrichBeatmapData\(/g) ?? [];
    const aquecidas = commandSource(comando).match(comAquecimento) ?? [];
    assert.equal(aquecidas.length, chamadas.length, `${comando}: toda página deveria aquecer`);
    assert.ok(chamadas.length >= 2, `${comando}: esperava a página e o prefetch`);
  }

  for (const comando of ['osu/nochoke', 'osu/topif']) {
    assert.doesNotMatch(commandSource(comando), comAquecimento, `${comando} aqueceria as 100 plays`);
  }
});
