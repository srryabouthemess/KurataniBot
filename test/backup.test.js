/**
 * O backup do bot.db: a cópia sai legível, com o que ainda está no WAL, e só
 * os últimos 14 dias ficam.
 *
 * O backup de antes de migrar, que usa as mesmas peças no boot, está no
 * dbMigrations.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const backup = require('../src/db/backup');

/** Pasta de dados descartável, com um bot.db em WAL e uma linha nele. */
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-backup-'));
  const db = new DatabaseSync(path.join(dir, 'bot.db'));
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE users (discord_id TEXT); INSERT INTO users VALUES ('1');");
  t.after(() => {
    try { db.close(); } catch { /* já fechado */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, db, backups: path.join(dir, 'backups') };
}

/** Lê num handle próprio — e fecha, senão o Windows trava o arquivo. */
function ler(arquivo, sql) {
  const h = new DatabaseSync(arquivo, { readOnly: true });
  try {
    return h.prepare(sql).all();
  } finally {
    h.close();
  }
}

test('o backup do dia sai legível, com o que ainda está no WAL', t => {
  const { db, backups } = workspace(t);
  const agora = new Date(2026, 8, 30, 4, 0);

  const destino = backup.backupDiario(db, { dir: backups, agora });
  assert.equal(path.basename(destino), 'bot-2026-09-30.db');
  assert.deepEqual(ler(destino, 'SELECT discord_id FROM users').map(r => r.discord_id), ['1']);

  // No mesmo dia, sobrescreve — e a cópia nova tem o que entrou desde a outra.
  db.exec("INSERT INTO users VALUES ('2')");
  backup.backupDiario(db, { dir: backups, agora: new Date(2026, 8, 30, 23, 0) });
  assert.deepEqual(fs.readdirSync(backups), ['bot-2026-09-30.db']);
  assert.deepEqual(ler(destino, 'SELECT discord_id FROM users ORDER BY 1').map(r => r.discord_id), ['1', '2']);
});

test('caminho com apóstrofo não quebra o VACUUM INTO', t => {
  const { db, dir } = workspace(t);
  const destino = backup.backupDiario(db, { dir: path.join(dir, "O'Brien"), agora: new Date(2026, 8, 30) });
  assert.equal(ler(destino, 'SELECT COUNT(*) AS n FROM users')[0].n, 1);
});

test('apaga os backups com mais de 14 dias, e só eles', t => {
  const { backups } = workspace(t);
  fs.mkdirSync(backups);
  const arquivos = [
    'bot-2026-09-30.db',        // hoje
    'bot-2026-09-16.db',        // 14 dias: fica
    'bot-2026-09-15.db',        // 15 dias: sai
    'bot-pre-v7-2026-09-01.db', // antes de migrar também vence
    'bot-pre-v7-2026-09-01-2.db',
    'bot-pre-v8-2026-09-29.db',
    'notas.txt',                // não é backup: não é da conta de ninguém aqui
  ];
  for (const f of arquivos) fs.writeFileSync(path.join(backups, f), '');

  const apagados = backup.limparAntigos({ dir: backups, agora: new Date(2026, 8, 30, 4, 0) });

  assert.deepEqual(apagados.sort(), ['bot-2026-09-15.db', 'bot-pre-v7-2026-09-01-2.db', 'bot-pre-v7-2026-09-01.db']);
  assert.deepEqual(fs.readdirSync(backups).sort(), [
    'bot-2026-09-16.db', 'bot-2026-09-30.db', 'bot-pre-v8-2026-09-29.db', 'notas.txt',
  ]);
});

test('sem pasta de backups, a limpeza não tem o que fazer', t => {
  const { backups } = workspace(t);
  assert.deepEqual(backup.limparAntigos({ dir: backups }), []);
});

test('npm run backup: copia com o banco aberto e limpa os antigos', t => {
  const { dir, backups } = workspace(t);
  fs.mkdirSync(backups);
  fs.writeFileSync(path.join(backups, 'bot-2000-01-01.db'), '');

  const saida = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'backup.js')], {
    env: { ...process.env, KURATANI_DATA_DIR: dir },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const hoje = fs.readdirSync(backups);
  assert.equal(hoje.length, 1);
  assert.match(hoje[0], /^bot-\d{4}-\d{2}-\d{2}\.db$/);
  assert.match(saida, /bot-2000-01-01\.db/);
  assert.equal(ler(path.join(backups, hoje[0]), 'SELECT COUNT(*) AS n FROM users')[0].n, 1);
});
