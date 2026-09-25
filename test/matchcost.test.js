/**
 * A fórmula do /matchcost — porte do `match_costs.rs` do Bathbot.
 *
 * Partidas montadas à mão, com o valor esperado calculado à mão no comentário
 * de cada teste. Os scores são redondos de propósito: a conta cabe de cabeça,
 * e o que se confere é a REGRA (qual jogo entra, quem ganha bônus), não o
 * ponto flutuante.
 *
 * Onde o ponto flutuante é o assunto (o arredondamento em f32 do Bathbot), o
 * teste diz — e os números esperados foram conferidos contra uma réplica em
 * Rust do `process_match`, compilada com os mesmos tipos (`f32`, `HashMap` com
 * hasher identidade), que também comparou o porte em ~50 mil partidas
 * aleatórias sem divergência.
 *
 * Nada aqui precisa de rede nem de banco.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  parseMatchInput, podeVerPartida, selecionarJogos, calcularMatchCost,
  arredondar, chaveMods, vencedor, contarVitorias, ordemDoHashMap,
} = require('../src/commands/osu/matchcost/logic');

// ─── Montagem ─────────────────────────────────────────────────────────────────

const NOMES = { 1: 'Alice', 2: 'Bruno', 3: 'Carla', 4: 'Davi' };

/** `[id, score]`, `[id, score, mods]` ou `[id, score, mods, team]`. */
function jogo(scores, { teamType = 'head-to-head', endedAt = '2026-09-01T00:00:00Z' } = {}) {
  return {
    endedAt,
    teamType,
    scores: scores.map(([userId, score, mods = [], team = 'none']) => ({
      userId, username: NOMES[userId] ?? null, team, mods, score,
    })),
  };
}

const partida = (games, finished = true) => ({ name: 'OWC: (A) vs (B)', finished, games });

/** Todos os jogadores do resultado, por id. */
function porId(resultado) {
  const lista = resultado.tipo === 'times'
    ? [...resultado.azul.jogadores, ...resultado.vermelho.jogadores]
    : resultado.jogadores;
  return Object.fromEntries(lista.map(e => [e.userId, e]));
}

const perto = (atual, esperado, msg) =>
  assert.ok(Math.abs(atual - esperado) < 1e-5, `${msg ?? ''} esperado ${esperado}, veio ${atual}`);

// ─── Head-to-head ─────────────────────────────────────────────────────────────

test('head-to-head: performance, participação e ordem', () => {
  // Jogo 1: 300k, 200k, 100k → média 200k → Alice 1.5, Bruno 1.0, Carla 0.5
  // Jogo 2: 100k, 100k (Carla fora) → média 100k → Alice 1.0, Bruno 1.0
  //
  // Alice: média(1.5, 1.0) = 1.25 + 0.5 = 1.75; jogou 2 de 2 → exp 1 → 1.5^1 = 1.5
  //        → 1.75 × 1.5 = 2.625
  // Bruno: média(1.0, 1.0) = 1.0 + 0.5 = 1.5 × 1.5 = 2.25
  // Carla: 0.5 + 0.5 = 1.0; jogou 1 de 2 → exp 0 → 1.5^0 = 1 → 1.0
  const r = calcularMatchCost(partida([
    jogo([[1, 300000], [2, 200000], [3, 100000]]),
    jogo([[1, 100000], [2, 100000]]),
  ]));

  assert.equal(r.tipo, 'todos');
  assert.deepEqual(r.jogadores.map(e => e.userId), [1, 2, 3]);
  assert.equal(r.mvp, 1);

  const j = porId(r);
  perto(j[1].performanceCost, 1.75);
  perto(j[1].participationBonus, 1.5);
  perto(j[1].matchCost, 2.625);
  perto(j[2].matchCost, 2.25);
  perto(j[3].participationBonus, 1);
  perto(j[3].matchCost, 1.0);
  // Head-to-head não tem tiebreaker: não há times para empatar.
  assert.ok(Object.values(j).every(e => e.tiebreakerBonus === 0));
  // 2.625 é meio-centésimo exato: o `round` do Rust arredonda para longe do zero.
  assert.equal(arredondar(j[1].matchCost), '2.63');
});

