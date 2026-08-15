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
  // O que se quer provar é SOBREPOSIÇÃO: enquanto o lento está em voo, a outra
  // posição vaga e revaga, e os cinco rápidos passam por ele. Em lotes de 2, o
  // rápido que caiu no mesmo lote do lento é o único que roda — os outros quatro
  // esperam o lote fechar.
  //
  // Isto era cronometrado ("total < 300ms" para um item de 200ms), e o relógio
  // errava dos dois lados. Falhava sozinho quando a máquina estava carregada —
  // medido a 303, 306, 343 e 352ms em quatro rodadas com o runner disputando
  // 32 processos em 12 núcleos —, e ainda assim APROVAVA uma implementação em
  // lotes, que sai em ~220ms e passaria pelo limite folgado. Sem timer nenhum,
  // o caso vale nas duas pontas.
  let liberarOLento;
  const oLentoEmVoo = new Promise(resolve => { liberarOLento = resolve; });

  const comecaram = [];
  const itens = ['lento', 'r1', 'r2', 'r3', 'r4', 'r5'];

  const trabalho = mapLimit(itens, 2, async (item) => {
    comecaram.push(item);
    if (item === 'lento') await oLentoEmVoo;
    return item;
  });

  // setImmediate corre depois da fila de microtarefas: quando ele chega, tudo
  // que podia andar sem esperar o lento já andou.
  await new Promise(resolve => setImmediate(resolve));
  const enquantoOLentoRodava = [...comecaram];

  liberarOLento();
  const saida = await trabalho;

  assert.deepEqual(
    enquantoOLentoRodava, itens,
    'os rápidos ficaram presos ao lento em vez de reaproveitar a posição livre',
  );
  assert.deepEqual(saida, itens, 'a ordem da entrada precisa sobreviver');
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
