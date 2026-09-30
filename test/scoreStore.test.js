/**
 * O armazenamento dos scores vistos (db/scores.js + scoreStore.js).
 *
 * O que ele promete, e que rodar o bot não mostra até alguém reclamar de um
 * comando lento ou de um erro que não era dele:
 *   - o scores.db tem versão própria, e ela não mexe na do bot.db;
 *   - ver o mesmo score de novo não duplica (UPSERT), e a varredura do
 *     /topscores conta à parte;
 *   - falha de gravação nunca chega a quem chamou;
 *   - a gravação acontece DEPOIS da resposta, e não no caminho dela.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { dbWorkspace } = require('./helpers');
const scoreStore = require('../src/scoreStore');
const metrics = require('../src/lib/metrics');
const { executar } = require('../src/bot/dispatch');

/** Espera até `cond()` valer, dando voltas no event loop. */
async function ate(cond, ms = 500) {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error('condição não chegou a valer');
    await new Promise(r => setTimeout(r, 2));
  }
}

/** Um score na forma normalizada que o oficial devolve. */
function scoreOficial(extra = {}) {
  return {
    id: 4_100_000_001,
    user_id: 2,
    pp: 512.3,
    accuracy: 0.987,
    rank: 'S',
    passed: true,
    max_combo: 1200,
    score: 12345678,
    mods: ['HD', 'DT'],
    mode: 'osu',
    created_at: '2026-09-29T12:00:00Z',
    statistics: { count_300: 900, count_100: 10, count_50: 0, count_miss: 0 },
    beatmap: { id: 1234 },
    ...extra,
  };
}

/** Handle próprio, para conferir o arquivo e não a conexão do bot. */
function lerScoresDb(dir, sql, ...params) {
  const h = new DatabaseSync(path.join(dir, 'scores.db'));
  try {
    return h.prepare(sql).all(...params);
  } finally {
    h.close();
  }
}

/** Banco novo, com o store apontado para ele e zerado. */
function preparar(t, opts = {}) {
  const ws = dbWorkspace(t);
  const db = ws.load();
  scoreStore._paraTeste.reset();
  scoreStore._paraTeste.configurar({ banco: db, ...opts });
  metrics.reset();
  t.after(() => scoreStore._paraTeste.reset());
  return { ...ws, db };
}

const linhas = (db, server = 'official') => db.scoresGuardadosDoJogador(server, 2, { limit: 1000 });

// ─── Migração ─────────────────────────────────────────────────────────────────

