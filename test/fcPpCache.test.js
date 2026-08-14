/**
 * Cache do PP de FC.
 *
 * O cálculo é caro e determinístico: medido nos 12 maiores .osu do cache,
 * 1,54ms de parse + 4,28ms de dificuldade + 0,34ms de performance por play, num
 * motor Wasm que roda no event loop — ~30ms por página de /topplays, refeitos a
 * cada renderização de um número que nunca muda.
 *
 * O que este arquivo protege é a CHAVE, não a economia. Uma chave frouxa demais
 * serve o número de um mapa no lugar do de outro, e nada na tela denuncia: sai
 * um pp plausível. Uma chave rígida demais só desperdiça trabalho.
 *
 * Roda contra bancos descartáveis (KURATANI_DATA_DIR), definidos ANTES de
 * qualquer require de src/ — o paths.js lê a variável no carregamento. Sem
 * isso, exercitar a evicção significaria apagar o cache real de quem roda os
 * testes.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kuratani-fcpp-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;

// Teto baixo para a evicção caber num teste. Lido no carregamento do db.js,
// então também precisa vir antes do require.
const CAP = 50;
process.env.FC_PP_CACHE_MAX = String(CAP);

const db = require('../src/db');
const pp = require('../src/pp');

test.after(() => {
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

// ─── A chave ──────────────────────────────────────────────────────────────────

const base = {
  beatmapId: 123456,
  modsBits: 64,          // DT
  useLazer: true,
  relax: false,
  n300: 900, n100: 50, n50: 10, misses: 0,
};

test('os misses entram na chave como 300, que é o que o FC seria', () => {
  // Os dois motores somam os misses ao n300 antes de calcular (perfParams.n300
  // no rosu, calc_kwargs["n300"] no pp_calc.py). Então um score com 3 misses e
  // outro com nenhum, mas com o mesmo total de objetos acertados, têm
  // literalmente o mesmo FC pela frente — e devem dividir a entrada.
  const comMiss  = pp.fcCacheKey({ ...base, n300: 897, misses: 3 });
  const semMiss  = pp.fcCacheKey({ ...base, n300: 900, misses: 0 });

  assert.deepEqual(comMiss, semMiss);
  assert.equal(comMiss.n300, 900);
});

test('mapa, mods e motor separam entradas', () => {
  const referencia = pp.fcCacheKey(base);

  const outroMapa  = pp.fcCacheKey({ ...base, beatmapId: 999999 });
  const outrosMods = pp.fcCacheKey({ ...base, modsBits: 16 });   // HR
  const stable     = pp.fcCacheKey({ ...base, useLazer: false });
  const akatsuki   = pp.fcCacheKey({ ...base, relax: true });

  assert.equal(referencia.engine, 'rosu-lazer');
  assert.equal(stable.engine,     'rosu-stable');
  assert.equal(akatsuki.engine,   'akatsuki');

  // O Relax ignora a mecânica: quem calcula é outro motor inteiro.
  assert.equal(pp.fcCacheKey({ ...base, relax: true, useLazer: false }).engine, 'akatsuki');

  const chaves = [referencia, outroMapa, outrosMods, stable, akatsuki]
    .map(k => JSON.stringify(k));
  assert.equal(new Set(chaves).size, chaves.length, 'duas chaves distintas colidiram');
});

test('sem os três hits não há chave', () => {
  // É o ramo em que o cálculo cai na accuracy bruta — um float, que não serve
  // de chave. Acontece quando o servidor não informou os acertos.
  assert.equal(pp.fcCacheKey({ ...base, n300: null }), null);
  assert.equal(pp.fcCacheKey({ ...base, n100: null }), null);
  assert.equal(pp.fcCacheKey({ ...base, n50:  null }), null);
});

// ─── A tabela ─────────────────────────────────────────────────────────────────

test('grava e lê o mesmo número', () => {
  const chave = pp.fcCacheKey(base);

  assert.equal(db.getCachedFCpp(chave), null, 'não deveria existir antes de gravar');

  db.setCachedFCpp(chave, 432.1875);
  assert.equal(db.getCachedFCpp(chave), 432.1875);

  // Recalcular e regravar atualiza em vez de duplicar.
  db.setCachedFCpp(chave, 433.5);
  assert.equal(db.getCachedFCpp(chave), 433.5);
});

test('a separação da chave vale também na tabela', () => {
  // O teste de chave acima compara objetos; este confere que a PRIMARY KEY
  // cobre as mesmas dimensões — um índice mais estreito colidiria em silêncio.
  const lazer    = pp.fcCacheKey({ ...base, beatmapId: 222222 });
  const stable   = pp.fcCacheKey({ ...base, beatmapId: 222222, useLazer: false });
  const akatsuki = pp.fcCacheKey({ ...base, beatmapId: 222222, relax: true });
  const outroHit = pp.fcCacheKey({ ...base, beatmapId: 222222, n100: 51 });

  db.setCachedFCpp(lazer,    100);
  db.setCachedFCpp(stable,   200);
  db.setCachedFCpp(akatsuki, 300);
  db.setCachedFCpp(outroHit, 400);

  assert.equal(db.getCachedFCpp(lazer),    100);
  assert.equal(db.getCachedFCpp(stable),   200);
  assert.equal(db.getCachedFCpp(akatsuki), 300);
  assert.equal(db.getCachedFCpp(outroHit), 400);
});

// ─── O teto ───────────────────────────────────────────────────────────────────

test('o teto segura, descartando as entradas mais antigas', () => {
  // Esta tabela cresce por SCORE, e não por mapa como as outras duas de cache:
  // a chave inclui os hits, então o mesmo mapa rende uma linha por combinação
  // distinta. Sem teto ela só aumenta.
  const total = CAP + 30;
  const chaves = [];

  for (let i = 0; i < total; i++) {
    const chave = pp.fcCacheKey({ ...base, beatmapId: 700000 + i });
    chaves.push(chave);
    db.setCachedFCpp(chave, i);
  }

  const restantes = chaves.filter(c => db.getCachedFCpp(c) !== null).length;
  assert.ok(restantes <= CAP, `${restantes} entradas sobreviveram a um teto de ${CAP}`);

  // As primeiras saíram...
  assert.equal(db.getCachedFCpp(chaves[0]), null, 'a entrada mais antiga deveria ter saído');

  // ...e a recém-gravada continua lá. É o que o desempate por rowid garante:
  // as 30 gravações finais caem no mesmo milissegundo, e sem ele a evicção
  // poderia comer justamente a última.
  assert.equal(db.getCachedFCpp(chaves[total - 1]), total - 1);
});
