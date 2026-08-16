/**
 * O lazer-calculator num processo separado.
 *
 * ── Por que processo, e não thread ────────────────────────────────────────────
 * A lib é uma binding NAPI para o C# do osu!lazer, compilada em NativeAOT, e o
 * runtime .NET que ela carrega NÃO descarrega: o simples `require()`, sem
 * calcular nada, faz o processo terminar em segfault. Num worker thread isso
 * derruba o bot inteiro — e no meio do encerramento gracioso, antes do
 * `db.close()`. Como processo-filho, o estrago fica todo do lado de lá.
 *
 * É o risco que o último teste deste arquivo cobre, e o que mais importa aqui:
 * os números podem estar certos e ainda assim o desenho estar errado.
 *
 * Roda contra a lib de verdade, com o mesmo `.osu` sintético do rosuWorker —
 * assim não depende do cache da máquina nem da rede.
 */
const test = require('node:test');
const assert = require('node:assert');

const lazerWorker = require('../src/lazerWorker');
const { mapaSintetico } = require('./helpers');

test.after(() => lazerWorker.close());

const MAPA = mapaSintetico(200);
const bytesDe = () => Promise.resolve(MAPA);

test('a dificuldade sai com estrelas e combo do mapa', async () => {
  const attrs = await lazerWorker.calcular('difficulty', 8001, { mods: [] }, bytesDe);

  assert.ok(attrs, 'não veio resposta do processo');
  assert.ok(attrs.stars > 0, `estrelas deveriam ser positivas, vieram ${attrs.stars}`);
  // Mapa só de círculos: o combo máximo é um por objeto.
  assert.equal(attrs.maxCombo, 200);
});

test('mod de dificuldade move a estrela, e o CL não', async () => {
  const nm = await lazerWorker.calcular('difficulty', 8001, { mods: [] }, bytesDe);
  const dt = await lazerWorker.calcular('difficulty', 8001, { mods: ['DT'] }, bytesDe);
  const cl = await lazerWorker.calcular('difficulty', 8001, { mods: ['CL'] }, bytesDe);

  assert.ok(dt.stars > nm.stars, `DT (${dt.stars}) deveria passar de NM (${nm.stars})`);

  // O CL diz a MECÂNICA da play, não a dificuldade do mapa. É o que justifica
  // ele continuar fora do difficultyMods (mods.js) mesmo tendo virado um mod de
  // verdade na chave de cache.
  assert.equal(cl.stars, nm.stars, 'o CL não deveria mexer na estrela');
});

test('o HD mexe na estrela — foi o rework de reading', async () => {
  // Este teste existe por causa de uma regressão de valor, não de código: até o
  // rework de 03/07/2026 o HD não movia estrela nenhuma, e por isso ele estava
  // na lista de mods cosméticos (mods.js). Se voltar a empatar com o NM, ou a
  // lista está errada de novo, ou o motor regrediu de versão.
  const nm = await lazerWorker.calcular('difficulty', 8001, { mods: [] }, bytesDe);
  const hd = await lazerWorker.calcular('difficulty', 8001, { mods: ['HD'] }, bytesDe);

  assert.ok(hd.stars > nm.stars, `HD (${hd.stars}) deveria passar de NM (${nm.stars})`);
});

test('o FC pp ignora os misses e assume o combo cheio', async () => {
  // O "(FC: ~Xpp)" da linha da play. Um score com misses precisa render MAIS em
  // FC do que rendeu de verdade, senão o número não quer dizer nada.
  const comMiss = await lazerWorker.calcular(
    'simulate', 8001, { mods: ['CL'], n300: 190, n100: 5, n50: 0, misses: 5, combo: 40 }, bytesDe,
  );
  const seFosseFC = await lazerWorker.calcular(
    'fc', 8001, { mods: ['CL'], n300: 190, n100: 5, n50: 0, misses: 5 }, bytesDe,
  );

  assert.ok(
    seFosseFC.pp > comMiss.pp,
    `o FC (${seFosseFC.pp}) deveria render mais que o choke (${comMiss.pp})`,
  );
});