test('scores.db novo nasce carimbado na versão própria, e o bot.db não muda', t => {
  const { dir, dbPath, db } = preparar(t);

  const versaoScores = lerScoresDb(dir, 'PRAGMA user_version')[0].user_version;
  assert.equal(versaoScores, db.SCORES_SCHEMA_VERSION);
  assert.equal(db.SCORES_SCHEMA_VERSION, 1);

  const h = new DatabaseSync(dbPath);
  try {
    assert.equal(h.prepare('PRAGMA user_version').get().user_version, db.SCHEMA_VERSION);
    // As tabelas moram no scores.db, e NADA delas vai parar no bot.db.
    const noMain = h.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'score%'").all();
    assert.deepEqual(noMain, []);
  } finally {
    h.close();
  }

  const tabelas = lerScoresDb(dir, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .map(r => r.name);
  assert.deepEqual(tabelas, ['score_players', 'scores']);
  assert.equal(db.scoresDisponivel(), true);
});

test('bot.db existente na versão atual ganha o scores.db sem backup de migração', t => {
  // Se o scores.db subisse a versão do bot.db, este boot tiraria um backup
  // pré-migração — e o código anterior passaria a recusar o banco.
  const ws = dbWorkspace(t);
  ws.load().close();
  fs.rmSync(path.join(ws.dir, 'scores.db'), { force: true });
  for (const f of ['scores.db-wal', 'scores.db-shm']) fs.rmSync(path.join(ws.dir, f), { force: true });

  const db = ws.load();
  assert.equal(db.scoresDisponivel(), true);
  assert.equal(fs.existsSync(path.join(ws.dir, 'backups')), false, 'não deveria haver backup');
});

test('scores.db de versão mais nova desliga o store, sem derrubar o boot', t => {
  const ws = dbWorkspace(t);
  ws.load().close();

  const h = new DatabaseSync(path.join(ws.dir, 'scores.db'));
  h.exec('PRAGMA user_version = 99');
  h.close();

  const avisos = [];
  const warn = console.warn;
  console.warn = (...a) => avisos.push(a.join(' '));
  t.after(() => { console.warn = warn; });

  const db = ws.load();
  assert.equal(db.scoresDisponivel(), false);
  assert.match(avisos.join('\n'), /scores\.db está na versão 99/);
  // E o resto do bot segue: o bot.db responde normalmente.
  assert.equal(db.getLink('ninguem'), null);
});

// ─── Upsert e idempotência ───────────────────────────────────────────────────

test('o mesmo score gravado duas vezes vira uma linha só', t => {
  const { db } = preparar(t);
  const linha = scoreStore._paraTeste.linhaDe(scoreOficial(), { server: 'official' });

  assert.deepEqual(
    [db.gravarScores([linha]).novos, db.gravarScores([linha]).existentes],
    [1, 1],
  );

  const guardadas = linhas(db);
  assert.equal(guardadas.length, 1);
  assert.equal(guardadas[0].seen_count, 2);
  assert.equal(guardadas[0].sweep_count, 0);
  assert.equal(guardadas[0].mods, 'DT,HD');
});

test('repetido DENTRO do mesmo lote também não duplica', t => {
  const { db } = preparar(t);
  const linha = scoreStore._paraTeste.linhaDe(scoreOficial(), { server: 'official' });

  const r = db.gravarScores([linha, linha, linha]);
  assert.deepEqual([r.novos, r.existentes], [1, 2]);
  assert.equal(linhas(db).length, 1);
});

test('a varredura conta em sweep_count, e não infla o seen_count', t => {
  const { db } = preparar(t);
  const linha = scoreStore._paraTeste.linhaDe(scoreOficial(), { server: 'official' });

  db.gravarScores([linha], { varredura: true });
  db.gravarScores([linha], { varredura: true });
  db.gravarScores([linha]);

  const [g] = linhas(db);
  assert.equal(g.sweep_count, 2);
  assert.equal(g.seen_count, 1);
});

test('o upsert preenche o que faltava e troca o pp pelo mais novo', t => {
  const { db } = preparar(t);
  const { linhaDe } = scoreStore._paraTeste;

  db.gravarScores([linhaDe(scoreOficial({ statistics: {}, max_combo: null }), { server: 'official' })]);
  db.gravarScores([linhaDe(scoreOficial({ pp: 530.1, map_md5: 'A'.repeat(32) }), { server: 'official' })]);

  const [g] = linhas(db);
  assert.equal(g.pp, 530.1);
  assert.equal(g.max_combo, 1200);
  assert.equal(g.n300, 900);
  assert.equal(g.map_md5, 'a'.repeat(32));
});

test('pp nulo de uma fonte não apaga o pp que já estava guardado', t => {
  const { db } = preparar(t);
  const { linhaDe } = scoreStore._paraTeste;

  db.gravarScores([linhaDe(scoreOficial(), { server: 'official' })]);
  db.gravarScores([linhaDe(scoreOficial({ pp: null }), { server: 'official' })]);
  assert.equal(linhas(db)[0].pp, 512.3);
});

// ─── O que entra, e o que não entra ──────────────────────────────────────────

test('play que não passou, e score sem id ou sem dono, ficam de fora', () => {
  const { linhaDe } = scoreStore._paraTeste;
  const ctx = { server: 'official' };

  assert.equal(linhaDe(scoreOficial({ passed: false }), ctx), null);
  assert.equal(linhaDe(scoreOficial({ rank: 'F' }), ctx), null);
  assert.equal(linhaDe(scoreOficial({ id: undefined }), ctx), null);
  assert.equal(linhaDe(scoreOficial({ user_id: undefined }), ctx), null);
  // O dono do contexto vale mais que o do score: é quem o comando consultou.
  assert.equal(linhaDe(scoreOficial({ user_id: undefined }), { ...ctx, userId: 7 }).user_id, 7);
});

test('md5 que não é md5 não vai para a coluna', () => {
  const { linhaDe } = scoreStore._paraTeste;
  assert.equal(linhaDe(scoreOficial({ map_md5: 'qualquer coisa' }), { server: 'official' }).map_md5, null);
  // E nenhum outro campo é lido como md5: o oficial não foi verificado.
  assert.equal(linhaDe(scoreOficial({ beatmap: { id: 1, checksum: 'b'.repeat(32) } }), { server: 'official' }).map_md5, null);
});

test('NC chega igual do bitmask e da lista de acrônimos', () => {
  const { linhaDe } = scoreStore._paraTeste;
  const doBitmask = linhaDe(scoreOficial({ mods: ['DT', 'NC', 'HD'] }), { server: 'daycore' });
  const doOficial = linhaDe(scoreOficial({ mods: ['NC', 'HD'] }), { server: 'official' });
  assert.equal(doBitmask.mods, doOficial.mods);
});

test('o score do bancho.py sai da lista da v1 com id e md5', () => {
  // Resposta real do `get_player_scores`: o md5 vem só aninhado em `beatmap`
  // (ver test/scorewipe.test.js).
  const bancho = require('../src/osu/banchoPyApi');
  const cru = bancho.nativeScore({
    id: 4242, pp: 300.5, acc: 98.5, mods: 72, grade: 'A', score: 1000000,
    play_time: '2026-09-29T10:00:00', max_combo: 500, n300: 400, n100: 5, n50: 0, nmiss: 1,
    beatmap: { id: 7331, set_id: 99, md5: 'C'.repeat(32), title: 'T', artist: 'A', version: 'V' },
  });

  const linha = scoreStore._paraTeste.linhaDe(cru, { server: 'daycore', userId: 9, adaptar: bancho.paraGuardar });
  assert.equal(linha.score_id, 4242);
  assert.equal(linha.map_id, 7331);
  assert.equal(linha.map_md5, 'c'.repeat(32));
  assert.equal(linha.mods, 'DT,HD');
  assert.equal(linha.accuracy, 0.985);
});

test('a linha da varredura leva o dono do próprio score', () => {
  const bancho = require('../src/osu/banchoPyApi');
  const row = {
    id: 174, map_md5: 'd'.repeat(32), userid: 7, pp: 800, acc: 99.1, mods: 0, grade: 'SS',
    status: 2, play_time: '2026-09-01T00:00:00', max_combo: 900, n300: 900, n100: 0, n50: 0, nmiss: 0,
  };
  const linha = scoreStore._paraTeste.linhaDe(row, { server: 'daycore', adaptar: bancho.topParaGuardar, varredura: true });
  assert.equal(linha.user_id, 7);
  assert.equal(linha.score_id, 174);
  assert.equal(linha.map_md5, 'd'.repeat(32));
  assert.equal(linha.map_id, null);
});

test('o legado do Ripple passa a carregar o id do score', () => {
  const ripple = require('../src/osu/rippleApi');
  // O normalizeLegacyScore não é exportado; o caminho público é o beatmapScores,
  // que precisa de rede. Então a garantia é conferida no fonte.
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'osu', 'rippleApi.js'), 'utf8');
  assert.match(fonte, /score_id: raw\.score_id,/);
  assert.equal(typeof ripple.beatmapScores, 'function');
});

