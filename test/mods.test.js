/**
 * Tradução entre as três formas de mod (bitmask, acrônimo, texto digitado).
 *
 * O que este arquivo protege é o tipo de defeito que não quebra nada: um bit
 * ausente da tabela SOME na decodificação, sem erro nenhum — o score é exibido,
 * o pp é calculado, e só o mod é que não está lá. Foi o que aconteceu com o TD
 * e o AP, e ninguém tinha como notar pela tela: `+NM` numa play de touch é uma
 * resposta perfeitamente plausível.
 *
 * De que lado do `difficultyMods` cada mod cai é medido contra o motor de
 * verdade, no lazerWorker.test.js — aqui ficam só as consequências da decisão.
 */
const test = require('node:test');
const assert = require('node:assert');

const mods = require('../src/mods');

test('bit conhecido não some na decodificação', () => {
  assert.deepStrictEqual(mods.decodeMods(4), ['TD']);
  assert.deepStrictEqual(mods.decodeMods(8192), ['AP']);
  // O caso real que motivou: touch + hidden, que saía como só ['HD'].
  assert.deepStrictEqual(mods.decodeMods(4 | 8), ['TD', 'HD']);
  // Sem mod nenhum continua sendo lista vazia, e não um mod inventado.
  assert.deepStrictEqual(mods.decodeMods(0), []);
});

test('acrônimo e bitmask fecham nos dois sentidos', () => {
  for (const [nome, bit] of Object.entries(mods.MOD_BITS)) {
    assert.equal(mods.modsToBits([nome]), bit, `${nome} não vira o próprio bit`);
    assert.deepStrictEqual(mods.decodeMods(bit), [nome], `${bit} não volta a ser ${nome}`);
  }
});

test('TD é cosmético e AP não é', () => {
  // As estrelas que sustentam isto estão medidas no lazerWorker.test.js. Aqui
  // o que se trava é a consequência: com o AP na lista de cosméticos, o bot
  // exibiria a estrela SEM mods como se fosse a da play.
  assert.deepStrictEqual(mods.difficultyMods(['TD']), []);
  assert.deepStrictEqual(mods.difficultyMods(['AP']), ['AP']);
  assert.deepStrictEqual(mods.difficultyMods(['TD', 'DT']), ['DT']);
});

test('o DT que o NC arrasta sai da tela e da conta', () => {
  // No bitmask do stable o NC acompanha o DT em vez de substituí-lo, então um
  // score de nightcore chega como 576.
  assert.deepStrictEqual(mods.decodeMods(576), ['DT', 'NC']);

  // Fiel ao bitmask, e é assim que tem de continuar: o akatsuki-pp lê a
  // velocidade do BIT do DT, e tirá-lo de lá apagaria o mod inteiro (medido:
  // 39.21pp contra os 96.99 corretos). Quem corta é a borda do lazer.
  assert.deepStrictEqual(mods.stripImpliedDT(['DT', 'NC']), ['NC']);
  assert.deepStrictEqual(mods.stripImpliedDT(['DT', 'NC', 'HD']), ['NC', 'HD']);

  // DT sem NC é DT de verdade e não pode sumir.
  assert.deepStrictEqual(mods.stripImpliedDT(['DT']), ['DT']);
  assert.deepStrictEqual(mods.stripImpliedDT(['HD', 'HR']), ['HD', 'HR']);

  // E a tela: `+DTNC` é o bitmask vazando para o embed.
  assert.equal(mods.formatMods(mods.decodeMods(576)), '+NC');
  // A ordem é a dos bits, então o HD (8) vem antes do NC (512).
  assert.equal(mods.formatMods(mods.decodeMods(576 | 8)), '+HDNC');
  assert.equal(mods.formatMods(mods.decodeMods(64)), '+DT');

  // A lista de quem chamou não é tocada — o formatMods roda dentro de um map
  // sobre os mods do score.
  const original = ['DT', 'NC'];
  mods.stripImpliedDT(original);
  assert.deepStrictEqual(original, ['DT', 'NC']);
});

test('o texto digitado separa o que foi entendido do que não foi', () => {
  assert.deepStrictEqual(mods.parseModTokens('hddt'), { mods: ['HD', 'DT'], unknown: [] });
  assert.deepStrictEqual(mods.parseModTokens('xyhd'), { mods: ['HD'], unknown: ['XY'] });
  assert.deepStrictEqual(mods.parseModTokens(''), { mods: [], unknown: [] });
  // Repetido não vira dois, e separador não conta como caractere.
  assert.deepStrictEqual(mods.parseModTokens('hd, hd dt'), { mods: ['HD', 'DT'], unknown: [] });
});

test('o parseModsString continua tolerante, que é o que o score precisa', () => {
  // Quem lê um score não pode falhar por causa de um token estranho: a play
  // inteira sumiria da lista por causa de um mod que ninguém reconheceu.
  assert.deepStrictEqual(mods.parseModsString('xyhd'), ['HD']);
  assert.deepStrictEqual(mods.parseModsString(null), []);
});

