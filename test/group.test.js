/**
 * /group — põe e tira jogador de grupo do Daycore.
 *
 * Quem grava em `sh_groups_users` é o bancho, ao receber o canal `setgroup`
 * (patch do Daycore). O servidor valida alvo, grupo e ação, mas NÃO olha quem
 * publicou: a tranca de quem pode é o comando, e é isso que estes casos travam.
 */
const test = require('node:test');
const assert = require('node:assert');

// Stub do redis antes de carregar o daycoreAdmin, que desestrutura o
// createClient no require — o mesmo arranjo do test/role.test.js.
process.env.REDIS_HOST = '127.0.0.1';
const published = [];
const redis = require('redis');
redis.createClient = () => ({
  isOpen: true,
  on() {},
  async connect() {},
  async publish(channel, payload) { published.push([channel, JSON.parse(payload)]); },
});

const daycore = require('../src/daycoreAdmin');
const group = require('../src/commands/admin/group');

const ACTOR = { osuId: 3, discordId: '100000000000000002', discordName: 'staff-dois' };

test('setGroup publica o formato exato que o receptor lê', async () => {
  published.length = 0;
  await daycore.setGroup(1234, 7, 'add', ACTOR);
  await daycore.setGroup(1234, 7, 'remove', ACTOR);

  assert.deepEqual(published, [
    ['setgroup', { id: 1234, groupId: 7, action: 'add',    adminId: 3 }],
    ['setgroup', { id: 1234, groupId: 7, action: 'remove', adminId: 3 }],
  ]);
});

test('ação fora de add/remove não chega a ser publicada', async () => {
  // O bancho responderia `invalid action` para o console dele, não para cá.
  published.length = 0;
  await assert.rejects(() => daycore.setGroup(1234, 7, 'toggle', ACTOR), /toggle/);
  assert.equal(published.length, 0);
});

test('verifyGroup confirma pela releitura do MySQL e desiste quando não bate', async () => {
  const mysql = require('../src/daycoreMysql');
  const original = mysql.getPool;
  mysql.getPool = () => ({ query: async () => [[{ group_id: 7 }, { group_id: 9 }]] });
  try {
    const rapido = { attempts: 2, delayMs: 1 };
    assert.equal(await daycore.verifyGroup(1234, 7, true,  rapido), true);
    assert.equal(await daycore.verifyGroup(1234, 8, true,  rapido), false);
    assert.equal(await daycore.verifyGroup(1234, 8, false, rapido), true);
  } finally {
    mysql.getPool = original;
  }
});

test('findGroupByName compara o nome inteiro, sem diferenciar maiúscula', async () => {
  const mysql = require('../src/daycoreMysql');
  const original = mysql.getPool;
  mysql.getPool = () => ({
    query: async () => [[
      { id: 1, name: 'Legit', removes_from_leaderboard: 0 },
      { id: 2, name: 'Closet Cheating', removes_from_leaderboard: 1 },
    ]],
  });
  try {
    assert.equal((await daycore.findGroupByName('legit')).id, 1);
    assert.equal((await daycore.findGroupByName('  CLOSET cheating ')).id, 2);
    // Prefixo daria o grupo errado a quem digitou pela metade.
    assert.equal(await daycore.findGroupByName('Closet'), null);
  } finally {
    mysql.getPool = original;
  }
});

test('o comando tem add e remove, e fica fora do modo texto', () => {
  const json = group.data.toJSON();
  assert.deepEqual(json.options.map(o => o.name).sort(), ['add', 'remove']);
  for (const sub of json.options) {
    assert.deepEqual(sub.options.map(o => o.name), ['player', 'group', 'reason']);
  }
  assert.equal(group.prefix?.slashOnly, true);
  assert.equal(group.defer, 'ephemeral');
});

test('a tranca é MODERATOR', () => {
  // Grupo não dá poder sobre conta nenhuma, só muda onde o jogador aparece.
  const fonte = require('fs').readFileSync(require.resolve('../src/commands/admin/group'), 'utf8');
  assert.match(fonte, /resolveStaff\(interaction, daycore\.Privileges\.MODERATOR/);
});