// ─── A fila, o escopo e a ordem ──────────────────────────────────────────────

test('dentro do escopo nada é gravado antes de ele terminar', async t => {
  const { db } = preparar(t);

  await scoreStore.escopo(async () => {
    scoreStore.record([scoreOficial()], { server: 'official' });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(linhas(db).length, 0, 'gravou antes do fim do escopo');
  });

  await ate(() => linhas(db).length === 1);
  assert.equal(metrics.get('cache.scoreStore.miss'), 1);
});

test('a gravação acontece DEPOIS do editReply do comando', async t => {
  const eventos = [];
  const bancoFalso = {
    scoresDisponivel: () => true,
    contarScoresPorServidor: () => new Map(),
    gravarScores: (ls) => { eventos.push('gravou'); return { novos: ls.length, existentes: 0, novosPorServidor: new Map() }; },
  };
  scoreStore._paraTeste.reset();
  scoreStore._paraTeste.configurar({ banco: bancoFalso });
  t.after(() => scoreStore._paraTeste.reset());

  const interaction = {
    async deferReply() { eventos.push('defer'); },
    async editReply() {
      // Resposta lenta: se a gravação estivesse no caminho, entraria antes daqui.
      await new Promise(r => setTimeout(r, 15));
      eventos.push('editReply');
    },
  };
  const comando = {
    data: { name: 'falso' },
    async execute(i) {
      // É o que o osuClient faz quando a busca volta da rede.
      scoreStore.record([scoreOficial()], { server: 'official' });
      eventos.push('buscou');
      await i.editReply('ok');
      return 'resposta';
    },
  };

  const devolvido = await executar(comando, interaction);
  assert.equal(devolvido, 'resposta');
  assert.deepEqual(eventos, ['defer', 'buscou', 'editReply'], 'nada gravado até o execute terminar');

  await ate(() => eventos.includes('gravou'));
  assert.deepEqual(eventos, ['defer', 'buscou', 'editReply', 'gravou']);
});

