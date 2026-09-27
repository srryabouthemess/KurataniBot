/**
 * Cada servidor calcula no motor que ele próprio roda (ver src/pp/engines.js).
 *
 *   Bancho    → rosu-pp-bancho (fork no lazer master)
 *   Daycore   → rosu-pp-daycore no vanilla, akatsuki-pp-daycore no Relax
 *   Akatsuki  → akatsuki-pp-akatsuki nos dois
 *   o resto   → o perfil do Daycore
 *
 * O teste olha o MOTOR que foi chamado, e não o número, pelo mesmo motivo do
 * estrelaRelax.test.js: cravar números faria dele uma cópia do rework da vez. O
 * que tem de continuar valendo é a decisão.
 *
 * O "resto" é o EZPP, embutido como o Akatsuki: assim nada aqui depende de o
 * Daycore estar no `.env` de quem roda a suíte.
 */
const test = require('node:test');
const assert = require('node:assert');

const chamadasRosu = [];
const chamadasAkatsuki = [];
const wasmPath = require.resolve('../src/pp/wasmWorker');
require.cache[wasmPath] = {
  id: wasmPath, filename: wasmPath, loaded: true,
  exports: {
    calcular: async ({ pacote, tipo }, op, mapId, args) => {
      if (tipo === 'akatsuki') {
        chamadasAkatsuki.push({ pacote, op, mapId, args, mods: args.mods });
        return { pp: 200, stars: 6.66, maxCombo: 500 };
      }
      chamadasRosu.push({ pacote, op, mapId, args });
      return { pp: 100, stars: 5.55, maxCombo: 500 };
    },
    close: () => {},
    stats: () => ({}),
  },
};


const filePath = require.resolve('../src/pp/beatmapFile');
require.cache[filePath] = {
  id: filePath, filename: filePath, loaded: true,
  exports: { getBeatmapFile: async () => new Uint8Array([0]) },
};

const pp = require('../src/pp');
const engines = require('../src/pp/engines');
const { modsToBits } = require('../src/mods');

let proximoMapa = 710000;
const novoMapa = () => proximoMapa++;

test.beforeEach(() => {
  chamadasRosu.length = 0;
  chamadasAkatsuki.length = 0;
});

test('o mapa servidor → motor', () => {
  const motor = (mode) => engines.motorDe(mode).id;

  assert.equal(motor('official'),    'bancho');
  assert.equal(motor('akatsuki'),    'akatsuki');
  assert.equal(motor('akatsuki_rx'), 'akatsuki');
  // Sem rework próprio: o perfil do Daycore.
  assert.deepEqual(engines.PERFIS[engines.PERFIL_PADRAO], engines.PERFIS.daycore);
  assert.equal(motor('ezpp'),    'daycore');
  assert.equal(motor('ezpp_rx'), 'daycore_rx');
  // O rework do Gatari não é público: cai no padrão, como o EZPP.
  assert.equal(motor('gatari'),    'daycore');
  assert.equal(motor('gatari_rx'), 'daycore_rx');
});

test('a chave de cache leva a versão do build', () => {
  const { bancho, daycore, akatsuki, daycore_rx: daycoreRx } = engines.MOTORES;
  assert.match(bancho.cache,    /^bancho@\d/);
  assert.match(daycore.cache,   /^daycore@\d/);
  assert.match(akatsuki.cache,  /^akatsuki@\d/);
  assert.match(daycoreRx.cache, /^daycore_rx@\d/);
  // Os builds podem estar no mesmo commit; a chave os separa mesmo assim.
  assert.notEqual(bancho.cache, daycore.cache);
  assert.notEqual(akatsuki.cache, daycoreRx.cache);
});

test('o FC de cada servidor vai para o build dele', async () => {
  const play = (id) => ({
    beatmap: { id, max_combo: 500 },
    mods: ['HD'],
    max_combo: 200,
    statistics: { count_300: 400, count_100: 10, count_50: 0, count_miss: 2 },
  });

  await pp.getFCpp(play(novoMapa()), 'official');
  await pp.getFCpp(play(novoMapa()), 'ezpp');

  assert.deepEqual(chamadasRosu.map(c => c.pacote), ['rosu-pp-bancho', 'rosu-pp-daycore']);
  assert.equal(chamadasAkatsuki.length, 0);
});

