/**
 * hits.js
 * Os quatro acertos de uma play, venha ela de onde vier.
 *
 * A normalização deixa dois formatos: `count_300`/`count_miss` (osu! stable,
 * servidores privados) e `great`/`miss` (lazer). Zero onde falta — quem usa
 * isto faz conta, e `null` viraria NaN no meio dela. (O scorePP.js e o pp/ leem
 * os mesmos campos com `null` de propósito: lá "não sei" muda o cálculo.)
 */

function hitCounts(play) {
  const h = play?.statistics ?? {};
  return {
    n300: h.count_300 ?? h.great ?? 0,
    n100: h.count_100 ?? h.ok    ?? 0,
    n50:  h.count_50  ?? h.meh   ?? 0,
    nmiss: h.count_miss ?? h.miss ?? 0,
  };
}

module.exports = { hitCounts };