test('fora de escopo, o flush espera o atraso', async t => {
  const { db } = preparar(t, { atrasoMs: 40 });

  scoreStore.record([scoreOficial()], { server: 'official' });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(linhas(db).length, 0, 'gravou antes do atraso');

  await ate(() => linhas(db).length === 1);
});

test('o que o comando deixou correndo depois de terminar não se perde', async t => {
  // O escopo fecha no fim do execute; um registro atrasado cai no caminho de
  // fora de escopo, e não numa lista que ninguém mais esvazia.
  const { db } = preparar(t, { atrasoMs: 5 });

  let tardio;
  await scoreStore.escopo(async () => {
    tardio = new Promise(r => setTimeout(r, 10)).then(() =>
      scoreStore.record([scoreOficial()], { server: 'official' }));
  });
  await tardio;
  await ate(() => linhas(db).length === 1);
});

test('uma varredura grande é gravada em lotes, sem perder nada', async t => {
  const { db } = preparar(t, { lote: 7 });
  const muitos = Array.from({ length: 50 }, (_, i) => scoreOficial({ id: 1000 + i }));

  await scoreStore.escopo(async () => {
    scoreStore.record(muitos, { server: 'official' });
  });
  await ate(() => linhas(db).length === 50);
  assert.equal(scoreStore._paraTeste.naFila(), 0);
});

// ─── Falha nunca propaga ─────────────────────────────────────────────────────

test('falha de gravação não chega ao comando, e vira métrica', async t => {
  const erro = console.error;
  const logs = [];
  console.error = (...a) => logs.push(a.join(' '));
  t.after(() => { console.error = erro; });

  metrics.reset();
  scoreStore._paraTeste.reset();
  scoreStore._paraTeste.configurar({
    banco: {
      scoresDisponivel: () => true,
      gravarScores: () => { throw new Error('disk I/O error'); },
    },
  });
  t.after(() => scoreStore._paraTeste.reset());

  const r = await scoreStore.escopo(async () => {
    scoreStore.record([scoreOficial()], { server: 'official' });
    return 42;
  });
  assert.equal(r, 42);

  await ate(() => metrics.get('scoreStore.falhas') === 1);
  assert.match(logs.join('\n'), /\[scoreStore\] disk I\/O error/);
  assert.equal(scoreStore._paraTeste.naFila(), 0, 'o lote que falhou não fica preso na fila');
});

test('erro do próprio comando continua subindo igual, e o que ele registrou é gravado', async t => {
  const { db } = preparar(t);
  const boom = new Error('o comando quebrou');

  await assert.rejects(
    scoreStore.escopo(async () => {
      scoreStore.record([scoreOficial()], { server: 'official' });
      throw boom;
    }),
    e => e === boom,
  );
  await ate(() => linhas(db).length === 1);
});

test('record com lixo não lança', () => {
  scoreStore._paraTeste.reset();
  assert.doesNotThrow(() => scoreStore.record(null, { server: 'official' }));
  assert.doesNotThrow(() => scoreStore.record([scoreOficial()], null));
  assert.doesNotThrow(() => scoreStore.record('não é lista', { server: 'official' }));
  assert.equal(scoreStore._paraTeste.naFila(), 0);
});

