/** Lógica de juntar VN e RX no /recent: par de chaves, quais buscar, merge, falha parcial. */
const test = require('node:test');
const assert = require('node:assert');

const recentMerge = require('../src/recentMerge');

// ─── pairFor ────────────────────────────────────────────────────────────────

test('pairFor', async t => {
  await t.test('chave raiz de servidor com RX', () => {
    const pair = recentMerge.pairFor('daycore');
    assert.deepEqual(pair, { vn: 'daycore', rx: 'daycore_rx', resolvedIsRx: false });
  });

  await t.test('chave _rx do mesmo par', () => {
    const pair = recentMerge.pairFor('daycore_rx');
    assert.deepEqual(pair, { vn: 'daycore', rx: 'daycore_rx', resolvedIsRx: true });
  });

  await t.test('servidor sem variante RX', () => {
    const pair = recentMerge.pairFor('official');
    assert.deepEqual(pair, { vn: 'official', rx: null, resolvedIsRx: false });
  });
});

// ─── keysToFetch ────────────────────────────────────────────────────────────

test('keysToFetch', async t => {
  const comPar    = recentMerge.pairFor('daycore');
  const comParRx  = recentMerge.pairFor('daycore_rx');
  const semPar    = recentMerge.pairFor('official');

  await t.test('sem par, ignora modo e busca só a chave', () => {
    assert.deepEqual(recentMerge.keysToFetch(semPar, null), ['official']);
    assert.deepEqual(recentMerge.keysToFetch(semPar, 'rx'), ['official']);
  });

  await t.test('com par, sem modo: e resolvido pela raiz, só VN (sem surpresa)', () => {
    assert.deepEqual(recentMerge.keysToFetch(comPar, null), ['daycore']);
  });

  await t.test('com par, sem modo: mas resolvido pelo _rx, só RX', () => {
    assert.deepEqual(recentMerge.keysToFetch(comParRx, null), ['daycore_rx']);
  });

  await t.test('modo: vn força só VN mesmo resolvido pelo _rx', () => {
    assert.deepEqual(recentMerge.keysToFetch(comParRx, 'vn'), ['daycore']);
  });

  await t.test('modo: rx força só RX mesmo resolvido pela raiz', () => {
    assert.deepEqual(recentMerge.keysToFetch(comPar, 'rx'), ['daycore_rx']);
  });

  await t.test('modo: both combina os dois, resolvido pela raiz ou pelo _rx', () => {
    assert.deepEqual(recentMerge.keysToFetch(comPar, 'both'), ['daycore', 'daycore_rx']);
    assert.deepEqual(recentMerge.keysToFetch(comParRx, 'both'), ['daycore', 'daycore_rx']);
  });
});

// ─── mergeRecent ────────────────────────────────────────────────────────────

