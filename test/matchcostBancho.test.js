/**
 * /matchcost no Bancho: a resposta da API v2 vira o formato comum, e a busca
 * volta página por página até o primeiro evento da partida.
 *
 * O JSON de exemplo (fixtures/matchcost-bancho.json) tem a forma de um
 * `GET /matches/{id}` de verdade: eventos que não são jogo no meio, um jogo
 * abortado (`end_time: null`), mods só do jogador em `scores[].mods` e o time
 * em `scores[].match.team`.
 *
 * O transporte (axios) é dublado, e não o adaptador — mesmo motivo do
 * rankDoPais.test.js: o que se confere é o que o módulo PEDE à API.
 */
const test = require('node:test');
const assert = require('node:assert');

const EXEMPLO = require('./fixtures/matchcost-bancho.json');

// ─── O transporte, trocado por um que responde o roteiro do teste ─────────────

const chamadas = [];
let roteiro = () => ({ status: 200, data: EXEMPLO });

const axiosPath = require.resolve('axios');
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: {
    post: async () => ({ status: 200, data: { access_token: 'teste', expires_in: 86400 } }),
    get: async (url, config = {}) => {
      chamadas.push({ url, params: config.params ?? {} });
      const resposta = roteiro(url, config.params ?? {});
      if (resposta.status >= 400) {
        const erro = new Error(`HTTP ${resposta.status}`);
        erro.response = { status: resposta.status };
        throw erro;
      }
      return resposta;
    },
  },
};

const { buscarPartida, normalizarPartida } = require('../src/commands/osu/matchcost/bancho');
const { calcularMatchCost } = require('../src/commands/osu/matchcost/logic');

test.beforeEach(() => {
  chamadas.length = 0;
  roteiro = () => ({ status: 200, data: EXEMPLO });
});

// ─── Normalização ─────────────────────────────────────────────────────────────

test('a resposta da API v2 vira o formato comum', () => {
  const p = normalizarPartida(EXEMPLO);

  assert.equal(p.id, 111222333);
  assert.equal(p.name, 'KBT: (Os Azuis) vs (Os Vermelhos)');
  assert.equal(p.finished, true);

  // Só os eventos com `game` viram jogo — o abortado inclusive (quem o tira é a
  // conta, não a leitura).
  assert.equal(p.games.length, 2);
  assert.deepEqual(p.games[0], {
    endedAt: '2026-09-20T18:05:00+00:00',
    teamType: 'team-vs',
    scores: [
      { userId: 1001, username: 'Alice', team: 'blue', mods: ['HD'], score: 712345 },
      { userId: 1002, username: 'Bruno', team: 'red', mods: ['HD', 'NF'], score: 400000 },
    ],
  });
  assert.equal(p.games[1].endedAt, null);

  assert.equal(p.avatars[1001], 'https://a.ppy.sh/1001?1700000000.jpeg');
});

test('partida em andamento: finished falso', () => {
  const aberta = { ...EXEMPLO, match: { ...EXEMPLO.match, end_time: null } };
  assert.equal(normalizarPartida(aberta).finished, false);
});

test('mod no formato novo (objeto) vira acrônimo', () => {
  const raw = structuredClone(EXEMPLO);
  raw.events[3].game.scores[0].mods = [{ acronym: 'DT', settings: { speed_change: 1.2 } }, 'HD'];
  assert.deepEqual(normalizarPartida(raw).games[0].scores[0].mods, ['DT', 'HD']);
});

test('o exemplo passa pela conta: o abortado não entra', () => {
  // Um jogo só: 712345 + 400000 → média 556172.5.
  //   Alice 712345 / 556172.5 = 1.2808 + 0.5 = 1.7808
  //   Bruno 400000 / 556172.5 = 0.7192 + 0.5 = 1.2192
  const r = calcularMatchCost(normalizarPartida(EXEMPLO));
  assert.equal(r.tipo, 'times');
  assert.equal(r.jogos, 1);
  assert.equal(r.azul.vitorias, 1);
  assert.ok(Math.abs(r.azul.jogadores[0].matchCost - 1.7808) < 1e-4);
  assert.ok(Math.abs(r.vermelho.jogadores[0].matchCost - 1.2192) < 1e-4);
  assert.equal(r.mvp, 1001);
});

// ─── Busca ────────────────────────────────────────────────────────────────────

test('primeira página com o primeiro evento: uma requisição só', async () => {
  const r = await buscarPartida(111222333);
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /\/api\/v2\/matches\/111222333$/);
  assert.equal(r.partida.events.length, EXEMPLO.events.length);
});

test('volta página por página até o first_event_id, juntando eventos e usuários', async () => {
  // Três páginas: a mais recente (eventos 300-301), a do meio (200-201) e a
  // primeira (100-101). Um jogo em cada.
  const jogo = (id, user) => ({
    id, detail: { type: 'other' },
    game: { end_time: 'x', team_type: 'head-to-head', scores: [{ user_id: user, score: 1000, mods: [], match: { team: 'none' } }] },
  });
  const paginas = {
    atual: { match: EXEMPLO.match, first_event_id: 100, users: [{ id: 3, username: 'c' }], events: [jogo(300, 3), { id: 301, detail: { type: 'player-left' } }] },
    300: { match: EXEMPLO.match, first_event_id: 100, users: [{ id: 2, username: 'b' }], events: [jogo(200, 2), { id: 201, detail: { type: 'player-joined' } }] },
    200: { match: EXEMPLO.match, first_event_id: 100, users: [{ id: 1, username: 'a' }], events: [jogo(100, 1), { id: 101, detail: { type: 'player-joined' } }] },
  };
  roteiro = (_url, params) => ({ status: 200, data: paginas[params.before ?? 'atual'] });

  const r = await buscarPartida(7);

  assert.deepEqual(chamadas.map(c => c.params.before ?? null), [null, 300, 200]);
  assert.ok(chamadas.slice(1).every(c => c.params.limit === 100));
  assert.deepEqual(r.partida.events.map(e => e.id), [100, 101, 200, 201, 300, 301]);

  const p = normalizarPartida(r.partida);
  assert.deepEqual(p.games.map(g => g.scores[0].username), ['a', 'b', 'c']);
});

test('página anterior vazia encerra a busca', async () => {
  let n = 0;
  roteiro = () => ({
    status: 200,
    data: n++ === 0
      ? { match: EXEMPLO.match, first_event_id: 1, users: [], events: [{ id: 50, detail: { type: 'other' } }] }
      : { match: EXEMPLO.match, first_event_id: 1, users: [], events: [] },
  });
  const r = await buscarPartida(7);
  assert.equal(chamadas.length, 2);
  assert.equal(r.partida.events.length, 1);
});

test('404 é partida inexistente; 401 é partida privada', async () => {
  roteiro = () => ({ status: 404 });
  assert.deepEqual(await buscarPartida(1), { erro: 'not_found' });

  roteiro = () => ({ status: 401 });
  assert.deepEqual(await buscarPartida(1), { erro: 'private' });
});

test('outro erro sobe: não é resposta sobre a partida', async () => {
  roteiro = () => ({ status: 403 });
  await assert.rejects(() => buscarPartida(1), /HTTP 403/);
});
