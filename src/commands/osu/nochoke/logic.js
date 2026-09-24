/**
 * commands/osu/nochoke/logic.js
 * A conta do /nochoke: acurácia e grade de FC, e o top reordenado sem os chokes.
 * Pura — nada de Discord nem de rede.
 */

const { weightedPP } = require('../../../weightedPP');
const { hitCounts } = require('../../../hits');

// Acima disto a play não é mais "um choke" e sim outra corrida: o FC vira uma
// fantasia (rafs tinha play de 169 miss pagando 1048pp de FC contra 64 reais),
// e o top "sem choke" deixava de descrever o jogador. Fica no valor real.
const MISS_LIMIT     = 20;

/** Acurácia (0–100) a partir dos hits; e a que a play teria com os misses virando 300. */
function accPair(play) {
  const { n300, n100, n50, nmiss } = hitCounts(play);
  const objetos = n300 + n100 + n50 + nmiss;
  if (!objetos) {
    const bruto = Number(play?.accuracy) * 100;
    const val = Number.isFinite(bruto) ? bruto : 0;
    return { real: val, fc: val };
  }
  return {
    real: (300 * n300 + 100 * n100 + 50 * n50) / (3 * objetos),
    fc:   (300 * (n300 + nmiss) + 100 * n100 + 50 * n50) / (3 * objetos),
  };
}

/**
 * A grade que a play teria com FC: misses viram 300, sem quebra de combo.
 *
 * Regras do osu! std — razão de 300s sobre o total, com S/SS pratas (H) quando
 * há HD ou FL. Como no FC não há miss, os limiares de A/B/C colapsam nos de
 * "sem miss": A > 80% de 300, B > 70%, C > 60%.
 */
function fcGrade(play) {
  const { n300, n100, n50, nmiss } = hitCounts(play);
  const total = n300 + n100 + n50 + nmiss;
  if (!total) return play.rank;

  const g300 = n300 + nmiss;
  const r300 = g300 / total;
  const r50  = n50 / total;
  const mods = (play.mods ?? []).map(m => String(m).toUpperCase());
  const prata = mods.includes('HD') || mods.includes('FL');

  if (g300 === total)                 return prata ? 'XH' : 'X';
  if (r300 > 0.9 && r50 <= 0.01)      return prata ? 'SH' : 'S';
  if (r300 > 0.8)                     return 'A';
  if (r300 > 0.7)                     return 'B';
  if (r300 > 0.6)                     return 'C';
  return 'D';
}

/**
 * Reordena as top plays trocando cada choke pelo PP que ele teria com FC.
 *
 * Exportada para teste: é a única parte que faz conta, e ela precisa concordar
 * com o `/whatif` no truque do offset — o `weightedPP` só soma as 100
 * ponderadas, então o total do perfil (com bônus de playcount e a cauda) entra
 * de volta como um desvio calculado uma vez. O ganho não passa pelo offset
 * porque é uma diferença e ele se cancela; é o mesmo raciocínio do whatif.js.
 *
 * Cada entry leva o `origIndex` (posição 1-based na lista ANTES do sort, que é
 * a ordem de pp da API) — o embed mostra a posição de origem da play, não o
 * lugar dela na lista reordenada.
 *
 * Play com mais de `MISS_LIMIT` misses fica no pp real: acima disso o FC não é
 * mais "o mesmo jogador sem o choke".
 *
 * @param {{pp: number}[]} plays  top plays JÁ ORDENADAS por pp decrescente (como a API devolve)
 * @param {(number|null)[]} fcpps paralelo a `plays`: o PP de FC, ou null quando a play já é FC
 * @param {number} profilePP      `user.statistics.pp` — o total publicado no perfil
 * @returns {{entries: {play: object, pp: number, unchoked: boolean, origIndex: number}[],
 *            totalAntes: number, totalDepois: number, ganho: number, corrigidos: number}}
 */
function unchoke(plays, fcpps, profilePP) {
  const entries = plays.map((play, i) => {
    const fc = fcpps[i];
    const { nmiss } = hitCounts(play);
    // Só conta como choke desfeito quando o FC pagaria MAIS. Um FC que daria
    // menos (possível no Relax, onde o motor é outro) não é correção nenhuma.
    // E play acima do MISS_LIMIT fica de fora — o FC dela é fantasia.
    const unchoked = Number.isFinite(fc) && fc > play.pp && nmiss <= MISS_LIMIT;
    return { play, pp: unchoked ? fc : play.pp, unchoked, origIndex: i + 1 };
  });

  entries.sort((a, b) => b.pp - a.pp);

  const antes  = weightedPP(plays);           // `plays` já vem decrescente
  const depois = weightedPP(entries);         // reordenado acima
  const base   = Number.isFinite(profilePP) ? profilePP : antes;
  const offset = base - antes;

  return {
    entries,
    totalAntes:  base,
    totalDepois: depois + offset,
    ganho:       depois - antes,
    corrigidos:  entries.filter(e => e.unchoked).length,
  };
}

module.exports = {
  MISS_LIMIT,
  accPair,
  fcGrade,
  unchoke,
};
