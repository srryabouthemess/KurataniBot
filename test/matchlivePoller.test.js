const test = require('node:test');
const assert = require('node:assert');
const { criarPoller, INATIVIDADE_MS } = require('../src/matchlive/poller');

function cenario({ snaps, tracks }) {
  const enviados = [];
  const editados = [];
  let seq = 0;
  const canal = id => ({
    id,
    async send({ embeds, content }) { const m = { id: `m${++seq}` }; enviados.push({ canal: id, msg: m.id, embeds, content }); return m; },
    messages: { async edit(msgId, { embeds }) { editados.push({ canal: id, msg: msgId, embeds }); } },
  });
  const client = { channels: { async fetch(id) { return canal(id); } } };
  const estado = new Map(tracks.map(tr => [`${tr.channelId}|${tr.matchId}`, { logMessageId: null, logLines: 0, gameMessages: {}, lastActivityAt: 0, ...tr }]));
  const db = {
    listTracks: () => [...estado.values()],
    saveTrackState: (c, _s, m, st) => Object.assign(estado.get(`${c}|${m}`), st),
    removeTrack: (c, _s, m) => estado.delete(`${c}|${m}`),
  };
  let i = 0;
  const fonte = { async snapshot() { return snaps[Math.min(i++, snaps.length - 1)]; } };
  const s = new Proxy({}, { get: (_, k) => (...a) => `${String(k)}(${a.join(',')})` });
  const render = {
    linhaDeLog: e => `log:${e.id}`,
    embedLog: l => ({ log: l }), embedJogoInicio: g => ({ start: g.id }), embedJogoFim: g => ({ end: g.id }),
    embedJogoAbortado: g => ({ abort: g.id }), embedFim: () => ({ fim: true }),
  };
  let relogio = 1000;
  const poller = criarPoller({ client, db, fontes: { daycore: fonte }, render, strings: () => s, siteUrl: () => null, agora: () => relogio });
  return { poller, enviados, editados, estado, avancar: ms => { relogio += ms; } };
}

const track = { channelId: 'c1', guildId: 'g', server: 'daycore', matchId: 9, lastEventId: 0 };
const snap = (o = {}) => ({ match: { id: 9, name: 's', private: false, endedAt: null }, events: [], games: [], ...o });
const ev = (id, type = 'join') => ({ id, type, userId: 1, username: 'A', gameId: null, at: 'x' });
const jogo = (id, startedAt, endedAt = null) => ({ id, startedAt, endedAt, scores: [] });

test('posta log e início de jogo, depois edita com o fim', async () => {
  const c = cenario({ tracks: [track], snaps: [
    snap({ events: [ev(1)], games: [jogo(50, 't1')] }),
    snap({ events: [ev(1)], games: [jogo(50, 't1', 't2')] }),
  ] });
  await c.poller.tick();
  assert.equal(c.enviados.length, 2);
  assert.deepEqual(c.enviados[1].embeds, [{ start: 50 }]);
  await c.poller.tick();
  assert.equal(c.editados.at(-1).msg, c.enviados[1].msg);
  assert.deepEqual(c.editados.at(-1).embeds, [{ end: 50 }]);
  assert.match(c.estado.get('c1|9').gameMessages[50], /^done:/);
  assert.equal(c.estado.get('c1|9').lastEventId, 1);
});

test('log com até 15 linhas edita a mesma mensagem', async () => {
  const c = cenario({ tracks: [track], snaps: [snap({ events: [ev(1)] }), snap({ events: [ev(1), ev(2)] })] });
  await c.poller.tick();
  await c.poller.tick();
  assert.equal(c.enviados.length, 1);
  assert.equal(c.editados.length, 1);
  assert.deepEqual(c.editados[0].embeds, [{ log: ['log:1', 'log:2'] }]);
});

test('partida fechada posta o fim e remove o track', async () => {
  const c = cenario({ tracks: [track], snaps: [snap({ match: { id: 9, name: 's', private: false, endedAt: 't9' } })] });
  await c.poller.tick();
  assert.deepEqual(c.enviados.at(-1).embeds, [{ fim: true }]);
  assert.equal(c.estado.size, 0);
});

test('3h sem atividade: avisa e remove', async () => {
  const c = cenario({ tracks: [{ ...track, lastActivityAt: 1000 }], snaps: [snap()] });
  c.avancar(INATIVIDADE_MS);
  await c.poller.tick();
  assert.match(c.enviados.at(-1).content, /matchlive_idle_stop/);
  assert.equal(c.estado.size, 0);
});

test('erro na fonte entra em backoff e não chama de novo no tick seguinte', async () => {
  const c = cenario({ tracks: [track], snaps: [snap()] });
  let chamadas = 0;
  c.poller._fontes.daycore.snapshot = async () => { chamadas++; throw new Error('down'); };
  await c.poller.tick();
  await c.poller.tick();
  assert.equal(chamadas, 1);
  c.avancar(5000);
  await c.poller.tick();
  assert.equal(chamadas, 2);
});

test('snapshot null remove o track', async () => {
  const c = cenario({ tracks: [track], snaps: [null] });
  await c.poller.tick();
  assert.equal(c.estado.size, 0);
});
