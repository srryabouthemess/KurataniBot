/**
 * cooldowns.js
 * Cooldown por usuário, no modelo de tickets do BathBot.
 *
 * Sem isso, um único usuário podia spammar /topplays indefinidamente — e cada
 * execução custa uma dezena de requisições à API do osu!. O rate limiter global
 * (rateLimiter.js) impede que isso estoure o limite da API, mas não impede que
 * uma pessoa monopolize a fila e deixe todo mundo esperando.
 *
 * Duas dimensões por bucket:
 *   - delay:    segundos mínimos entre dois usos seguidos
 *   - limit/span: no máximo `limit` usos dentro de uma janela de `span` segundos
 */

// Guarda o estado por usuário. Comandos pesados ganham buckets próprios.
const BUCKETS = {
  // padrão para comandos simples (1 ou 2 requisições)
  default: { delay: 1, span: 10, limit: 6 },
  // comandos que enriquecem várias plays (topplays, recent, compare)
  heavy:   { delay: 2, span: 30, limit: 8 },
  // cálculo de PP local + download de mapa
  compute: { delay: 2, span: 20, limit: 5 },
};

/** Qual bucket cada comando usa. Ausente = 'default'. */
const COMMAND_BUCKET = {
  topplays: 'heavy',
  recent:   'heavy',
  compare:  'heavy',
  simulate: 'compute',
  whatif:   'compute',
  pp:       'compute',
};

// Map<bucketName, Map<userId, { lastUse, windowStart, tickets }>>
const state = new Map(Object.keys(BUCKETS).map(name => [name, new Map()]));

/**
 * Consome um ticket. Retorna 0 se pode executar, ou os segundos restantes
 * de espera se estiver em cooldown.
 *
 * @param {string} userId
 * @param {string} commandName
 * @returns {number} segundos de espera (0 = liberado)
 */
function check(userId, commandName) {
  const bucketName = COMMAND_BUCKET[commandName] ?? 'default';
  const { delay, span, limit } = BUCKETS[bucketName];
  const users = state.get(bucketName);

  const now  = Math.floor(Date.now() / 1000);
  const user = users.get(userId) ?? { lastUse: 0, windowStart: now, tickets: 0 };

  // Janela expirada: zera a contagem
  if (now >= user.windowStart + span) {
    user.windowStart = now;
    user.tickets     = 0;
  }

  // Estourou o limite da janela?
  if (user.tickets + 1 > limit) {
    users.set(userId, user);
    return (user.windowStart + span) - now;
  }

  // Usou rápido demais depois do anterior?
  if (now < user.lastUse + delay) {
    users.set(userId, user);
    return (user.lastUse + delay) - now;
  }

  user.tickets += 1;
  user.lastUse  = now;
  users.set(userId, user);
  return 0;
}

/**
 * Remove usuários inativos para o Map não crescer sem limite num bot que
 * fica semanas no ar.
 */
function prune() {
  const now = Math.floor(Date.now() / 1000);
  for (const [bucketName, users] of state) {
    const { span } = BUCKETS[bucketName];
    for (const [userId, user] of users) {
      // Descarta quem não usa há mais de 10 janelas
      if (now > user.lastUse + span * 10) users.delete(userId);
    }
  }
}

// A cada 10 min. unref() para o timer não segurar o processo vivo no shutdown.
const pruneTimer = setInterval(prune, 10 * 60 * 1000);
pruneTimer.unref();

module.exports = { check, prune };
