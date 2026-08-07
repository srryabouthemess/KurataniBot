/**
 * userLink.js
 * Resolve "qual jogador e qual servidor usar" para os comandos.
 *
 * O usuário pode ter um link por conta (Bancho e Daycore são cadastros
 * distintos, com nicks potencialmente diferentes) e um servidor preferido,
 * usado quando o comando não especifica um.
 *
 * Prioridade do SERVIDOR:
 *   1. Opção `server` do comando
 *   2. Servidor preferido do usuário (definido pelo último /link set)
 *   3. DEFAULT_MODE
 *
 * Prioridade do JOGADOR:
 *   1. Nome passado na opção `player` do comando
 *   2. Link do usuário para o servidor resolvido acima
 *   3. Erro — o usuário não tem link para aquele servidor especificamente
 */

const { getLink, getPreferredServer } = require('./db');
const { t } = require('./i18n');
const osu = require('./osuClient');

/**
 * @returns {{username: string|number, displayName?: string, mode: string, fromLink: boolean}
 *           | {error: string}}
 *   Em caso de falha devolve `{ error }` com a mensagem já traduzida — assim
 *   os comandos não precisam decidir entre "sem link nenhum" e "sem link para
 *   este servidor", que exigem orientações diferentes.
 */
function resolvePlayer(interaction, playerOptionName = 'player', serverOptionName = 'server') {
  const manualPlayer = interaction.options.getString(playerOptionName);
  const manualServer = interaction.options.getString(serverOptionName);

  const mode = manualServer
    || getPreferredServer(interaction.user.id)
    || osu.DEFAULT_MODE;

  if (manualPlayer) {
    return { username: manualPlayer, displayName: manualPlayer, mode, fromLink: false };
  }

  const link = getLink(interaction.user.id, mode);
  if (!link) {
    const s = t(interaction);
    return { error: s.no_link_for_server(osu.getModeLabel(mode)) };
  }

  // Prefere o ID numérico quando disponível: sobrevive a troca de nick e, no
  // Daycore, evita a chamada extra de resolvePlayerId a cada comando.
  return {
    username: link.osu_id ?? link.osu_user,
    displayName: link.osu_user,
    mode,
    fromLink: true,
  };
}

module.exports = { resolvePlayer };
