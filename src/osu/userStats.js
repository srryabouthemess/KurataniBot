/**
 * osu/userStats.js
 * Pedaços do perfil que os servidores privados mandam em formatos diferentes,
 * traduzidos para o da API oficial.
 *
 * ── Level ────────────────────────────────────────────────────────────────────
 * O bancho.py não manda level, só `tscore`, e antes o adaptador preenchia 1
 * para todo mundo: o /compare mostrava "Level 1 | 1" no Daycore. O level do
 * osu! é função do score total e de mais nada, então dá para chegar nele sem
 * palpite. Conferido contra a Akatsuki, que manda os dois: 29.261.595.431 de
 * score total dá 100,0233, e ela responde 100,02330404602.
 */

/** Score total necessário para chegar ao nível `n`. */
function scoreForLevel(n) {
  if (n <= 100) {
    if (n <= 1) return 0;
    return (5000 / 3) * (4 * n ** 3 - 3 * n ** 2 - n) + 1.25 * 1.8 ** (n - 60);
  }
  return 26931190827 + 99999999999 * (n - 100);
}

/**
 * @param {number} totalScore
 * @returns {{ current: number, progress: number }} progresso em 0-100, como o
 *   `statistics.level` da API oficial.
 */
function levelFromScore(totalScore) {
  const score = Number(totalScore) || 0;

  let n = 1;
  while (scoreForLevel(n + 1) <= score) n++;

  const base = scoreForLevel(n);
  const progress = (score - base) / (scoreForLevel(n + 1) - base);
  return { current: n, progress: Math.floor(progress * 100) };
}

/**
 * Level em ponto flutuante (100.07), como o Ripple manda, no formato da API
 * oficial.
 */
function levelFromFloat(value) {
  const n = Number(value);
  if (!(n >= 1)) return { current: 1, progress: 0 };
  const current = Math.floor(n);
  // O epsilon é contra o 100.07 - 100 = 0.0699999… do ponto flutuante, que
  // sem ele sairia 100.06.
  return { current, progress: Math.floor((n - current) * 100 + 1e-9) };
}

/**
 * Contagem de notas no formato da API oficial. O bancho.py, o Ripple e o Gatari
 * usam os mesmos nomes (`xh_count`, `x_count`...), só em lugares diferentes da
 * resposta; sem nenhum deles, null — "não sei" e não "zero de tudo".
 */
function gradeCounts(src) {
  if (!src || src.xh_count === undefined) return null;
  return {
    ssh: Number(src.xh_count) || 0,
    ss:  Number(src.x_count)  || 0,
    sh:  Number(src.sh_count) || 0,
    s:   Number(src.s_count)  || 0,
    a:   Number(src.a_count)  || 0,
  };
}

module.exports = { levelFromScore, levelFromFloat, gradeCounts };
