/**
 * O worker Python de vida longa.
 *
 * O cálculo de PP do Relax custava um `spawn` por play — medido só o spawn +
 * startup do interpretador, SEM importar a lib: 44ms por chamada. Uma página de
 * /topplays de RX são cinco.
 *
 * Trocar isso por um processo de pé introduz três riscos que o script de uma
 * tacada só não tinha, e são eles que este arquivo cobre:
 *
 *   1. resposta entregue ao pedido ERRADO (vários em voo ao mesmo tempo);
 *   2. um mapa problemático derrubando o cálculo dos outros;
 *   3. um worker que não sobe sendo ressuscitado a cada chamada — que é
 *      exatamente o desperdício que a mudança veio eliminar.
 *
 * Roda contra o `pp_calc.py` de VERDADE, com um dublê da lib compilada entrando
 * por PYTHONPATH (test/fixtures/akatsuki_pp_py.py). Assim o protocolo — o
 * enquadramento do cabeçalho, a leitura exata do corpo, os ids — é exercitado
 * como em produção, sem exigir a lib instalada na máquina de quem testa.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

// Antes do require do worker: é o env deste processo que o filho herda.
process.env.PYTHONPATH = path.join(__dirname, 'fixtures');

const worker = require('../src/pythonWorker');

/**
 * Sem Python não há o que testar aqui, e falhar seria mentira: o bot trata a
 * ausência dele como recurso opcional indisponível, não como defeito.
 */
function pythonDisponivel() {
  const bin = process.platform === 'win32' ? 'python' : 'python3';
  try {
    execFileSync(bin, ['-c', 'pass'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const skip = pythonDisponivel() ? false : 'Python não encontrado nesta máquina';

test.after(() => worker.close());

/** Um .osu falso do tamanho pedido — o dublê devolve o tamanho como pp. */
const mapa = (tamanho) => new Uint8Array(tamanho).fill(65);

const pedido = (extra) => ({
  mapId: 1, mods: 0, n300: -1, n100: 0, n50: 0, nmiss: 0, combo: -1, ...extra,
});

/** Executa silenciando o console: falha esperada não precisa poluir a saída. */
async function calado(fn) {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

test('vários cálculos seguidos usam um processo só', { skip }, async () => {
  const antes = worker.stats().spawns;

  const primeiro = await worker.calcular(mapa(1000), pedido({ mapId: 1, mods: 64 }));
  const segundo  = await worker.calcular(mapa(2000), pedido({ mapId: 2, mods: 8 }));

  assert.equal(primeiro.pp, 1000, 'o corpo do primeiro pedido não chegou inteiro');
  assert.equal(segundo.pp,  2000);
  assert.equal(primeiro.stars, 64, 'o cabeçalho não chegou junto do corpo certo');

  // O ponto inteiro da mudança: dois números, um interpretador.
  assert.equal(worker.stats().spawns - antes, 1, 'subiu mais de um processo');
});

test('cada resposta volta para quem pediu', { skip }, async () => {
  // Cinco em voo ao mesmo tempo, como uma página de /topplays. Sem os ids
  // casando pedido e resposta, bastaria uma chegar fora de ordem para uma play
  // exibir o pp de outra — e o número sairia plausível, sem nada denunciar.
  const tamanhos = [1100, 1200, 1300, 1400, 1500];

  const respostas = await Promise.all(
    tamanhos.map((tamanho, i) =>
      worker.calcular(mapa(tamanho), pedido({ mapId: i, mods: (i + 1) * 2, n100: i }))
    )
  );

  respostas.forEach((resposta, i) => {
    assert.equal(resposta.pp, tamanhos[i], `o pedido ${i} recebeu a resposta de outro`);
    assert.equal(resposta.stars, (i + 1) * 2);
    assert.equal(resposta.max_combo, i);
  });
});

test('erro em um pedido não derruba o worker', { skip }, async () => {
  const antes = worker.stats().spawns;

  // 666 é a combinação que o dublê usa para levantar exceção.
  const ruim = await calado(() =>
    worker.calcular(mapa(500), pedido({ mapId: 9, mods: 666 }))
  );
  assert.equal(ruim, null, 'mapa problemático deveria virar null, não exceção');

  // A play seguinte da MESMA página precisa continuar funcionando: derrubar o
  // worker por causa de um mapa puniria as outras quatro.
  const bom = await worker.calcular(mapa(700), pedido({ mapId: 10, mods: 2 }));
  assert.equal(bom.pp, 700);
  assert.equal(worker.stats().spawns - antes, 0, 'o worker foi reiniciado à toa');
});

test('encerramento limpo não é relatado como falha', { skip }, async () => {
  // Uma morte chega por até três caminhos — 'error', 'close' e o close() do
  // shutdown —, e o worker recebe mais de um para o mesmo processo. Sem trava,
  // um shutdown normal do bot caía no mesmo relato de "morreu sozinho": numa
  // sessão em que nenhum cálculo de RX aconteceu, o bot logava "PP do Relax
  // indisponível" ao encerrar e ainda ligava o backoff — por causa de um
  // encerramento que deu certo.
  worker.close();

  const capturado = [];
  const original = console.error;
  console.error = (...args) => capturado.push(args.join(' '));

  try {
    // Sobe um worker e o fecha antes de qualquer resposta chegar: é o pior
    // caso, `served === 0`.
    const emVoo = worker.calcular(mapa(300), pedido());
    worker.close();
    assert.equal(await emVoo, null, 'o pedido em voo deveria ser encerrado como null');

    // O 'close' do processo filho chega depois do close(); era ele que relatava.
    await new Promise(resolve => setTimeout(resolve, 300));
  } finally {
    console.error = original;
  }

  assert.deepEqual(capturado, [], `um shutdown limpo logou: ${capturado.join(' | ')}`);
});

test('worker que não sobe não é ressuscitado a cada chamada', { skip }, async () => {
  // Precisa vir por último: deixa o módulo em backoff.
  worker.close();

  // Um binário que não existe falha igual em qualquer máquina — apagar o
  // PYTHONPATH não serviria, porque numa máquina COM a lib instalada de
  // verdade o worker subiria normalmente e o teste passaria por engano.
  process.env.PYTHON_BIN = 'python-que-nao-existe-mesmo';

  const antes = worker.stats().spawns;

  const respostas = await calado(async () => [
    await worker.calcular(mapa(100), pedido()),
    await worker.calcular(mapa(100), pedido()),
    await worker.calcular(mapa(100), pedido()),
  ]);

  assert.deepEqual(respostas, [null, null, null], 'falha do Python deveria virar null');

  // É o desperdício que a mudança veio matar: o caminho antigo pagava um spawn
  // por chamada só para redescobrir a mesma falha permanente.
  assert.equal(worker.stats().spawns - antes, 1, 'tentou subir o worker mais de uma vez');
});
