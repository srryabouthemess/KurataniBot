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
  assert.match(e.footer.text, /Vermelho vence/);
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

test('grade dos hits (std)', () => {
  const g = (o, mods = [], mode = 0) => r.grade({ n300: 0, n100: 0, n50: 0, nmiss: 0, passed: true, ...o }, mods, mode);
  assert.equal(g({ n300: 100 }), 'X');
  assert.equal(g({ n300: 100 }, ['HD']), 'XH');
  assert.equal(g({ n300: 95, n100: 5 }), 'S');
  assert.equal(g({ n300: 95, n100: 5 }, ['FL']), 'SH');
  assert.equal(g({ n300: 95, n100: 4, nmiss: 1 }), 'A');
  assert.equal(g({ n300: 93, n50: 2, n100: 5 }), 'A');
  assert.equal(g({ n300: 85, n100: 15 }), 'A');
  assert.equal(g({ n300: 85, n100: 14, nmiss: 1 }), 'B');
  assert.equal(g({ n300: 75, n100: 25 }), 'B');
  assert.equal(g({ n300: 75, n100: 24, nmiss: 1 }), 'C');
  assert.equal(g({ n300: 50, n100: 50 }), 'D');
  assert.equal(g({ n300: 100, passed: false }), 'F');
  assert.equal(g({ n300: 100 }, [], 3), null);
});

test('linhas no formato do Bathbot: colunas alinhadas, miss só quando > 0', () => {
  const g = jogo([sc(1, 'Ana', 500000, 'none', { maxCombo: 5, nmiss: 2, n300: 98 }), sc(2, 'Beatriz', 1234567, 'none', { mods: ['HD', 'DT'] })]);
  const e = r.embedJogoFim(g, partida, [g], s, { rotuloDaGrade: x => `<${x}>` });
  const linhas = e.description.split('\n').filter(l => l.startsWith('<'));
  assert.equal(linhas[0], '<XH> `Beatriz` `+HDDT` `  100%` `100x` `1,234,567`');
  assert.match(linhas[1], /^<A> `Ana {4}` `\+NM {2}` ` {3}98%` ` {2}5x` ` {2}500,000` 2❌$/);
});

test('team-vs agrupa por time com total, rodapé com vencedor e match cost', () => {
  const g = jogo([sc(1, 'Ana', 500000, 'blue'), sc(2, 'Bia', 300000, 'red'), sc(3, 'Caio', 400000, 'red')], 'team-vs');
  const e = r.embedJogoFim(g, partida, [g], s);
  const d = e.description;
  assert.ok(d.indexOf(':red_circle:') < d.indexOf(':blue_circle:'));
  assert.match(d, /:red_circle: \*\*Vermelho\*\* :red_circle: \| 700,000/);
  assert.ok(d.indexOf('Caio') < d.indexOf('Bia'));
  assert.match(e.footer.text, /Vermelho vence por 200,000 • Match cost/);
});

test('imagem e duração do mapa quando vêm', () => {
  const g = { ...jogo([]), endedAt: null };
  const e = r.embedJogoInicio(g, partida, s, { mapa: { setId: 42, segundos: 125 } });
  assert.equal(e.image.url, 'https://assets.ppy.sh/beatmaps/42/covers/cover.jpg');
  assert.match(e.description, /2:05/);
  assert.equal('image' in r.embedJogoInicio(g, partida, s), false);
  assert.equal(r.embedJogoFim(jogo([]), partida, [], s, { mapa: { setId: 7 } }).image.url, 'https://assets.ppy.sh/beatmaps/7/covers/cover.jpg');
});
