/**
 * `k!rs @fulano`: o jogador é a conta que o fulano vinculou no /link.
 *
 * Sem `server:` no comando, valem as preferências DO FULANO (servidor e modo),
 * e não as de quem digitou — é a conta dele que se está pedindo, no lugar onde
 * ele joga. Um `server:`/`modo:` explícito continua ganhando de tudo.
 */
const test = require('node:test');
const assert = require('node:assert');

const AUTOR    = '100000000000000001';
const FULANO   = '200000000000000002';
const SEM_LINK = '300000000000000003';

// Links e preferências por pessoa do Discord.
const links = {
  [AUTOR]:  { official: { osu_user: 'autor', osu_id: 1 } },
  [FULANO]: {
    daycore:    { osu_user: 'fulano_dc', osu_id: 22 },
    daycore_rx: { osu_user: 'fulano_dc', osu_id: 22 },
    official:   { osu_user: 'fulano_bancho', osu_id: 2 },
  },
};
const preferido = { [AUTOR]: 'official', [FULANO]: 'daycore' };
let modoDoFulano = null;

// Trocado ANTES de carregar o userLink: ele resolve o db no require do topo
// (mesmo padrão de preferredModo.test.js).
{
  const resolvido = require.resolve('../src/db');
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports: {
      getLink:            (id, chave) => links[id]?.[chave] ?? null,
      getPreferredServer: id => preferido[id] ?? null,
      getPreferredModo:   id => (id === FULANO ? modoDoFulano : null),
      getUserLang:        () => 'en',
      getServerLang:      () => null,
    },
  };
}

const { resolvePlayer, mentionedId } = require('../src/userLink');

function interacao(opcoes = {}) {
  return {
    user:    { id: AUTOR, username: 'autor' },
    guildId: null,
    options: { getString: nome => opcoes[nome] ?? null },
  };
}

test('mentionedId reconhece só a menção inteira', () => {
  assert.equal(mentionedId(`<@${FULANO}>`), FULANO);
  assert.equal(mentionedId(`<@!${FULANO}>`), FULANO);
  assert.equal(mentionedId(` <@${FULANO}> `), FULANO);
  assert.equal(mentionedId('mrekk'), null);
  assert.equal(mentionedId(`<@&${FULANO}>`), null, 'menção de cargo não é jogador');
  assert.equal(mentionedId(`x<@${FULANO}>`), null);
  assert.equal(mentionedId(null), null);
});

test('menção usa o link e o servidor preferido de quem foi mencionado', () => {
  modoDoFulano = null;
  const r = resolvePlayer(interacao({ player: `<@${FULANO}>` }));

  assert.equal(r.mode, 'daycore', 'o preferido do fulano, não o do autor');
  assert.equal(r.username, 22);
  assert.equal(r.displayName, 'fulano_dc');
  assert.equal(r.fromLink, true);
  assert.equal(r.ownerId, FULANO);
});

test('o modo preferido de quem foi mencionado também vale', () => {
  modoDoFulano = 'rx';
  const r = resolvePlayer(interacao({ player: `<@${FULANO}>` }));
  modoDoFulano = null;

  assert.equal(r.mode, 'daycore_rx');
});

test('server: explícito ganha da preferência do mencionado', () => {
  const r = resolvePlayer(interacao({ player: `<@!${FULANO}>`, server: 'official' }));

  assert.equal(r.mode, 'official');
  assert.equal(r.username, 2);
  assert.equal(r.displayName, 'fulano_bancho');
});

test('mencionado sem link naquele servidor recebe erro que diz quem e onde', () => {
  const r = resolvePlayer(interacao({ player: `<@${SEM_LINK}>` }));

  assert.ok(r.error);
  assert.match(r.error, new RegExp(`<@${SEM_LINK}>`));
  assert.doesNotMatch(r.error, /You have no link/, 'o erro é sobre o mencionado, não sobre quem digitou');
});

test('nome digitado continua como sempre, com o autor como dono', () => {
  const r = resolvePlayer(interacao({ player: 'mrekk' }));

  assert.equal(r.username, 'mrekk');
  assert.equal(r.fromLink, false);
  assert.equal(r.mode, 'official');
  assert.equal(r.ownerId, AUTOR);
});

test('sem player, é o link do próprio autor', () => {
  const r = resolvePlayer(interacao());

  assert.equal(r.username, 1);
  assert.equal(r.ownerId, AUTOR);
});
