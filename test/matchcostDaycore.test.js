/**
 * /matchcost no Daycore: linhas do MySQL viram o formato comum, e partida
 * privada só aparece para quem jogou nela.
 *
 * Não existe MySQL aqui. O `mysql2` é dublado antes do require, no mesmo
 * espírito do invitecode.test.js, e o dublê responde por SQL — as linhas têm
 * a forma que o `mysql2` devolve (DATETIME vira Date, TINYINT vira número).
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.DAYCORE_MYSQL_HOST = '127.0.0.1';

// ─── O banco, trocado por um que responde o roteiro do teste ──────────────────

const executados = [];
let banco = {};

const mysql2 = require('mysql2/promise');
mysql2.createPool = () => ({
  async execute(sql, params) {
    executados.push({ sql, params });
    if (sql.includes('FROM `dc_matches`')) return [banco.partidas.filter(p => p.id === params[0])];
    if (sql.includes('FROM `dc_match_events`')) {
      const [matchId, quem] = params;
      const campo = sql.includes('u.`name`') ? 'name' : 'user_id';
      return [banco.joins.filter(j => j.match_id === matchId && j[campo] === quem).map(() => ({ 1: 1 }))];
    }
    if (sql.includes('FROM `dc_match_games`')) return [banco.jogos];
    if (sql.includes('FROM `dc_match_scores`')) return [banco.scores];
    throw new Error(`SQL inesperado: ${sql}`);
  },
  async query() { return [[{ 1: 1 }]]; },
  async end() {},
});

const daycore = require('../src/commands/osu/matchcost/daycore');
const { calcularMatchCost } = require('../src/commands/osu/matchcost/logic');

const FIM = new Date('2026-09-20T19:00:00.000Z');

/** Uma partida Team VS de dois jogos, com um abortado no meio. */
function bancoPadrao({ privada = false } = {}) {
  return {
    partidas: [{ id: 77, name: 'DCL: (Azul) vs (Vermelho)', private: privada ? 1 : 0, ended_at: FIM }],
    // Joins de quem jogou: Alice (10) e Bruno (20). O `name` é o do `users`.
    joins: [{ match_id: 77, user_id: 10, name: 'Alice' }, { match_id: 77, user_id: 20, name: 'Bruno' }],
    jogos: [
      { id: 1, team_type: 2, ended_at: new Date('2026-09-20T18:05:00.000Z') },
      { id: 2, team_type: 2, ended_at: null },
      { id: 3, team_type: 2, ended_at: new Date('2026-09-20T18:15:00.000Z') },
    ],
    // Fora da ordem de slot de propósito: a ordem da lista sai do slot.
    scores: [
      { game_id: 1, user_id: 20, slot: 1, team: 2, mods: 8, score: 300000, name: 'Bruno' },
      { game_id: 1, user_id: 10, slot: 0, team: 1, mods: 0, score: 500000, name: 'Alice' },
      { game_id: 2, user_id: 10, slot: 0, team: 1, mods: 0, score: 1000, name: 'Alice' },
      // NC no bitmask do bancho vem com o bit do DT junto: 512 + 64 + 8 (HD).
      { game_id: 3, user_id: 10, slot: 0, team: 1, mods: 584, score: 200000, name: 'Alice' },
      // Conta apagada: o LEFT JOIN com `users` devolve nome nulo.
      { game_id: 3, user_id: 20, slot: 1, team: 2, mods: 1, score: 400000, name: null },
    ],
  };
}

/** O que o `buscarPartida` devolve em `linhas`, a partir do banco dublado. */
const linhasDe = b => ({ partida: b.partidas[0], jogos: b.jogos, scores: b.scores });

test.beforeEach(() => {
  executados.length = 0;
  banco = bancoPadrao();
});

// ─── Normalização ─────────────────────────────────────────────────────────────

test('as constantes seguem a numeração do bancho.py', () => {
  assert.deepEqual(daycore.TIMES, { 0: 'none', 1: 'blue', 2: 'red' });
  assert.deepEqual(daycore.TIPOS_DE_TIME, { 0: 'head-to-head', 1: 'tag-coop', 2: 'team-vs', 3: 'tag-team-vs' });
});

