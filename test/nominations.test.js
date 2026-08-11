/**
 * Nomeação: unicidade por conta de JOGO (não por conta do Discord) e a
 * migração que troca a chave da tabela antiga.
 *
 * Roda contra um bot.db descartável — o db.js abre o banco ao lado dele mesmo,
 * então copiamos o módulo para um diretório temporário.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');

function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-db-'));
  for (const file of ['db.js', 'servers.js']) {
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');

  const dbPath = path.join(dir, 'bot.db');

  // Todo handle aberto é fechado ANTES de apagar a pasta: no Windows um banco
  // ainda aberto trava o arquivo e o rmSync falha com EPERM.
  const opened = [];
  const load = () => {
    delete require.cache[require.resolve(path.join(dir, 'db.js'))];
    const db = require(path.join(dir, 'db.js'));
    opened.push(db);
    return db;
  };

  /** Lê a PK num handle próprio — e fecha, senão o Windows trava o arquivo. */
  const primaryKey = (table = 'map_nominations') => {
    const handle = new DatabaseSync(dbPath);
    try {
      return handle.prepare(`PRAGMA table_info(${table})`).all()
        .filter(c => c.pk > 0).map(c => c.name).sort().join(',');
    } finally {
      handle.close();
    }
  };

  t.after(() => {
    for (const db of opened) { try { db.close(); } catch { /* já fechado */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return { dir, dbPath, load, primaryKey };
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

test('banco antigo é migrado e deduplicado', async t => {
  const { dbPath, load, primaryKey } = workspace(t);

  // Schema ANTIGO, com dois votos da mesma conta de jogo.
  const old = new DatabaseSync(dbPath);
  old.exec(`
    CREATE TABLE map_nominations (
      set_id        INTEGER NOT NULL,
      target_status INTEGER NOT NULL,
      discord_id    TEXT    NOT NULL,
      osu_id        INTEGER NOT NULL,
      osu_name      TEXT,
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (set_id, target_status, discord_id)
    );
    INSERT INTO map_nominations VALUES
      (200, 2, 'discord-A', 777, 'fulano',  1000),
      (200, 2, 'discord-B', 777, 'fulano',  2000),
      (200, 2, 'discord-C', 888, 'sicrano', 3000);
  `);
  old.close();

  const db = load();
  const rows = db.getNominations(200, 2);

  await t.test('o voto repetido some', () => {
    assert.equal(rows.length, 2);
  });

  await t.test('fica a nomeação mais antiga, com o Discord dela', () => {
    const row = rows.find(r => r.osu_id === 777);
    assert.equal(row.created_at, 1000);
    assert.equal(row.discord_id, 'discord-A');
  });

  await t.test('a outra pessoa é preservada', () => {
    assert.ok(rows.some(r => r.osu_id === 888));
  });

  await t.test('a chave da tabela foi trocada', () => {
    assert.equal(primaryKey(), 'osu_id,set_id,target_status');
  });

  await t.test('o duplicado não reaparece depois', () => {
    db.addNomination(200, 2, 'discord-B', 777, 'fulano');
    assert.equal(db.getNominations(200, 2).length, 2);
  });

  await t.test('carregar de novo é idempotente', () => {
    const again = load();
    assert.equal(again.getNominations(200, 2).length, 2);
    again.close();
  });
});
