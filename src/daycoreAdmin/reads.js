/**
 * daycoreAdmin/reads.js
 * O lado de leitura que os comandos administrativos usam antes de agir: de
 * qual servidor se está falando, e quais privilégios o alvo tem lá.
 */

const osu = require('../osuClient');
const servers = require('../servers');

/**
 * Qual servidor as leituras administrativas consultam, para o log.
 *
 * As escritas vão para o Redis apontado pelo .env; as leituras vão para o
 * `PRIVATE_MODE` do osuClient, que sai do registro de servidores. São duas
 * configurações independentes que precisam falar do MESMO servidor, e quando
 * elas divergiram não havia como perceber pela mensagem de erro.
 */
function adminServerLabel() {
  return servers.label(osu.PRIVATE_MODE);
}

/**
 * Privilégios de um jogador no Daycore, lidos da API v2.
 * @returns {Promise<{id: number, name: string, priv: number} | null>}
 */
async function getPlayerPrivileges(osuId) {
  const player = await osu.getServerPlayerRaw(osuId);
  if (!player) return null;
  return { id: player.id, name: player.name, priv: Number(player.priv ?? 0) };
}

module.exports = {
  adminServerLabel,
  getPlayerPrivileges,
};
