/**
 * A soma ponderada das top plays.
 *
 * A conta é uma linha, e estava escrita duas vezes — `/pp` e `/whatif` respondem
 * perguntas opostas sobre o MESMO número. Duas cópias de uma fórmula que precisa
 * concordar é o arranjo que já custou caro aqui: o pp local do `/score` e o do
 * `/recent` divergiram, um calculava e o outro imprimia zero.
 *
 * Ao juntar as duas, o risco deixa de ser "elas divergirem" e passa a ser "a
 * junção ter mudado o resultado". É isso que este arquivo trava: os casos abaixo
 * comparam a peça nova com a implementação ANTIGA, escrita aqui como referência.
 */
const test = require('node:test');
const assert = require('node:assert');

const { weightedPP, comPlayHipotetica, TOP_SIZE, WEIGHT } = require('../src/weightedPP');

// ─── As duas cópias que existiam, palavra por palavra ────────────────────────
// Ficam aqui como referência do que o bot fazia antes da junção. Se alguém
// mexer na fórmula sem querer, é contra isto que a diferença aparece.

const antigaSoma = (plays) =>
  plays.reduce((sum, play, i) => sum + play.pp * Math.pow(0.95, i), 0);

function antigaSimulacao(currentPlays, hypotheticalPP) {
  const hypothetical = { pp: hypotheticalPP };
  const simulated = [...currentPlays, hypothetical]
    .sort((a, b) => b.pp - a.pp)
    .slice(0, 100);

  const currentPP   = antigaSoma(currentPlays);
  const simulatedPP = antigaSoma(simulated);
  const position    = simulated.indexOf(hypothetical) + 1;

  return {
    currentPP,
    simulatedPP,
    gain: simulatedPP - currentPP,
    position,
    didEnter: position > 0 && position <= simulated.length,
  };
}

/** Top plays plausíveis: decrescentes, como a API devolve. */
function topFalso(n, semente = 1) {
  let valor = 700 + (semente % 13) * 10;
  return Array.from({ length: n }, () => {
    valor = Math.max(1, valor - (3 + (valor % 7)));
    return { pp: Number(valor.toFixed(2)) };
  });
}

test('a soma bate com a implementação antiga', () => {
  for (const n of [0, 1, 5, 50, 100, 137]) {
    const plays = topFalso(n, n);
    assert.equal(weightedPP(plays), antigaSoma(plays), `divergiu com ${n} plays`);
  }
});

test('a fórmula é a do osu!, e o peso não mudou', () => {
  // Conferível na mão: 100 + 100*0.95 + 100*0.95² = 285.25
  assert.equal(weightedPP([{ pp: 100 }, { pp: 100 }, { pp: 100 }]).toFixed(2), '285.25');
  assert.equal(WEIGHT, 0.95);
  assert.equal(TOP_SIZE, 100);
  assert.equal(weightedPP([]), 0);
});

test('a simulação bate com a antiga, inclusive quando a play não entra', () => {
  const plays = topFalso(100, 3);

  for (const pp of [2000, 700, 500, 123.45, 1, 0]) {
    const nova   = comPlayHipotetica(plays, pp);
    const antiga = antigaSimulacao(plays, pp);

    assert.equal(nova.weighted, antiga.simulatedPP, `soma divergiu para ${pp}pp`);
    assert.equal(nova.position, antiga.position,    `posição divergiu para ${pp}pp`);
    assert.equal(nova.entrou,   antiga.didEnter,    `"entrou" divergiu para ${pp}pp`);
  }
});

test('empate exato devolve a posição da hipotética, não a da play real', () => {
  // O detalhe que os dois comandos documentavam: procurar por VALOR
  // (`p.pp === x`) devolve a posição da play real, porque o sort é estável e
  // deixa a hipotética depois das empatadas. A busca é por referência.
  const plays = [{ pp: 500 }, { pp: 400 }, { pp: 300 }];

  const { position } = comPlayHipotetica(plays, 400);
  assert.equal(position, 3, 'a hipotética empatada deveria ficar DEPOIS da real');
  assert.equal(plays.findIndex(p => p.pp === 400) + 1, 2, '(a real está na 2ª)');
});

test('a lista de entrada não é modificada', () => {
  // Ela vem do cache de top plays (osuClient), compartilhada por referência
  // entre comandos: ordenar ou inserir no lugar corromperia o cache de todos.
  const plays = topFalso(5, 7);
  const copia = plays.map(p => ({ ...p }));

  comPlayHipotetica(plays, 999);

  assert.deepEqual(plays, copia, 'a simulação mexeu na lista original');
});

test('o corte em 100 vale mesmo com mais plays na entrada', () => {
  const plays = topFalso(150, 11);
  const { weighted } = comPlayHipotetica(plays, 1);

  // A play de 1pp não entra, então o resultado é o das 100 primeiras.
  assert.equal(weighted, weightedPP(plays.slice(0, TOP_SIZE)));
});
