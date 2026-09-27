/**
 * O rosu-pp numa thread separada.
 *
 * É o motor vanilla inteiro: estrelas, PP (FC, simulação, play interrompida) e
 * a linha de informação do mapa. Roda o build do Bancho (vendor/rosu-pp-bancho),
 * o rosu-pp-js compilado contra o fork no lazer master, que substituiu o
 * lazer-calculator. O do Daycore tem os seus testes no fim.
 *
 * O cálculo é Wasm SÍNCRONO: enquanto ele roda, o event loop não anda. Medido
 * numa rajada de 10 mapas grandes com mods inéditos, amostrando o intervalo
 * entre execuções de setImmediate: **22,9ms de bloqueio no pior caso dentro do
 * processo, contra 4,1ms na thread** (e p99 zerado). O total sobe um pouco — a
 * thread não acelera o cálculo, ela devolve o event loop enquanto ele acontece.
 *
 * Mover o cálculo de lugar traz três riscos que rodá-lo aqui não tinha, e são
 * eles que este arquivo cobre, junto do comportamento do motor que o resto do
 * bot assume:
 *
 *   1. o número mudar ao atravessar a fronteira da thread;
 *   2. o mapa viajar de novo a cada cálculo, trocando CPU por cópia de 50–300KB;
 *   3. um mapa problemático derrubar a thread e levar junto as outras plays.
 *
 * Roda contra o rosu-pp de verdade, com um `.osu` sintético — assim não depende
 * do cache da máquina nem da rede.
 */
const test = require('node:test');
const assert = require('node:assert');

const rosu = require('rosu-pp-bancho');

const PACOTE = 'rosu-pp-bancho';
const rosuWorker = require('../src/pp/rosuWorker');
const { mapaSintetico } = require('./helpers');

test.after(() => rosuWorker.close());

const MAPA = mapaSintetico(200);
const bytesDe = () => Promise.resolve(MAPA);

/** O mesmo cálculo feito aqui, para comparar com o que a thread devolve. */
function noProcesso(fn) {
  const beatmap = new rosu.Beatmap(MAPA);
  try {
    return fn(beatmap);
  } finally {
    beatmap.free();
  }
}

test('os atributos do mapa saem já ajustados pelos mods', async () => {
  // A conta de AR/OD com mod de velocidade não é multiplicação: a janela de
  // tempo é que muda. É o motivo de o cálculo ficar do lado do rosu-pp em vez
  // de virar uma segunda implementação em JS — o mapa sintético tem AR 9 e
  // OD 7, e nenhum dos dois vira 13.5 nem 10.5 no DT.
  const semMods = await rosuWorker.calcular(PACOTE, 'attributes', 9001, { mods: 0 }, bytesDe);
  const comDT   = await rosuWorker.calcular(PACOTE, 'attributes', 9001, { mods: 64 }, bytesDe);

  const esperado = noProcesso(bm =>
    new rosu.BeatmapAttributesBuilder({ map: bm, mods: 64 }).build()
  );

  assert.equal(semMods.ar, 9);
  assert.equal(semMods.od, 7);
  assert.equal(comDT.ar, esperado.ar);
  assert.equal(comDT.od, esperado.od);
  assert.equal(comDT.clockRate, 1.5);

  // BPM e contagem de objetos vêm do mesmo mapa parseado: é o que evita uma
  // requisição a mais só para a linha de informação do embed.
  assert.equal(comDT.bpm, semMods.bpm * 1.5);
  assert.equal(comDT.objects, 200);
});