test('adaptador que lança descarta só aquele score', async t => {
  const { db } = preparar(t);
  let n = 0;
  const adaptar = s => { if (n++ === 0) throw new Error('formato inesperado'); return s; };

  await scoreStore.escopo(async () => {
    scoreStore.record([scoreOficial({ id: 1 }), scoreOficial({ id: 2 })], { server: 'official', adaptar });
  });
  await ate(() => linhas(db).length === 1);
  assert.equal(metrics.get('scoreStore.descartados'), 1);
});

test('fila cheia descarta o excedente e conta', t => {
  preparar(t, { maxFila: 3, atrasoMs: 60_000 });
  scoreStore.record([scoreOficial({ id: 1 }), scoreOficial({ id: 2 })], { server: 'official' });
  scoreStore.record([scoreOficial({ id: 3 }), scoreOficial({ id: 4 })], { server: 'official' });

  assert.equal(scoreStore._paraTeste.naFila(), 2);
  assert.equal(metrics.get('scoreStore.filaCheia'), 2);
});

test('store desligado (versão desconhecida) não grava nem lança', async t => {
  const { db } = preparar(t);
  db.definirScoresDisponivel(false);
  t.after(() => db.definirScoresDisponivel(true));

  await scoreStore.escopo(async () => {
    scoreStore.record([scoreOficial()], { server: 'official' });
  });
  await ate(() => metrics.get('scoreStore.desligado') === 1);
  db.definirScoresDisponivel(true);
  assert.equal(linhas(db).length, 0);
});

// ─── Métricas separadas ──────────────────────────────────────────────────────

test('a varredura tem métrica própria, separada do uso normal', async t => {
  preparar(t);

  await scoreStore.escopo(async () => {
    scoreStore.record([scoreOficial({ id: 1 })], { server: 'official', varredura: true });
    scoreStore.record([scoreOficial({ id: 1 })], { server: 'official', varredura: true });
    scoreStore.record([scoreOficial({ id: 2 })], { server: 'official' });
  });
  await ate(() => metrics.get('cache.scoreStore.miss') === 1);

  const { caches } = metrics.snapshot();
  assert.deepEqual([caches.scoreStoreVarredura.miss, caches.scoreStoreVarredura.hit], [1, 1]);
  assert.deepEqual([caches.scoreStore.miss, caches.scoreStore.hit], [1, 0]);
});

// ─── Poda ─────────────────────────────────────────────────────────────────────

test('passou do teto: poda o servidor maior, pelo menor pp, NULL primeiro', async t => {
  const { db } = preparar(t, { maxRows: 10 });

  const grande = Array.from({ length: 12 }, (_, i) =>
    scoreOficial({ id: 100 + i, pp: i === 0 ? null : 100 + i * 10 }));
  const pequeno = Array.from({ length: 3 }, (_, i) =>
    scoreOficial({ id: 900 + i, pp: 1 + i }));

  await scoreStore.escopo(async () => {
    scoreStore.record(grande, { server: 'official' });
    scoreStore.record(pequeno, { server: 'daycore' });
  });

  // 15 linhas, teto 10, alvo 9: saem 6, todas do servidor maior.
  await ate(() => metrics.get('scoreStore.podados') === 6);

  const oficial = db.scoresGuardadosDoJogador('official', 2, { limit: 100 });
  assert.equal(oficial.length, 6);
  assert.ok(oficial.every(s => s.pp !== null), 'o sem pp deveria ter saído primeiro');
  assert.equal(Math.min(...oficial.map(s => s.pp)), 160, 'saíram os menores pp');
  assert.equal(db.scoresGuardadosDoJogador('daycore', 2).length, 3, 'o servidor pequeno ficou inteiro');
});

// ─── Consulta e privacidade ──────────────────────────────────────────────────