test('linhas do MySQL → formato comum', () => {
  const p = daycore.normalizarPartida(linhasDe(bancoPadrao()), { avatars: 'https://a.daycore.org' });

  assert.equal(p.id, 77);
  assert.equal(p.name, 'DCL: (Azul) vs (Vermelho)');
  assert.equal(p.finished, true);
  assert.equal(p.games.length, 3);

  assert.deepEqual(p.games[0], {
    endedAt: '2026-09-20T18:05:00.000Z',
    teamType: 'team-vs',
    scores: [
      { userId: 10, username: 'Alice', team: 'blue', mods: [], score: 500000 },
      { userId: 20, username: 'Bruno', team: 'red', mods: ['HD'], score: 300000 },
    ],
  });
  // Abortado: `ended_at` NULL continua nulo, e a conta o descarta.
  assert.equal(p.games[1].endedAt, null);

  // NC sem o DT implícito (como o Bancho manda), NF como NF.
  assert.deepEqual(p.games[2].scores[0].mods, ['HD', 'NC']);
  assert.deepEqual(p.games[2].scores[1].mods, ['NF']);
  assert.equal(p.games[2].scores[1].username, null);

  // O `?v=` muda com a hora — ver servers.avatarUrl.
  assert.deepEqual(Object.keys(p.avatars), ['10', '20']);
  assert.match(p.avatars[10], /^https:\/\/a\.daycore\.org\/10\?v=\d+$/);
  assert.match(p.avatars[20], /^https:\/\/a\.daycore\.org\/20\?v=\d+$/);
});

test('partida aberta, team_type desconhecido e time fora da faixa', () => {
  const linhas = bancoPadrao();
  linhas.partidas[0].ended_at = null;
  linhas.jogos[0].team_type = 9;
  linhas.scores[0].team = 7;

  const p = daycore.normalizarPartida(linhasDe(linhas));
  assert.equal(p.finished, false);
  assert.equal(p.games[0].teamType, 'head-to-head');
  assert.equal(p.games[0].scores[1].team, 'none');
  assert.deepEqual(p.avatars, {});
});

test('o exemplo passa pela conta', () => {
  // Jogos 1 e 3 (o 2 foi abortado):
  //   jogo 1: 500k + 300k → média 400k → Alice 1.25, Bruno 0.75  (azul)
  //   jogo 3: 200k + 400k → média 300k → Alice 0.6667, Bruno 1.3333 (vermelho)
  //   Alice: (1.25 + 0.6667)/2 = 0.9583 + 0.5 = 1.4583 × 1.5 = 2.1875
  //   Bruno: (0.75 + 1.3333)/2 = 1.0417 + 0.5 = 1.5417 × 1.5 = 2.3125
  const r = calcularMatchCost(daycore.normalizarPartida(linhasDe(bancoPadrao())));
  assert.equal(r.tipo, 'times');
  assert.equal(r.jogos, 2);
  assert.equal(r.azul.vitorias, 1);
  assert.equal(r.vermelho.vitorias, 1);
  assert.ok(Math.abs(r.azul.jogadores[0].matchCost - 2.1875) < 1e-5);
  assert.ok(Math.abs(r.vermelho.jogadores[0].matchCost - 2.3125) < 1e-5);
});

// ─── Busca e partida privada ──────────────────────────────────────────────────

test('partida pública: aparece para qualquer um, sem consultar joins', async () => {
  const r = await daycore.buscarPartida(77, null);
  assert.ok(r.linhas);
  assert.ok(!executados.some(e => e.sql.includes('dc_match_events')));
});

test('partida inexistente: not_found', async () => {
  assert.deepEqual(await daycore.buscarPartida(999, { id: 10, name: 'Alice' }), { erro: 'not_found' });
});

test('partida privada: quem jogou vê', async () => {
  banco = bancoPadrao({ privada: true });
  const r = await daycore.buscarPartida(77, { id: 10, name: 'Alice' });
  assert.ok(r.linhas);
});

test('partida privada: quem não jogou recebe o MESMO not_found de partida inexistente', async () => {
  banco = bancoPadrao({ privada: true });
  const r = await daycore.buscarPartida(77, { id: 30, name: 'Carla' });
  assert.deepEqual(r, await daycore.buscarPartida(999, { id: 30, name: 'Carla' }));
  // E não leu jogo nem score de uma partida que não ia mostrar.
  assert.ok(!executados.some(e => e.sql.includes('dc_match_scores')));
});

test('partida privada: sem /link no servidor, não vê', async () => {
  banco = bancoPadrao({ privada: true });
  assert.deepEqual(await daycore.buscarPartida(77, null), { erro: 'not_found' });
});

test('partida privada: link antigo, só com o nome, confere pelo nome', async () => {
  banco = bancoPadrao({ privada: true });
  const r = await daycore.buscarPartida(77, { id: null, name: 'Bruno' });
  assert.ok(r.linhas);
  const consulta = executados.find(e => e.sql.includes('dc_match_events'));
  assert.match(consulta.sql, /u\.`name` = \?/);
});

test('as consultas são parametrizadas: o id não entra no texto do SQL', async () => {
  banco = bancoPadrao({ privada: true });
  await daycore.buscarPartida(77, { id: 10, name: "x' OR 1=1 -- " });
  for (const { sql, params } of executados) {
    assert.ok(!sql.includes('77'), sql);
    assert.ok(params.length > 0);
  }
});