test('participação parcial: 2 de 3 jogos', () => {
  // Três jogos iguais (todo mundo 100k → performance 1.0 em cada), Carla
  // fora do terceiro. Carla: exp = (2 - 1) / (3 - 1) = 0.5
  //   0.5^0.6 = e^(0.6 × ln 0.5) = e^(-0.415888) = 0.659754
  //   1.5^0.659754 = e^(0.659754 × 0.405465) = e^(0.267507) = 1.306703
  //   match cost = (1.0 + 0.5) × 1.306703 = 1.960054
  const r = calcularMatchCost(partida([
    jogo([[1, 100000], [2, 100000], [3, 100000]]),
    jogo([[1, 100000], [2, 100000], [3, 100000]]),
    jogo([[1, 100000], [2, 100000]]),
  ]));
  const j = porId(r);
  perto(j[3].participationBonus, 1.306703);
  perto(j[3].matchCost, 1.960054);
  perto(j[1].matchCost, 2.25);
});

test('participação com um jogo só: exp = 0, bônus 1', () => {
  // Sem o caso especial seria 0/0. Com ele: 1.5^(0^0.6) = 1.5^0 = 1.
  // Jogo: 200k, 100k, 300k → média 200k → 1.0, 0.5, 1.5 → +0.5 = 1.5, 1.0, 2.0
  const r = calcularMatchCost(partida([jogo([[1, 200000], [2, 100000], [3, 300000]])]));
  const j = porId(r);
  for (const e of Object.values(j)) assert.equal(e.participationBonus, 1);
  perto(j[1].matchCost, 1.5);
  perto(j[2].matchCost, 1.0);
  perto(j[3].matchCost, 2.0);
  assert.equal(r.mvp, 3);
});

test('head-to-head de dois vira "times" de um, com placar de mapas', () => {
  // Jogos: Alice ganha o 1º e o 3º, Bruno o 2º → 2 x 1.
  const r = calcularMatchCost(partida([
    jogo([[1, 300000], [2, 100000]]),
    jogo([[1, 100000], [2, 300000]]),
    jogo([[1, 200000], [2, 100000]]),
  ]));
  assert.equal(r.tipo, 'times');
  const [azul] = r.azul.jogadores;
  const [vermelho] = r.vermelho.jogadores;
  const vitorias = { [azul.userId]: r.azul.vitorias, [vermelho.userId]: r.vermelho.vitorias };
  assert.deepEqual(vitorias, { 1: 2, 2: 1 });
});

// ─── Team VS e tiebreaker ─────────────────────────────────────────────────────

// Azul: Alice (1) e Bruno (2). Vermelho: Carla (3) e Davi (4).
// Cada jogo com o score de cada um, em milhares, e quem ganhou (soma do time):
//
//   jogo  Alice Bruno Carla Davi   média  azul x vermelho
//   1     400   200   100   100    200    600 x 200  azul
//   2     100   100   300   300    200    200 x 600  vermelho
//   3     300   100   100   100    150    400 x 200  azul
//   4     100   100   100   300    150    200 x 400  vermelho
//   5     200   200   100   100    150    400 x 200  azul
//
// Performance cost por jogo (score / média):
//   Alice 2, 0.5, 2, 2/3, 4/3        soma 6.5
//   Bruno 1, 0.5, 2/3, 2/3, 4/3      soma 4.1667
//   Carla 0.5, 1.5, 2/3, 2/3, 2/3    soma 4
//   Davi  0.5, 1.5, 2/3, 2, 2/3      soma 5.3333
const TIMES = { 1: 'blue', 2: 'blue', 3: 'red', 4: 'red' };
const tvs = (a, b, c, d) => jogo(
  [[1, a * 1000], [2, b * 1000], [3, c * 1000], [4, d * 1000]].map(([id, s]) => [id, s, [], TIMES[id]]),
  { teamType: 'team-vs' },
);
const CINCO = [tvs(400, 200, 100, 100), tvs(100, 100, 300, 300), tvs(300, 100, 100, 100), tvs(100, 100, 100, 300), tvs(200, 200, 100, 100)];

