/**
 * O cache do detalhe de score do bancho.py.
 *
 * Este endpoint é o mais caro do bot em servidor privado: UMA requisição por
 * score, cinco por página do /topplays, e nada era reaproveitado — medido, 294ms
 * numa rodada e 843ms na seguinte para as mesmas cinco plays.
 *
 * Guardar um dado que "quase não muda" tem quatro jeitos conhecidos de dar
 * errado, e são eles que este arquivo trava:
 *
 *   - guardar a FALHA, que transforma um blip de rede em uma hora sem detalhe;
 *   - misturar servidores, servindo o score de um no outro (os ids são
 *     independentes entre instalações de bancho.py);
 *   - score sem id envenenando uma chave `undefined` compartilhada;
 *   - dois pedidos simultâneos do mesmo score saindo os dois — que é exatamente
 *     a corrida que o prefetch da paginação criou.
 *
 * O axios é trocado por um dublê: aqui o que se mede é quantas requisições
 * SAEM, não o que a API responde.
 */
const test = require('node:test');
const assert = require('node:assert');

const axiosPath = require.resolve('axios');
const chamadas = [];

/**
 * Só as requisições de DETALHE de score.
 *
 * O `enrichScores` também busca o MAPA de cada score (`/v2/maps/{id}`), que é
 * o que faz um mapa custom aparecer com combo e estrelas. Contar as duas
 * juntas mediria as duas caches ao mesmo tempo; o assunto deste arquivo é a
 * do detalhe.
 */
const detalhes = () => chamadas.filter(url => url.includes('/scores/'));

/**
 * A resposta atravessa DOIS envelopes antes de virar detalhe: o `data` do axios
 * e o `data` da v2 do bancho.py. Errar isso faz o dublê devolver sempre "sem
 * detalhe", e aí os casos passam sem testar nada.
 */
const respostaHttp = (payload) => ({ data: { status: 'success', data: payload } });
const DETALHE_PADRAO = { pp: 123, acc: 98.5, max_combo: 700, grade: 'S', mods: 64 };

// O dublê responde por URL: o mapa e o detalhe são endpoints diferentes, e
// devolver o detalhe também no lugar do mapa faria a mescla inventar combo.
const respostaPadrao = async (url) =>
  (String(url).includes('/maps/') ? respostaHttp(null) : respostaHttp(DETALHE_PADRAO));

let responder = respostaPadrao;

require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { get: async (url) => { chamadas.push(url); return responder(url); } },
};

const { enrichScores } = require('../src/osu/banchoPyApi');

/** Um score da v1 como o `get_player_scores` devolve, no mínimo que a mescla usa. */
const scoreV1 = (id) => ({
  score_id: id,
  map_id: 1000 + id,
  map_set_id: 2000 + id,
  map_name: 'Artista - Titulo [Diff]',
  pp: 1, acc: 90, grade: 'A', mods: 0, play_time: '2026-08-14 12:00:00',
});

// O cache é do módulo e sobrevive entre os casos — de propósito, é o que ele faz
// em produção. Por isso cada caso usa uma faixa de id só dele: reaproveitar o
// mesmo número faria um caso começar com o cache que o anterior deixou quente.
test.beforeEach(() => {
  chamadas.length = 0;
  responder = respostaPadrao;
});

test('o mesmo score não é buscado duas vezes', async () => {
  const [primeiro] = await enrichScores([scoreV1(1)], 'daycore');
  const [segundo]  = await enrichScores([scoreV1(1)], 'daycore');

  assert.equal(detalhes().length, 1, 'a segunda exibição repetiu a requisição');
  // E o resultado tem de ser o mesmo, não um score empobrecido: o valor do
  // cache passa pela mesma mescla que o da rede.
  assert.equal(primeiro.pp, segundo.pp);
  assert.equal(primeiro.rank, 'S');
  assert.deepEqual(primeiro.mods, segundo.mods);
});

test('scores diferentes continuam sendo buscados', async () => {
  await enrichScores([scoreV1(31), scoreV1(32), scoreV1(33)], 'daycore');
  assert.equal(detalhes().length, 3);
});

test('servidores diferentes não dividem a mesma entrada', async () => {
  // Os ids de score são de cada instalação: servir o de um no outro exibiria a
  // play errada, com um número plausível e nada denunciando.
  await enrichScores([scoreV1(7)], 'daycore');
  await enrichScores([scoreV1(7)], 'outro');

  assert.equal(detalhes().length, 2);
});

test('falha não entra no cache', async () => {
  // Sem `response` nem `code`, o withRetry considera definitivo e não repete —
  // o que este caso quer é a falha CHEGANDO ao enrichScores, não o backoff.
  responder = async () => { throw new Error('deu ruim'); };
  const [comFalha] = await enrichScores([scoreV1(9)], 'daycore');

  // A play ainda sai, com o que a v1 já trazia: o comando não pode quebrar
  // porque um detalhe faltou.
  assert.equal(comFalha.rank, 'A');
  assert.equal(detalhes().length, 1);

  responder = async () => respostaHttp({ pp: 500, grade: 'X' });
  const [depois] = await enrichScores([scoreV1(9)], 'daycore');

  assert.equal(detalhes().length, 2, 'a falha ficou guardada e o detalhe nunca mais foi buscado');
  assert.equal(depois.rank, 'X');
});

test('resposta vazia é guardada — ela também é um resultado', async () => {
  responder = async () => respostaHttp(null);

  await enrichScores([scoreV1(11)], 'daycore');
  await enrichScores([scoreV1(11)], 'daycore');

  assert.equal(detalhes().length, 1, 'o "não sei" foi repedido a cada exibição');
});

test('score sem id não busca nada nem cria chave compartilhada', async () => {
  const semId = { ...scoreV1(0), score_id: undefined };
  const outro = { ...scoreV1(0), score_id: null, map_id: 555 };

  const [a, b] = await enrichScores([semId, outro], 'daycore');

  assert.equal(detalhes().length, 0, 'saiu requisição para um score sem id');
  // Cada um continua saindo com os próprios dados da v1, e não com os do outro.
  assert.equal(a.beatmap.id, 1000);
  assert.equal(b.beatmap.id, 555);
});

test('dois pedidos simultâneos do mesmo score saem como um', async () => {
  // A corrida que o prefetch criou: quem clica em ▶️ antes de a próxima página
  // terminar de ser aquecida pede os mesmos scores de novo.
  let liberar;
  const emVoo = new Promise(resolve => { liberar = resolve; });
  responder = async () => { await emVoo; return respostaHttp({ pp: 1 }); };

  const dois = Promise.all([
    enrichScores([scoreV1(21)], 'daycore'),
    enrichScores([scoreV1(21)], 'daycore'),
  ]);

  liberar();
  await dois;

  assert.equal(detalhes().length, 1, 'os dois pedidos saíram em vez de compartilhar a mesma promise');
});