test('o rate ajustado chega como número, porque no bit ele não cabe', async () => {
  // Um DT a 1,4x é play diferente de um DT comum, e é aqui que a diferença
  // aparece na tela: BPM e AR/OD. O bitmask não tem onde guardar o ajuste, então
  // ele viaja ao lado — e o resultado tem de bater com o do rosu-pp recebendo os
  // mods como objeto, que é o caminho que NÃO se usa (ver rosuWorkerThread.js).
  const dtCheio    = await rosuWorker.calcular(PACOTE, 'attributes', 9005, { mods: 64 }, bytesDe);
  const dtAjustado = await rosuWorker.calcular(PACOTE,
    'attributes', 9005, { mods: 64, clockRate: 1.4 }, bytesDe,
  );

  const esperado = noProcesso(bm =>
    new rosu.BeatmapAttributesBuilder({
      map: bm, mods: [{ acronym: 'DT', settings: { speed_change: 1.4 } }],
    }).build()
  );

  assert.equal(dtAjustado.clockRate, 1.4);
  assert.equal(dtAjustado.ar, esperado.ar);
  assert.equal(dtAjustado.od, esperado.od);
  assert.equal(dtAjustado.bpm, 120 * 1.4);

  // E não é o mesmo mapa que o DT sem ajuste: se empatar, o ajuste se perdeu no
  // caminho e a linha do embed voltou a mentir em silêncio.
  assert.ok(dtAjustado.ar < dtCheio.ar, `AR ${dtAjustado.ar} deveria ficar abaixo de ${dtCheio.ar}`);
});

test('sem rate informado, quem manda continua sendo o bitmask', async () => {
  // O `clockRate` nulo é o "deduza dos mods" do rosu-pp. Se ele virasse 1 por
  // engano, todo score de DT passaria a exibir o mapa em velocidade normal.
  const semRate = await rosuWorker.calcular(PACOTE, 'attributes', 9006, { mods: 64 }, bytesDe);
  const nulo    = await rosuWorker.calcular(PACOTE, 'attributes', 9006, { mods: 64, clockRate: null }, bytesDe);

  assert.equal(semRate.clockRate, 1.5);
  assert.equal(nulo.clockRate, 1.5);
});

test('o mapa viaja uma vez só, não a cada cálculo', async () => {
  // O .osu tem 50–300KB. Mandá-lo em todo cálculo trocaria o custo de CPU por
  // um de cópia — a thread guarda o mapa já parseado justamente para evitar
  // isso, e só pede os bytes quando não o tem.
  const mapId = 9002;

  await rosuWorker.calcular(PACOTE, 'attributes', mapId, { mods: 0 }, bytesDe);
  const depoisDoPrimeiro = rosuWorker.stats()[PACOTE].bytesEnviados;

  for (const mods of [64, 16, 8, 2]) {
    await rosuWorker.calcular(PACOTE, 'attributes', mapId, { mods }, bytesDe);
  }

  assert.equal(
    rosuWorker.stats()[PACOTE].bytesEnviados, depoisDoPrimeiro,
    'o mapa foi reenviado em cálculos seguintes',
  );
});

test('mapa ilegível não derruba a thread', async () => {
  const antes = rosuWorker.stats()[PACOTE].spawns;

  // ATENÇÃO ao que o rosu-pp faz aqui: ele NÃO recusa entrada corrompida. Com
  // lixo puro ele parseia o que der e devolve um mapa degenerado — sem objeto
  // nenhum e sem erro. É por isso que o getMapAttrs trata `objects` zerado como
  // "não sei", em vez de confiar no que voltou.
  const ruim = await rosuWorker.calcular(PACOTE,
    'attributes', 9003, { mods: 0 },
    async () => Buffer.from('isto não é um beatmap'),
  );

  assert.equal(ruim.objects, 0, 'o mapa degenerado deveria vir sem objetos');

  // A play seguinte da mesma página precisa continuar funcionando.
  const bom = await rosuWorker.calcular(PACOTE, 'attributes', 9004, { mods: 0 }, bytesDe);
  assert.ok(bom && bom.objects > 0, 'a thread deveria ter sobrevivido');
  assert.equal(rosuWorker.stats()[PACOTE].spawns - antes, 0, 'a thread foi reiniciada à toa');
});

test('operação desconhecida não derruba a thread', async () => {
  const antes = rosuWorker.stats()[PACOTE].spawns;

  const resposta = await rosuWorker.calcular(PACOTE, 'inventada', 9001, { mods: 0 }, bytesDe);
  assert.equal(resposta, null);

  const bom = await rosuWorker.calcular(PACOTE, 'attributes', 9001, { mods: 0 }, bytesDe);
  assert.ok(bom, 'a thread deveria ter sobrevivido');
  assert.equal(rosuWorker.stats()[PACOTE].spawns - antes, 0);
});

