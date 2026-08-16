/**
 * daycoreEvents.js
 * Escuta o que o servidor de jogo publica por conta própria.
 *
 * ── Por que existe ────────────────────────────────────────────────────────────
 * O bancho publica em `ex:map_status_change` toda vez que alguém muda o status
 * de um mapa **pelo jogo** (`!map rank/unrank/love`). Ninguém assinava esse
 * canal, então o evento existia e se perdia — mapas rankeados in-game não
 * apareciam em lugar nenhum do Discord, só os que passavam pelo `/nominate`.
 *
 * As duas fontes não se cruzam: o caminho do bot publica no canal `rank`, que o
 * bancho consome, e o `change_bm_status` que atende esse canal **não** publica
 * o `ex:map_status_change`. Então assinar aqui não duplica o que o
 * `/nominate` já anuncia — completa.
 *
 * ── Conexão separada ──────────────────────────────────────────────────────────
 * Um client em modo subscribe não aceita outros comandos, então esta assinatura
 * NÃO pode dividir a conexão que o daycoreAdmin usa para publicar. É um client
 * próprio, e é por isso que este módulo não vive lá dentro.
 *
 * ── Nunca derruba o bot ───────────────────────────────────────────────────────
 * Isto é um extra: sem Redis, ou com o canal mudo, o bot inteiro segue
 * funcionando e só deixa de anunciar o que foi feito in-game. Toda falha vira
 * log — inclusive a reconexão, que o client tenta sozinho.
 */

require('dotenv').config({ quiet: true });
const { createClient } = require('redis');

const { logError } = require('./logger');

const CHANNEL = 'ex:map_status_change';

/**
 * Só `rank` e `love` viram anúncio.
 *
 * `unrank` fica de fora por decisão de produto: desqualificar é rotina de
 * curadoria e encheria o canal sem informar ninguém — quem acompanha quer saber
 * o que ENTROU, não o que saiu. O evento continua chegando; é aqui que ele para.
 */
const ANNOUNCED_TYPES = new Set(['rank', 'love']);

// Mesmo mapeamento do `status_to_id` do bancho (app/commands.py).
const STATUS_BY_TYPE = { rank: 2, love: 5, unrank: 0 };

let _client = null;

function isConfigured() {
  return Boolean(process.env.REDIS_HOST);
}

/**
 * Traduz a mensagem crua do canal para o que o anúncio precisa.
 *
 * O payload do bancho é `{ map_ids, ranktype, type }`, e `author_id`/
 * `author_name` só existem se o fork tiver a alteração que os inclui — por isso
 * são opcionais aqui. Sem eles o anúncio sai sem "aplicado por", em vez de sair
 * errado ou não sair.
 *
 * @returns {{mapIds: number[], status: number, type: string, scope: string,
 *            authorId: number|null, authorName: string|null} | null}
 */
function parseEvent(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const type = String(data?.type ?? '');
  if (!ANNOUNCED_TYPES.has(type)) return null;

  // Inteiro POSITIVO, e não só "finito": `Number(null)` é 0, que passaria no
  // isFinite e viraria uma consulta a um mapa que não existe.
  const mapIds = (Array.isArray(data?.map_ids) ? data.map_ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0);
  if (mapIds.length === 0) return null;

  // Mesma exigência dos `map_ids` logo acima, e pelo mesmo motivo: `Number(null)`
  // é 0, e `Number.isFinite(0)` é verdadeiro. O campo é OPCIONAL — o fork que
  // não o preenche manda `author_id: null` —, então este é o caso comum, não a
  // borda: quem lesse o resultado receberia o jogador 0 no lugar de "não sei".
  const authorId = Number(data?.author_id);

  return {
    mapIds,
    status: STATUS_BY_TYPE[type],
    type,
    scope: String(data?.ranktype ?? 'map'),
    authorId: Number.isInteger(authorId) && authorId > 0 ? authorId : null,
    authorName: data?.author_name ? String(data.author_name) : null,
  };
}

/**
 * Começa a escutar. Idempotente: chamar de novo não abre uma segunda conexão.
 *
 * @param {(evento: object) => Promise<void>|void} onStatusChange
 * @returns {Promise<boolean>} se a assinatura ficou de pé
 */
async function listen(onStatusChange) {
  if (!isConfigured() || _client) return Boolean(_client);

  try {
    const client = createClient({
      socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        connectTimeout: 5000,
        // Ao contrário do publisher, aqui a reconexão infinita é o que se quer:
        // é uma assinatura de vida longa, e desistir dela deixaria o bot mudo
        // para sempre sem ninguém perceber. O teto evita rajada de tentativas.
        reconnectStrategy: (retries) => Math.min(retries * 500, 30000),
      },
      username: process.env.REDIS_USER || undefined,
      password: process.env.REDIS_PASS || undefined,
      database: Number(process.env.REDIS_DB || 0),
    });

    client.on('error', (err) => logError('daycoreEvents:redis', err));

    await client.connect();
    await client.subscribe(CHANNEL, (message) => {
      const evento = parseEvent(message);
      if (!evento) return;

      // O handler é assíncrono e ninguém o aguarda: uma falha ao anunciar não
      // pode derrubar o listener e calar todos os eventos seguintes.
      Promise.resolve(onStatusChange(evento)).catch(err => logError('daycoreEvents:handler', err));
    });

    _client = client;
    console.log(`[eventos] Escutando "${CHANNEL}" para mapas rankeados no jogo.`);
    return true;
  } catch (error) {
    logError('daycoreEvents:listen', error);
    return false;
  }
}

async function close() {
  if (_client?.isOpen) await _client.quit().catch(() => {});
  _client = null;
}

module.exports = { listen, close, parseEvent, isConfigured, CHANNEL, ANNOUNCED_TYPES };
