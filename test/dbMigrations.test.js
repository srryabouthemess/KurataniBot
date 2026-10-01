/**
 * O carimbo de versão do schema.
 *
 * As migrações se detectam sozinhas — olham `PRAGMA table_info`, o
 * `sqlite_master` e flags no `meta` para decidir se já rodaram. Isso é robusto,
 * e custa uma dezena de consultas de sondagem em TODO boot, para sempre, num
 * banco que passou por elas anos atrás.
 *
 * O `user_version` fecha isso: rodou uma vez, o banco é carimbado, e o boot
 * seguinte sai na primeira linha. O que este arquivo trava são as duas pontas
 * dessa troca — que o carimbo é posto, e que ele de fato impede a repetição —,
 * e a recusa do banco antigo demais para as migrações que sobraram.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { dbWorkspace, ROOT } = require('./helpers');

/** Lê num handle próprio — e fecha, senão o Windows trava o arquivo. */
function comHandle(dbPath, fn) {
  const handle = new DatabaseSync(dbPath);
  try {
    return fn(handle);
  } finally {
    handle.close();
  }
}

const userVersion = (dbPath) =>
  comHandle(dbPath, h => h.prepare('PRAGMA user_version').get().user_version);

const primaryKey = (dbPath, table) =>
  comHandle(dbPath, h => h.prepare(`PRAGMA table_info(${table})`).all()
    .filter(c => c.pk > 0).map(c => c.name).sort().join(','));

test('banco novo já sai carimbado na versão atual', t => {
  const { dbPath, load } = dbWorkspace(t);
  const db = load();

  assert.ok(db.SCHEMA_VERSION >= 1, 'a versão atual deveria ser conhecida');
  assert.equal(userVersion(dbPath), db.SCHEMA_VERSION);
});