test('o vanilla do Akatsuki é akatsuki-pp, sem o bit do RX', async () => {
  const estrelas = await pp.getAdjustedStars(novoMapa(), ['HD', 'DT'], 'akatsuki');

  assert.equal(estrelas, '6.66');
  assert.equal(chamadasRosu.length, 0, 'o rosu-pp respondeu pelo vanilla do Akatsuki');
  assert.equal(chamadasAkatsuki.length, 1);

  const bitDoRX = modsToBits(['RX']);
  assert.equal(chamadasAkatsuki[0].mods & bitDoRX, 0, 'o vanilla foi calculado como Relax');
});

test('fora do Bancho a estrela sem mod é calculada, e não lida da API', async () => {
  // A estrela que a API publica é a do rework do Bancho; a de outro build ou do
  // akatsuki-pp só coincide com ela por acaso.
  assert.equal(await pp.getAdjustedStars(novoMapa(), ['CL'], 'official'), null);
  assert.equal(await pp.getAdjustedStars(novoMapa(), ['CL'], 'ezpp'), '5.55');
  assert.equal(await pp.getAdjustedStars(novoMapa(), ['CL'], 'akatsuki'), '6.66');
});

test('o score total só chega ao motor que o usa', async () => {
  // O bancho.py do Daycore não passa o score para o rosu-pp: num choke, só a
  // estimativa por combo opera lá, e o bot tem de fazer igual.
  const hits = { n100: 5, misses: 3, combo: 100, legacyTotalScore: 1_000_000 };

  await pp.simulatePP(novoMapa(), ['CL'], hits, 'official');
  await pp.simulatePP(novoMapa(), ['CL'], hits, 'ezpp');

  const [bancho, daycore] = chamadasRosu;
  assert.equal(bancho.args.legacyTotalScore, 1_000_000);
  assert.equal(daycore.args.legacyTotalScore, null);
});

test('mesmo mapa e mods em builds diferentes não dividem o cache', async () => {
  const mapa = novoMapa();
  const mods = ['HD', 'DT', 'CL'];

  await pp.getAdjustedStars(mapa, mods, 'official');
  await pp.getAdjustedStars(mapa, mods, 'ezpp');

  assert.deepEqual(chamadasRosu.map(c => c.pacote), ['rosu-pp-bancho', 'rosu-pp-daycore']);
});

test('o Relax de cada servidor vai para o akatsuki-pp dele, com a entrada dele', async () => {
  // O score-service do Akatsuki pede o PP com accuracy + misses; o bancho.py do
  // Daycore, com os hits. O motor é o mesmo e o número muda (ver
  // akatsukiWorkerThread.js).
  const play = (id) => ({
    beatmap: { id, max_combo: 500 },
    mods: ['HD', 'RX'],
    max_combo: 200,
    statistics: { count_300: 400, count_100: 10, count_50: 0, count_miss: 2 },
  });

  await pp.getFCpp(play(novoMapa()), 'akatsuki_rx');
  await pp.getFCpp(play(novoMapa()), 'ezpp_rx');

  assert.deepEqual(chamadasAkatsuki.map(c => c.pacote), ['akatsuki-pp-akatsuki', 'akatsuki-pp-daycore']);
  assert.deepEqual(chamadasAkatsuki.map(c => c.args.viaAcc), [true, false]);
  assert.equal(chamadasRosu.length, 0);
});

test('o NC chega ao akatsuki-pp com o DT junto', async () => {
  // O akatsuki-pp lê a velocidade só do bit do DT. O stable manda os dois; um
  // NC sozinho sairia na velocidade normal.
  await pp.getFCpp({
    beatmap: { id: novoMapa(), max_combo: 500 },
    mods: ['NC', 'RX'],
    max_combo: 200,
    statistics: { count_300: 400, count_100: 10, count_50: 0, count_miss: 2 },
  }, 'akatsuki_rx');

  assert.equal(chamadasAkatsuki[0].mods, modsToBits(['DT', 'NC', 'RX']));
});
