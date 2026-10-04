/**
 * O id de um nick pelo que o bot já viu (`scores.score_players`).
 *
 * É o que deixa o `fetchPlayer` buscar perfil e scores juntos mesmo quando a
 * pessoa digita um nome (ver userLink.js). A resposta daqui é um palpite — o
 * nick pode ter trocado de dono —, e quem confere é o `fetchPlayer`. O que este
 * arquivo trava é o palpite em si: certo quando dá, nulo quando não dá, e
 * barato o bastante para rodar no caminho de todo comando.
 */
const test = require('node:test');
const assert = require('node:assert');
const { freshDb } = require('./helpers');

const jogador = (server, userId, username) => ({ server, userId, username });

test('acha o id pelo nick, sem diferenciar maiúsculas', t => {
  const db = freshDb(t);
  db.gravarScores([], { jogadores: [jogador('official', 7562902, 'mrekk')] });

  assert.equal(db.idPorNick('official', 'mrekk'), 7562902);
  assert.equal(db.idPorNick('official', 'MREKK'), 7562902);
});

test('o nick vale só no servidor em que foi visto', t => {
  // O mesmo nick em dois servidores costuma ser gente diferente, com ids de
  // sequências diferentes: misturar daria o perfil de outra pessoa.
  const db = freshDb(t);
  db.gravarScores([], { jogadores: [jogador('daycore', 1000, 'pudim2')] });

  assert.equal(db.idPorNick('daycore', 'pudim2'), 1000);
  assert.equal(db.idPorNick('official', 'pudim2'), null);
});

test('nick que nunca passou por aqui volta nulo', t => {
  const db = freshDb(t);
  assert.equal(db.idPorNick('official', 'ninguem'), null);
  assert.equal(db.idPorNick('official', ''), null);
  assert.equal(db.idPorNick('official', null), null);
});

test('dois ids com o mesmo nick: vale o visto mais recentemente', t => {
  // Fulano troca de nick e Beltrano pega o antigo. A linha de Fulano continua
  // com o nick velho até um score dele passar de novo, e a de Beltrano é a nova.
  const db = freshDb(t);
  db.gravarScores([], { jogadores: [jogador('official', 1, 'cookiezi')], agora: 1000 });
  db.gravarScores([], { jogadores: [jogador('official', 2, 'Cookiezi')], agora: 2000 });

  assert.equal(db.idPorNick('official', 'cookiezi'), 2);
});

test('com o scores.db desligado, não arrisca palpite', t => {
  const db = freshDb(t);
  db.gravarScores([], { jogadores: [jogador('official', 7562902, 'mrekk')] });
  db.definirScoresDisponivel(false);
  t.after(() => db.definirScoresDisponivel(true));

  assert.equal(db.idPorNick('official', 'mrekk'), null);
});

test('a busca usa índice, e não varre a tabela', t => {
  // Roda no caminho de todo comando com nick digitado: uma varredura cresceria
  // junto com o número de jogadores guardados.
  const db = freshDb(t);
  const { db: conexao } = require('../src/db/connection');
  const plano = conexao.prepare(`
    EXPLAIN QUERY PLAN
    SELECT user_id FROM scores.score_players
    WHERE server = ? AND username = ? COLLATE NOCASE
  `).all('official', 'mrekk').map(r => r.detail).join('\n');

  assert.ok(db.scoresDisponivel());
  assert.match(plano, /USING (COVERING )?INDEX idx_score_players_nick/);
});
