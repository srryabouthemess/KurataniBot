/**
 * As duas posições de um perfil de bancho.py saem da mesma fonte.
 *
 * ── O que aparecia na tela ────────────────────────────────────────────────────
 * `nunca: 7.108,00pp (#3 KP)` — bandeira, país, e nenhuma posição dentro dele. O
 * `author()` só escreve o rank regional quando ele existe (ver embeds/play.js),
 * então o país sozinho não era um bug ali: era o que sobrava quando o
 * `country_rank` vinha nulo.
 *
 * E ele vinha nulo por causa da FONTE. Servidor com Shiina-Web lia o rank global
 * do `get_rank_cache` do front-end, que responde o histórico diário do jogador —
 * a posição de hoje é o último item da lista, e rank de país não existe naquela
 * resposta. Só o servidor SEM Shiina-Web caía na v1 do bancho.py-ex, que traz as
 * duas de uma vez.
 *
 * Agora as duas saem da v1 em qualquer servidor bancho.py. Custa a mesma
 * requisição que o `get_rank_cache` custava, e o `webApi` continua existindo
 * para o que só o front-end tem (`get_player_scores`).
 *
 * ── Por que o teste dubla o axios, e não o adaptador ──────────────────────────
 * O que precisa continuar valendo é qual ENDEREÇO o `fetchUser` procura. Um
 * dublê do próprio adaptador responderia o que o teste mandasse e concordaria
 * com ele por construção; o dublê do transporte deixa a decisão onde ela mora.
 */
const test = require('node:test');
const assert = require('node:assert');

// O registro de servidores é montado no require do topo, a partir do ambiente —
// então ele é definido ANTES de qualquer require de src/. Um servidor próprio,
// e não o `.env` de quem roda a suíte: `SERVERS` já preenchido faz o dotenv não
// sobrescrever, e o teste passa igual numa máquina sem `.env` nenhum.
process.env.SERVERS = 'testsrv';
process.env.SERVER_TESTSRV_URL = 'https://testsrv.example';
process.env.SERVER_TESTSRV_RELAX = 'true';

// ─── O transporte, trocado por um que só anota ────────────────────────────────

const chamadas = [];

/** As respostas de cada endereço, no formato que o adaptador espera ler. */
function responder(url) {
  if (url.endsWith('/v2/players/42')) {
    return { status: 200, data: { data: { id: 42, name: 'pudim2', country: 'br' } } };
  }
  if (/\/v2\/players\/42\/stats\/\d+$/.test(url)) {
    return { status: 200, data: { data: { pp: 7112, acc: 95.07, plays: 974 } } };
  }
  if (url.endsWith('/v1/get_player_info')) {
    // Indexado por modo, que é como o bancho.py devolve: 0 é o vanilla, 4 é o
    // Relax. Os números são os da conta que reportou o problema.
    return {
      status: 200,
      data: {
        status: 'success',
        player: {
          stats: {
            0: { rank: 3, country_rank: 1, pp: 7112 },
            4: { rank: 4, country_rank: 1, pp: 14324 },
          },
        },
      },
    };
  }
  // Qualquer outro endereço responde vazio — inclusive o `get_rank_cache`, que
  // não deve mais ser procurado. Se voltar a ser, o rank sai nulo e o teste cai.
  return { status: 200, data: null };
}

const axiosPath = require.resolve('axios');
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: {
    get: async (url, config = {}) => {
      chamadas.push({ url, params: config.params ?? {} });
      return responder(url);
    },
  },
};

const banchoPy = require('../src/osu/banchoPyApi');
const servers = require('../src/servers');

test.beforeEach(() => {
  chamadas.length = 0;
});

test('o servidor de teste tem front-end e par VN/RX', () => {
  // Sem `webApi` este teste não afirmaria nada: seria o caminho que já lia a v1.
  assert.ok(servers.get('testsrv').webApi, 'o servidor do teste precisa ter Shiina-Web');
  assert.equal(servers.relaxKey('testsrv'), 'testsrv_rx');
});

test('o rank do país chega junto do global, num servidor com Shiina-Web', async () => {
  const user = await banchoPy.fetchUser(42, 'testsrv');

  assert.equal(user.statistics.global_rank, 3);
  assert.equal(user.statistics.country_rank, 1);
  assert.equal(user.country_code, 'BR');
});

test('o get_rank_cache do front-end não é mais procurado', async () => {
  await banchoPy.fetchUser(42, 'testsrv');

  const doFront = chamadas.filter(c => c.url.includes('get_rank_cache'));
  assert.deepEqual(doFront, [], 'o rank voltou a sair do histórico do front-end');

  const daV1 = chamadas.filter(c => c.url.endsWith('/v1/get_player_info'));
  assert.equal(daV1.length, 1, 'as duas posições saem de uma requisição só');
  assert.equal(daV1[0].params.scope, 'stats');
});

test('cada leaderboard tem a sua posição, e o modo é quem escolhe', async () => {
  const vn = await banchoPy.fetchUser(42, 'testsrv');
  const rx = await banchoPy.fetchUser(42, 'testsrv_rx');

  assert.equal(vn.statistics.global_rank, 3);
  assert.equal(rx.statistics.global_rank, 4);

  // O modo pedido à v2 acompanha: 0 no vanilla, 4 no Relax (ver relaxVariant).
  const modos = chamadas
    .filter(c => /\/v2\/players\/42\/stats\/\d+$/.test(c.url))
    .map(c => c.url.slice(c.url.lastIndexOf('/') + 1));
  assert.deepEqual(modos, ['0', '4']);
});

test('sem posição naquele modo, sai Unranked em vez de "#0"', async () => {
  // Quem nunca jogou o modo vem com zero do bancho.py, e "rank 0" na tela é
  // pior do que não dizer nada.
  const original = require.cache[axiosPath].exports.get;
  require.cache[axiosPath].exports.get = async (url, config = {}) => {
    if (url.endsWith('/v1/get_player_info')) {
      chamadas.push({ url, params: config.params ?? {} });
      return { status: 200, data: { player: { stats: { 0: { rank: 0, country_rank: 0 } } } } };
    }
    return original(url, config);
  };

  try {
    const zerado = await banchoPy.fetchUser(42, 'testsrv');
    assert.equal(zerado.statistics.global_rank, null);
    assert.equal(zerado.statistics.country_rank, null);
  } finally {
    require.cache[axiosPath].exports.get = original;
  }
});
