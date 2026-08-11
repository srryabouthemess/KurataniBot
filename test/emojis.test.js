/** Envio dos application emojis: nomes aceitos, recusas e o texto de reserva. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const emojis = require('../emojis');

// PNG de 1x1, o menor arquivo válido possível.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('sem emoji enviado, a grade sai em texto', () => {
  assert.equal(emojis.rankLabel('A'), '**A**');
  assert.equal(emojis.rank('X'), null);
  assert.equal(emojis.rankLabel('?'), '**?**');
});

test('sync envia o que falta e reaproveita o resto', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-'));
  fs.writeFileSync(path.join(dir, 'rank_ss.png'), PNG);
  fs.writeFileSync(path.join(dir, 'ranking-A.png'), PNG);   // nome do pacote oficial
  fs.writeFileSync(path.join(dir, '--.png'), PNG);          // não sobra nome
  fs.writeFileSync(path.join(dir, 'gigante.png'), Buffer.alloc(300 * 1024));
  fs.writeFileSync(path.join(dir, 'leiame.txt'), 'nao e imagem');

  // O ASSETS_DIR é fixo no módulo; redirecionamos o fs que ele consulta.
  const realReaddir = fs.readdirSync;
  const realExists  = fs.existsSync;
  const realStat    = fs.statSync;
  fs.readdirSync = p => (p === emojis.ASSETS_DIR ? realReaddir(dir) : realReaddir(p));
  fs.existsSync  = p => (p === emojis.ASSETS_DIR ? true : realExists(p));
  fs.statSync    = p => realStat(
    String(p).startsWith(emojis.ASSETS_DIR) ? path.join(dir, path.basename(p)) : p,
  );
  t.after(() => {
    fs.readdirSync = realReaddir;
    fs.existsSync  = realExists;
    fs.statSync    = realStat;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const created = [];
  const client = ({ existing = [], failOn = null } = {}) => ({
    application: {
      emojis: {
        fetch: async () => new Map(existing.map(e => [e.name, {
          name: e.name, toString: () => `<:${e.name}:${e.id}>`,
        }])),
        create: async ({ name }) => {
          if (name === failOn) throw new Error('recusado pela API');
          created.push(name);
          return { name, toString: () => `<:${name}:900${created.length}>` };
        },
      },
    },
  });

  await t.test('envia só os arquivos válidos', async () => {
    await emojis.sync(client());
    assert.deepEqual(created.sort(), ['rank_ss', 'ranking_a']);
  });

  await t.test('hífen do nome oficial vira _', () => {
    assert.match(emojis.rankLabel('A'), /ranking_a/);
  });

  await t.test('as duas convenções de nome resolvem a mesma grade', () => {
    assert.match(emojis.rankLabel('X'), /rank_ss/);
    assert.equal(emojis.rank('SS'), emojis.rank('X'));
    assert.equal(emojis.rank('a'), emojis.rank('A'));
  });

  await t.test('grade sem arquivo continua em texto', () => {
    assert.equal(emojis.rankLabel('XH'), '**XH**');
  });

  await t.test('não reenvia o que o aplicativo já tem', async () => {
    created.length = 0;
    await emojis.sync(client({ existing: [{ name: 'rank_ss', id: '1' }, { name: 'ranking_a', id: '2' }] }));
    assert.deepEqual(created, []);
    assert.equal(emojis.rank('X'), '<:rank_ss:1>');
  });
});

test('falha num emoji não impede os outros', async t => {
  // Cache novo: o de nomes vive pelo processo (um boot = um sync).
  delete require.cache[require.resolve('../emojis')];
  const fresh = require('../emojis');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji2-'));
  fs.writeFileSync(path.join(dir, 'rank_ss.png'), PNG);
  fs.writeFileSync(path.join(dir, 'rank_a.png'), PNG);

  const realReaddir = fs.readdirSync;
  const realExists  = fs.existsSync;
  const realStat    = fs.statSync;
  fs.readdirSync = p => (p === fresh.ASSETS_DIR ? realReaddir(dir) : realReaddir(p));
  fs.existsSync  = p => (p === fresh.ASSETS_DIR ? true : realExists(p));
  fs.statSync    = p => realStat(
    String(p).startsWith(fresh.ASSETS_DIR) ? path.join(dir, path.basename(p)) : p,
  );
  t.after(() => {
    fs.readdirSync = realReaddir;
    fs.existsSync  = realExists;
    fs.statSync    = realStat;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const created = [];
  await fresh.sync({
    application: {
      emojis: {
        fetch: async () => new Map(),
        create: async ({ name }) => {
          if (name === 'rank_ss') throw new Error('recusado pela API');
          created.push(name);
          return { name, toString: () => `<:${name}:1>` };
        },
      },
    },
  });

  assert.deepEqual(created, ['rank_a']);
});