// ─── Estrelas e PP ────────────────────────────────────────────────────────────

test('a dificuldade sai com estrelas e combo do mapa', async () => {
  const attrs = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: [] }, bytesDe);

  assert.ok(attrs, 'não veio resposta da thread');
  assert.ok(attrs.stars > 0, `estrelas deveriam ser positivas, vieram ${attrs.stars}`);
  // Mapa só de círculos: o combo máximo é um por objeto.
  assert.equal(attrs.maxCombo, 200);
});

test('mod de dificuldade move a estrela, e o CL não', async () => {
  const nm = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: [] }, bytesDe);
  const dt = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: ['DT'] }, bytesDe);
  const cl = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: ['CL'] }, bytesDe);

  assert.ok(dt.stars > nm.stars, `DT (${dt.stars}) deveria passar de NM (${nm.stars})`);

  // O CL diz a MECÂNICA da play, não a dificuldade do mapa. É o que justifica
  // ele continuar fora do difficultyMods (mods.js) mesmo tendo virado um mod de
  // verdade na chave de cache.
  assert.equal(cl.stars, nm.stars, 'o CL não deveria mexer na estrela');
});

test('o motor conhece TD e AP, e só um deles mexe na estrela', async () => {
  // Os dois faltavam no MOD_BITS, e o efeito era mudo: bit ausente some na
  // decodificação, então um score de touch aparecia como `+NM`.
  const nm = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: [] }, bytesDe);
  const td = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: ['TD'] }, bytesDe);
  const ap = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: ['AP'] }, bytesDe);

  assert.ok(td && ap, 'o motor deveria aceitar os dois acrônimos');

  // TD penaliza o pp sem tocar na dificuldade — daí ele estar em COSMETIC_MODS,
  // onde o bot confia na estrela publicada pela API em vez de calcular.
  assert.equal(td.stars, nm.stars, 'o TD não deveria mexer na estrela');

  // O AP tira uma dimensão inteira do jogo, como o RX. Se ele empatar com o NM,
  // é sinal de que o motor deixou de aplicá-lo — e o bot passaria a exibir a
  // estrela sem mods como se fosse a da play.
  assert.ok(ap.stars < nm.stars, `AP (${ap.stars}) deveria ficar abaixo de NM (${nm.stars})`);
});

test('o HD mexe na estrela — foi o rework de reading', async () => {
  // Até o rework de 03/07/2026 o HD não movia estrela nenhuma, e por isso ele
  // estava na lista de mods cosméticos (mods.js). Se voltar a empatar com o NM,
  // ou a lista está errada de novo, ou o vendor/rosu-pp-bancho regrediu para um
  // rosu-pp sem a skill de reading.
  const nm = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: [] }, bytesDe);
  const hd = await rosuWorker.calcular(PACOTE, 'difficulty', 8001, { mods: ['HD'] }, bytesDe);

  assert.ok(hd.stars > nm.stars, `HD (${hd.stars}) deveria passar de NM (${nm.stars})`);
});

test('o ajuste de rate muda a play, e é o motor quem aplica', async () => {
  // O bot manda o `speed_change` que a API informa, e este teste é o que
  // garante que o motor o CONSOME — se ele passasse a ignorar o ajuste, o 1,4x
  // empataria com o 1,5x e nada mais no bot denunciaria.
  const dt14Mods = [{ acronym: 'DT', settings: { speed_change: 1.4 } }];
  const dtCheio = await rosuWorker.calcular(PACOTE, 'difficulty', 8010, { mods: ['DT'] }, bytesDe);
  const dt14 = await rosuWorker.calcular(PACOTE, 'difficulty', 8010, { mods: dt14Mods }, bytesDe);
  const nm = await rosuWorker.calcular(PACOTE, 'difficulty', 8010, { mods: [] }, bytesDe);

  assert.ok(
    dt14.stars < dtCheio.stars && dt14.stars > nm.stars,
    `1,4x (${dt14.stars}) deveria ficar entre NM (${nm.stars}) e DT (${dtCheio.stars})`,
  );

  const comum = { n300: null, n100: 0, n50: 0, misses: 0, combo: -1 };
  const ppCheio = await rosuWorker.calcular(PACOTE, 'simulate', 8010, { mods: ['DT'], ...comum }, bytesDe);
  const pp14 = await rosuWorker.calcular(PACOTE, 'simulate', 8010, { mods: dt14Mods, ...comum }, bytesDe);

  assert.ok(pp14.pp < ppCheio.pp, `1,4x (${pp14.pp}) deveria render menos que 1,5x (${ppCheio.pp})`);
});

