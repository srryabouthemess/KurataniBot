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
const { stripClassic, difficultyMods, modsToBits } = require('../src/mods');
const { shouldUseLazer } = require('../src/pp');

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
  // O CL não é o único que aparece sem mudar dificuldade nenhuma: o HD está em
  // metade dos scores, e enquanto ele contava, um `+HD` de mapa ranqueado saía
  // com a estrela calculada aqui — 8.09★ onde o site publica 8.31★.
  assert.deepEqual(difficultyMods(['HD', 'CL']), []);
  assert.deepEqual(difficultyMods(['NF', 'SO', 'SD', 'PF']), []);

  // Os que mudam continuam mudando — inclusive o RX, que troca o motor inteiro.
  assert.deepEqual(difficultyMods(['DT', 'HD', 'CL']), ['DT']);
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
  // sinal onde a pergunta é feita (shouldUseLazer), e um score de lazer COM o
  // CL usa mecânica clássica de qualquer forma — o id seria redundante e
  // discordaria justamente nesse caso.
  const stable = normalizeScore(FC_STABLE);
  assert.ok(stable.mods.includes('CL'), 'score de stable precisa trazer o CL');
  assert.equal(shouldUseLazer('official', stable.mods), false);

  const lazer = normalizeScore({ ...FC_STABLE, legacy_score_id: null, mods: [{ acronym: 'DT' }] });
  assert.ok(!lazer.mods.includes('CL'));
  assert.equal(shouldUseLazer('official', lazer.mods), true);
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
