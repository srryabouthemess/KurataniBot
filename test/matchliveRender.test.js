const test = require('node:test');
const assert = require('node:assert');
const { forGuild } = require('../src/i18n');
const r = require('../src/matchlive/render');

const s = forGuild(null);
const partida = { id: 9, name: 'sala' };
const sc = (userId, username, score, team = 'none', extra = {}) => ({
  userId, username, slot: userId, team, mods: [], score, maxCombo: 100,
  n300: 100, n100: 0, n50: 0, nmiss: 0, ngeki: 0, nkatu: 0, passed: true, perfect: true, ...extra,
});
const jogo = (scores, teamType = 'head-to-head') => ({
  id: 50, mapId: 111, mapName: 'Artist - Song [Hard]', mode: 0, mods: ['HD'], freemods: false,
  teamType, startedAt: '2026-10-14T20:00:00.000Z', endedAt: '2026-10-14T20:03:00.000Z', scores,
});

test('acuracia', () => {
  assert.equal(r.acuracia({ n300: 100, n100: 0, n50: 0, nmiss: 0 }), 100);
  assert.equal(r.acuracia({ n300: 90, n100: 10, n50: 0, nmiss: 0 }), 93.33);
  assert.equal(r.acuracia({ n300: 0, n100: 0, n50: 0, nmiss: 0 }), 0);
});

test('linhas de log', () => {
  assert.match(r.linhaDeLog({ type: 'join', username: 'Ana', userId: 1 }, s), /Ana.*entrou/);
  assert.match(r.linhaDeLog({ type: 'host', username: null, userId: 7 }, s), /7/);
});

test('fim de jogo h2h: ordenado por score, link do mapa no título', () => {
  const g = jogo([sc(1, 'Ana', 500000), sc(2, 'Bia', 900000)]);
  const e = r.embedJogoFim(g, partida, [g], s);
  assert.ok(e.description.indexOf('Bia') < e.description.indexOf('Ana'));
  assert.match(e.url, /111/);
  assert.match(e.footer.text, /Match cost/);
});

test('fim de jogo team-vs: vencedor pela soma', () => {
  const g = jogo([sc(1, 'Ana', 500000, 'blue'), sc(2, 'Bia', 300000, 'red'), sc(3, 'Caio', 400000, 'red')], 'team-vs');
  const e = r.embedJogoFim(g, partida, [g], s);
  assert.match(e.description, /Vermelho.*venceu/);
});

test('início e abortado', () => {
  const g = { ...jogo([]), endedAt: null };
  assert.match(r.embedJogoInicio(g, partida, s).description, /andamento/);
  assert.match(r.embedJogoAbortado(g, partida, s).description, /Abortado/);
});

test('fim da partida: sem url quando não há site, sem campos vazios', () => {
  const e = r.embedFim(partida, null, s);
  assert.equal('url' in e, false);
  assert.equal(r.embedFim(partida, 'https://x/9', s).url, 'https://x/9');
});
