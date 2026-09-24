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