test('carregar de novo não muda o carimbo', t => {
  const { dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  const versao = userVersion(dbPath);
  primeiro.close();

  load();
  assert.equal(userVersion(dbPath), versao);
});

test('banco numa versão intermediária é levado até a atual', t => {
  // Quem atualiza o bot vindo de uma versão numerada: as faixas que faltam
  // rodam, o carimbo sobe, e o dado que estava lá continua.
  const { dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  primeiro.setUserLang('discord-A', 'en');
  primeiro.close();

  // 1 é a VERSAO_MINIMA: a mais antiga que as migrações ainda sabem levar.
  comHandle(dbPath, h => h.exec("PRAGMA user_version = 1"));

  const db = load();
  assert.equal(userVersion(dbPath), db.SCHEMA_VERSION);
  assert.equal(db.getUserLang('discord-A'), 'en', 'o dado existente deveria sobreviver');
});

test('o cache do lazer-calculator sai, e o do Relax fica', t => {
  // O vanilla passou a ser calculado pelo rosu-pp, com `engine = 'rosu'` na
  // chave. As linhas `lazer` não seriam mais lidas, e sem TTL também não
  // venceriam nunca.
  const { dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  primeiro.setMapDifficulty(1, 'DT', 'lazer', 6.5, 900);
  primeiro.setMapDifficulty(1, 'DT,RX', 'akatsuki@1.1.2-c0e499e', 4.2, 900);
  const fc = { mapId: 1, mods: 'DT', n300: 800, n100: 10, n50: 0 };
  primeiro.setCachedFCpp({ ...fc, engine: 'lazer' }, 500);
  primeiro.setCachedFCpp({ ...fc, engine: 'akatsuki@1.1.2-c0e499e' }, 300);
  primeiro.close();

  comHandle(dbPath, h => h.exec('PRAGMA user_version = 4'));

  const db = load();
  assert.equal(db.getMapDifficulty(1, 'DT', 'lazer'), null);
  assert.ok(db.getMapDifficulty(1, 'DT,RX', 'akatsuki@1.1.2-c0e499e'), 'a estrela do Relax deveria sobreviver');
  assert.equal(db.getCachedFCpp({ ...fc, engine: 'lazer' }), null);
  assert.equal(db.getCachedFCpp({ ...fc, engine: 'akatsuki@1.1.2-c0e499e' }), 300);
});

test('o cache do rosu-pp sem servidor sai, e o do akatsuki-pp fica', t => {
  // O rosu-pp virou um build por servidor, e a chave passou a dizer qual (com a
  // versão junto). As linhas `rosu` não se sabe de qual vieram.
  const { dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  primeiro.setMapDifficulty(1, 'DT', 'rosu', 6.5, 900);
  primeiro.setMapDifficulty(1, 'DT,RX', 'akatsuki@1.1.2-c0e499e', 4.2, 900);
  const fc = { mapId: 1, mods: 'DT', n300: 800, n100: 10, n50: 0 };
  primeiro.setCachedFCpp({ ...fc, engine: 'rosu' }, 500);
  primeiro.setCachedFCpp({ ...fc, engine: 'akatsuki@1.1.2-c0e499e' }, 300);
  primeiro.close();

  comHandle(dbPath, h => h.exec('PRAGMA user_version = 5'));

  const db = load();
  assert.equal(db.getMapDifficulty(1, 'DT', 'rosu'), null);
  assert.equal(db.getCachedFCpp({ ...fc, engine: 'rosu' }), null);
});

test('6 → 7 descarta o cache do akatsuki-pp-py e mantém o dos builds', t => {
  // As linhas `akatsuki` sem versão vieram do akatsuki-pp-py do PyPI, num
  // commit que nenhum servidor roda; os builds novos gravam com a versão.
  const { dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  primeiro.setMapDifficulty(1, 'DT,RX', 'akatsuki', 4.2, 900);
  primeiro.setMapDifficulty(1, 'DT,RX', 'akatsuki@1.1.2-c0e499e', 4.3, 900);
  const fc = { mapId: 1, mods: 'DT,RX', n300: 800, n100: 10, n50: 0 };
  primeiro.setCachedFCpp({ ...fc, engine: 'akatsuki' }, 300);
  primeiro.setCachedFCpp({ ...fc, engine: 'daycore_rx@1.1.2-591de0d' }, 310);
  primeiro.close();

  comHandle(dbPath, h => h.exec('PRAGMA user_version = 6'));

  const db = load();
  assert.equal(db.getMapDifficulty(1, 'DT,RX', 'akatsuki'), null);
  assert.ok(db.getMapDifficulty(1, 'DT,RX', 'akatsuki@1.1.2-c0e499e'), 'a estrela do build deveria sobreviver');
  assert.equal(db.getCachedFCpp({ ...fc, engine: 'akatsuki' }), null);
  assert.equal(db.getCachedFCpp({ ...fc, engine: 'daycore_rx@1.1.2-591de0d' }), 310);
});

test('7 → 8 apaga o link antigo de users e mantém o resto', t => {
  // O modelo antigo guardava o link em users(osu_user, osu_server, osu_id); a
  // migração para user_links copiou e deixou a origem, que ninguém mais lê.
  const { dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  primeiro.setLink('1', 'official', 'fulano', 123);
  primeiro.close();

  comHandle(dbPath, h => {
    h.exec("UPDATE users SET osu_user = 'fulano', osu_server = 'official', osu_id = 123, lang = 'pt' WHERE discord_id = '1'");
    h.exec('PRAGMA user_version = 7');
  });

  const db = load();
  const row = comHandle(dbPath, h => h.prepare("SELECT osu_user, osu_server, osu_id, lang, preferred_server FROM users WHERE discord_id = '1'").get());
  assert.equal(row.osu_user, null);
  assert.equal(row.osu_server, null);
  assert.equal(row.osu_id, null);
  assert.equal(row.lang, 'pt');
  assert.equal(row.preferred_server, 'official');
  assert.equal(db.getLink('1', 'official').osu_user, 'fulano', 'o link em user_links deveria sobreviver');
});

/** Carrega esperando a recusa, e fecha o handle que a conexão já abriu. */
function recusa(load) {
  let erro = null;
  try {
    load();
  } catch (e) {
    erro = e;
  } finally {
    require(path.join(ROOT, 'db', 'connection')).close();
  }
  return erro;
}

test('banco sem carimbo é recusado, apontando quem ainda sabe migrá-lo', t => {
  // A faixa 0→1 saiu. Aplicar o schema atual por cima de tabelas antigas não
  // daria erro na hora — misturaria os dois formatos. Recusar é o lado seguro.
  const { dbPath, load } = dbWorkspace(t);

  comHandle(dbPath, h => h.exec(`
    CREATE TABLE map_nominations (
      set_id        INTEGER NOT NULL,
      target_status INTEGER NOT NULL,
      discord_id    TEXT    NOT NULL,
      osu_id        INTEGER NOT NULL,
      osu_name      TEXT,
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (set_id, target_status, discord_id)
    );
  `));

  const erro = recusa(load);
  assert.ok(erro, 'deveria ter recusado o banco');
  assert.match(erro.message, /anterior à numeração/);
  assert.match(erro.message, /git checkout [0-9a-f]{7}/);

  // E não mexeu em nada: a tabela antiga continua como estava.
  assert.equal(primaryKey(dbPath, 'map_nominations'), 'discord_id,set_id,target_status');
  assert.equal(userVersion(dbPath), 0);
});

test('JSON de antes do SQLite, sem banco, é recusado em vez de ignorado', t => {
  // Criar um bot.db vazio ao lado de um links.json seria perder os links calado.
  const { dir, load } = dbWorkspace(t);
  fs.writeFileSync(path.join(dir, 'links.json'), '{}');

  const erro = recusa(load);
  assert.ok(erro, 'deveria ter recusado');
  assert.match(erro.message, /links\.json/);
});

test('o .migrated que sobrou da importação antiga não atrapalha', t => {
  const { dir, dbPath, load } = dbWorkspace(t);
  fs.writeFileSync(path.join(dir, 'links.json.migrated'), '{}');

  const db = load();
  assert.equal(userVersion(dbPath), db.SCHEMA_VERSION);
});

// ─── Rollback: banco mais novo que o código, e o backup de antes de migrar ────

test('banco de schema mais novo que o código é recusado, sem ser tocado', t => {
  // É o rollback de código depois de uma migração: antes o `run` via
  // `versao >= VERSAO_ATUAL`, saía calado, e o bot seguia gravando num formato
  // que não conhece.
  const { dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  const atual = primeiro.SCHEMA_VERSION;
  primeiro.setUserLang('discord-A', 'en');
  primeiro.close();

  comHandle(dbPath, h => h.exec(`PRAGMA user_version = ${atual + 1}`));

  const erro = recusa(load);
  assert.ok(erro, 'deveria ter recusado o banco');
  assert.match(erro.message, new RegExp(`versão ${atual + 1} do schema`));
  assert.match(erro.message, new RegExp(`só conhece até a ${atual}`));
  assert.match(erro.message, /backup de antes dela/);

  assert.equal(userVersion(dbPath), atual + 1, 'o carimbo não deveria ter descido');
  assert.equal(
    comHandle(dbPath, h => h.prepare("SELECT lang FROM users WHERE discord_id = 'discord-A'").get().lang),
    'en',
  );
});

test('o run também recusa o banco mais novo, e aceita o da versão atual', () => {
  // A trava mora no `run` além da conferência do boot: quem chamar as
  // migrações por outro caminho não passa por cima dela.
  const migrations = require(path.join(ROOT, 'db', 'migrations'));
  const h = new DatabaseSync(':memory:');
  try {
    h.exec(`PRAGMA user_version = ${migrations.VERSAO_ATUAL}`);
    assert.equal(migrations.run(h), migrations.VERSAO_ATUAL);

    h.exec(`PRAGMA user_version = ${migrations.VERSAO_ATUAL + 1}`);
    assert.throws(() => migrations.run(h), /só conhece até a/);
  } finally {
    h.close();
  }
});

/** Os backups gravados na pasta de dados do workspace. */
const backupsEm = (dir) => {
  const pasta = path.join(dir, 'backups');
  return fs.existsSync(pasta) ? fs.readdirSync(pasta).sort() : [];
};

test('antes de migrar, o bot.db é copiado como estava', t => {
  // Voltar o código depois de uma migração exige o banco de antes dela; esta
  // é a cópia, tirada antes até do schema.apply.
  const { dir, dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  primeiro.setLink('1', 'official', 'fulano', 123);
  primeiro.close();
  assert.deepEqual(backupsEm(dir), [], 'banco novo não tem o que copiar');

  comHandle(dbPath, h => {
    h.exec("UPDATE users SET osu_user = 'fulano' WHERE discord_id = '1'");
    h.exec('PRAGMA user_version = 7');
  });

  const db = load();
  const [nome, ...resto] = backupsEm(dir);
  assert.match(nome, /^bot-pre-v7-\d{4}-\d{2}-\d{2}\.db$/);
  assert.deepEqual(resto, []);

  // A cópia é o banco de ANTES: carimbo 7 e o valor que a 7 → 8 apaga.
  const copia = path.join(dir, 'backups', nome);
  assert.equal(userVersion(copia), 7);
  assert.equal(comHandle(copia, h => h.prepare("SELECT osu_user FROM users WHERE discord_id = '1'").get().osu_user), 'fulano');
  assert.equal(userVersion(dbPath), db.SCHEMA_VERSION, 'e a migração rodou mesmo assim');
  db.close();

  // Já na versão atual, nada a migrar: nada a copiar.
  load().close();
  assert.equal(backupsEm(dir).length, 1);

  // Outra migração a partir da mesma versão no mesmo dia não sobrescreve a
  // primeira cópia: ela pode ser o único retrato bom de antes de uma falha.
  comHandle(dbPath, h => h.exec('PRAGMA user_version = 7'));
  load();
  assert.deepEqual(backupsEm(dir), [nome, nome.replace(/\.db$/, '-2.db')].sort());
});

test('banco mais novo não ganha backup de "antes de migrar"', t => {
  const { dir, dbPath, load } = dbWorkspace(t);
  const primeiro = load();
  const atual = primeiro.SCHEMA_VERSION;
  primeiro.close();

  comHandle(dbPath, h => h.exec(`PRAGMA user_version = ${atual + 1}`));
  assert.ok(recusa(load));
  assert.deepEqual(backupsEm(dir), []);
});

// ─── 8 → 9: formato do score total ────────────────────────────────────────────

const colunasDe = (dbPath, table) =>
  comHandle(dbPath, h => h.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));

test('banco novo já nasce com users.score_format', t => {
  const { dbPath, load } = dbWorkspace(t);
  const db = load();

  assert.ok(colunasDe(dbPath, 'users').includes('score_format'));
  assert.equal(db.getScoreFormat('1'), null, 'sem preferência é null, que vale o clássico');

  db.setScoreFormat('1', 'standardised');
  assert.equal(db.getScoreFormat('1'), 'standardised');
  db.setScoreFormat('1', 'lixo');
  assert.equal(db.getScoreFormat('1'), null, 'valor inválido não é gravado');
});

test('8 → 9 acrescenta users.score_format e mantém o resto', t => {
  const { dbPath, load } = dbWorkspace(t);

  const primeiro = load();
  primeiro.setLink('1', 'official', 'fulano', 123);
  primeiro.setPreferredModo('1', 'rx');
  primeiro.close();

  // O banco como a versão 8 o deixava: a tabela sem a coluna. Refeita em vez
  // de `DROP COLUMN`, que o SQLite recusa por causa dos comentários do CREATE.
  comHandle(dbPath, h => h.exec(`
    CREATE TABLE users_v8 (
      discord_id TEXT PRIMARY KEY, osu_user TEXT, osu_server TEXT, lang TEXT,
      osu_id INTEGER, preferred_server TEXT, preferred_modo TEXT
    );
    INSERT INTO users_v8 SELECT discord_id, osu_user, osu_server, lang, osu_id,
      preferred_server, preferred_modo FROM users;
    DROP TABLE users;
    ALTER TABLE users_v8 RENAME TO users;
    PRAGMA user_version = 8;
  `));
  assert.ok(!colunasDe(dbPath, 'users').includes('score_format'));

  const db = load();
  assert.equal(userVersion(dbPath), 9);
  assert.ok(colunasDe(dbPath, 'users').includes('score_format'));
  assert.equal(db.getScoreFormat('1'), null, 'quem já existia fica sem preferência, o clássico');
  assert.equal(db.getPreferredModo('1'), 'rx');
  assert.equal(db.getLink('1', 'official').osu_user, 'fulano');

  db.setScoreFormat('1', 'classic');
  assert.equal(db.getScoreFormat('1'), 'classic');
});
