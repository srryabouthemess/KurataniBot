/**
 * /matchlive — o comando que liga e desliga o acompanhamento ao vivo.
 *
 * Sem MySQL nem Discord: o `mysql2` é dublado antes do require (como em
 * test/matchcostDaycore.test.js) e a interaction é um objeto que grava as
 * respostas. O banco do bot é um SQLite numa pasta temporária, aberto ANTES do
 * comando para ele pegar este banco e não outro.
 */
const test = require('node:test');
const assert = require('node:assert');
const { dbWorkspace } = require('./helpers');

process.env.DAYCORE_MYSQL_HOST = '127.0.0.1';
process.env.SERVERS = 'daycore';
process.env.SERVER_DAYCORE_URL = 'https://daycore.test';

let banco = {};
const mysql2 = require('mysql2/promise');
mysql2.createPool = () => ({
  async execute(sql, params) {
    if (sql.includes('FROM `dc_match_games`')) banco.aoLerJogos?.();
    if (sql.includes('MAX(`id`)')) return [[{ n: banco.eventos.length ? Math.max(...banco.eventos.map(e => e.id)) : null }]];
    if (sql.includes("`type` = 'join'")) return [banco.joins.filter(j => j.match_id === params[0] && j.user_id === params[1])];
    if (sql.includes('FROM `dc_matches`')) return [banco.partidas.filter(p => p.id === params[0])];
    if (sql.includes('FROM `dc_match_events`')) return [banco.eventos.filter(e => e.id > params[1])];
    if (sql.includes('FROM `dc_match_games`')) return [banco.jogos ?? []];
    if (sql.includes('FROM `dc_match_scores`')) return [[]];
    throw new Error(`SQL inesperado: ${sql}`);
  },
  async query() { return [[{ 1: 1 }]]; },
  async end() {},
});

const db = dbWorkspace({ after: fn => test.after(fn) }).load();
const matchlive = require('../src/commands/osu/matchlive');

const CANAL = 'c1';

function interacao({ sub, match = null, pode = true, guildId = 'g1' }) {
  const respostas = [];
  const i = {
    guildId,
    channelId: CANAL,
    locale: 'pt-BR',
    guildLocale: 'pt-BR',
    user: { id: 'u1' },
    memberPermissions: { has: () => pode },
    options: {
      getSubcommand: () => sub,
      getString: nome => (nome === 'match' ? match : null),
    },
    deferred: false,
    replied: false,
    async reply(p) { i.replied = true; respostas.push(p); },
    async deferReply() { i.deferred = true; },
    async editReply(p) { respostas.push(p); },
  };
  return { i, respostas };
}

const texto = r => (typeof r === 'string' ? r : r.content);

test.beforeEach(() => {
  for (const tr of db.listTracks()) db.removeTrack(tr.channelId, tr.server, tr.matchId);
  banco = {
    partidas: [{ id: 9, name: 'sala', private: 0, ended_at: null }],
    eventos: [{ id: 5, type: 'join', user_id: 3, name: 'Alice', game_id: null, created_at: new Date() }],
    joins: [],
  };
});

test('sem Manage Channels: recusa em efêmero', async () => {
  const { i, respostas } = interacao({ sub: 'track', match: '9', pode: false });
  await matchlive.execute(i);
  assert.match(texto(respostas[0]), /Gerenciar Canais/);
  assert.ok(respostas[0].flags);
  assert.equal(db.countTracks(), 0);
});

test('link do Bancho: em breve', async () => {
  const { i, respostas } = interacao({ sub: 'track', match: 'https://osu.ppy.sh/community/matches/123' });
  await matchlive.execute(i);
  assert.match(texto(respostas[0]), /ainda não chegou/);
});

test('partida fechada: sugere /matchcost', async () => {
  banco.partidas[0].ended_at = new Date();
  const { i, respostas } = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(i);
  assert.match(texto(respostas.at(-1)), /\/matchcost 9/);
  assert.equal(db.countTracks(), 0);
});

test('privada sem join: não encontrada', async () => {
  banco.partidas[0].private = 1;
  const { i, respostas } = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(i);
  assert.match(texto(respostas.at(-1)), /Nenhuma partida com o id `9`/);
  assert.equal(db.countTracks(), 0);
});

test('track grava o início do log e untrack remove', async () => {
  const a = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(a.i);
  assert.match(texto(a.respostas.at(-1)), /Acompanhando a partida `9` \(\*\*sala\*\*\)/);
  const tr = db.getTrack(CANAL, 'daycore', 9);
  assert.equal(tr.lastEventId, 0);
  assert.equal(tr.trackedBy, 'u1');
  assert.equal(tr.guildId, 'g1');

  const b = interacao({ sub: 'untrack', match: '9' + '' });
  b.i.options.getString = () => 'https://daycore.test/matches/9';
  await matchlive.execute(b.i);
  assert.match(texto(b.respostas[0]), /Parei de acompanhar/);
  assert.equal(db.getTrack(CANAL, 'daycore', 9), null);
});

test('limite de 3 por canal', async () => {
  for (const matchId of [1, 2, 3]) {
    db.addTrack({ channelId: CANAL, guildId: 'g1', server: 'daycore', matchId, lastEventId: 0, trackedBy: 'u1' });
  }
  const { i, respostas } = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(i);
  assert.match(texto(respostas[0]), /já acompanha 3 partidas/);
  assert.equal(db.getTrack(CANAL, 'daycore', 9), null);
});

test('list em canal vazio', async () => {
  const { i, respostas } = interacao({ sub: 'list' });
  await matchlive.execute(i);
  assert.match(texto(respostas[0]), /Nenhuma partida acompanhada/);
});

