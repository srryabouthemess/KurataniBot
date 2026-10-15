const test = require('node:test');
const assert = require('node:assert');

process.env.DAYCORE_MYSQL_HOST = '127.0.0.1';
let banco = {};
const executados = [];
const mysql2 = require('mysql2/promise');
mysql2.createPool = () => ({
  async execute(sql, params) {
    executados.push({ sql, params });
    if (sql.includes('MAX(`id`)')) return [[{ n: banco.eventos.length ? Math.max(...banco.eventos.map(e => e.id)) : null }]];
    if (sql.includes('FROM `dc_matches`')) return [banco.partidas.filter(p => p.id === params[0])];
    if (sql.includes('FROM `dc_match_events`')) return [banco.eventos.filter(e => e.id > params[1])];
    if (sql.includes('FROM `dc_match_games`')) return [banco.jogos];
    if (sql.includes('FROM `dc_match_scores`')) return [banco.scores];
    throw new Error(`SQL inesperado: ${sql}`);
  },
  async query() { return [[{ 1: 1 }]]; },
});

const fonte = require('../src/matchlive/sources/daycore');
const T0 = new Date('2026-10-14T20:00:00.000Z');
const T1 = new Date('2026-10-14T20:03:00.000Z');

test.beforeEach(() => {
  executados.length = 0;
  banco = {
    partidas: [{ id: 9, name: 'sala', private: 0, ended_at: null }],
    eventos: [
      { id: 1, type: 'create', user_id: 3, name: 'Alice', game_id: null, created_at: T0 },
      { id: 2, type: 'join', user_id: 4, name: 'Bruno', game_id: null, created_at: T0 },
    ],
    jogos: [
      { id: 50, map_id: 111, map_name: 'Artist - Song [Hard]', mode: 0, mods: 64, freemods: 0, team_type: 0, started_at: T0, ended_at: T1 },
      { id: 51, map_id: 112, map_name: 'Artist - Other [Insane]', mode: 0, mods: 0, freemods: 1, team_type: 2, started_at: T1, ended_at: null },
    ],
    scores: [
      { game_id: 50, user_id: 3, name: 'Alice', slot: 0, team: 0, mods: 64, score: 900000, max_combo: 500, n300: 400, n100: 5, n50: 0, nmiss: 1, ngeki: 0, nkatu: 0, passed: 1, perfect: 0 },
    ],
  };
});

test('snapshot: partida inexistente devolve null', async () => {
  banco.partidas = [];
  assert.equal(await fonte.snapshot(9, 0), null);
});

test('snapshot: só eventos depois do lastEventId e scores só do jogo terminado', async () => {
  const s = await fonte.snapshot(9, 1);
  assert.deepEqual(s.events.map(e => e.id), [2]);
  assert.equal(s.events[0].username, 'Bruno');
  assert.equal(s.games.length, 2);
  assert.deepEqual(s.games[0].mods, ['DT']);
  assert.equal(s.games[0].scores[0].maxCombo, 500);
  assert.equal(s.games[0].scores[0].passed, true);
  assert.equal(s.games[1].endedAt, null);
  assert.deepEqual(s.games[1].scores, []);
  assert.equal(s.games[1].teamType, 'team-vs');
});

test('lastEventIdOf: maior id, 0 sem eventos', async () => {
  assert.equal(await fonte.lastEventIdOf(9), 2);
  banco.eventos = [];
  assert.equal(await fonte.lastEventIdOf(9), 0);
});

test('live: null na fase 1', async () => {
  assert.equal(await fonte.live(51), null);
});
