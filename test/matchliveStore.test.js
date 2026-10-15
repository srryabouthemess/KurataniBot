const test = require('node:test');
const assert = require('node:assert');
const { freshDb } = require('./helpers');

const base = { channelId: 'c1', guildId: 'g1', server: 'daycore', matchId: 42, lastEventId: 7, trackedBy: 'u1' };

test('matchlive: grava, lê, atualiza e remove o track', (t) => {
  const db = freshDb(t);
  db.addTrack(base);
  const lido = db.getTrack('c1', 'daycore', 42);
  assert.equal(lido.lastEventId, 7);
  assert.deepEqual(lido.gameMessages, {});
  assert.equal(lido.logMessageId, null);

  db.saveTrackState('c1', 'daycore', 42, {
    lastEventId: 9, logMessageId: 'm1', logLines: 3, gameMessages: { 5: 'm2' }, lastActivityAt: 123,
  });
  const depois = db.getTrack('c1', 'daycore', 42);
  assert.deepEqual(depois.gameMessages, { 5: 'm2' });
  assert.equal(depois.logLines, 3);
  assert.equal(depois.lastActivityAt, 123);

  assert.equal(db.countTracks(), 1);
  assert.equal(db.listTracksByChannel('c1').length, 1);
  assert.equal(db.removeTrack('c1', 'daycore', 42), true);
  assert.equal(db.removeTrack('c1', 'daycore', 42), false);
  assert.equal(db.listTracks().length, 0);
});

test('matchlive: mesma partida no mesmo canal não duplica', (t) => {
  const db = freshDb(t);
  db.addTrack(base);
  assert.throws(() => db.addTrack(base), /UNIQUE|PRIMARY/);
});
