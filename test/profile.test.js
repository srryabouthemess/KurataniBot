/**
 * O /profile. Como no playEmbed.test, o que importa é o que o embed AFIRMA:
 * dado que o servidor não manda não pode virar "0", "NaN" ou "undefined".
 */
const test = require('node:test');
const assert = require('node:assert');

const clientPath = require.resolve('../src/osuClient');
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    getMapUrl:    (mapId, setId) => `https://osu.ppy.sh/beatmapsets/${setId}#osu/${mapId}`,
    getUserUrl:   (userId) => `https://osu.ppy.sh/users/${userId}`,
    getModeLabel: () => 'osu! (Bancho)',
  },
};

const { describe } = require('../src/commands/osu/profile');
const s = require('../src/i18n/pt')({ ADMIN: 'Servidor' });

const jogador = (stats = {}, over = {}) => ({
  id: 2, username: 'kuratani', country_code: 'BR', avatar_url: 'https://a.ppy.sh/2',
  join_date: '2022-11-01T15:37:14Z', last_visit: '2026-09-27T12:00:00Z', is_online: false,
  statistics: {
    global_rank: 68526, country_rank: 2150, pp: 5891.68, hit_accuracy: 97.2345,
    level: { current: 100, progress: 7 }, maximum_combo: 1234, play_count: 37587,
    play_time: 636 * 3600 + 59, grade_counts: { ssh: 5, ss: 11, sh: 17, s: 65, a: 379 },
    ...stats,
  },
  ...over,
});

const play = {
  pp: 412.3, accuracy: 0.991, rank: 'S', max_combo: 1500, mods: ['HD', 'DT'],
  beatmap: { id: 10, version: 'Insane' }, beatmapset: { id: 5, title: 'Song', artist: 'Artist' },
};

test('o perfil completo mostra tudo o que as referências mostram', () => {
  const e = describe(jogador(), play, 'official', s).toJSON();

  assert.equal(e.author.name, 'kuratani: 5.891,68pp (#68.526 BR#2.150)');
  assert.match(e.description, /\*\*Acc:\*\* `97,23%` • \*\*Level:\*\* `100,07`/);
  assert.match(e.description, /\*\*Playcount:\*\* `37\.587` \(`636 h`\)/);
  assert.match(e.description, /\*\*SS\+\*\* `5` \*\*SS\*\* `11` \*\*S\+\*\* `17` \*\*S\*\* `65` \*\*A\*\* `379`/);
  assert.match(e.description, /\[Artist - Song ［Insane］\]\(https:\/\/osu\.ppy\.sh\/beatmapsets\/5#osu\/10\) \*\*\+HDDT\*\*/);
  assert.match(e.description, /`412,30pp` • 99,10% • \*\*S\*\* • 1\.500x/);
  assert.match(e.description, /🔴 Visto <t:\d+:R> • Entrou em <t:1667317034:D> \(<t:1667317034:R>\)/);
});

test('dado que o servidor não manda some, em vez de sair zerado', () => {
  const e = describe(
    jogador({ play_time: null, grade_counts: null }, { last_visit: null }),
    null, 'gatari_rx', s,
  ).toJSON();

  assert.doesNotMatch(e.description, / h`\)/);
  assert.doesNotMatch(e.description, /Notas/);
  assert.doesNotMatch(e.description, /Visto/);
  assert.doesNotMatch(e.description, /undefined|NaN|null/);
  assert.match(e.description, /\*\*Top play:\*\* Nenhuma play encontrada\./);
});

test('play sem mods não leva o +NM, e online troca o "visto"', () => {
  const e = describe(jogador({}, { is_online: true }), { ...play, mods: [] }, 'official', s).toJSON();
  assert.doesNotMatch(e.description, /\+NM/);
  assert.match(e.description, /🟢 Online agora • Entrou/);
});
