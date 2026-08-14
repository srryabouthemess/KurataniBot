/**
 * rateLimiter.js
 * Leaky bucket por classe de recurso.
 *
 * Antes disso o único controle de vazão era o BEATMAP_BATCH_SIZE do
 * osuClient, que limita a concorrência *dentro de uma chamada* de
 * enrichBeatmapData. Dois usuários rodando /topplays ao mesmo tempo disparavam
 * duas rajadas independentes (mais os downloads de .osu, mais os atributos),
 * sem nada coordenando o total — o que estourava o rate limit da API e fazia
 * dados sumirem aleatoriamente dos embeds.
 *
 * Aqui toda requisição passa por um bucket antes de sair. Os limites são por
 * recurso, não globais, porque a API do osu! trata download de arquivo .osu de
 * forma bem mais restrita que um GET de metadados.
 *
 * As aquisições são serializadas por uma corrente de promises: sem isso vários
 * waiters acordariam do mesmo setTimeout e consumiriam o mesmo token.
 */

const metrics = require('./metrics');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class LeakyBucket {
  /** @param {number} perSecond requisições permitidas por segundo */
  constructor(name, perSecond) {
    this.name       = name;
    this.capacity   = perSecond;
    this.tokens     = perSecond;
    this.intervalMs = 1000 / perSecond;
    this.lastRefill = Date.now();
    this.chain      = Promise.resolve();
  }

  _refill() {
    const now    = Date.now();
    const gained = (now - this.lastRefill) / this.intervalMs;
    if (gained > 0) {
      this.tokens     = Math.min(this.capacity, this.tokens + gained);
      this.lastRefill = now;
    }
  }

  async _acquireOne() {
    this._refill();
    if (this.tokens < 1) {
      const espera = Math.ceil((1 - this.tokens) * this.intervalMs);
      // O tempo parado na fila é o número que diz se um balde está apertado
      // demais — sem ele, "o bot está lento" não distingue API lenta de limite
      // nosso mal calibrado.
      metrics.count(`limiter.${this.name}.waitMs`, espera);
      await sleep(espera);
      this._refill();
    }
    this.tokens -= 1;
    metrics.count(`limiter.${this.name}.calls`);
  }

  /** Resolve quando for permitido fazer a requisição. */
  acquire() {
    const next = this.chain.then(() => this._acquireOne());
    // A corrente nunca deve quebrar por causa de um erro de um waiter.
    this.chain = next.catch(() => {});
    return next;
  }
}

/**
 * Limites por recurso (requisições por segundo).
 *
 * `osuMapFile` continua sendo o mais apertado: são arquivos de ~50KB, e o
 * endpoint de download é mais sensível que os de metadados. Mas o 2 original
 * foi cautela sem medição, e ele estava no caminho crítico do que a pessoa
 * sente: uma página de /topplays com 5 mapas inéditos gastava ~2,5s só na fila
 * de download, antes de qualquer cálculo. A 4/s isso cai para ~1,2s, e ainda
 * fica na metade do balde de metadados.
 *
 * Se algum dia aparecer 429 nos downloads, este é o primeiro número a baixar.
 */
const BUCKETS = {
  osuApi:     8,  // GET/POST em osu.ppy.sh/api/v2
  osuMapFile: 4,  // download de .osu em osu.ppy.sh/osu/{id}
  osuOAuth:   1,  // /oauth/token
};

// Servidores privados usam `server:<chave>`, criado sob demanda: são hosts
// diferentes, com limites independentes — um servidor lento não tem por que
// segurar a fila do outro.
const PER_SERVER = 5;

const buckets = Object.fromEntries(
  Object.entries(BUCKETS).map(([name, perSecond]) => [name, new LeakyBucket(name, perSecond)])
);

/**
 * Espera até que seja permitido fazer uma requisição ao recurso indicado.
 * @param {keyof typeof BUCKETS | `server:${string}`} site
 */
function acquire(site) {
  let bucket = buckets[site];

  if (!bucket && String(site).startsWith('server:')) {
    bucket = buckets[site] = new LeakyBucket(site, PER_SERVER);
  }
  if (!bucket) throw new Error(`rateLimiter: bucket desconhecido "${site}"`);

  return bucket.acquire();
}

module.exports = { acquire, BUCKETS };
