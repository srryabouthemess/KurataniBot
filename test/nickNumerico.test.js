/**
 * Nick só de dígitos.
 *
 * No Daycore existe o jogador `547`, de id 58. O bot tratava qualquer texto só
 * de dígitos como id: `/rs 547` e `/link set 547` consultavam `/players/547`,
 * que não existe, e respondiam "jogador não encontrado" (visto em produção em
 * 04/11/2026).
 *
 * A regra agora é pelo TIPO: número é id (é como o link salvo entrega o
 * `osu_id`, coluna INTEGER), texto é o que alguém digitou. Texto só de dígitos
 * tenta o nick primeiro e só cai no id quando não há nick assim — quem digita
 * um id continua sendo atendido.
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const osu = require('../src/osuClient');
const officialApi = require('../src/osu/officialApi');

const V1 = 'https://api.daycore.org/v1';

const naoAchou = (url) => Object.assign(new Error(`404 ${url}`), {
  response: { status: 404, data: { status: 'error', error: 'Player not found.' } },
});

/**
 * bancho.py falso com dois jogadores: `547` (id 58) e `pudim` (id 547 — o id
 * que um nick só de dígitos confundiria). Guarda as URLs pedidas.
 */
async function comBanchoFalso(fn) {
  const jogadores = { 58: '547', 547: 'pudim' };
  const pedidos = [];
  const original = axios.get;

  axios.get = async (url, config = {}) => {
    const params = config.params ?? {};
    pedidos.push({ url, params });

    if (url === `${V1}/get_player_info`) {
      const id = params.id ?? Object.keys(jogadores).find(k => jogadores[k] === params.name);
      if (!id || !jogadores[id]) return { status: 404, data: { status: 'error' } };
      return {
        status: 200,
        data: { player: { info: { id: Number(id), name: jogadores[id] }, stats: {} } },
      };
    }

    const perfil = url.match(/^.*\/v2\/players\/(\d+)$/);
    if (perfil) {
      if (!jogadores[perfil[1]]) throw naoAchou(url);
      return { status: 200, data: { data: { id: Number(perfil[1]), name: jogadores[perfil[1]], country: 'br' } } };
    }
    const stats = url.match(/^.*\/v2\/players\/(\d+)\/stats\/\d+$/);
    if (stats) {
      if (!jogadores[stats[1]]) throw naoAchou(url);
      return { status: 200, data: { data: { pp: 0, plays: 0 } } };
    }
    throw new Error(`URL inesperada no teste: ${url}`);
  };

  try {
    return await fn(pedidos);
  } finally {
    axios.get = original;
  }
}

test('bancho.py: nick só de dígitos acha o jogador pelo nome', async () => {
  await comBanchoFalso(async () => {
    assert.equal(await osu.resolvePlayerId('547', 'daycore'), 58);
  });
});

test('bancho.py: texto de dígitos sem nick igual ainda vale como id', async () => {
  await comBanchoFalso(async () => {
    // Não há nick "58"; quem digitou o id do jogador continua chegando nele.
    assert.equal(await osu.resolvePlayerId('58', 'daycore'), 58);
  });
});

test('bancho.py: número (id do link) não passa pela busca por nome', async () => {
  await comBanchoFalso(async (pedidos) => {
    assert.equal(await osu.resolvePlayerId(547, 'daycore'), 547);
    assert.equal(pedidos.length, 0);
  });
});

test('getUser: nick "547" e id 547 são jogadores diferentes, também no cache', async () => {
  await comBanchoFalso(async () => {
    const porNick = await osu.getUser('547', 'daycore_rx', { fresh: true });
    assert.equal(porNick?.id, 58);
    assert.equal(porNick?.username, '547');

    // Sem `fresh`: se o cache misturasse as chaves, viria o `547` de antes.
    const porId = await osu.getUser(547, 'daycore_rx');
    assert.equal(porId?.id, 547);
    assert.equal(porId?.username, 'pudim');

    const deNovo = await osu.getUser('547', 'daycore_rx');
    assert.equal(deNovo?.id, 58);
  });
});

/** API oficial falsa: `responder(path)` devolve o corpo ou lança. */
async function comOficialFalso(responder, fn) {
  const originalGet  = axios.get;
  const originalPost = axios.post;
  const caminhos = [];
  axios.post = async () => ({ data: { access_token: 'x', expires_in: 3600 } });
  axios.get = async (url) => {
    const path = url.replace('https://osu.ppy.sh/api/v2', '');
    caminhos.push(path);
    return { status: 200, data: responder(path) };
  };
  try {
    await fn();
  } finally {
    axios.get  = originalGet;
    axios.post = originalPost;
  }
  return caminhos;
}

test('Bancho oficial: nick de dígitos vai com @, id vai puro', async () => {
  const caminhos = await comOficialFalso(() => ({ id: 1, username: 'x' }), async () => {
    await officialApi.fetchUser('727');
    await officialApi.fetchUser(727);
  });
  assert.deepEqual(caminhos, ['/users/%40727/osu', '/users/727/osu']);
});

test('Bancho oficial: texto de dígitos sem nick igual cai no id', async () => {
  let user;
  const caminhos = await comOficialFalso((path) => {
    if (path.includes('%40')) throw naoAchou(path);
    return { id: 727, username: 'alguem' };
  }, async () => {
    user = await officialApi.fetchUser('727');
  });
  assert.equal(user?.id, 727);
  assert.deepEqual(caminhos, ['/users/%40727/osu', '/users/727/osu']);
});
