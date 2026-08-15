/**
 * Perfil e scores na mesma viagem.
 *
 * A economia é real (medido: 638ms → 367ms no Bancho, 388ms → 175ms no Daycore),
 * mas ela vem de disparar a busca de scores a partir de um id que **ainda não
 * foi validado**. Isso cria uma corrida que não existia antes, e é ela que este
 * arquivo trava:
 *
 *   - as duas chamadas realmente saem juntas quando o id é conhecido;
 *   - sem id, a segunda continua esperando a primeira (não há o que paralelizar);
 *   - id inválido responde "jogador não encontrado", e não o erro que a busca de
 *     scores der por causa dele — trocar uma pela outra é trocar uma resposta que
 *     explica o que fazer por uma que não explica nada;
 *   - falha de verdade na busca de scores continua subindo.
 */
const test = require('node:test');
const assert = require('node:assert');

// Trocados ANTES de carregar o userLink: ele resolve os dois no require do topo.
// O db entra dublê porque só o `resolvePlayer` o usa — o `fetchPlayer` não toca
// no banco, e abrir o de verdade só para este arquivo seria efeito colateral.
for (const [caminho, exports] of [
  ['../src/db', { getLink: () => null, getPreferredServer: () => null, getUserLang: () => null, getServerLang: () => null }],
  ['../src/osuClient', {}],
]) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

const osuMock = require('../src/osuClient');
const { fetchPlayer } = require('../src/userLink');

const JOGADOR = { id: 42, username: 'pudim2' };

/** Falha o teste em vez de pendurar o runner quando as chamadas serializam. */
const comPrazo = (promessa, aviso, ms = 1000) => Promise.race([
  promessa,
  new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error(aviso)), ms).unref?.()),
]);

test('com o id do link, as duas chamadas saem juntas', async () => {
  // O perfil só resolve DEPOIS que a busca de scores começou: em série isso
  // seria um impasse, e o prazo abaixo transforma o impasse em falha legível.
  let liberar;
  const scoresComecou = new Promise(resolve => { liberar = resolve; });

  osuMock.getUser = async () => { await scoresComecou; return JOGADOR; };
  const buscar = async () => { liberar(); return ['play']; };

  const { user, scores } = await comPrazo(
    fetchPlayer({ username: 42, mode: 'official' }, buscar),
    'a busca de scores esperou o perfil, em vez de sair junto',
  );

  assert.equal(user, JOGADOR);
  assert.deepEqual(scores, ['play']);
});

test('o id vai como número para as duas pontas', async () => {
  // O link guarda o osu_id como texto quando veio do banco; mandar "42" para
  // uma ponta e 42 para a outra faria as duas cairem em entradas de cache
  // diferentes (ver _userCacheKey no osuClient).
  const recebidos = [];
  osuMock.getUser = async (v) => { recebidos.push(v); return JOGADOR; };

  await fetchPlayer({ username: '42', mode: 'official' }, async (id) => { recebidos.push(id); return []; });

  assert.deepEqual(recebidos.sort(), [42, 42]);
});

test('sem id conhecido, a busca espera o perfil e usa o id dele', async () => {
  let perfilResolvido = false;
  osuMock.getUser = async () => { perfilResolvido = true; return JOGADOR; };

  const { scores } = await fetchPlayer({ username: 'pudim2', mode: 'official' }, async (id) => {
    assert.ok(perfilResolvido, 'a busca saiu antes de o perfil chegar, sem id para usar');
    assert.equal(id, 42);
    return ['play'];
  });

  assert.deepEqual(scores, ['play']);
});

test('jogador que não existe nem chega a buscar scores pelo nome', async () => {
  osuMock.getUser = async () => null;
  let chamou = false;

  const { user, scores } = await fetchPlayer({ username: 'ninguem', mode: 'official' }, async () => {
    chamou = true;
    return ['play'];
  });

  assert.equal(user, null);
  assert.deepEqual(scores, []);
  assert.equal(chamou, false);
});

test('id inválido responde "não encontrado", e não o erro dos scores', async () => {
  // O caso comum de link antigo: a conta sumiu, o perfil volta vazio e a busca
  // de scores estoura por causa do mesmo id. Quem manda é o perfil.
  osuMock.getUser = async () => null;
  const buscar = async () => { throw new Error('404 no endpoint de scores'); };

  const { user, scores } = await fetchPlayer({ username: 999, mode: 'official' }, buscar);

  assert.equal(user, null);
  assert.deepEqual(scores, []);
});

test('falha real na busca de scores sobe, com o jogador existindo', async () => {
  osuMock.getUser = async () => JOGADOR;
  const buscar = async () => { throw new Error('ECONNRESET'); };

  await assert.rejects(
    () => fetchPlayer({ username: 42, mode: 'official' }, buscar),
    /ECONNRESET/,
  );
});

test('falha ao buscar o perfil sobe, mesmo com os scores prontos', async () => {
  osuMock.getUser = async () => { throw new Error('500 no perfil'); };

  await assert.rejects(
    () => fetchPlayer({ username: 42, mode: 'official' }, async () => ['play']),
    /500 no perfil/,
  );
});