test('team VS com tiebreaker: 3 x 2, cinco jogos, partida encerrada', () => {
  // Todos jogaram tudo → participação 1.5. Tiebreaker = jogo 5.
  //   Alice: 6.5/5 = 1.3 + 0.5 = 1.8 × 1.5 = 2.7; TB min(0.5, 0.25 × 4/3) = 0.3333 → 3.0333
  //   Bruno: 4.1667/5 = 0.8333 + 0.5 = 1.3333 × 1.5 = 2.0; TB 0.3333 → 2.3333
  //   Carla: 4/5 = 0.8 + 0.5 = 1.3 × 1.5 = 1.95; TB 0.25 × 2/3 = 0.1667 → 2.1167
  //   Davi:  5.3333/5 = 1.0667 + 0.5 = 1.5667 × 1.5 = 2.35; TB 0.1667 → 2.5167
  const r = calcularMatchCost(partida(CINCO));

  assert.equal(r.tipo, 'times');
  assert.equal(r.azul.vitorias, 3);
  assert.equal(r.vermelho.vitorias, 2);
  assert.deepEqual(r.azul.jogadores.map(e => e.userId), [1, 2]);
  assert.deepEqual(r.vermelho.jogadores.map(e => e.userId), [4, 3]);
  assert.equal(r.mvp, 1);

  const j = porId(r);
  perto(j[1].tiebreakerBonus, 1 / 3);
  perto(j[3].tiebreakerBonus, 1 / 6);
  perto(j[1].matchCost, 2.7 + 1 / 3);
  perto(j[2].matchCost, 2.0 + 1 / 3);
  perto(j[3].matchCost, 1.95 + 1 / 6);
  perto(j[4].matchCost, 2.35 + 1 / 6);
  assert.deepEqual([1, 2, 3, 4].map(id => arredondar(j[id].matchCost)), ['3.03', '2.33', '2.12', '2.52']);
});

test('tiebreaker tem teto de 0.5', () => {
  // Jogo 5 trocado: Alice 700k e o resto 100k → média 250k → Alice 2.8 no
  // último jogo → 0.25 × 2.8 = 0.7, cortado em 0.5. Placar continua 3 x 2.
  const r = calcularMatchCost(partida([...CINCO.slice(0, 4), tvs(700, 100, 100, 100)]));
  assert.equal(porId(r)[1].tiebreakerBonus, 0.5);
});

test('tiebreaker só vale para quem jogou o último jogo', () => {
  // Davi fora do jogo 5 (o azul ainda ganha: 400 x 100).
  const ultimo = jogo([[1, 200000, [], 'blue'], [2, 200000, [], 'blue'], [3, 100000, [], 'red']], { teamType: 'team-vs' });
  const r = calcularMatchCost(partida([...CINCO.slice(0, 4), ultimo]));
  const j = porId(r);
  assert.equal(j[4].tiebreakerBonus, 0);
  assert.ok(j[3].tiebreakerBonus > 0);
});

test('sem tiebreaker quando a diferença é 2 (4 x 2, seis jogos)', () => {
  // Sexto jogo igual ao quinto (azul ganha) → 4 x 2. Ninguém ganha bônus.
  //   Alice: (6.5 + 4/3)/6 = 1.3056 + 0.5 = 1.8056 × 1.5 = 2.7083
  //   Bruno: (4.1667 + 4/3)/6 = 0.9167 + 0.5 = 1.4167 × 1.5 = 2.125
  //   Carla: (4 + 2/3)/6 = 0.7778 + 0.5 = 1.2778 × 1.5 = 1.9167
  //   Davi:  (5.3333 + 2/3)/6 = 1.0 + 0.5 = 1.5 × 1.5 = 2.25
  const r = calcularMatchCost(partida([...CINCO, tvs(200, 200, 100, 100)]));
  assert.equal(r.azul.vitorias, 4);
  assert.equal(r.vermelho.vitorias, 2);

  const j = porId(r);
  assert.ok(Object.values(j).every(e => e.tiebreakerBonus === 0));
  perto(j[1].matchCost, 2.708333);
  perto(j[2].matchCost, 2.125);
  perto(j[3].matchCost, 1.916667);
  perto(j[4].matchCost, 2.25);
});

test('sem tiebreaker com a partida em andamento, ou com 4 jogos ou menos', () => {
  const aberta = porId(calcularMatchCost(partida(CINCO, false)));
  perto(aberta[1].matchCost, 2.7);

  // Quatro jogos, 2 x 2... e ainda que fosse 3 x 1, "mais de 4" é regra.
  const quatro = calcularMatchCost(partida([CINCO[0], CINCO[1], CINCO[2], CINCO[4]]));
  assert.equal(quatro.azul.vitorias, 3);
  assert.ok(Object.values(porId(quatro)).every(e => e.tiebreakerBonus === 0));
});

