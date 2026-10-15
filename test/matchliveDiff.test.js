const test = require('node:test');
const assert = require('node:assert');
const { diff } = require('../src/matchlive/diff');

const ev = (id, type, userId = 1) => ({ id, type, userId, username: 'A', gameId: null, at: '2026-10-14T20:00:00.000Z' });
const jogo = (id, startedAt, endedAt = null) => ({ id, startedAt, endedAt, scores: [] });
const snap = ({ events = [], games = [], endedAt = null } = {}) => ({ match: { id: 9, name: 's', private: false, endedAt }, events, games });
const tipos = r => r.acoes.map(a => a.tipo + (a.game ? `:${a.game.id}` : ''));

test('eventos: só join/leave/host viram log, lastEventId avança', () => {
  const r = diff({ lastEventId: 0, gameMessages: {} }, snap({ events: [ev(1, 'create'), ev(2, 'join'), ev(3, 'host'), ev(4, 'game'), ev(5, 'leave')] }));
  assert.deepEqual(tipos(r), ['log', 'log', 'log']);
  assert.equal(r.lastEventId, 5);
});

test('sem eventos novos mantém lastEventId', () => {
  assert.equal(diff({ lastEventId: 7, gameMessages: {} }, snap()).lastEventId, 7);
});

test('jogo novo em andamento: gameStart', () => {
  const r = diff({ lastEventId: 0, gameMessages: {} }, snap({ games: [jogo(50, 't1')] }));
  assert.deepEqual(tipos(r), ['gameStart:50']);
});

test('jogo postado que terminou: gameEnd', () => {
  const r = diff({ lastEventId: 0, gameMessages: { 50: 'm1' } }, snap({ games: [jogo(50, 't1', 't2')] }));
  assert.deepEqual(tipos(r), ['gameEnd:50']);
});

test('jogo já finalizado não reemite', () => {
  const r = diff({ lastEventId: 0, gameMessages: { 50: 'done:m1' } }, snap({ games: [jogo(50, 't1', 't2')] }));
  assert.deepEqual(tipos(r), []);
});

test('jogo aberto superado por outro: gameAbort + gameStart do novo', () => {
  const r = diff({ lastEventId: 0, gameMessages: { 50: 'm1' } }, snap({ games: [jogo(50, 't1'), jogo(51, 't2')] }));
  assert.deepEqual(tipos(r), ['gameAbort:50', 'gameStart:51']);
});

test('partida fechou com jogo aberto: gameAbort + matchEnd por último', () => {
  const r = diff({ lastEventId: 0, gameMessages: { 50: 'm1' } }, snap({ games: [jogo(50, 't1')], endedAt: 't9' }));
  assert.deepEqual(tipos(r), ['gameAbort:50', 'matchEnd']);
});

test('restart: jogo inteiro perdido sai como start + end', () => {
  const r = diff({ lastEventId: 0, gameMessages: {} }, snap({ games: [jogo(50, 't1', 't2')] }));
  assert.deepEqual(tipos(r), ['gameStart:50', 'gameEnd:50']);
});

const { gameMessagesIniciais, inicioDoLog } = require('../src/matchlive/diff');

test('gameMessagesIniciais sem limite: nenhum jogo vira done:', () => {
  assert.deepEqual(gameMessagesIniciais([jogo(50, 't1', 't2'), jogo(51, 't3')]), {});
});

test('gameMessagesIniciais com limite: só os últimos mapas, o aberto conta', () => {
  const games = [jogo(50, 't1', 't2'), jogo(51, 't3'), jogo(52, 't4', 't5'), jogo(53, 't6')];
  assert.deepEqual(gameMessagesIniciais(games, 2), { 50: 'done:', 51: 'done:' });
  assert.deepEqual(gameMessagesIniciais(games.slice(0, 3), 2), { 50: 'done:' });
  assert.deepEqual(gameMessagesIniciais(games, 0), { 50: 'done:', 51: 'done:', 52: 'done:', 53: 'done:' });
});

test('inicioDoLog: o evento logável logo antes das últimas N entradas, ou 0', () => {
  const evs = [ev(1, 'create'), ev(2, 'join'), ev(3, 'game'), ev(4, 'join'), ev(5, 'host'), ev(6, 'leave')];
  assert.equal(inicioDoLog(evs, 2), 4);
  assert.equal(inicioDoLog(evs, 4), 0);
  assert.equal(inicioDoLog(evs, 3), 2);
});