test('a chave de cache não depende da ordem em que os mods chegaram', () => {
  // A API não garante ordem, e sem a forma canônica o mesmo cálculo ocuparia
  // duas linhas do cache — nenhuma delas acertando de forma confiável.
  assert.equal(mods.canonicalMods(['DT', 'HD']), mods.canonicalMods(['HD', 'DT']));
  assert.equal(mods.canonicalMods(['HD', 'HD']), 'HD');
  assert.equal(mods.canonicalMods([]), '');
});

// ─── Rate ajustado ────────────────────────────────────────────────────────────
// O acrônimo deixou de descrever a play: no lazer o DT vem com um `speed_change`
// escolhido por quem jogou. O quanto isso muda está medido contra os motores de
// verdade (lazerWorker.test.js e rosuWorker.test.js); aqui ficam as
// consequências — o que vai para a tela e o que separa uma chave de cache da
// outra.

const dt = (rate) => ({ acronym: 'DT', settings: { speed_change: rate } });

test('o mod com ajuste atravessa as funções sem perder o ajuste', () => {
  // O risco é silencioso: qualquer uma destas funções que trate o objeto como
  // string devolve `undefined` no lugar do mod, ou o descarta, e o cálculo
  // segue adiante com a play errada e sem erro nenhum.
  assert.deepStrictEqual(mods.stripClassic([dt(1.4), 'CL']), [dt(1.4)]);
  assert.deepStrictEqual(mods.difficultyMods([dt(1.4), 'NF']), [dt(1.4)]);
  assert.deepStrictEqual(mods.stripImpliedDT([dt(1.4), 'HD']), [dt(1.4), 'HD']);

  // O bit é o do acrônimo: o ajuste não cabe num bitmask, e é por isso que o
  // rosu-pp recebe o rate como número à parte (ver getMapAttrs).
  assert.equal(mods.modsToBits([dt(1.4), 'HD']), 64 | 8);
});

test('o NC ajustado engole o DT que o bitmask arrasta, e leva o ajuste', () => {
  // O corte é por acrônimo; se ele olhasse o objeto inteiro, um score de
  // nightcore ajustado sairia daqui com os dois mods e o lazer aceleraria duas
  // vezes — que é o defeito que o stripImpliedDT existe para evitar.
  const nc = { acronym: 'NC', settings: { speed_change: 1.3 } };
  assert.deepStrictEqual(mods.stripImpliedDT(['DT', nc]), [nc]);
  assert.equal(mods.formatMods(['DT', nc]), '+NC (1.3x)');
});

test('o rate ajustado aparece na tela, e o normal não', () => {
  assert.equal(mods.formatMods([dt(1.4)]), '+DT (1.4x)');
  assert.equal(mods.formatMods(['HD', dt(1.4)]), '+HDDT (1.4x)');

  // Grudado no acrônimo, `+HDDT1.4` seria lido como um mod chamado DT1.
  assert.equal(mods.formatMods([dt(1.9), 'HR']), '+DTHR (1.9x)');

  // Um DT comum não ganha texto nenhum — nem quando o valor padrão vem escrito.
  assert.equal(mods.formatMods(['DT']), '+DT');
  assert.equal(mods.formatMods([dt(1.5)]), '+DT');
  assert.equal(mods.formatMods([{ acronym: 'HT', settings: { speed_change: 0.75 } }]), '+HT');
  assert.equal(mods.formatMods([{ acronym: 'HT', settings: { speed_change: 0.9 } }]), '+HT (0.9x)');
});

test('o rate ajustado separa a chave de cache, e o padrão não', () => {
  // A `map_difficulty` não tem TTL: colidir aqui é gravar a estrela de 1,5x na
  // linha que o 1,4x vai ler, para sempre.
  assert.notEqual(mods.canonicalMods([dt(1.4)]), mods.canonicalMods(['DT']));
  assert.notEqual(mods.canonicalMods([dt(1.4)]), mods.canonicalMods([dt(1.45)]));

  // E o contrário também precisa valer, senão as linhas já gravadas — que estão
  // certas, porque um DT sem ajuste é 1,5x — deixariam de ser encontradas.
  assert.equal(mods.canonicalMods([dt(1.5)]), mods.canonicalMods(['DT']));

  // A ordem dos ajustes dentro do mod não muda a chave, pelo mesmo motivo que a
  // ordem dos mods não muda: o JSON da API não promete nenhuma das duas.
  assert.equal(
    mods.canonicalMods([{ acronym: 'DT', settings: { speed_change: 1.4, adjust_pitch: true } }]),
    mods.canonicalMods([{ acronym: 'DT', settings: { adjust_pitch: true, speed_change: 1.4 } }]),
  );
});