test('team VS: o time é o do primeiro jogo, e quem não tem time some da lista', () => {
  // Alice começa no azul e troca de lado depois; o Bathbot guarda o primeiro.
  // Eva (5) entra como "none" numa sala Team VS: conta na média, mas não
  // aparece em nenhum time — como lá.
  const r = calcularMatchCost(partida([
    jogo([[1, 100000, [], 'blue'], [2, 100000, [], 'red'], [5, 100000, [], 'none']], { teamType: 'team-vs' }),
    jogo([[1, 100000, [], 'red'], [2, 100000, [], 'red']], { teamType: 'team-vs' }),
  ]));
  assert.deepEqual(r.azul.jogadores.map(e => e.userId), [1]);
  assert.deepEqual(r.vermelho.jogadores.map(e => e.userId), [2]);
});

test('placar: empate na soma vai para o vermelho, jogo sem score é de ninguém', () => {
  // A ordem de iteração do HashMap do Bathbot é none, blue, red, e o
  // `max_by_key` fica com o último dos máximos.
  assert.equal(vencedor([{ team: 'blue', score: 5 }, { team: 'red', score: 5 }]), 'red');
  assert.equal(vencedor([{ team: 'blue', score: 6 }, { team: 'red', score: 5 }]), 'blue');
  assert.equal(vencedor([]), 'none');

  // 5 x 0 não é diferença 5: sem vitória do vermelho não há entrada dele.
  assert.equal(contarVitorias(['blue', 'blue', 'blue', 'blue', 'blue']).diferenca, 0);
  assert.equal(contarVitorias(['blue', 'red', 'blue']).diferenca, 1);
});

// ─── Quais jogos entram ───────────────────────────────────────────────────────

const TRES = [
  jogo([[1, 300000], [2, 100000], [3, 200000]]),
  jogo([[1, 100000], [2, 300000], [3, 200000]]),
  jogo([[1, 200000], [2, 200000], [3, 200000]]),
];

test('warmups: os primeiros jogos não entram', () => {
  // Pulando o 1º, sobram o 2º (Alice 0.5, Bruno 1.5, Carla 1.0) e o 3º (todos 1.0).
  //   Alice: (0.5 + 1)/2 = 0.75 + 0.5 = 1.25 × 1.5 = 1.875
  //   Bruno: (1.5 + 1)/2 = 1.25 + 0.5 = 1.75 × 1.5 = 2.625
  const r = calcularMatchCost(partida(TRES), { warmups: 1 });
  assert.equal(r.jogos, 2);
  perto(porId(r)[1].matchCost, 1.875);
  perto(porId(r)[2].matchCost, 2.625);
});

test('warmups: jogo abortado não conta como warmup', () => {
  // O filtro de abortados vem antes do `skip`: com um abortado na frente,
  // `warmups: 1` ainda pula o primeiro jogo DE VERDADE.
  const abortado = jogo([[1, 900000], [2, 100000], [3, 100000]], { endedAt: null });
  const r = calcularMatchCost(partida([abortado, ...TRES]), { warmups: 1 });
  assert.equal(r.jogos, 2);
  perto(porId(r)[1].matchCost, 1.875);
});

test('warmups demais: nenhum jogo', () => {
  assert.deepEqual(calcularMatchCost(partida(TRES), { warmups: 3 }), { tipo: 'vazio', jogos: 0 });
});

test('skip_last: os últimos jogos não entram', () => {
  // Sem o 3º: jogo 1 (Alice 1.5, Bruno 0.5, Carla 1.0) e jogo 2 (0.5, 1.5, 1.0).
  //   Alice e Bruno: (1.5 + 0.5)/2 = 1.0 + 0.5 = 1.5 × 1.5 = 2.25
  const r = calcularMatchCost(partida(TRES), { skipLast: 1 });
  assert.equal(r.jogos, 2);
  perto(porId(r)[1].matchCost, 2.25);
  perto(porId(r)[2].matchCost, 2.25);
});

test('skip_last maior que a partida: nenhum jogo (e não "todos", como no Bathbot)', () => {
  // Lá a subtração de usize dá a volta e o truncate não corta nada — ver o
  // comentário de `selecionarJogos`.
  assert.equal(calcularMatchCost(partida(TRES), { skipLast: 5 }).tipo, 'vazio');
  assert.equal(calcularMatchCost(partida(TRES), { warmups: 1, skipLast: 2 }).tipo, 'vazio');
});

