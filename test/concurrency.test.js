/**
 * A piscina de posições que substituiu os lotes.
 *
 * O jeito óbvio é fatiar a lista e dar Promise.all em cada fatia — como o
 * enrichBeatmapData nasceu. O problema é que a fatia só termina quando o MAIS
 * LENTO dela termina: quatro mapas rápidos ficam parados esperando o quinto, e
 * a fatia seguinte nem começou. É esse desperdício que o teste do meio mede.
 */
const test = require('node:test');
const assert = require('node:assert');

const { mapLimit } = require('../src/concurrency');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test('os resultados vêm na ordem da entrada, não na de conclusão', async () => {
  // Quem chama casa items[i] com results[i]; ordem de chegada quebraria isso.
  const itens = [50, 10, 30, 0, 20];

  const saida = await mapLimit(itens, 3, async (ms) => {
    await sleep(ms);
    return ms;
  });

  assert.deepEqual(saida, itens);
});

test('nunca passa do teto de chamadas em voo', async () => {
  let emVoo = 0;
  let pico = 0;

  await mapLimit(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
    emVoo++;
    pico = Math.max(pico, emVoo);
    await sleep(5);
    emVoo--;
  });

  assert.ok(pico <= 4, `chegou a ${pico} chamadas simultâneas`);
  assert.equal(pico, 4, 'deveria ter usado todas as vagas');
});

test('o item lento não segura os outros', async () => {
  // Em lotes de 2, o primeiro lote [200, 10] levaria 200ms antes de o segundo
  // começar, e o total passaria de 400ms. Com a piscina, os rápidos passam pelo
  // lento e o total fica perto do próprio lento.
  const itens = [200, 10, 10, 10, 10, 10];

  const inicio = Date.now();
  await mapLimit(itens, 2, async (ms) => { await sleep(ms); });
  const total = Date.now() - inicio;

  assert.ok(total < 180 + 120, `levou ${total}ms; os rápidos ficaram presos ao lento`);
});

test('lista vazia não trava nem estoura', async () => {
  // Math.min(limit, 0) daria zero trabalhadores, e o Promise.all de nada
  // resolveria na hora — mas só por acidente. Vale travar.
  assert.deepEqual(await mapLimit([], 5, async () => 1), []);
});

test('menos itens que vagas não cria trabalhador ocioso', async () => {
  let chamadas = 0;
  const saida = await mapLimit([1, 2], 10, async (n) => { chamadas++; return n * 2; });

  assert.deepEqual(saida, [2, 4]);
  assert.equal(chamadas, 2);
});