test('mergeRecent', async t => {
  const vn = [
    { id: 1, created_at: '2026-08-20T10:00:00Z' },
    { id: 2, created_at: '2026-08-20T08:00:00Z' },
  ];
  const rx = [
    { id: 3, created_at: '2026-08-20T09:00:00Z' },
  ];

  await t.test('junta as duas listas por data decrescente', () => {
    const out = recentMerge.mergeRecent(
      [{ mode: 'daycore', scores: vn }, { mode: 'daycore_rx', scores: rx }],
      50,
    );
    assert.deepEqual(out.map(s => s.id), [1, 3, 2]);
  });

  await t.test('cada score ganha o _mode de onde veio', () => {
    const out = recentMerge.mergeRecent(
      [{ mode: 'daycore', scores: vn }, { mode: 'daycore_rx', scores: rx }],
      50,
    );
    assert.equal(out.find(s => s.id === 1)._mode, 'daycore');
    assert.equal(out.find(s => s.id === 3)._mode, 'daycore_rx');
  });

  await t.test('corta no limite depois de juntar', () => {
    const out = recentMerge.mergeRecent(
      [{ mode: 'daycore', scores: vn }, { mode: 'daycore_rx', scores: rx }],
      2,
    );
    assert.deepEqual(out.map(s => s.id), [1, 3]);
  });

  await t.test('uma chave só também marca o _mode', () => {
    const out = recentMerge.mergeRecent([{ mode: 'official', scores: vn }], 50);
    assert.ok(out.every(s => s._mode === 'official'));
  });

  // Regressão: `osu.getRecentScores` devolve o score CRU em bancho.py, e cru
  // quer dizer data em `play_time`, não `created_at` — a normalização só
  // acontece depois, dentro do `enrichScores` de cada página (ver
  // banchoPyApi.js). Ordenar lendo só `created_at` faz `new Date(undefined)`
  // virar `Invalid Date`, toda comparação dá `NaN`, e o `.sort()` não
  // reordena nada — a "mesclagem" vira só VN concatenado com RX. Com este
  // teste sozinho a suíte já cairia no código de antes desta correção.
  await t.test('mescla score cru de bancho.py (play_time) com score já normalizado (created_at) pela ordem cronológica real', () => {
    const vnNormalizado = [
      { id: 1, created_at: '2026-08-20T10:00:00Z' },
      { id: 2, created_at: '2026-08-20T08:00:00Z' },
    ];
    // Sem `created_at` nenhum — é assim que `getRecentScores` devolve uma
    // play de bancho.py antes de passar pelo enrichScores.
    const rxCru = [
      { id: 3, play_time: '2026-08-20 09:00:00' },
    ];

    const out = recentMerge.mergeRecent(
      [{ mode: 'daycore', scores: vnNormalizado }, { mode: 'daycore_rx', scores: rxCru }],
      50,
    );
    assert.deepEqual(out.map(s => s.id), [1, 3, 2]);
  });

  await t.test('score sem created_at e sem play_time vai pro fim da lista, não pro topo', () => {
    const semData = { id: 9 };
    const comData = { id: 1, created_at: '2026-08-20T08:00:00Z' };

    const out = recentMerge.mergeRecent(
      [{ mode: 'daycore', scores: [semData, comData] }],
      50,
    );
    assert.deepEqual(out.map(s => s.id), [1, 9]);
  });
});

// ─── modoLabel ──────────────────────────────────────────────────────────────

test('modoLabel', async t => {
  await t.test('rótulo curto de cada modo válido', () => {
    assert.equal(recentMerge.modoLabel('vn'), 'VN');
    assert.equal(recentMerge.modoLabel('rx'), 'RX');
    assert.equal(recentMerge.modoLabel('both'), 'VN+RX');
  });

  await t.test('sem preferência (null) ou valor desconhecido, sem rótulo', () => {
    assert.equal(recentMerge.modoLabel(null), null);
    assert.equal(recentMerge.modoLabel('lixo'), null);
  });
});

// ─── fetchEach ──────────────────────────────────────────────────────────────

test('fetchEach', async t => {
  await t.test('todas as chaves respondem', async () => {
    const out = await recentMerge.fetchEach(['daycore', 'daycore_rx'], async mode => [{ mode }]);
    assert.deepEqual(out, [
      { mode: 'daycore', scores: [{ mode: 'daycore' }] },
      { mode: 'daycore_rx', scores: [{ mode: 'daycore_rx' }] },
    ]);
  });

  await t.test('uma falha, a outra ainda responde — e a falha vai pro log, não some calada', async () => {
    // Sem o log, "RX fora do ar" e "esse jogador não tem play em RX" ficam
    // indistinguíveis: as duas devolvem só a lista de VN.
    const original = console.error;
    const linhas = [];
    console.error = (...parts) => linhas.push(parts.join(' '));

    let out;
    try {
      out = await recentMerge.fetchEach(['daycore', 'daycore_rx'], async mode => {
        if (mode === 'daycore_rx') throw new Error('RX fora do ar');
        return [{ mode }];
      });
    } finally {
      console.error = original;
    }

    assert.deepEqual(out, [{ mode: 'daycore', scores: [{ mode: 'daycore' }] }]);
    assert.ok(linhas.some(l => l.includes('RX fora do ar')), 'a falha parcial deveria ter sido logada');
  });

  await t.test('as duas falham, relança o primeiro erro', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      await assert.rejects(
        recentMerge.fetchEach(['daycore', 'daycore_rx'], async () => { throw new Error('fora do ar'); }),
        /fora do ar/,
      );
    } finally {
      console.error = original;
    }
  });
});
