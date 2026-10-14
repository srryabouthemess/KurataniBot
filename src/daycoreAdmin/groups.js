/**
 * daycoreAdmin/groups.js
 * Os grupos do Shiina (`sh_groups`, `sh_groups_users`), lidos direto do MySQL.
 *
 * Só leitura, de propósito: quem grava é o bancho, ao receber o canal
 * `setgroup`, porque é ele que reposiciona o jogador nos sorted sets de
 * leaderboard. O usuário MySQL do bot precisa só de SELECT nessas duas tabelas
 * (ver o `.env.example`).
 *
 * Não dá para ler pelo `osu.getPlayerGroups`: ele raspa o HTML do perfil e
 * guarda 30 minutos em cache, e aqui a releitura depois de publicar precisa
 * enxergar a mudança na hora.
 */

// Pelo objeto do módulo, e não desestruturado: os testes trocam o getPool.
const mysql = require('../daycoreMysql');

function poolOrThrow() {
  const pool = mysql.getPool();
  if (!pool) throw new Error('MySQL do Daycore não configurado (defina DAYCORE_MYSQL_HOST no .env).');
  return pool;
}

/**
 * Todos os grupos existentes.
 * @returns {Promise<Array<{id: number, name: string, removesFromLeaderboard: boolean}>>}
 */
async function listGroups() {
  const [rows] = await poolOrThrow().query(
    'SELECT id, name, removes_from_leaderboard FROM sh_groups ORDER BY id',
  );
  return rows.map(r => ({
    id: Number(r.id),
    name: String(r.name),
    removesFromLeaderboard: Number(r.removes_from_leaderboard) === 1,
  }));
}

/**
 * Acha um grupo pelo nome, sem diferenciar maiúscula. Igualdade inteira: grupo
 * por prefixo daria o grupo errado a quem digitou pela metade.
 * @returns {Promise<{id: number, name: string, removesFromLeaderboard: boolean} | null>}
 */
async function findGroupByName(name) {
  const alvo = String(name).trim().toLowerCase();
  return (await listGroups()).find(g => g.name.toLowerCase() === alvo) ?? null;
}

/** Os ids dos grupos de um jogador. */
async function getUserGroupIds(osuId) {
  const [rows] = await poolOrThrow().query(
    'SELECT group_id FROM sh_groups_users WHERE user_id = ?',
    [Number(osuId)],
  );
  return rows.map(r => Number(r.group_id));
}

module.exports = {
  listGroups,
  findGroupByName,
  getUserGroupIds,
};