test('play interrompida usa só o trecho jogado', async () => {
  // Alguém desistiu no objeto 40 de 200. Os dois lados são como o scorePP.js
  // monta a chamada de verdade, e a diferença entre eles é o assunto do teste:
  //
  //   sem passedObjects → os 300 são DEDUZIDOS da contagem de objetos, ou seja,
  //     a conta inventa um 300 para cada objeto que a pessoa nunca viu e avalia
  //     tudo contra o mapa completo (no motor antigo: 332.6pp);
  //   com passedObjects → a dificuldade é a do TRECHO jogado, e os 300 são os
  //     que aconteceram de fato (os 101.3pp corretos).
  const comum = { mods: ['CL'], n100: 0, n50: 0, misses: 0, combo: 40 };

  const inteiro = await lazerWorker.calcular(
    'simulate', 8001, { ...comum, n300: null, passedObjects: null }, bytesDe,
  );
  const parcial = await lazerWorker.calcular(
    'simulate', 8001, { ...comum, n300: 40, passedObjects: 40 }, bytesDe,
  );

  assert.ok(parcial.pp < inteiro.pp, `parcial ${parcial.pp} deveria ser menor que ${inteiro.pp}`);
  assert.ok(
    parcial.maxCombo < inteiro.maxCombo,
    `o trecho jogado deveria ter combo menor (${parcial.maxCombo} vs ${inteiro.maxCombo})`,
  );
});

test('o mapa viaja uma vez só, não a cada cálculo', async () => {
  // Aqui isso pesa ainda mais que no rosu-pp: o parse custa ~18ms contra 1,5ms,
  // então reenviar bytes significaria reparsear.
  const mapId = 8002;

  await lazerWorker.calcular('difficulty', mapId, { mods: [] }, bytesDe);
  const depoisDoPrimeiro = lazerWorker.stats().bytesEnviados;

  for (const mods of [['DT'], ['HR'], ['HD'], ['EZ']]) {
    await lazerWorker.calcular('difficulty', mapId, { mods }, bytesDe);
  }

  assert.equal(
    lazerWorker.stats().bytesEnviados, depoisDoPrimeiro,
    'o mapa foi reenviado em cálculos seguintes',
  );
});

test('mapa ilegível não derruba o processo', async () => {
  const antes = lazerWorker.stats().spawns;

  const ruim = await lazerWorker.calcular(
    'difficulty', 8003, { mods: [] },
    async () => Buffer.from('isto não é um beatmap'),
  );

  // Ao contrário do rosu-pp, que aceita lixo e devolve um mapa degenerado, aqui
  // o parser do osu! recusa e a resposta vem nula. Os dois caminhos terminam no
  // mesmo lugar para quem chamou — o getDifficultyAttrs não grava nenhum dos
  // dois no cache —, mas por motivos diferentes, e vale registrar qual é qual.
  assert.ok(ruim === null || !ruim.maxCombo, `entrada corrompida não deveria virar número: ${JSON.stringify(ruim)}`);

  // A play seguinte da mesma página precisa continuar funcionando.
  const bom = await lazerWorker.calcular('difficulty', 8004, { mods: [] }, bytesDe);
  assert.ok(bom && bom.maxCombo > 0, 'o processo deveria ter sobrevivido');
  assert.equal(lazerWorker.stats().spawns - antes, 0, 'o processo foi reiniciado à toa');
});

test('operação desconhecida não derruba o processo', async () => {
  const antes = lazerWorker.stats().spawns;

  const resposta = await lazerWorker.calcular('inventada', 8001, { mods: [] }, bytesDe);
  assert.equal(resposta, null);

  const bom = await lazerWorker.calcular('difficulty', 8001, { mods: [] }, bytesDe);
  assert.ok(bom, 'o processo deveria ter sobrevivido');
  assert.equal(lazerWorker.stats().spawns - antes, 0);
});

test('o segfault do runtime .NET não sai do processo-filho', async (t) => {
  // O teste que justifica o desenho inteiro. Sobe um filho, calcula, fecha, e
  // confere que QUEM FECHOU continua de pé — que é exatamente o que a versão em
  // worker thread não conseguia fazer.
  const { fork } = require('node:child_process');
  const path = require('path');

  const roteiro = path.join(__dirname, 'fixtures', 'lazerTeardown.js');
  const filho = fork(roteiro, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });

  const resultado = await new Promise((resolve) => {
    let saida = '';
    filho.stdout.on('data', (c) => { saida += c.toString(); });
    filho.on('exit', (code) => resolve({ code, saida }));
    t.after(() => { try { filho.kill(); } catch { /* já morreu */ } });
  });

  assert.equal(
    resultado.code, 0,
    `o processo que fecha o worker deveria sair limpo, saiu ${resultado.code}: ${resultado.saida}`,
  );
  assert.match(
    resultado.saida, /SOBREVIVEU/,
    `o shutdown deveria ter terminado depois de fechar o worker: ${resultado.saida}`,
  );
});
