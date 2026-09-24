/**
 * Nomeação: unicidade por conta de JOGO (não por conta do Discord).
 *
 * (A migração que trocava a chave da tabela antiga saiu junto com a faixa 0→1
 * das migrações; um banco daquela época agora é recusado — ver dbMigrations.)
 *
 * Roda contra um bot.db descartável, apontado por `KURATANI_DATA_DIR` (ver
 * dbWorkspace em helpers.js). O caminho do banco saía de `src/` e não havia como
 * desviá-lo, então isto copiava os módulos para uma pasta que imitava o layout
 * do projeto — o que amarrava o teste à lista de arquivos do `db`.
 */
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

const { dbWorkspace } = require('./helpers');

function workspace(t) {
  const ws = dbWorkspace(t);

  /** Lê a PK num handle próprio — e fecha, senão o Windows trava o arquivo. */
  const primaryKey = (table = 'map_nominations') => {
    const handle = new DatabaseSync(ws.dbPath);
    try {
      return handle.prepare(`PRAGMA table_info(${table})`).all()
        .filter(c => c.pk > 0).map(c => c.name).sort().join(',');
    } finally {
      handle.close();
    }
  };

  return { ...ws, primaryKey };
}

test('banco novo já nasce com a chave certa', async t => {
  const { load, primaryKey } = workspace(t);
  const db = load();

  assert.equal(primaryKey(), 'osu_id,set_id,target_status');

  await t.test('duas contas do Discord com o mesmo osu! id contam uma vez', () => {
    db.addNomination(100, 2, 'discord-A', 777, 'fulano');
    db.addNomination(100, 2, 'discord-B', 777, 'fulano');
    assert.equal(db.getNominations(100, 2).length, 1);
  });

  await t.test('contas de jogo distintas somam', () => {
    db.addNomination(100, 2, 'discord-C', 888, 'sicrano');
    assert.equal(db.getNominations(100, 2).length, 2);
  });

  await t.test('guarda quem operou por último', () => {
    const row = db.getNominations(100, 2).find(r => r.osu_id === 777);
    assert.equal(row.discord_id, 'discord-B');
  });

  await t.test('withdraw é por conta de jogo', () => {
    assert.equal(db.removeNomination(100, 2, 777), true);
    assert.equal(db.getNominations(100, 2).length, 1);
    assert.equal(db.removeNomination(100, 2, 999), false);
  });

  await t.test('ranked e loved são filas independentes', () => {
    db.addNomination(100, 5, 'discord-A', 777, 'fulano');
    assert.equal(db.getNominations(100, 2).length, 1);
    assert.equal(db.getNominations(100, 5).length, 1);
  });
});
