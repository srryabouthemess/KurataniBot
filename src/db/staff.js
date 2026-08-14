/**
 * db/staff.js
 * Vínculo entre uma conta do Discord e uma conta de staff do servidor de jogo,
 * e o desafio que prova a posse dela.
 *
 * Por que isto NÃO é `users.js`: aquele guarda o que a pessoa declarou sobre si
 * (o /link só confere que a conta existe, não que ela é sua). Aqui é a base de
 * permissão dos comandos administrativos, e a diferença entre "declarado" e
 * "provado" é justamente o que separa os dois arquivos. Ver o comentário da
 * tabela em schema.js.
 */

const { db } = require('./connection');

// ─── Vínculo ──────────────────────────────────────────────────────────────────

/**
 * @param {'self'|'vouch'|null} proof como a identidade foi estabelecida.
 *   Vínculos anteriores à prova existir têm NULL — ver schema.js.
 */
function setStaffLink(discordId, osuId, osuName, addedBy, proof = null) {
  db.prepare(`
    INSERT INTO staff_links (discord_id, osu_id, osu_name, added_by, added_at, proof)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      osu_id = excluded.osu_id, osu_name = excluded.osu_name,
      added_by = excluded.added_by, added_at = excluded.added_at,
      proof = excluded.proof
  `).run(discordId, osuId, osuName ?? null, addedBy, Date.now(), proof);
}

function getStaffLink(discordId) {
  return db.prepare('SELECT * FROM staff_links WHERE discord_id = ?').get(discordId) ?? null;
}

/**
 * Quem já está vinculado àquela conta de jogo.
 *
 * A PK da tabela é o `discord_id`, então nada no schema impede dois Discords
 * apontando para o mesmo `osu_id` — e isso já aconteceu em produção. Para
 * nomeação não era problema (a PK de map_nominations é por osu_id, então não
 * vira voto duplo), mas para moderação são duas identidades do Discord agindo
 * como a mesma pessoa no log do servidor de jogo.
 */
function getStaffLinkByOsuId(osuId) {
  return db.prepare('SELECT * FROM staff_links WHERE osu_id = ?').get(osuId) ?? null;
}

function removeStaffLink(discordId) {
  return db.prepare('DELETE FROM staff_links WHERE discord_id = ?').run(discordId).changes > 0;
}

function listStaffLinks() {
  return db.prepare('SELECT * FROM staff_links ORDER BY added_at ASC').all();
}

// ─── Desafio de posse de conta ────────────────────────────────────────────────

/**
 * Cria (ou substitui) o desafio pendente daquele Discord.
 *
 * Um por Discord: pedir um vínculo novo cancela o anterior, para não ficarem
 * dois códigos válidos ao mesmo tempo apontando para contas diferentes.
 */
function setStaffChallenge({ discordId, osuId, osuName, code, requestedBy, ttlMs }) {
  const agora = Date.now();
  db.prepare(`
    INSERT INTO staff_link_challenges
      (discord_id, osu_id, osu_name, code, requested_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      osu_id = excluded.osu_id, osu_name = excluded.osu_name,
      code = excluded.code, requested_by = excluded.requested_by,
      created_at = excluded.created_at, expires_at = excluded.expires_at
  `).run(discordId, osuId, osuName ?? null, code, requestedBy, agora, agora + ttlMs);
}

/** O desafio pendente, ou null se não existir ou já ter expirado. */
function getStaffChallenge(discordId) {
  const row = db.prepare('SELECT * FROM staff_link_challenges WHERE discord_id = ?').get(discordId);
  if (!row) return null;

  // Expirado é o mesmo que inexistente, e some na leitura: sem isso um código
  // velho ficaria no banco esperando alguém tentar usá-lo.
  if (row.expires_at <= Date.now()) {
    clearStaffChallenge(discordId);
    return null;
  }
  return row;
}

function clearStaffChallenge(discordId) {
  return db.prepare('DELETE FROM staff_link_challenges WHERE discord_id = ?').run(discordId).changes > 0;
}

module.exports = {
  setStaffLink, getStaffLink, getStaffLinkByOsuId, removeStaffLink, listStaffLinks,
  setStaffChallenge, getStaffChallenge, clearStaffChallenge,
};
