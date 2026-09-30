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
const { logErrorOnce } = require('./lib/logger');

/**
 * O par VN/RX do mesmo namespace que uma chave pertence.
 *
 * @param {string} key chave já resolvida (o que `resolvePlayer` devolveu)
 * @returns {{vn: string, rx: string|null, resolvedIsRx: boolean}}
 */
function pairFor(key) {
  const resolved = servers.resolveKey(key) ?? String(key ?? '');
  const root = servers.rootKey(resolved);

  return {
    vn: servers.has(root) ? root : null,
    rx: servers.relaxKey(root),
    resolvedIsRx: resolved.endsWith('_rx'),
  };
}

/**
 * Quais chaves buscar, dado o par do servidor e a opção `modo:` do comando.
 *
 * Sem par, `modo:` não tem o que filtrar — busca só a chave que existe. Com
 * par e sem `modo:` explícito, busca só a chave que `server:` resolveu (raiz
 * vira VN, `_rx` continua RX) — igual ao `/recent` de sempre. Combinar os
 * dois exige pedir explicitamente com `modo: both`; virou opção, não default,
 * porque um default silencioso mesclando as duas listas surpreendia quem só
 * queria a lista de sempre.
 *
 * @param {{vn: string, rx: string|null, resolvedIsRx: boolean}} pair
 * @param {'vn'|'rx'|'both'|null} modoOption
 * @returns {string[]}
 */
function keysToFetch(pair, modoOption) {
  if (!pair.rx) return [pair.vn];
  if (modoOption === 'vn') return [pair.vn];
  if (modoOption === 'rx') return [pair.rx];
  if (modoOption === 'both') return [pair.vn, pair.rx];
  return pair.resolvedIsRx ? [pair.rx] : [pair.vn];
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

/**
 * O mapa de uma play CRUA, como string (id em número ou texto é o mesmo mapa).
 *
 * A lista do /recent só é enriquecida página a página, então aqui a play ainda
 * vem no formato do servidor: normalizada com `beatmap.id` (oficial, Ripple,
 * Gatari) ou no formato enxuto do bancho.py (o que o `nativeScore` deixa), com
 * `map_id` solto. O `map_md5` é da Shiina-Web, de quando as plays do Daycore
 * vinham dela, e fica como último recurso — custa um `??`.
 */
function mapaDaPlay(play) {
  const id = play?.beatmap?.id ?? play?.map_id ?? play?.map_md5;
  return id === undefined || id === null ? null : String(id);
}

/**
 * Em que tentativa daquele mapa a play está — o "Try #N" do rodapé do /rs.
 *
 * São as plays SEGUIDAS no mesmo mapa, da exibida para trás no tempo (a lista
 * vem da mais recente para a mais antiga). Voltar ao mapa depois de jogar outro
 * recomeça a conta, e VN e RX contam separado: são leaderboards diferentes.
 *
 * A lista só tem as últimas `limit` plays. Quando a sequência encosta no fim de
 * uma lista cheia, o número real pode ser maior — `partial` avisa isso.
 *
 * @returns {{count: number, partial: boolean}|null} null sem mapa para contar
 */
function triesAt(list, index, limit) {
  const alvo = list[index];
  const mapa = mapaDaPlay(alvo);
  if (mapa === null) return null;

  const mesmoMapa = play => mapaDaPlay(play) === mapa && play._mode === alvo._mode;

  let fim = index;
  while (fim < list.length && mesmoMapa(list[fim])) fim++;

  return { count: fim - index, partial: fim === list.length && list.length >= limit };
}

/**
 * Identidade de um score cru, como string (ou null quando não há).
 *
 * bancho.py, Ripple e Gatari usam `score_id`; a API oficial usa `id`, que
 * sobrevive ao normalizeScore por causa do `...raw` (ver officialApi.js). Em
 * string porque o mesmo id chega em número de um endpoint e em texto de outro.
 */
function scoreIdOf(score) {
  const id = score?.score_id ?? score?.id;
  return id === undefined || id === null || id === '' ? null : String(id);
}

/**
 * O top de cada chave, para o "PB #N" do /recent. NUNCA rejeita.
 *
 * O top é enfeite: sem ele o /recent responde como sempre respondeu, sem a
 * marca. Então a falha de uma chave (ou de todas) vira "sem top daquela chave",
 * e vai para o log uma vez por causa — do contrário "top fora do ar" e "play
 * fora do top" ficariam indistinguíveis, como no `fetchEach`.
 *
 * @param {string[]} keys
 * @param {(mode: string) => Promise<object[]>} fetchOne
 * @returns {Promise<Map<string, object[]>>} só as chaves que responderam
 */
async function fetchTops(keys, fetchOne) {
  // O `async` embrulha um throw síncrono de `fetchOne` numa rejeição, que o
  // allSettled segura — senão ele escaparia pelo `map` e derrubaria o comando.
  const settled = await Promise.allSettled(keys.map(async key => fetchOne(key)));

  const tops = new Map();
  settled.forEach((result, i) => {
    if (result.status === 'rejected') logErrorOnce(`recentMerge:top:${keys[i]}`, result.reason);
    else if (Array.isArray(result.value)) tops.set(keys[i], result.value);
  });
  return tops;
}

/**
 * Em que posição do top do jogador a play está — o "PB #N" do /recent —, ou
 * null quando ela não está lá (ou não dá para afirmar que está).
 *
 * Casa pelo ID do score, e só por ele. A lista de recentes e a de top vêm do
 * mesmo adaptador, então o id é o mesmo nas duas. Mapa + mods + pp parece
 * equivalente e não é: duas plays com os mesmos mods no mesmo mapa (a de agora
 * pior que a do top) casariam, e o embed diria "PB" numa play que não é. Sem id
 * de um dos lados, a marca some em vez de ser chutada.
 *
 * O top consultado é o da CHAVE da play (`_mode`): com `modo: both`, uma play
 * de RX é procurada no top de RX, nunca no de VN.
 *
 * @param {object} play score cru, com o `_mode` que o mergeRecent pôs
 * @param {Map<string, object[]>} tops o que o fetchTops devolveu
 * @returns {number|null} posição começando em 1
 */
function personalBestAt(play, tops) {
  const id  = scoreIdOf(play);
  const top = tops?.get(play?._mode);
  if (id === null || !Array.isArray(top)) return null;

  const i = top.findIndex(score => scoreIdOf(score) === id);
  return i === -1 ? null : i + 1;
}

module.exports = {
  pairFor, keysToFetch, mergeRecent, fetchEach, triesAt,
  scoreIdOf, fetchTops, personalBestAt,
};
