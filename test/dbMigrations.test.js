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
 * dessa troca — que o carimbo é posto, e que ele de fato impede a repetição.
 */
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

const { dbWorkspace } = require('./helpers');

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

test('banco carimbado não repete as migrações herdadas', t => {
  const { dbPath, load } = dbWorkspace(t);

  // Uma tabela no formato ANTIGO, mas com o carimbo da versão atual. A
  // combinação não acontece na vida real — é justamente por isso que ela serve
  // de prova: se as migrações rodassem assim mesmo, a chave seria reconstruída,
  // e o carimbo não estaria evitando trabalho nenhum.
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
    PRAGMA user_version = 1;
  `));

  load();

  assert.equal(
    primaryKey(dbPath, 'map_nominations'), 'discord_id,set_id,target_status',
    'a migração rodou num banco que já estava carimbado',
  );
});

test('banco sem carimbo ainda é migrado', t => {
  // A contraparte do caso acima: mesma tabela antiga, sem carimbo. É o banco de
  // quem atualiza o bot vindo de uma versão anterior, e ele PRECISA ser tocado.
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
    INSERT INTO map_nominations VALUES (300, 2, 'discord-A', 777, 'fulano', 1000);
  `));

  const db = load();

  assert.equal(primaryKey(dbPath, 'map_nominations'), 'osu_id,set_id,target_status');
  assert.equal(userVersion(dbPath), db.SCHEMA_VERSION, 'deveria ter sido carimbado ao fim');
  assert.equal(db.getNominations(300, 2).length, 1, 'a nomeação existente deveria sobreviver');
});
