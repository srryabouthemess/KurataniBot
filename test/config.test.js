/**
 * config.js: a leitura do `.env` num lugar só.
 *
 * Três promessas a manter:
 *   - leitura na hora do acesso (os testes e o bot podem mudar o ambiente);
 *   - valor inválido nunca derruba um comando — vira default — mas o
 *     `validate()` do boot aponta ele pelo NOME, sem vazar o valor;
 *   - ninguém fora do config.js (e do servers.js) lê o `process.env`, senão a
 *     centralização se desfaz um arquivo de cada vez.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const config = require('../src/config');

const ROOT = path.join(__dirname, '..');

/**
 * Parte de um ambiente limpo: o `.env` de quem roda a suíte não pode vazar aqui.
 * O KURATANI_DATA_DIR fica: é o test/setup.js que isola os dados deste processo.
 */
function limpar(extra = {}) {
  for (const name of config.VARS) if (name !== 'KURATANI_DATA_DIR') delete process.env[name];
  Object.assign(process.env, extra);
}

test('lê na hora do acesso, não no require', () => {
  limpar({ DAYCORE_GUILD_ID: '111111111111111111' });
  assert.equal(config.daycore.guildId, '111111111111111111');
  process.env.DAYCORE_GUILD_ID = '222222222222222222';
  assert.equal(config.daycore.guildId, '222222222222222222');
});

test('vazio e só espaço contam como ausente', () => {
  limpar({ DAYCORE_ANNOUNCE_CHANNEL_ID: '   ', COMMAND_PREFIX: '' });
  assert.equal(config.daycore.announceChannelId, null);
  assert.equal(config.commandPrefix, '');
});

test('número inválido vira o default na leitura', () => {
  limpar({ REDIS_HOST: 'localhost', REDIS_PORT: 'abc', REDIS_DB: '-1', BEATMAP_CACHE_MAX: '0' });
  assert.equal(config.redis.port, 6379);
  assert.equal(config.redis.database, 0);
  assert.equal(config.cache.beatmapMaxRows, 1500);
});

test('sem host, redis e mysql são null; com host, os defaults', () => {
  limpar();
  assert.equal(config.redis, null);
  assert.equal(config.daycoreMysql, null);

  limpar({ REDIS_HOST: 'r', DAYCORE_MYSQL_HOST: 'm' });
  assert.deepEqual(config.redis, { host: 'r', port: 6379, username: undefined, password: undefined, database: 0 });
  assert.deepEqual(config.daycoreMysql, { host: 'm', port: 3306, user: undefined, password: undefined, database: 'bancho' });
});

test('senha não passa por trim', () => {
  limpar({ REDIS_HOST: 'r', REDIS_PASS: ' com espaço ' });
  assert.equal(config.redis.password, ' com espaço ');
});

test('EXIT_ON_UNCAUGHT aceita as formas de sim', () => {
  for (const [value, expected] of [['true', true], ['1', true], ['sim', true], ['false', false], ['', false], ['talvez', false]]) {
    limpar({ EXIT_ON_UNCAUGHT: value });
    assert.equal(config.exitOnUncaught, expected, value);
  }
});

test('validate: ambiente mínimo passa', () => {
  limpar({ DISCORD_TOKEN: 'x', CLIENT_ID: '123456789012345678', OSU_CLIENT_ID: '1', OSU_CLIENT_SECRET: 's' });
  assert.deepEqual(config.validate(), { errors: [], warnings: [] });
});

test('validate: token e client id são exigidos só quando pedido', () => {
  limpar();
  assert.equal(config.validate().errors.length, 2);
  assert.equal(config.validate({ discord: false }).errors.length, 0);
});

test('validate: número e id do Discord malformados são erro, nomeando a variável', () => {
  limpar({
    DISCORD_TOKEN: 'x', CLIENT_ID: '123456789012345678',
    REDIS_PORT: '63a79', NOMINATION_THRESHOLD: '0',
    DAYCORE_ANNOUNCE_CHANNEL_ID: '12345',
  });

  const { errors } = config.validate();
  assert.equal(errors.length, 3, errors.join('\n'));
  assert.ok(errors.some(e => e.startsWith('REDIS_PORT')));
  assert.ok(errors.some(e => e.startsWith('NOMINATION_THRESHOLD')));
  assert.ok(errors.some(e => e.startsWith('DAYCORE_ANNOUNCE_CHANNEL_ID')));
});

test('validate: configuração pela metade é aviso', () => {
  limpar({ DISCORD_TOKEN: 'x', CLIENT_ID: '123456789012345678', DAYCORE_MYSQL_HOST: 'm', DAYCORE_GUILD_ID: '123456789012345678' });
  const { errors, warnings } = config.validate();
  assert.equal(errors.length, 0);
  assert.ok(warnings.some(w => w.includes('DAYCORE_MYSQL_USER')));
  assert.ok(warnings.some(w => w.includes('REDIS_HOST')));
  assert.ok(warnings.some(w => w.includes('OSU_CLIENT_ID')));
});

test('validate nunca repete o valor da variável', () => {
  const SEGREDO = 'segredo-que-nao-pode-vazar';
  limpar({ DISCORD_TOKEN: SEGREDO, CLIENT_ID: SEGREDO, REDIS_PORT: SEGREDO, DAYCORE_GUILD_ID: SEGREDO });
  const { errors, warnings } = config.validate();
  for (const line of [...errors, ...warnings]) assert.ok(!line.includes(SEGREDO), line);
});

test('toda variável do config está documentada no .env.example, e vice-versa', () => {
  const example = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  // Linhas `NOME=` — as comentadas de exemplo (`#   SERVER_X_URL=`) ficam de fora.
  const documented = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]));

  for (const name of config.VARS) {
    assert.ok(documented.has(name), `${name} é lida pelo config.js e não está no .env.example`);
  }

  // O que o servers.js lê por conta própria (ver o cabeçalho do config.js).
  const doServers = new Set(['SERVERS', 'OSU_MODE']);
  for (const name of documented) {
    assert.ok(config.VARS.includes(name) || doServers.has(name), `${name} está no .env.example e ninguém lê`);
  }
});

test('só config.js e servers.js leem o process.env', () => {
  const permitidos = new Set(['config.js', 'servers.js']);
  const achados = [];

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const rel = path.relative(path.join(ROOT, 'src'), full);
        if (permitidos.has(rel)) continue;
        const source = fs.readFileSync(full, 'utf8');
        if (/process\.env\b/.test(source) || /require\(['"]dotenv['"]\)/.test(source)) achados.push(rel);
      }
    }
  };
  walk(path.join(ROOT, 'src'));

  assert.deepEqual(achados, [], `leem o ambiente direto (use config.js): ${achados.join(', ')}`);
});
