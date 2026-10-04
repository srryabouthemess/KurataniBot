/**
 * db/scores.js
 * Os scores que o bot já viu, no scores.db — o SQL, e só ele.
 *
 * Quem decide QUANDO gravar é o scoreStore.js (depois da resposta, em lote,
 * sem nunca propagar falha). Aqui chegam linhas já validadas e prontas.
 *
 * ── Idempotência ──────────────────────────────────────────────────────────────
 * A chave é (servidor, id do score), e ver o mesmo score de novo é um UPSERT:
 * não duplica, só atualiza `last_seen` e soma no contador daquela origem. O pp
 * e o rank recebem o valor novo quando ele vem (rework de pp muda o número de
 * um score que já existia); o resto só preenche o que estava faltando.
 *
 * Uma imprecisão conhecida, e aceita: a lista da v1 do bancho.py manda o pp
 * truncado, e a v2 (a do /score e da varredura) manda cheio. O número guardado
 * oscila na segunda casa decimal conforme a última fonte.
 */

const { db } = require('./connection');

// Ligado pelo index.js depois do `runScores`: um scores.db de versão que este
// código não conhece deixa tudo aqui em silêncio, sem derrubar o bot.
let _disponivel = false;

function definirScoresDisponivel(valor) {
  _disponivel = Boolean(valor);
}

const scoresDisponivel = () => _disponivel;

// Preparados uma vez: são os caminhos quentes, rodando a cada flush.
let _upsert = null;
let _upsertJogador = null;

const upsert = () => (_upsert ??= db.prepare(`
  INSERT INTO scores.scores (
    server, score_id, user_id, ruleset, map_id, map_md5, mods, mods_bits,
    pp, accuracy, max_combo, total_score, n300, n100, n50, nmiss, rank,
    played_at, first_seen, last_seen, seen_count, sweep_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (server, score_id) DO UPDATE SET
    pp          = COALESCE(excluded.pp, pp),
    rank        = COALESCE(excluded.rank, rank),
    map_id      = COALESCE(map_id, excluded.map_id),
    map_md5     = COALESCE(map_md5, excluded.map_md5),
    mods_bits   = COALESCE(mods_bits, excluded.mods_bits),
    accuracy    = COALESCE(accuracy, excluded.accuracy),
    max_combo   = COALESCE(max_combo, excluded.max_combo),
    total_score = COALESCE(total_score, excluded.total_score),
    n300        = COALESCE(n300, excluded.n300),
    n100        = COALESCE(n100, excluded.n100),
    n50         = COALESCE(n50, excluded.n50),
    nmiss       = COALESCE(nmiss, excluded.nmiss),
    played_at   = COALESCE(played_at, excluded.played_at),
    last_seen   = excluded.last_seen,
    seen_count  = seen_count + excluded.seen_count,
    sweep_count = sweep_count + excluded.sweep_count
  RETURNING seen_count + sweep_count AS vezes
`));

const upsertJogador = () => (_upsertJogador ??= db.prepare(`
  INSERT INTO scores.score_players (server, user_id, username, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (server, user_id) DO UPDATE SET
    username   = COALESCE(excluded.username, username),
    updated_at = excluded.updated_at
`));

/**
 * Grava um lote numa transação só.
 *
 * @param {Array<object>} linhas no formato das colunas (ver scoreStore.linhaDe)
 * @param {object}  [opts]
 * @param {boolean} [opts.varredura] conta em `sweep_count`, e não em `seen_count`
 * @param {Array<{server, userId, username}>} [opts.jogadores] nicks conhecidos
 * @returns {{novos: number, existentes: number, novosPorServidor: Map<string, number>}}
 */
function gravarScores(linhas, { varredura = false, jogadores = [], agora = Date.now() } = {}) {
  let novos = 0;
  let existentes = 0;
  const novosPorServidor = new Map();

  db.exec('BEGIN');
  try {
    const stmt = upsert();
    for (const l of linhas) {
      const { vezes } = stmt.get(
        l.server, l.score_id, l.user_id, l.ruleset, l.map_id, l.map_md5, l.mods, l.mods_bits,
        l.pp, l.accuracy, l.max_combo, l.total_score, l.n300, l.n100, l.n50, l.nmiss, l.rank,
        l.played_at, agora, agora, varredura ? 0 : 1, varredura ? 1 : 0,
      );
      // Mais de uma vez contando as duas origens é linha que já existia — vale
      // também para o mesmo score repetido dentro do próprio lote.
      if (vezes > 1) {
        existentes++;
      } else {
        novos++;
        novosPorServidor.set(l.server, (novosPorServidor.get(l.server) ?? 0) + 1);
      }
    }

    const stmtJogador = upsertJogador();
    for (const j of jogadores) stmtJogador.run(j.server, j.userId, j.username ?? null, agora);

    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* a transação já caiu sozinha */ }
    throw error;
  }

  return { novos, existentes, novosPorServidor };
}

/** Linhas por servidor. Uma varredura do índice da chave — chamada uma vez por processo. */
function contarScoresPorServidor() {
  const contagem = new Map();
  for (const { server, n } of db.prepare('SELECT server, COUNT(*) AS n FROM scores.scores GROUP BY server').all()) {
    contagem.set(server, n);
  }
  return contagem;
}

