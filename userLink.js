/**
 * userLink.js
 * Resolve "qual jogador usar" para os comandos.
 *
 * Prioridade:
 *   1. Nome manual passado no comando → usa ele
 *   2. Link salvo do usuário Discord → usa ele
 *   3. Nenhum → retorna null
 *
 * O servidor manual sempre sobrescreve o do link.
 */

const { getLink } = require('./db');
const osu = require('./osuClient');

function resolvePlayer(interaction, playerOptionName = 'player', serverOptionName = 'server') {
  const manualPlayer = interaction.options.getString(playerOptionName);
  const manualServer = interaction.options.getString(serverOptionName);

  if (manualPlayer) {
    return {
      username: manualPlayer,
      mode: manualServer || osu.DEFAULT_MODE,
      fromLink: false,
    };
  }

  const link = getLink(interaction.user.id);
  if (!link) return null;

  return {
    username: link.osu_user,
    mode: manualServer || link.server,
    fromLink: true,
  };
}

module.exports = { resolvePlayer };
