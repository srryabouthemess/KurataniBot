/**
 * O link do mapa aponta para o osu.ppy.sh, de qualquer servidor.
 *
 * A página do servidor privado nem sempre tem leaderboard, download ou
 * discussão; a oficial tem. A exceção é o mapa custom do Daycore (id a partir
 * de 100.000.000), que o oficial não conhece — lá o link daria 404.
 */
const test = require('node:test');
const assert = require('node:assert');

const osu = require('../src/osuClient');
const servers = require('../src/servers');

// Os servidores privados do registro variam com o .env de quem roda; o teste
// usa o que houver, e o `official` que está sempre lá.
const privados = servers.rootChoices().map(c => c.value).filter(k => k !== 'official');

test('mapa oficial jogado em servidor privado linka o osu.ppy.sh', () => {
  for (const key of ['official', ...privados]) {
    assert.equal(
      osu.getMapUrl(129891, 39804, key),
      'https://osu.ppy.sh/beatmapsets/39804#osu/129891',
      `servidor ${key}`,
    );
  }
});

test('sem o id do set, cai no /b/ do oficial', () => {
  assert.equal(osu.getMapUrl(129891, undefined, 'official'), 'https://osu.ppy.sh/b/129891');
  assert.equal(osu.getMapUrl(129891, null, 'official'), 'https://osu.ppy.sh/b/129891');
});

test('mapa custom continua no servidor da play', () => {
  for (const key of privados) {
    const url = osu.getMapUrl(100000123, 100000005, key);
    assert.ok(!url.startsWith('https://osu.ppy.sh'), `servidor ${key}: ${url}`);
    assert.ok(url.startsWith(servers.get(key).webUrl), `servidor ${key}: ${url}`);
  }
});

test('id que não é número não derruba o embed', () => {
  assert.doesNotThrow(() => osu.getMapUrl(null, null, 'official'));
  assert.doesNotThrow(() => osu.getMapUrl(undefined, 39804, 'official'));
});
