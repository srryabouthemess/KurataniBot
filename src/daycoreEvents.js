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
 * ── O segundo canal: cargo mexido dentro do jogo ──────────────────────────────
 * `ex:priv_change` é a mesma ideia para `!addpriv`/`!rmpriv`. Esses dois são o
 * ÚNICO caminho de cargo que não aparece em lugar nenhum: o `/role` do bot e o
 * admin panel publicam nos canais `addpriv`/`removepriv`, e quem atende esses
 * canais (`app/api/utils.py`) já manda um embed para o webhook de auditoria do
 * servidor. Os comandos in-game chamam `add_privs`/`remove_privs` direto — sem
 * receptor no meio, sem auditoria, sem nada.
 *
 * Por isso este canal cobre só o caminho in-game: assinar mais que isso
 * publicaria no Discord o que o webhook do servidor já publica.
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

const CHANNEL      = 'ex:map_status_change';
const PRIV_CHANNEL = 'ex:priv_change';

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

/** Os dois tipos que o `ex:priv_change` carrega, com o comando que os gera. */
const PRIV_TYPES = new Set(['addpriv', 'rmpriv']);

/**
 * Quantos nomes de cargo aceitar de uma vez, e que tamanho cada um pode ter.
 *
 * `!addpriv <nick> <cargo1 cargo2 ...>` aceita quantos argumentos quiserem
 * digitar, e o que chega aqui vai direto para um embed público. O bancho tem
 * onze cargos no `str_priv_dict`; o teto é folgado o bastante para caber todos
 * e apertado o bastante para um payload forjado não virar uma parede de texto.
 */
const PRIV_MAX_ITEMS  = 16;
const PRIV_MAX_LENGTH = 32;

/**
 * Traduz a mensagem crua do `ex:priv_change`.
 *
 * Os nomes de cargo vêm como o jogador digitou — o bancho valida contra o
 * `str_priv_dict` ANTES de aplicar, então tudo que chega aqui é nome válido,
 * mas em caixa qualquer. Normalizar para minúsculo aqui deixa o rótulo do
 * embed sair de uma tabela só, em vez de depender de como foi digitado.
 *
 * @returns {{type: string, targetId: number, targetName: string|null,
 *            privs: string[], authorId: number|null,
 *            authorName: string|null} | null}
 */
function parsePrivEvent(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  const type = String(data?.type ?? '');
  if (!PRIV_TYPES.has(type)) return null;

  // Mesmo cuidado dos `map_ids` do `parseEvent`: `Number(null)` é 0, e um alvo
  // 0 viraria um anúncio sobre um jogador que não existe.
  const targetId = Number(data?.target_id);
  if (!Number.isInteger(targetId) || targetId <= 0) return null;

  const privs = (Array.isArray(data?.privs) ? data.privs : [])
    .filter(p => typeof p === 'string')
    .map(p => p.trim().toLowerCase())
    .filter(p => p.length > 0 && p.length <= PRIV_MAX_LENGTH)
    // Duplicata é o caso comum, não o hostil: `!addpriv fulano mod mod` é o
    // dedo escorregando, e o bancho aplica sem reclamar.
    .filter((p, i, todos) => todos.indexOf(p) === i)
    .slice(0, PRIV_MAX_ITEMS);
  // Evento sem cargo nenhum não tem o que anunciar.
  if (privs.length === 0) return null;

  const authorId = Number(data?.author_id);

  return {
    type,
    targetId,
    targetName: data?.target_name ? String(data.target_name) : null,
    privs,
    authorId: Number.isInteger(authorId) && authorId > 0 ? authorId : null,
    authorName: data?.author_name ? String(data.author_name) : null,
  };
}

/**
 * Começa a escutar. Idempotente: chamar de novo não abre uma segunda conexão.
 *
 * Os dois canais dividem o MESMO client de propósito: um client em modo
 * subscribe não serve para mais nada mesmo, e duas conexões só dobrariam o que
 * pode cair sem ninguém perceber.
 *
 * @param {object} handlers
 * @param {(evento: object) => Promise<void>|void} handlers.onStatusChange mapa mexido in-game
 * @param {(evento: object) => Promise<void>|void} [handlers.onPrivChange]  cargo mexido in-game
 * @returns {Promise<boolean>} se a assinatura ficou de pé
 */
async function listen({ onStatusChange, onPrivChange } = {}) {
  if (!isConfigured() || _client) return Boolean(_client);
  // Sem handler nenhum não há o que escutar, e abrir a conexão assim deixaria
  // um client em modo subscribe pendurado sem assinatura nenhuma.
  if (!onStatusChange && !onPrivChange) return false;

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

    // O handler é assíncrono e ninguém o aguarda: uma falha ao anunciar não
    // pode derrubar o listener e calar todos os eventos seguintes.
    const despachar = (contexto, parse, handler) => (message) => {
      const evento = parse(message);
      if (!evento) return;
      Promise.resolve(handler(evento)).catch(err => logError(contexto, err));
    };

    if (onStatusChange) {
      await client.subscribe(CHANNEL, despachar('daycoreEvents:handler', parseEvent, onStatusChange));
      console.log(`[eventos] Escutando "${CHANNEL}" para mapas rankeados no jogo.`);
    }

    // Assinar o canal de cargo é independente: um fork sem a publicação do
    // `!addpriv` simplesmente nunca manda nada nele, e o resto segue igual.
    if (onPrivChange) {
      await client.subscribe(PRIV_CHANNEL, despachar('daycoreEvents:priv', parsePrivEvent, onPrivChange));
      console.log(`[eventos] Escutando "${PRIV_CHANNEL}" para cargos mexidos no jogo.`);
    }

    _client = client;
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

module.exports = {
  listen, close, isConfigured,
  parseEvent, CHANNEL, ANNOUNCED_TYPES,
  parsePrivEvent, PRIV_CHANNEL, PRIV_TYPES,
};
