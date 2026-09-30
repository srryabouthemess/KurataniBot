/**
 * Backup diário do bot.db: `npm run backup`.
 *
 * Grava `data/backups/bot-AAAA-MM-DD.db` e apaga os com mais de 14 dias. Rodar
 * de novo no mesmo dia sobrescreve o do dia. Pode rodar com o bot no ar: o
 * `VACUUM INTO` lê um retrato consistente mesmo com o WAL cheio (ver
 * src/db/backup.js). A linha de crontab sugerida está no docs/OPCIONAIS.md.
 *
 * Abre o arquivo direto, somente leitura, e NÃO pelo `src/db`: carregar aquele
 * roda schema e migrações, e um backup não pode ser quem muda o banco.
 */
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const { BOT_DB } = require('../src/paths');
const backup = require('../src/db/backup');

if (!fs.existsSync(BOT_DB)) {
  console.error(`backup: não há bot.db em ${BOT_DB}. Nada a copiar.`);
  process.exit(1);
}

const db = new DatabaseSync(BOT_DB, { readOnly: true });
try {
  console.log(`backup: ${backup.backupDiario(db)}`);
} finally {
  db.close();
}

const apagados = backup.limparAntigos();
if (apagados.length > 0) {
  console.log(`backup: ${apagados.length} com mais de ${backup.DIAS_DE_RETENCAO} dias apagado(s): ${apagados.join(', ')}`);
}