test('o rate digitado encaixa no mod de velocidade', () => {
  // Antes o scanner lia de dois em dois caracteres e cortava dígitos: `dt1.4`
  // virava `DT` e o 1.4 sumia sem deixar sinal.
  assert.deepStrictEqual(mods.parseModsString('dt1.4'), [dt(1.4)]);

  // As três formas que as pessoas escrevem dizem a mesma coisa — inclusive a
  // que o próprio bot imprime, `+HDDT (1.4x)`, que assim volta a ser digitável.
  assert.deepStrictEqual(mods.parseModsString('hddt 1.4x'), ['HD', dt(1.4)]);
  assert.deepStrictEqual(mods.parseModsString('hddt (1.4)'), ['HD', dt(1.4)]);

  // A posição do número não importa: só existe um mod de velocidade por play,
  // então não há a quem mais ele possa pertencer.
  assert.deepStrictEqual(mods.parseModsString('dt1.4hr'), [dt(1.4), 'HR']);
  assert.deepStrictEqual(mods.parseModsString('dthr 1.4'), [dt(1.4), 'HR']);

  // O X colado no número não pode virar meio token de mod.
  assert.deepStrictEqual(mods.parseModTokens('dt1.4x'), { mods: [dt(1.4)], unknown: [] });

  // Nem o número pode colar dois acrônimos que estavam separados por ele.
  assert.deepStrictEqual(mods.parseModTokens('hd1.4dt'), { mods: ['HD', dt(1.4)], unknown: [] });

  // HT e DC andam para o outro lado, e o DC não tem bit legado — sem ele entre
  // os tokens conhecidos, `dc0.8` seria recusado por um mod que o motor conhece.
  assert.deepStrictEqual(
    mods.parseModsString('ht0.9'), [{ acronym: 'HT', settings: { speed_change: 0.9 } }],
  );
  assert.deepStrictEqual(
    mods.parseModsString('dc0.8'), [{ acronym: 'DC', settings: { speed_change: 0.8 } }],
  );
});

test('rate que o motor truncaria é recusado, e leva o mod junto', () => {
  // Medido: o motor aceita qualquer número e trunca em silêncio para a faixa do
  // mod — DT a 0,5x sai calculado a 1,01x. Sem recusar, a tela diria
  // "+DT (0.5x)" ao lado do pp de outra velocidade.
  assert.deepStrictEqual(mods.parseModTokens('dt0.5'), { mods: [], unknown: ['DT0.5'] });
  assert.deepStrictEqual(mods.parseModTokens('dt2.5'), { mods: [], unknown: ['DT2.5'] });
  assert.deepStrictEqual(mods.parseModTokens('ht1.4'), { mods: [], unknown: ['HT1.4'] });

  // As pontas da faixa valem: DT de 1.01 a 2, HT de 0.5 a 0.99.
  assert.deepStrictEqual(mods.parseModsString('dt1.01'), [dt(1.01)]);
  assert.deepStrictEqual(mods.parseModsString('dt2'), [dt(2)]);
  assert.deepStrictEqual(
    mods.parseModsString('ht0.5'), [{ acronym: 'HT', settings: { speed_change: 0.5 } }],
  );

  // Número sem mod de velocidade a que se ligar não é pedido nenhum, e dois
  // números não têm desempate.
  assert.deepStrictEqual(mods.parseModTokens('hd1.4'), { mods: ['HD'], unknown: ['1.4'] });
  assert.deepStrictEqual(mods.parseModTokens('dt1.4hr1.2'), { mods: ['DT', 'HR'], unknown: ['1.4', '1.2'] });

  // Rate igual ao padrão do mod é o mod puro: `dt1.5` e `dt` são a mesma play e
  // precisam cair na mesma linha de cache.
  assert.deepStrictEqual(mods.parseModsString('dt1.5'), ['DT']);
});

test('o texto sem rate continua sendo lido como sempre foi', () => {
  // A leitura de dois em dois caracteres não mudou, e é dela que dependem os
  // mods que já eram digitáveis.
  assert.deepStrictEqual(mods.parseModsString('hddt'), ['HD', 'DT']);
  assert.deepStrictEqual(mods.parseModTokens('xyhd'), { mods: ['HD'], unknown: ['XY'] });
  assert.deepStrictEqual(mods.parseModsString('hd, hd dt'), ['HD', 'DT']);
  assert.deepStrictEqual(mods.parseModsString(''), []);

  // O SV2 continua intocável por quem digita: o `2` sai como número e o `SV`
  // não é token conhecido (ver o comentário do MOD_BITS).
  assert.deepStrictEqual(mods.parseModTokens('sv2'), { mods: [], unknown: ['SV', '2'] });
});

test('o clockRate é o que o bitmask não sabe dizer', () => {
  // É o número que vai para o rosu-pp ao lado dos bits. Ele precisa sair mesmo
  // quando o rate é o padrão do mod: o bit do DT o rosu deduz sozinho, mas o DC
  // não tem bit nenhum, e sem isto uma play desacelerada mostraria o BPM cheio.
  assert.equal(mods.clockRate([dt(1.4)]), 1.4);
  assert.equal(mods.clockRate(['DT']), 1.5);
  assert.equal(mods.clockRate(['DC']), 0.75);
  assert.equal(mods.clockRate(['HD', 'HR']), null);
  assert.equal(mods.clockRate([]), null);

  // O NC do bitmask vem sempre acompanhado do DT, e os dois valem o mesmo rate —
  // a velocidade não dobra por causa disso.
  assert.equal(mods.clockRate(['DT', 'NC']), 1.5);
});
