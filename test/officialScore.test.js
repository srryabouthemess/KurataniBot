/**
 * Normalização do formato novo de score da API oficial.
 *
 * O bot passou a pedir `x-api-version` porque o formato antigo OMITE o mod CL —
 * o único sinal de que a play foi jogada no stable. Sem ele o cálculo de PP
 * escolhia mecânica de lazer para score que não é de lazer, e o rosu-pp então
 * ignora o combo: 18,9% de erro médio contra o pp oficial, contra 7,3% com o CL.
 *
 * O que precisa continuar valendo depois da troca:
 *  - o CL chega, porque é dele que depende a escolha da mecânica;
 *  - o `statistics` novo é ESPARSO (zero não vem), e um FC não pode virar
 *    `undefined` misses;
 *  - os campos que mudaram de nome continuam legíveis pelos nomes antigos, que
 *    é o que o resto do bot usa.
 */
const test = require('node:test');
const assert = require('node:assert');

const officialApi = require('../src/osu/officialApi');
const { normalizeScore } = officialApi;
const { stripClassic, difficultyMods, modsToBits, formatMods, clockRate } = require('../src/mods');
const { engineMods } = require('../src/pp');

/** Score como a API responde com x-api-version: um FC de stable, com CL. */
const FC_STABLE = {
  mods: [{ acronym: 'DT' }, { acronym: 'CL' }],
  statistics: { great: 268, ok: 5 },     // sem `meh`, sem `miss`: são zero
  ended_at: '2026-02-23T20:16:07Z',
  legacy_score_id: 4988081501,
  is_perfect_combo: true,
  legacy_total_score: 12345678,
  max_combo: 402,
  pp: 340.728,
};

test('o mod CL chega — é dele que depende a mecânica do cálculo', () => {
  const s = normalizeScore(FC_STABLE);
  assert.deepEqual(s.mods, ['DT', 'CL']);
});

test('CL é exibido, mas não conta como mod de dificuldade', () => {
  const s = normalizeScore(FC_STABLE);

  // Vai para a tela junto dos outros: é o que separa play de mecânica clássica
  // de play de lazer, e não há outro sinal disso no embed.
  assert.deepEqual(s.mods, ['DT', 'CL']);

  // Mas não tem bit legado — só o DT (64) chega ao cálculo...
  assert.equal(modsToBits(s.mods), 64);
  // ...e sai da conta de "tem mod que altera a dificuldade?", senão um score
  // sem mod nenhum deixaria de usar a estrela que a API publica.
  assert.deepEqual(stripClassic(s.mods), ['DT']);
  assert.deepEqual(stripClassic(['CL']), []);
});

test('só o mod que mexe no mapa tira a estrela das mãos da API', () => {
  // O CL aparece em quase todo score sem mudar dificuldade nenhuma: enquanto
  // ele contava, um score SEM mod nenhum saía com a estrela calculada aqui —
  // 7.08★ onde o site publica 7.13★.
  assert.deepEqual(difficultyMods(['CL']), []);
  assert.deepEqual(difficultyMods(['NF', 'SO', 'SD', 'PF']), []);

  // O HD saiu da lista de cosméticos: desde o rework de 03/07/2026 ele mexe na
  // estrela (a skill de reading), e a API só publica o valor SEM mods — deixá-lo
  // aqui faria todo `+HD` exibir a estrela errada. Ver lazerWorker.test.js, que
  // cobre o outro lado disto no motor.
  assert.deepEqual(difficultyMods(['HD', 'CL']), ['HD']);

  // Os que mudam continuam mudando — inclusive o RX, que troca o motor inteiro.
  assert.deepEqual(difficultyMods(['DT', 'HD', 'CL']), ['DT', 'HD']);
  assert.deepEqual(difficultyMods(['HR']), ['HR']);
  assert.deepEqual(difficultyMods(['RX']), ['RX']);
});

test('statistics esparso vira contagem completa', () => {
  const s = normalizeScore(FC_STABLE);
  assert.equal(s.statistics.count_300, 268);
  assert.equal(s.statistics.count_100, 5);
  // Os que não vieram são ZERO, não undefined — um `undefined` aqui vazaria
  // para o cálculo de PP e para a linha de hits do embed.
  assert.equal(s.statistics.count_50, 0);
  assert.equal(s.statistics.count_miss, 0);
});

test('campos renomeados continuam legíveis pelos nomes antigos', () => {
  const s = normalizeScore(FC_STABLE);
  assert.equal(s.created_at, '2026-02-23T20:16:07Z');  // era ended_at
  assert.equal(s.perfect, true);                        // era is_perfect_combo
  assert.equal(s.score, 12345678);                      // era legacy_total_score
  assert.equal(s.mode, 'osu');                          // era ruleset_id
});