test('score 0 sai antes da média', () => {
  // Alice 200k, Bruno 100k, Carla 0, Davi 300k → a média é de TRÊS scores:
  // 600k / 3 = 200k (e não 600k / 4 = 150k).
  //   Alice 1.0 + 0.5 = 1.5, Bruno 0.5 + 0.5 = 1.0, Davi 1.5 + 0.5 = 2.0
  // Carla não aparece: só jogou com score 0.
  const r = calcularMatchCost(partida([jogo([[1, 200000], [2, 100000], [3, 0], [4, 300000]])]));
  const j = porId(r);
  assert.equal(j[3], undefined);
  perto(j[1].matchCost, 1.5);
  perto(j[2].matchCost, 1.0);
  perto(j[4].matchCost, 2.0);
});

test('jogo abortado não entra em nada', () => {
  // Só o 1º jogo conta: todos 100k → 1.0 + 0.5 = 1.5, participação de 1 jogo = 1.
  const r = calcularMatchCost(partida([
    jogo([[1, 100000], [2, 100000], [3, 100000]]),
    jogo([[1, 900000], [2, 100000], [3, 100000]], { endedAt: null }),
  ]));
  assert.equal(r.jogos, 1);
  for (const e of Object.values(porId(r))) perto(e.matchCost, 1.5);
});

test('jogo sem score nenhum continua contando no total de jogos', () => {
  // Como no Bathbot: o jogo fica, vazio. Alice e Bruno jogaram 1 de 2 → exp 0.
  const r = calcularMatchCost(partida([
    jogo([[1, 100000], [2, 100000], [3, 100000]]),
    jogo([[1, 0], [2, 0]]),
  ]));
  assert.equal(r.jogos, 2);
  perto(porId(r)[1].participationBonus, 1);
});

test('ez_mult multiplica só quem jogou com EZ, depois do corte de score 0', () => {
  // Alice 100k com EZ, Bruno e Carla 150k sem mods.
  //   Com 1.5: Alice vira 150k → média 150k → todos 1.0 + 0.5 = 1.5
  //   Sem:     média 133.333k → Alice 0.75 + 0.5 = 1.25, Bruno 1.125 + 0.5 = 1.625
  const jogos = [jogo([[1, 100000, ['EZ']], [2, 150000], [3, 150000]])];

  const com = porId(calcularMatchCost(partida(jogos), { ezMult: 1.5 }));
  for (const e of Object.values(com)) perto(e.matchCost, 1.5);

  const sem = porId(calcularMatchCost(partida(jogos)));
  perto(sem[1].matchCost, 1.25);
  perto(sem[2].matchCost, 1.625);

  // O `as u32` do Rust trunca: 100001 × 1.5 = 150001.5 → 150001.
  const [sel] = selecionarJogos([jogo([[1, 100001, ['EZ', 'NF']], [2, 0, ['EZ']]])], { ezMult: 1.5 });
  assert.deepEqual(sel.scores.map(s => s.score), [150001]);
});

// ─── Mods ─────────────────────────────────────────────────────────────────────

test('NoFail não conta como combinação de mods', () => {
  // Cinco jogos, todo mundo 100k em todos → performance 1.0 + 0.5 = 1.5, e
  // participação 1.5 (jogaram tudo). Muda só o fator de mods:
  //   Alice: NM, NF, HD, HDNF, HR → sem o NF são NM, HD, HR = 3 → 1 + 0.02 × 1 = 1.02
  //          (contando o NF seriam 5 → 1.06)
  //   Bruno: NM × 5 → 1 combinação → 1
  //   Carla: NM, HD, HR, DT, FL = 5 → 1 + 0.02 × 3 = 1.06
  const mods = { 1: [[], ['NF'], ['HD'], ['HD', 'NF'], ['HR']], 3: [[], ['HD'], ['HR'], ['DT'], ['FL']] };
  const jogos = [0, 1, 2, 3, 4].map(i => jogo([[1, 100000, mods[1][i]], [2, 100000], [3, 100000, mods[3][i]]]));
  const j = porId(calcularMatchCost(partida(jogos)));

  perto(j[1].modsBonus, 1.02);
  assert.equal(j[2].modsBonus, 1);
  perto(j[3].modsBonus, 1.06);
  perto(j[1].matchCost, 2.25 * 1.02);
  perto(j[3].matchCost, 2.25 * 1.06);

  assert.equal(chaveMods(['HD', 'NF']), chaveMods(['HD']));
  assert.equal(chaveMods(['HR', 'HD']), chaveMods(['HD', 'HR']));
});