/**
 * Apaga até `n` scores do servidor, os que menos servem a um ranking: sem pp
 * primeiro (o ASC do SQLite põe NULL na frente), depois o menor pp.
 *
 * @returns {number} quantos saíram
 */
function podarScoresDoServidor(server, n) {
  return db.prepare(`
    DELETE FROM scores.scores WHERE server = ? AND score_id IN (
      SELECT score_id FROM scores.scores WHERE server = ? ORDER BY pp ASC LIMIT ?
    )
  `).run(server, server, n).changes;
}

/**
 * Tudo o que se sabe de um jogador naquele servidor, e o nick dele.
 *
 * Existe para atender pedido de remoção (ver docs/PRIVACY.md). Não há comando:
 * quem mantém o bot roda à mão. O jogador volta a ser gravado se for consultado
 * de novo — os dados são públicos, e é o comando de alguém que os traz.
 *
 * @returns {number} scores apagados
 */
function esquecerJogador(server, userId) {
  db.exec('BEGIN');
  try {
    const apagados = db.prepare('DELETE FROM scores.scores WHERE server = ? AND user_id = ?')
      .run(server, userId).changes;
    db.prepare('DELETE FROM scores.score_players WHERE server = ? AND user_id = ?').run(server, userId);
    db.exec('COMMIT');
    return apagados;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* já caiu */ }
    throw error;
  }
}

// ─── Consulta ─────────────────────────────────────────────────────────────────
// O nick vem pelo LEFT JOIN: score sem nick conhecido sai com `username` nulo.

const COM_NICK = `
  SELECT s.*, p.username FROM scores.scores s
  LEFT JOIN scores.score_players p ON p.server = s.server AND p.user_id = s.user_id
`;

/** Os scores de maior pp daquele servidor. */
function topScoresGuardados(server, { limit = 50 } = {}) {
  return db.prepare(`${COM_NICK} WHERE s.server = ? AND s.pp IS NOT NULL ORDER BY s.pp DESC LIMIT ?`)
    .all(server, limit);
}

/** Os scores de um jogador, do maior pp para o menor. */
function scoresGuardadosDoJogador(server, userId, { limit = 100 } = {}) {
  return db.prepare(`${COM_NICK} WHERE s.server = ? AND s.user_id = ? ORDER BY s.pp DESC LIMIT ?`)
    .all(server, userId, limit);
}

/** Os scores de um mapa, por id ou por md5 (a varredura do bancho.py só tem o md5). */
function scoresGuardadosDoMapa(server, { mapId = null, md5 = null } = {}, { limit = 50 } = {}) {
  if (mapId === null && md5 === null) return [];
  const [coluna, valor] = mapId !== null ? ['map_id', mapId] : ['map_md5', md5];
  return db.prepare(`${COM_NICK} WHERE s.server = ? AND s.${coluna} = ? ORDER BY s.pp DESC LIMIT ?`)
    .all(server, valor, limit);
}

let _idPorNick = null;

/**
 * O id que aquele nick tinha da última vez que o bot o viu naquele servidor.
 *
 * É um PALPITE: o nick pode ter trocado de dono depois disso, e quem usa tem
 * de conferir o perfil que voltar (ver fetchPlayer em userLink.js). Com nick
 * repetido — sobra de troca de nick que ainda não passou de novo por aqui —,
 * vale o visto mais recentemente.
 *
 * @returns {number|null}
 */
function idPorNick(server, username) {
  if (!_disponivel || !username) return null;
  _idPorNick ??= db.prepare(`
    SELECT user_id FROM scores.score_players
    WHERE server = ? AND username = ? COLLATE NOCASE
    ORDER BY updated_at DESC LIMIT 1
  `);
  return _idPorNick.get(server, String(username))?.user_id ?? null;
}

/**
 * Tamanho e ritmo do que está guardado. É daqui que sai o número de jogadores
 * distintos por dia — as métricas em memória não têm como dar (ver CHANGELOG).
 *
 * Varre a tabela — 258ms com 300 mil linhas, com o event loop parado. É para
 * diagnóstico sob demanda, rodado à mão, e nunca para caminho de comando.
 */
function estatisticasScores({ agora = Date.now() } = {}) {
  const desde = agora - 24 * 60 * 60 * 1000;
  const geral = db.prepare(`
    SELECT COUNT(*) AS total,
           COUNT(DISTINCT server || ':' || user_id) AS jogadores,
           SUM(first_seen >= ?) AS novos24h
    FROM scores.scores
  `).get(desde);
  const ativos = db.prepare(`
    SELECT COUNT(DISTINCT server || ':' || user_id) AS n FROM scores.scores WHERE last_seen >= ?
  `).get(desde).n;

  return {
    total:           geral.total,
    jogadores:       geral.jogadores,
    novos24h:        geral.novos24h ?? 0,
    jogadores24h:    ativos,
    porServidor:     Object.fromEntries(contarScoresPorServidor()),
  };
}

module.exports = {
  definirScoresDisponivel, scoresDisponivel,
  gravarScores, contarScoresPorServidor, podarScoresDoServidor, esquecerJogador,
  topScoresGuardados, scoresGuardadosDoJogador, scoresGuardadosDoMapa, estatisticasScores,
  idPorNick,
};
