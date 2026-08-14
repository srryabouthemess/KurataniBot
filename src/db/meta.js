/**
 * db/meta.js
 * Estado interno do bot: o que ele precisa lembrar entre execuções e que não é
 * dado de ninguém.
 *
 * Hoje é o hash do conjunto de slash commands já registrado no Discord — é ele
 * que faz o boot pular a chamada de registro quando nada mudou (ver index.js) —
 * e as marcas das migrações herdadas.
 */

const { db } = require('./connection');

function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

function setMeta(key, value) {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

module.exports = { getMeta, setMeta };