test('a presença do CL é o que separa stable de lazer', () => {
  // O `legacy_score_id` também diria isso, mas o bot não o consome: o mod é o
  // sinal onde a pergunta é feita (engineMods), e um score de lazer COM o CL usa
  // mecânica clássica de qualquer forma — o id seria redundante e discordaria
  // justamente nesse caso.
  //
  // No Bancho o CL vem do próprio score; num bancho.py, onde ninguém roda lazer,
  // o engineMods o acrescenta. Nos dois casos o que chega ao motor é a lista de
  // mods que descreve a play, sem booleano separado ao lado.
  const stable = normalizeScore(FC_STABLE);
  assert.ok(stable.mods.includes('CL'), 'score de stable precisa trazer o CL');
  assert.deepEqual(engineMods('official', stable.mods), stable.mods);

  const lazer = normalizeScore({ ...FC_STABLE, legacy_score_id: null, mods: [{ acronym: 'DT' }] });
  assert.ok(!lazer.mods.includes('CL'));
  assert.deepEqual(engineMods('official', lazer.mods), ['DT']);
});

test('o ajuste de rate sobrevive à normalização', () => {
  // Era aqui que ele morria: o `.map(m => m.acronym)` jogava fora o
  // `settings`, e um DT a 1,4x virava um DT comum antes de chegar a qualquer
  // cálculo. O bot exibia +DT e cobrava o pp de 1,5x — 12,4% a mais, medido no
  // lazerWorker.test.js.
  const s = normalizeScore({
    ...FC_STABLE,
    mods: [{ acronym: 'DT', settings: { speed_change: 1.4 } }, { acronym: 'CL' }],
  });

  assert.deepEqual(s.mods, [{ acronym: 'DT', settings: { speed_change: 1.4 } }, 'CL']);

  // E o resto do bot continua lendo a lista: o CL é achado, o bit sai, a tela
  // diz qual foi o rate.
  assert.equal(modsToBits(s.mods), 64);
  assert.deepEqual(stripClassic(s.mods), [{ acronym: 'DT', settings: { speed_change: 1.4 } }]);
  assert.equal(formatMods(s.mods), '+DTCL (1.4x)');
  assert.equal(clockRate(s.mods), 1.4);
});

test('mod sem ajuste continua sendo string, e o ajuste padrão não conta', () => {
  // Objeto só onde ele muda alguma coisa. A string é a forma que o bitmask e o
  // texto digitado produzem, e trocar todo mod por objeto obrigaria o resto do
  // bot a lidar com duas formas onde hoje só chega uma.
  assert.deepEqual(normalizeScore(FC_STABLE).mods, ['DT', 'CL']);

  // `speed_change` igual ao padrão do mod é a mesma play que o mod sem ajuste —
  // e precisa cair na mesma linha de cache, que não tem TTL.
  const padrao = normalizeScore({
    ...FC_STABLE, mods: [{ acronym: 'DT', settings: { speed_change: 1.5 } }],
  });
  assert.deepEqual(padrao.mods, ['DT']);

  // Ajuste vazio também não vira objeto.
  const vazio = normalizeScore({ ...FC_STABLE, mods: [{ acronym: 'HD', settings: {} }] });
  assert.deepEqual(vazio.mods, ['HD']);
});

test('formato antigo continua atravessando sem estrago', () => {
  // Defensivo: se a API voltar a responder no formato velho, nada quebra.
  const antigo = {
    mods: ['HD', 'DT'],
    statistics: { count_300: 100, count_100: 2, count_50: 0, count_miss: 1 },
    created_at: '2026-01-01T00:00:00Z',
    perfect: false,
  };
  const s = normalizeScore(antigo);
  assert.deepEqual(s.mods, ['HD', 'DT']);
  assert.equal(s.statistics.count_300, 100);
  assert.equal(s.statistics.count_miss, 1);
  assert.equal(s.created_at, '2026-01-01T00:00:00Z');
});

test('entrada inútil não estoura', () => {
  assert.equal(normalizeScore(null), null);
  assert.equal(normalizeScore(undefined), undefined);
});

/**
 * Stub no axios (o mesmo objeto de módulo que o officialApi carregou), para o
 * caminho testado ser o de verdade: rate limiter, retry e tratamento de erro.
 */
function comAxiosFalhando(status, corpo) {
  const axios = require('axios');
  const getOriginal = axios.get;
  const postOriginal = axios.post;

  axios.post = async () => ({ data: { access_token: 'x', expires_in: 86400 } });
  axios.get = async () => {
    throw Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data: corpo },
    });
  };

  return () => { axios.get = getOriginal; axios.post = postOriginal; };
}

test('mapa sem placar devolve lista vazia, não erro', async () => {
  // Medido na API: o endpoint de scores responde 404 tanto para mapa
  // inexistente quanto para mapa graveyard. Deixar a exceção subir fazia o
  // /score dizer "erro ao buscar os scores" para QUALQUER mapa não ranqueado —
  // enquanto o /recent exibia a play daquele mesmo mapa numa boa.
  const restaurar = comAxiosFalhando(404, { error: "Specified beatmap difficulty couldn't be found." });
  try {
    assert.deepEqual(await officialApi.beatmapScores(7562902, 5391035), []);
  } finally {
    restaurar();
  }
});

test('erro que NÃO é 404 continua subindo', async () => {
  // Um 500 é falha de verdade: engolir viraria "sem score" e esconderia a
  // indisponibilidade da API atrás de uma resposta que parece normal.
  const restaurar = comAxiosFalhando(500, {});
  try {
    await assert.rejects(() => officialApi.beatmapScores(7562902, 2298847));
  } finally {
    restaurar();
  }
});
