/**
 * weightedPP.js
 * Como o osu! soma as top plays de alguém.
 *
 * A conta é uma linha, e é justamente por isso que ela estava escrita duas
 * vezes — `/pp` e `/whatif` respondem perguntas opostas sobre o MESMO número
 * ("quanto falta para chegar em X" e "quanto X me daria"), e cada um trouxe a
 * própria cópia. Duas cópias de uma fórmula que precisa concordar é o mesmo
 * arranjo que já custou caro aqui antes: o pp local do `/score` e o do `/recent`
 * divergiram, um calculava e o outro imprimia zero (ver scorePP.js).
 *
 * ── O que a fórmula é, e o que ela não é ──────────────────────────────────────
 * O osu! ordena as plays por pp e pesa cada uma por `0.95^posição`: a primeira
 * conta inteira, a centésima conta ~0,6%. O que ela devolve **não** é o pp do
 * perfil — de fora ficam o bônus por playcount e a cauda além da centésima, que
 * numa conta ativa passam de 400pp somados.
 *
 * Quem precisa do total do perfil calcula o desvio uma vez (`stats.pp` menos
 * esta soma) e o aplica no fim; os dois comandos já faziam isso, cada um de um
 * lado — o `/pp` subtrai do alvo antes de procurar, o `/whatif` soma ao
 * resultado depois. É a mesma correção vista de dois ângulos.
 */

/** Quantas plays entram na conta. Além disso o peso é irrelevante, e o osu! corta. */
const TOP_SIZE = 100;

/** O peso da play na posição `i`, contando do zero. */
const WEIGHT = 0.95;

/**
 * Soma ponderada de uma lista JÁ ORDENADA por pp decrescente.
 *
 * A ordem é responsabilidade de quem chama porque os dois usos já ordenam por
 * conta própria — reordenar aqui seria trabalho repetido em cima de 100 itens, a
 * cada simulação de um laço.
 *
 * @param {{pp: number}[]} plays
 * @returns {number}
 */
function weightedPP(plays) {
  return plays.reduce((soma, play, i) => soma + play.pp * Math.pow(WEIGHT, i), 0);
}

/**
 * Insere uma play hipotética na lista e devolve o que ela mudaria.
 *
 * O objeto hipotético é procurado por REFERÊNCIA, e não por valor de pp: com
 * `indexOf` sobre o número, um empate exato com uma play real devolveria a
 * posição da outra — o `sort` é estável e deixa a hipotética depois das reais
 * empatadas. Já era assim nos dois comandos, e o comentário viaja junto porque
 * é o tipo de detalhe que alguém "simplifica" de volta.
 *
 * @param {{pp: number}[]} plays lista atual, ordenada por pp decrescente
 * @param {number} pp valor da play hipotética
 * @returns {{weighted: number, position: number, entrou: boolean}}
 *   `position` é 1-based; `entrou` é falso quando a play não alcançou o top.
 */
function comPlayHipotetica(plays, pp) {
  const hipotetica = { pp };

  const simulado = [...plays, hipotetica]
    .sort((a, b) => b.pp - a.pp)
    .slice(0, TOP_SIZE);

  const indice = simulado.indexOf(hipotetica);

  return {
    weighted: weightedPP(simulado),
    position: indice + 1,
    entrou:   indice >= 0,
  };
}

module.exports = { weightedPP, comPlayHipotetica, TOP_SIZE, WEIGHT };