test('o arredondamento é o do Bathbot, em f32', () => {
  // Os dois casos do teste anterior caem perto do meio-centésimo, onde f32 e
  // f64 discordam — conferido contra a réplica em Rust:
  //   2.25 × 1.02 = 2.295 → em f32, 100 × 2.2949999 = 229.5 → "2.30"
  //                        (em f64 seria "2.29")
  //   2.25 × 1.06 = 2.385 → em f32, 100 × 2.3849998 = 238.49998 → "2.38"
  const mods = { 1: [[], ['NF'], ['HD'], ['HD', 'NF'], ['HR']], 3: [[], ['HD'], ['HR'], ['DT'], ['FL']] };
  const jogos = [0, 1, 2, 3, 4].map(i => jogo([[1, 100000, mods[1][i]], [2, 100000], [3, 100000, mods[3][i]]]));
  const j = porId(calcularMatchCost(partida(jogos)));
  assert.equal(arredondar(j[1].matchCost), '2.30');
  assert.equal(arredondar(j[3].matchCost), '2.38');

  // 1.005 em f32 é 1.00499999523; × 100 em f32 dá 100.5 → 101.
  assert.equal(arredondar(1.005), '1.01');
  assert.equal(arredondar(0.5), '0.50');
  assert.equal(arredondar(10.123), '10.12');
});

// ─── A ordem do HashMap do Bathbot ────────────────────────────────────────────

test('ordemDoHashMap reproduz o HashMap<u32, _, IntHasher> do Rust', () => {
  // Ordens tiradas de um programa Rust (rustc 1.94, std HashMap) que insere os
  // ids na ordem da primeira coluna: `default` e depois `with_capacity` com a
  // ordem do primeiro — o mesmo caminho do `match_costs` do Bathbot.
  const casos = [
    [[7, 3], [3, 7], [7, 3]],
    [[2, 6, 10, 14, 1], [1, 10, 2, 6, 14], [1, 10, 2, 6, 14]],
    [[9001, 124493, 2, 7562902, 4787, 39828, 5, 100],
      [2, 4787, 39828, 5, 7562902, 100, 9001, 124493],
      [2, 4787, 39828, 5, 7562902, 100, 9001, 124493]],
    [Array.from({ length: 20 }, (_, i) => (i + 1) * 16),
      [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 16, 48, 80, 112, 144, 176, 208, 240, 272, 304],
      [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 16, 48, 80, 112, 144, 176, 208, 240, 272, 304]],
    [[11367222, 4504101, 8472302, 7562902, 12408961, 2831793, 9269034, 5155744,
      3533719, 10263032, 2927561, 17214386, 4001213, 7813296, 11408405, 6447255],
    [5155744, 12408961, 4504101, 2927561, 9269034, 8472302, 7813296, 2831793,
      17214386, 11408405, 7562902, 11367222, 3533719, 10263032, 6447255, 4001213],
    [5155744, 12408961, 4504101, 2927561, 9269034, 8472302, 7813296, 2831793,
      17214386, 11408405, 7562902, 11367222, 3533719, 10263032, 6447255, 4001213]],
  ];
  for (const [ids, padrao, comCapacidade] of casos) {
    const primeira = ordemDoHashMap(ids);
    assert.deepEqual(primeira, padrao);
    assert.deepEqual(ordemDoHashMap(primeira, primeira.length), comCapacidade);
  }
});

test('empate exato: MVP e lado do 1v1 seguem a ordem do HashMap', () => {
  // Dois SS no mesmo mapa dão o mesmo score. Com ids 3 e 7, a tabela do
  // Bathbot percorre 7 antes de 3 (ver o caso [7, 3] acima): o 7 é o MVP no
  // empate e vai para o azul — e por isso PERDE o jogo empatado, que o placar
  // dá ao vermelho.
  const r = calcularMatchCost(partida([
    jogo([[7, 500000], [3, 500000]]),
  ]));
  assert.equal(r.mvp, 7);
  assert.equal(r.azul.jogadores[0].userId, 7);
  assert.equal(r.azul.vitorias, 0);
  assert.equal(r.vermelho.vitorias, 1);
});

