/**
 * staffGuard.js
 * Porta de entrada dos comandos administrativos do Daycore.
 *
 * Os comandos normais do bot (/pp, /profile...) são calculadora: rodam em
 * qualquer servidor onde o bot esteja instalado, para qualquer pessoa. Os
 * administrativos não — eles mudam o Daycore de verdade, então precisam de
 * duas travas que os outros não têm:
 *
 *   1. ESCOPO — só funcionam no Discord do Daycore. Sem isso, como o bot é
 *      instalável por qualquer um (GuildInstall/UserInstall), bastaria alguém
 *      adicioná-lo ao próprio servidor para tentar usá-los.
 *
 *   2. IDENTIDADE — qual conta do Daycore é a pessoa. Vem de `staff_links`,
 *      preenchida só por quem tem Administrator no Discord do Daycore.
 *
 *      NÃO usa o /link comum: aquele é auto-declarado (só confere que a conta
 *      existe, não que você é dono dela). Usá-lo aqui deixaria qualquer um
 *      linkar o nick de um admin e herdar os poderes dele — inclusive
 *      assinando o log de auditoria do Daycore com o nome do admim real.
 *
 *   3. AUTORIDADE — o que a pessoa pode fazer vem do `priv` daquela conta,
 *      lido do Daycore a cada comando. Assim, tirar o cargo de alguém no
 *      servidor revoga o acesso pelo bot na hora, sem precisar mexer no bot.
 *
 * Todas falham FECHADO: faltando configuração ou vínculo, o comando é recusado.
 */

const { getStaffLink } = require('./db');
const daycore = require('./daycoreAdmin');

/**
 * Resolve quem está rodando o comando e confirma que pode.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} requiredPriv Bit de Privileges exigido
 * @param {object} s Strings de i18n já resolvidas
 * @returns {Promise<{osuId: number, osuName: string, priv: number} | {error: string}>}
 */
async function resolveStaff(interaction, requiredPriv, s) {
  const guildId = process.env.DAYCORE_GUILD_ID;

  if (!guildId) return { error: s.admin_not_configured };
  if (interaction.guildId !== guildId) return { error: s.admin_wrong_guild };

  // Vínculo verificado, registrado por um administrador do Discord do Daycore.
  // Guarda sempre o ID numérico, então não há resolução por nome aqui — nome
  // muda, ID não, e resolver por nome reabriria espaço para confusão de conta.
  const link = getStaffLink(interaction.user.id);
  if (!link) return { error: s.admin_not_staff };

  let player;
  try {
    player = await daycore.getPlayerPrivileges(link.osu_id);
  } catch {
    return { error: s.admin_priv_fetch_failed };
  }
  // O vínculo aponta para uma conta que o Daycore não reconhece mais (renomeada,
  // apagada). Recusa em vez de seguir sem saber o priv — falhar fechado.
  if (!player) return { error: s.admin_priv_fetch_failed };

  if (!daycore.hasPriv(player.priv, requiredPriv)) {
    return { error: s.admin_missing_priv(daycore.privLabel(player.priv)) };
  }

  return { osuId: player.id, osuName: player.name, priv: player.priv };
}

/**
 * Confirma que dá para falar com o Redis antes de prometer qualquer ação.
 * Sem isso o comando publicaria no vazio e reportaria sucesso.
 * @returns {Promise<string|null>} mensagem de erro, ou null se estiver tudo certo
 */
async function checkRedisOrError(s) {
  const check = await daycore.checkConnection();
  if (check.ok) return null;
  return check.reason === 'unconfigured'
    ? s.admin_redis_unconfigured
    : s.admin_redis_unreachable(check.error ?? '');
}

module.exports = { resolveStaff, checkRedisOrError };
