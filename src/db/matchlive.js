/**
 * db/matchlive.js
 * As partidas que o /matchlive acompanha, por canal, e até onde já postou.
 *
 * O estado mora aqui (e não em memória) para o bot retomar depois de um
 * restart sem repostar o log nem os mapas — ver src/matchlive/poller.js.
 */

const { db } = require('./connection');

function deLinha(r) {
  if (!r) return null;
  return {
    channelId: r.channel_id,
    guildId: r.guild_id,
    server: r.server,
    matchId: Number(r.match_id),
    lastEventId: Number(r.last_event_id),
    logMessageId: r.log_message_id ?? null,
    logLines: Number(r.log_lines),
    gameMessages: JSON.parse(r.game_messages || '{}'),
    trackedBy: r.tracked_by,
    createdAt: Number(r.created_at),
    lastActivityAt: Number(r.last_activity_at),
  };
}

function addTrack({ channelId, guildId, server, matchId, lastEventId, trackedBy, gameMessages = {} }) {
  const agora = Date.now();
  db.prepare(`
    INSERT INTO matchlive_tracks
      (channel_id, guild_id, server, match_id, last_event_id, tracked_by, game_messages, created_at, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(channelId, guildId ?? null, server, matchId, lastEventId, trackedBy, JSON.stringify(gameMessages), agora, agora);
}

function removeTrack(channelId, server, matchId) {
  return db.prepare('DELETE FROM matchlive_tracks WHERE channel_id = ? AND server = ? AND match_id = ?')
    .run(channelId, server, matchId).changes > 0;
}

function getTrack(channelId, server, matchId) {
  return deLinha(db.prepare('SELECT * FROM matchlive_tracks WHERE channel_id = ? AND server = ? AND match_id = ?')
    .get(channelId, server, matchId));
}

function listTracks() {
  return db.prepare('SELECT * FROM matchlive_tracks ORDER BY created_at').all().map(deLinha);
}

function listTracksByChannel(channelId) {
  return db.prepare('SELECT * FROM matchlive_tracks WHERE channel_id = ? ORDER BY created_at')
    .all(channelId).map(deLinha);
}

function countTracks() {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM matchlive_tracks').get().n);
}

function saveTrackState(channelId, server, matchId, { lastEventId, logMessageId, logLines, gameMessages, lastActivityAt }) {
  db.prepare(`
    UPDATE matchlive_tracks
    SET last_event_id = ?, log_message_id = ?, log_lines = ?, game_messages = ?, last_activity_at = ?
    WHERE channel_id = ? AND server = ? AND match_id = ?
  `).run(lastEventId, logMessageId ?? null, logLines, JSON.stringify(gameMessages ?? {}), lastActivityAt,
    channelId, server, matchId);
}

module.exports = { addTrack, removeTrack, getTrack, listTracks, listTracksByChannel, countTracks, saveTrackState };
