/**
 * embedLayout.js
 * Quais pedaços do embed do /recent aparecem — a escolha que o /builder grava.
 *
 * O conjunto de chaves é FECHADO: é ele que o banco valida ao ler (ver
 * db/users.js), que o embed consulta ao montar (ver embeds/play.js) e que o
 * /builder oferece no menu. Título do mapa, grade e mods não estão aqui de
 * propósito: são o que identifica a play, e um embed sem eles não diz de que
 * play se trata.
 *
 * ── O formato guardado ────────────────────────────────────────────────────────
 * Lista JSON das chaves LIGADAS, na ordem de `CHAVES` (`["pp","combo"]`). NULL
 * é o padrão — tudo ligado, o embed de sempre. `[]` é uma escolha legítima
 * (tudo desligado) e por isso não pode ser confundido com o padrão: uma string
 * vazia ou com vírgulas não distinguiria "nada" de "nunca escolheu".
 *
 * Lista e não bitmask porque o número depende da POSIÇÃO de cada chave: uma
 * chave nova no meio da lista trocaria o significado de todo layout já gravado,
 * sem erro nenhum na leitura.
 *
 * Ao ler, qualquer coisa fora do formato (JSON quebrado, algo que não é lista,
 * chave que este código não conhece) vale como o padrão, sem lançar: o /recent
 * de quem tem um valor estragado continua respondendo, com o embed completo.
 */

/** As chaves, na ordem em que os pedaços aparecem no embed. */
const CHAVES = Object.freeze([
  'pb',         // **Top #N pessoal**
  'score',      // score total
  'accuracy',   // 81.48%
  'time',       // há 2 horas
  'pp',         // **121.21**/457.95pp
  'combo',      // 55x/284x
  'misses',     // ❌ 23
  'hits',       // { 148 / 18 / 0 / 23 }
  'map',        // `02:00` • `CS 4 AR 9.4 OD 9.6 HP 5` • `128 BPM`
  'thumbnail',  // a capa do mapa
]);

const VALIDAS = new Set(CHAVES);

/**
 * Se o pedaço aparece. `layout` null é o padrão: tudo ligado.
 *
 * @param {Set<string>|null} layout
 * @param {string} chave
 */
const liga = (layout, chave) => layout === null || layout === undefined || layout.has(chave);

/**
 * O valor do banco como conjunto de chaves ligadas, ou null (o padrão).
 *
 * @param {string|null} bruto
 * @returns {Set<string>|null}
 */
function parse(bruto) {
  if (typeof bruto !== 'string') return null;

  let lista;
  try {
    lista = JSON.parse(bruto);
  } catch {
    return null;
  }

  if (!Array.isArray(lista)) return null;
  if (!lista.every(chave => typeof chave === 'string' && VALIDAS.has(chave))) return null;

  return new Set(lista);
}

/** Se o conjunto liga exatamente o que o padrão liga. */
const ehPadrao = (layout) => layout === null || (layout.size === CHAVES.length && CHAVES.every(c => layout.has(c)));

/**
 * O conjunto como vai para o banco, ou null para o padrão.
 *
 * Escolher tudo ligado grava NULL, e não a lista completa: é o mesmo embed, e
 * NULL continua valendo "o padrão" quando uma chave nova (que nasce ligada)
 * entrar — a lista completa de hoje deixaria a chave nova de fora.
 *
 * Chave fora do conjunto LANÇA aqui, ao contrário do parse: na gravação ela é
 * defeito de quem chamou, e gravá-la faria o layout inteiro valer como padrão
 * na próxima leitura.
 *
 * @param {Iterable<string>|null} chaves
 * @returns {string|null}
 */
function serialize(chaves) {
  if (chaves === null || chaves === undefined) return null;

  const conjunto = new Set(chaves);
  for (const chave of conjunto) {
    if (!VALIDAS.has(chave)) throw new Error(`embedLayout: chave desconhecida "${chave}"`);
  }
  if (ehPadrao(conjunto)) return null;

  return JSON.stringify(CHAVES.filter(c => conjunto.has(c)));
}

module.exports = { CHAVES, liga, parse, serialize, ehPadrao };