test('mod ou ajuste que o rosu-pp não conhece não apaga a play', async () => {
  // Os mods vêm da API oficial, que ganha mod e ajuste novos sem avisar, e o
  // rosu-pp recusa a lista INTEIRA quando não reconhece algo nela. O que não
  // pode acontecer é a play deixar de ser calculada por isso: a thread cai no
  // bitmask + rate, que perde só o que não tem bit.
  const dt = await rosuWorker.calcular(PACOTE, 'difficulty', 8011, { mods: ['DT'] }, bytesDe);
  const ajusteEstranho = await rosuWorker.calcular(PACOTE,
    'difficulty', 8011,
    { mods: [{ acronym: 'DT', settings: { ajuste_que_nao_existe: 3 } }] },
    bytesDe,
  );
  const modEstranho = await rosuWorker.calcular(PACOTE,
    'difficulty', 8011, { mods: ['DT', 'ZZ'] }, bytesDe,
  );

  assert.ok(ajusteEstranho, 'o motor deveria ter respondido mesmo sem conhecer o ajuste');
  assert.equal(ajusteEstranho.stars, dt.stars);
  assert.ok(modEstranho, 'o motor deveria ter respondido mesmo sem conhecer o mod');
  assert.equal(modEstranho.stars, dt.stars);
});

test('o FC pp ignora os misses e assume o combo cheio', async () => {
  // O "(FC: ~Xpp)" da linha da play. Um score com misses precisa render MAIS em
  // FC do que rendeu de verdade, senão o número não quer dizer nada.
  const comMiss = await rosuWorker.calcular(PACOTE,
    'simulate', 8001, { mods: ['CL'], n300: 190, n100: 5, n50: 0, misses: 5, combo: 40 }, bytesDe,
  );
  const seFosseFC = await rosuWorker.calcular(PACOTE,
    'fc', 8001, { mods: ['CL'], n300: 190, n100: 5, n50: 0, misses: 5 }, bytesDe,
  );

  assert.ok(
    seFosseFC.pp > comMiss.pp,
    `o FC (${seFosseFC.pp}) deveria render mais que o choke (${comMiss.pp})`,
  );
});

test('score hipotético só usa a estimativa por combo', async () => {
  // O /simulate não tem score total, e aí só a estimativa por combo deve
  // operar. No lazer-calculator de antes, 0 como placar NÃO era "sem score": a
  // estimativa por score rodava com 0 pontos, achava miss de mais e derrubava o
  // pp (95.06pp contra 107.86pp). O lazer master passou a tratar 0 como
  // ausente, e o fork segue — então os dois caminhos têm de empatar, e um placar
  // de verdade é que tem de mexer no número.
  //
  // Precisa de slider: a estimativa por score existe para achar sliderbreak, e
  // no mapa só de círculos ela nunca pesa.
  const objetos = [];
  for (let i = 0; i < 200; i++) {
    const x = 100 + (i % 300), y = 100 + (i % 200), t = 500 + i * 300;
    objetos.push(i % 2 ? `${x},${y},${t},1,0` : `${x},${y},${t},2,0,L|${x + 80}:${y},1,80`);
  }
  const comSliders = Buffer.from(
    MAPA.toString().replace(/\[HitObjects\][\s\S]*/, `[HitObjects]\n${objetos.join('\n')}`),
  );
  const bytesComSliders = () => Promise.resolve(comSliders);
  const choke = { mods: ['CL'], n300: 180, n100: 12, n50: 3, misses: 5, combo: 40 };

  const semScore = await rosuWorker.calcular(PACOTE, 'simulate', 8002, choke, bytesComSliders);
  const zeroPontos = await rosuWorker.calcular(PACOTE,
    'simulate', 8002, { ...choke, legacyTotalScore: 0 }, bytesComSliders,
  );
  const poucosPontos = await rosuWorker.calcular(PACOTE,
    'simulate', 8002, { ...choke, legacyTotalScore: 1000 }, bytesComSliders,
  );

  assert.equal(zeroPontos.pp, semScore.pp, 'placar 0 deveria valer o mesmo que placar nenhum');
  assert.notEqual(
    poucosPontos.pp, semScore.pp,
    'um placar de verdade deveria acionar a estimativa por score',
  );

  // Em play de lazer (sem CL) o placar não é o legado, e a thread o descarta.
  const lazer = { ...choke, mods: [] };
  const lazerSem = await rosuWorker.calcular(PACOTE, 'simulate', 8002, lazer, bytesComSliders);
  const lazerCom = await rosuWorker.calcular(PACOTE,
    'simulate', 8002, { ...lazer, legacyTotalScore: 1000 }, bytesComSliders,
  );
  assert.equal(lazerCom.pp, lazerSem.pp, 'o placar não deveria pesar numa play de lazer');
});