test('fora de servidor: só em canal de guild', async () => {
  const { i, respostas } = interacao({ sub: 'list', guildId: null });
  await matchlive.execute(i);
  assert.match(texto(respostas[0]), /só funciona em canais de servidor/);
});

test('outro track gravado durante as consultas: limite conferido de novo antes de gravar', async () => {
  banco.aoLerJogos = () => {
    for (const matchId of [1, 2, 3]) {
      db.addTrack({ channelId: CANAL, guildId: 'g1', server: 'daycore', matchId, lastEventId: 0, trackedBy: 'u2' });
    }
  };
  const { i, respostas } = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(i);
  assert.equal(i.deferred, true);
  assert.match(texto(respostas.at(-1)), /já acompanha 3 partidas/);
  assert.equal(db.getTrack(CANAL, 'daycore', 9), null);
  assert.equal(db.countTracks(), 3);
});

test('limite global', async () => {
  for (let matchId = 100; matchId < 120; matchId++) {
    db.addTrack({ channelId: `outro${matchId}`, guildId: 'g2', server: 'daycore', matchId, lastEventId: 0, trackedBy: 'u2' });
  }
  const { i, respostas } = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(i);
  assert.match(texto(respostas[0]), /limite de partidas acompanhadas/);
  assert.equal(db.getTrack(CANAL, 'daycore', 9), null);
});

test('partida privada não é acompanhada em canal compartilhado', async () => {
  banco.partidas[0].private = 1;
  banco.joins = [{ match_id: 9, user_id: 3 }];
  db.setLink('u1', 'daycore', 'Alice', 3);
  const { i, respostas } = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(i);
  assert.match(texto(respostas.at(-1)), /Nenhuma partida com o id `9` foi encontrada/);
  assert.equal(db.getTrack(CANAL, 'daycore', 9), null);
});

test('list sem Manage Channels: recusa em efêmero', async () => {
  const { i, respostas } = interacao({ sub: 'list', pode: false });
  await matchlive.execute(i);
  assert.match(texto(respostas[0]), /Gerenciar Canais/);
  assert.ok(respostas[0].flags);
});

const jg = (id, min, fim) => ({ id, map_id: 1, map_name: 'm', mode: 0, mods: 0, freemods: 0, team_type: 0,
  started_at: new Date(Date.UTC(2026, 0, 1, 0, min)), ended_at: fim == null ? null : new Date(Date.UTC(2026, 0, 1, 0, fim)) });

test('track numa partida em andamento: todo o histórico cabe, nada vira done:', async () => {
  banco.jogos = [jg(1, 0, 3), jg(2, 5, 8), jg(3, 10, null)];
  const { i, respostas } = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(i);
  assert.deepEqual(db.getTrack(CANAL, 'daycore', 9).gameMessages, {});
  assert.doesNotMatch(texto(respostas.at(-1)), /ficaram de fora/);
});

test('histórico longo: log conta 1, mapas mais antigos viram done: e a resposta avisa', async () => {
  banco.jogos = Array.from({ length: 12 }, (_, k) => jg(k + 1, k * 5, k * 5 + 3));
  banco.eventos = Array.from({ length: 20 }, (_, k) => ({ id: k + 1, type: 'join', user_id: 3, name: 'Alice', game_id: null, created_at: new Date() }));
  const { i, respostas } = interacao({ sub: 'track', match: 'https://daycore.test/matches/9' });
  await matchlive.execute(i);
  const tr = db.getTrack(CANAL, 'daycore', 9);
  // 20 entradas, só as últimas 15 (ids 6..20) entram: começa depois do 5.
  assert.equal(tr.lastEventId, 5);
  // 10 mensagens: 1 de log + 9 mapas; os 3 primeiros ficam de fora.
  assert.deepEqual(tr.gameMessages, { 1: 'done:', 2: 'done:', 3: 'done:' });
  assert.match(texto(respostas.at(-1)), /3 mapa\(s\) mais antigo\(s\) ficaram de fora/);
});

test('untrack sem id: para a única partida do canal', async () => {
  db.addTrack({ channelId: CANAL, guildId: 'g1', server: 'daycore', matchId: 9, lastEventId: 0, trackedBy: 'u1' });
  const { i, respostas } = interacao({ sub: 'untrack' });
  await matchlive.execute(i);
  assert.match(texto(respostas[0]), /Parei de acompanhar a partida `9`/);
  assert.equal(db.countTracks(), 0);
});

test('untrack sem id com zero ou duas partidas: pede o id', async () => {
  const a = interacao({ sub: 'untrack' });
  await matchlive.execute(a.i);
  assert.match(texto(a.respostas[0]), /opção `match`/);
  for (const matchId of [1, 2]) {
    db.addTrack({ channelId: CANAL, guildId: 'g1', server: 'daycore', matchId, lastEventId: 0, trackedBy: 'u1' });
  }
  const b = interacao({ sub: 'untrack' });
  await matchlive.execute(b.i);
  assert.match(texto(b.respostas[0]), /opção `match`/);
  assert.equal(db.countTracks(), 2);
});

test('untrack funciona sem o MySQL configurado', async () => {
  db.addTrack({ channelId: CANAL, guildId: 'g1', server: 'daycore', matchId: 9, lastEventId: 0, trackedBy: 'u1' });
  const daycoreMysql = require('../src/daycoreMysql');
  const original = daycoreMysql.isConfigured;
  daycoreMysql.isConfigured = () => false;
  try {
    const { i, respostas } = interacao({ sub: 'untrack', match: 'https://daycore.test/matches/9' });
    await matchlive.execute(i);
    assert.match(texto(respostas[0]), /Parei de acompanhar/);
    assert.equal(db.getTrack(CANAL, 'daycore', 9), null);
  } finally {
    daycoreMysql.isConfigured = original;
  }
});