// ─── De onde vem a partida ────────────────────────────────────────────────────

const SERVIDORES = [
  { key: 'official', kind: 'official', webUrl: 'https://osu.ppy.sh' },
  { key: 'akatsuki', kind: 'ripple', webUrl: 'https://akatsuki.gg' },
  { key: 'ezpp', kind: 'banchopy', webUrl: 'https://ez-pp.farm' },
  { key: 'daycore', kind: 'banchopy', webUrl: 'https://daycore.org' },
];

test('parseMatchInput: id, link do Bancho e link do servidor privado', () => {
  assert.deepEqual(parseMatchInput('58320988', SERVIDORES), { key: null, id: 58320988 });
  assert.deepEqual(parseMatchInput('https://osu.ppy.sh/community/matches/58320988', SERVIDORES), { key: 'official', id: 58320988 });
  assert.deepEqual(parseMatchInput('https://osu.ppy.sh/mp/58320988', SERVIDORES), { key: 'official', id: 58320988 });
  assert.deepEqual(parseMatchInput('osu.ppy.sh/community/matches/1?x=1#y', SERVIDORES), { key: 'official', id: 1 });
  assert.deepEqual(parseMatchInput('https://daycore.org/matches/42', SERVIDORES), { key: 'daycore', id: 42 });
  assert.deepEqual(parseMatchInput('https://www.daycore.org/matches/42/', SERVIDORES), { key: 'daycore', id: 42 });
  // O servidor é reconhecido pelo site do registro — sem ele, o link não é de ninguém.
  assert.equal(parseMatchInput('https://daycore.org/matches/42', SERVIDORES.slice(0, 3)), null);
  // Servidor conhecido mas sem as tabelas: quem decide a resposta é o comando.
  assert.deepEqual(parseMatchInput('https://ez-pp.farm/matches/7', SERVIDORES), { key: 'ezpp', id: 7 });
});

test('parseMatchInput: o que não é partida', () => {
  for (const lixo of ['', 'abc', 'https://osu.ppy.sh/users/2', 'https://daycore.org/u/5',
    'https://daycore.org/community/matches/1', 'https://exemplo.com/matches/1', '99999999999']) {
    assert.equal(parseMatchInput(lixo, SERVIDORES), null, lixo);
  }
});

test('partida privada: só quem jogou vê', () => {
  assert.equal(podeVerPartida({ private: false }, false), true);
  assert.equal(podeVerPartida({ private: true }, true), true);
  assert.equal(podeVerPartida({ private: true }, false), false);
  assert.equal(podeVerPartida({ private: true }, undefined), false);
});

test('head-to-head sem nenhum score acima de 0: embed com aviso, não descrição vazia', () => {
  const { montarEmbeds } = require('../src/commands/osu/matchcost/embed');
  const s = require('../src/i18n/pt')({ ADMIN: 'Servidor' });
  const r = calcularMatchCost(partida([jogo([[1, 0], [2, 0]])]));
  assert.deepStrictEqual(r.jogadores, []);
  const embeds = montarEmbeds({
    partida: partida([]), resultado: r, id: 1,
    server: { kind: 'private', webUrl: 'https://exemplo', label: 'Servidor' },
    opcoes: { warmups: 0, ezMult: 1 }, urlDoJogador: id => `https://exemplo/u/${id}`,
  }, s);
  assert.equal(embeds.length, 1);
  assert.equal(embeds[0].data.description, s.matchcost_no_scores);
});

test('cor do embed: time com mais mapas, neutra no empate e fora de Team VS', () => {
  const { corDoResultado, COR } = require('../src/commands/osu/matchcost/embed');
  const times = (a, v) => ({ tipo: 'times', azul: { vitorias: a }, vermelho: { vitorias: v } });
  assert.equal(corDoResultado(times(3, 1)), COR.blue);
  assert.equal(corDoResultado(times(1, 3)), COR.red);
  assert.equal(corDoResultado(times(2, 2)), COR.neutra);
  assert.equal(corDoResultado({ tipo: 'todos' }), COR.neutra);
  assert.equal(corDoResultado({ tipo: 'vazio' }), COR.neutra);
});