test('play interrompida usa só o trecho jogado', async () => {
  // Alguém desistiu no objeto 40 de 200. Sem passedObjects os 300 são
  // DEDUZIDOS da contagem de objetos, ou seja, a conta inventa um 300 para cada
  // objeto que a pessoa nunca viu; com ele, a dificuldade é a do TRECHO jogado.
  const comum = { mods: ['CL'], n100: 0, n50: 0, misses: 0, combo: 40 };

  const inteiro = await rosuWorker.calcular(PACOTE,
    'simulate', 8001, { ...comum, n300: null, passedObjects: null }, bytesDe,
  );
  const parcial = await rosuWorker.calcular(PACOTE,
    'simulate', 8001, { ...comum, n300: 40, passedObjects: 40 }, bytesDe,
  );

  assert.ok(parcial.pp < inteiro.pp, `parcial ${parcial.pp} deveria ser menor que ${inteiro.pp}`);
  assert.ok(
    parcial.maxCombo < inteiro.maxCombo,
    `o trecho jogado deveria ter combo menor (${parcial.maxCombo} vs ${inteiro.maxCombo})`,
  );
});

// ─── Um build por servidor ────────────────────────────────────────────────────
// O Daycore calcula no build dele (ver engines.js). O que interessa aqui é que
// cada build tenha a sua thread: o mesmo mapId nos dois não pode ler o Beatmap
// parseado do outro, e um build que não carrega não pode levar o outro junto.

test('o build do Daycore roda na própria thread', async () => {
  const dia = { mods: ['HD', 'DT', 'CL'] };
  const bancho  = await rosuWorker.calcular(PACOTE, 'difficulty', 9100, dia, bytesDe);
  const daycore = await rosuWorker.calcular('rosu-pp-daycore', 'difficulty', 9100, dia, bytesDe);

  // Hoje os dois estão no mesmo commit do fork; o número só pode divergir
  // quando um deles for atualizado sem o outro.
  assert.ok(Number.isFinite(daycore?.stars), 'o build do Daycore não calculou');
  assert.equal(daycore.stars, bancho.stars);

  const stats = rosuWorker.stats();
  assert.ok(stats['rosu-pp-daycore'].bytesEnviados > 0, 'o Daycore leu o mapa da thread do Bancho');
  assert.equal(stats['rosu-pp-daycore'].spawns, 1);
});

test('build que não carrega não derruba o outro', async () => {
  const nada = await rosuWorker.calcular('rosu-pp-inexistente', 'difficulty', 9101, { mods: [] }, bytesDe);
  assert.equal(nada, null);

  const bom = await rosuWorker.calcular(PACOTE, 'difficulty', 9101, { mods: [] }, bytesDe);
  assert.ok(Number.isFinite(bom?.stars), 'o build do Bancho parou junto');
});
