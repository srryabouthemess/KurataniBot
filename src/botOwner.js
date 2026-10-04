/**
 * botOwner.js
 * Quem é dono do bot, segundo a própria aplicação no Discord.
 *
 * O `setDefaultMemberPermissions(0)` só esconde um comando de quem não é
 * administrador DO SERVIDOR onde ele roda — e o bot é instalável por qualquer
 * um. Para o que é do operador do bot, e não de quem administra um servidor que
 * só o usa (o /diag mede o processo inteiro, com o uso de todos os servidores),
 * a pergunta certa é "é dono da aplicação?".
 *
 * A resposta vem do Discord (`client.application.fetch()`), e não do `.env`:
 * nada para configurar, e trocar o dono no Developer Portal vale aqui sem
 * redeploy. Aplicação de Team vale para todos os membros do time.
 *
 * Falha FECHADO: se o Discord não responder, ninguém é dono até a próxima
 * tentativa.
 */

const { logErrorOnce } = require('./lib/logger');

/**
 * Por quanto tempo a lista vale. Dono muda quase nunca; o TTL só existe para
 * uma troca no Developer Portal chegar aqui sem restart.
 */
const TTL_MS = 10 * 60_000;

let _cache = null; // { ids: Set<string>, ate: number }
let _emVoo = null;

/** IDs dos donos de uma aplicação já buscada: o usuário, ou os membros do Team. */
function idsDoDono(application) {
  const owner = application?.owner;
  if (!owner) return new Set();

  // Team tem `members` (Collection de TeamMember); usuário não.
  if (owner.members) {
    return new Set([...owner.members.values()].map(m => m.user?.id ?? m.id).filter(Boolean));
  }
  return owner.id ? new Set([owner.id]) : new Set();
}

async function donos(client) {
  if (_cache && Date.now() < _cache.ate) return _cache.ids;
  if (_emVoo) return _emVoo;

  _emVoo = (async () => {
    try {
      const application = await client.application.fetch();
      const ids = idsDoDono(application);
      // Lista vazia não vai para o cache: é resposta estranha, não "ninguém é
      // dono", e guardá-la travaria o dono de verdade por dez minutos.
      if (ids.size > 0) _cache = { ids, ate: Date.now() + TTL_MS };
      return ids;
    } catch (error) {
      logErrorOnce('botOwner', error);
      return new Set();
    } finally {
      _emVoo = null;
    }
  })();

  return _emVoo;
}

/**
 * A pessoa da interação é dona do bot?
 * @param {import('discord.js').BaseInteraction} interaction
 */
async function ehDono(interaction) {
  const id = interaction?.user?.id;
  if (!id || !interaction.client?.application) return false;
  return (await donos(interaction.client)).has(id);
}

/** Só para teste: o cache é de processo. */
function _reset() {
  _cache = null;
  _emVoo = null;
}

module.exports = { ehDono, idsDoDono, _reset };