test('as consultas trazem o nick conhecido', async t => {
  const { db } = preparar(t);

  await scoreStore.escopo(async () => {
    scoreStore.record([scoreOficial({ id: 1, pp: 300 }), scoreOficial({ id: 2, pp: 700 })],
      { server: 'official', userId: 2, username: 'fulano' });
  });
  await ate(() => linhas(db).length === 2);

  const top = db.topScoresGuardados('official');
  assert.deepEqual(top.map(s => [s.score_id, s.username]), [[2, 'fulano'], [1, 'fulano']]);
  assert.equal(db.scoresGuardadosDoMapa('official', { mapId: 1234 }).length, 2);

  const est = db.estatisticasScores();
  assert.equal(est.total, 2);
  assert.equal(est.jogadores, 1);
  assert.equal(est.jogadores24h, 1);
  assert.deepEqual(est.porServidor, { official: 2 });
});

test('forgetPlayer apaga os scores e o nick daquele jogador, e só dele', async t => {
  const { db, dir } = preparar(t);

  await scoreStore.escopo(async () => {
    scoreStore.record([scoreOficial({ id: 1 })], { server: 'official', userId: 2, username: 'fulano' });
    scoreStore.record([scoreOficial({ id: 2 })], { server: 'official', userId: 3, username: 'ciclano' });
  });
  await ate(() => db.topScoresGuardados('official').length === 2);

  assert.equal(scoreStore.forgetPlayer('official', 2), 1);
  assert.deepEqual(db.topScoresGuardados('official').map(s => s.user_id), [3]);
  assert.deepEqual(
    lerScoresDb(dir, 'SELECT user_id FROM score_players').map(r => r.user_id),
    [3],
  );
});

test('forgetPlayer tira da fila o que ainda não foi gravado', t => {
  preparar(t, { atrasoMs: 60_000 });
  scoreStore.record([scoreOficial()], { server: 'official', userId: 2 });
  assert.equal(scoreStore._paraTeste.naFila(), 1);

  scoreStore.forgetPlayer('official', 2);
  assert.equal(scoreStore._paraTeste.naFila(), 0);
});

test('nada do Discord é guardado', t => {
  const { dir } = preparar(t);
  const colunas = [
    ...lerScoresDb(dir, 'PRAGMA table_info(scores)'),
    ...lerScoresDb(dir, 'PRAGMA table_info(score_players)'),
  ].map(c => c.name);
  assert.deepEqual(colunas.filter(c => /discord|guild|channel/i.test(c)), []);
});

// ─── O ponto de ligação no osuClient ─────────────────────────────────────────

test('o osuClient registra o que veio da rede, com o servidor e o dono', async t => {
  const { db } = preparar(t);
  const oficial = require('../src/osu/officialApi');
  const osu = require('../src/osuClient');

  const original = oficial.recentScores;
  oficial.recentScores = async () => [scoreOficial({ id: 55 }), scoreOficial({ id: 56, passed: false })];
  t.after(() => { oficial.recentScores = original; });

  const devolvido = await scoreStore.escopo(() => osu.getRecentScores(2, 50, 'official'));
  // A resposta não muda: a play que não passou continua na lista do comando.
  assert.equal(devolvido.length, 2);

  await ate(() => linhas(db).length === 1);
  assert.equal(linhas(db)[0].score_id, 55);
});

test('o osuClient adapta a lista crua do bancho.py antes de guardar', async t => {
  const { db } = preparar(t);
  const bancho = require('../src/osu/banchoPyApi');
  const osu = require('../src/osuClient');

  const original = bancho.bestScores;
  bancho.bestScores = async () => [bancho.nativeScore({
    id: 777, pp: 250, acc: 97, mods: 8, grade: 'A', play_time: '2026-09-29T10:00:00',
    max_combo: 300, n300: 250, n100: 10, n50: 0, nmiss: 2,
    beatmap: { id: 42, set_id: 4, md5: 'e'.repeat(32), title: 'T', version: 'V' },
  })];
  t.after(() => { bancho.bestScores = original; });

  await scoreStore.escopo(() => osu.getBestScores(2, 100, 'daycore', { fresh: true }));
  await ate(() => db.scoresGuardadosDoJogador('daycore', 2).length === 1);

  const [g] = db.scoresGuardadosDoJogador('daycore', 2);
  assert.equal(g.score_id, 777);
  assert.equal(g.map_md5, 'e'.repeat(32));
  assert.equal(g.mods, 'HD');
});
