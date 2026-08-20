/**
 * recentMerge.js
 * A lógica de juntar VN e RX no /recent e /rs — só ela, sem tocar em rede
 * nem em Discord, pra dar pra testar sem os dois.
 *
 * "Par" é a chave raiz de um servidor (ex: `daycore`) e a variante `_rx` dela
 * (ex: `daycore_rx`) — a mesma conta, dois leaderboards (ver servers.js). Um
 * servidor sem RX configurado (`RELAX` ausente no `.env`, ou o Bancho oficial)
 * não tem par: o `rx` do pairFor vem `null`, e tudo aqui se comporta como o
 * /recent de sempre, uma busca só.
 */

const servers = require('./servers');
const { dateOf } = require('./topFilter');
const { logErrorOnce } = require('./logger');

/**
 * O par VN/RX do mesmo namespace que uma chave pertence.
 *
 * @param {string} key chave já resolvida (o que `resolvePlayer` devolveu)
 * @returns {{vn: string, rx: string|null, resolvedIsRx: boolean}}
 */
function pairFor(key) {
  const resolved = servers.resolveKey(key) ?? String(key ?? '');
  const resolvedIsRx = resolved.endsWith('_rx');
  const root = resolvedIsRx ? resolved.slice(0, -3) : resolved;

  return {
    vn: servers.has(root) ? root : null,
    rx: servers.has(`${root}_rx`) ? `${root}_rx` : null,
    resolvedIsRx,
  };
}

/**
 * Quais chaves buscar, dado o par do servidor e a opção `modo:` do comando.
 *
 * Sem par, `modo:` não tem o que filtrar — busca só a chave que existe. Com
 * par e sem `modo:` explícito, o default depende de COMO o servidor foi
 * resolvido: pela raiz vira combinado (o comportamento novo), pelo `_rx`
 * continua só RX — quem já apontava pra lá (`server: daycore_rx`, ou
 * `/link default` configurado assim) não é surpreendido com uma lista
 * mesclada do nada.
 *
 * @param {{vn: string, rx: string|null, resolvedIsRx: boolean}} pair
 * @param {'vn'|'rx'|null} modoOption
 * @returns {string[]}
 */
function keysToFetch(pair, modoOption) {
  if (!pair.rx) return [pair.vn];
  if (modoOption === 'vn') return [pair.vn];
  if (modoOption === 'rx') return [pair.rx];
  return pair.resolvedIsRx ? [pair.rx] : [pair.vn, pair.rx];
}

/**
 * Junta scores de uma ou mais chaves, do mais recente pro mais antigo, cortado
 * no limite. Cada score ganha um `_mode` com a chave de onde veio — inclusive
 * quando só há uma chave, pra quem consome não precisar de um caso especial.
 *
 * A data lê as duas formas (ver `topFilter.dateOf`) porque o que chega aqui é
 * o resultado CRU de `osu.getRecentScores` — em bancho.py isso é `play_time`,
 * não `created_at`; a normalização só acontece depois, dentro do
 * `enrichScores` de cada página. Ler só `created_at` faria a comparação virar
 * `Invalid Date` para todo mundo, e um `.sort()` onde toda comparação dá `NaN`
 * não reordena nada — a "mesclagem" era só VN concatenado com RX. Score sem
 * data (nenhum dos dois campos) vai para o FIM, não para o topo, mesmo padrão
 * do `arrange()` do topFilter.
 *
 * @param {{mode: string, scores: object[]}[]} porModo
 * @param {number} limit
 * @returns {object[]}
 */
function mergeRecent(porModo, limit) {
  const marcados = porModo.flatMap(({ mode, scores }) =>
    scores.map(score => ({ ...score, _mode: mode })));

  const comData = [];
  const semData = [];
  for (const item of marcados) {
    if (dateOf(item) === null) semData.push(item);
    else comData.push(item);
  }
  comData.sort((a, b) => dateOf(b) - dateOf(a));

  return [...comData, ...semData].slice(0, limit);
}

/**
 * Busca cada chave em paralelo; uma rejeitar não derruba as outras — só
 * quando TODAS rejeitam é que a falha sobe (o primeiro erro, mesmo padrão de
 * `fetchPlayer` em userLink.js pra separar "sem esse jogador" de "erro de
 * rede").
 *
 * Uma falha parcial ainda vai pro log (uma vez por causa, ver
 * `logErrorOnce`) — sem isso, "RX fora do ar" e "esse jogador não tem play em
 * RX" ficam indistinguíveis: as duas devolvem a lista da outra chave, quieto.
 *
 * @param {string[]} keys
 * @param {(mode: string) => Promise<object[]>} fetchOne
 * @returns {Promise<{mode: string, scores: object[]}[]>}
 */
async function fetchEach(keys, fetchOne) {
  const settled = await Promise.allSettled(keys.map(fetchOne));

  settled.forEach((result, i) => {
    if (result.status === 'rejected') logErrorOnce(`recentMerge:${keys[i]}`, result.reason);
  });

  const ok = keys
    .map((mode, i) => ({ mode, result: settled[i] }))
    .filter(({ result }) => result.status === 'fulfilled')
    .map(({ mode, result }) => ({ mode, scores: result.value }));

  if (ok.length === 0) throw settled[0].reason;
  return ok;
}

module.exports = { pairFor, keysToFetch, mergeRecent, fetchEach };
