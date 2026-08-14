/**
 * db/connection.js
 * A conexão com o SQLite, e o porquê de serem dois arquivos.
 *
 * `node:sqlite` é nativo do Node — sem dependência externa nem build nativo.
 */

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  // node:sqlite chegou no v22.5.0, mas até o v22.12 exigia a flag
  // --experimental-sqlite; só a partir do v22.13/v23.4 funciona sem flag.
  console.error(
    `❌ Este bot requer Node.js 22.13+ (módulo nativo "node:sqlite" indisponível).\n` +
    `   Versão atual: ${process.version}. Atualize o Node.js e tente novamente.`
  );
  process.exit(1);
}

const { BOT_DB, CACHE_DB } = require('../paths');

const db = new DatabaseSync(BOT_DB);

// WAL melhora leitura concorrente e deixa a escrita mais barata; o bot lê o
// cache de mapas com muito mais frequência do que escreve.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

/**
 * O cache de mapas mora em OUTRO arquivo, anexado a esta mesma conexão.
 *
 * Os dados que importam (links, idiomas, staff, nomeações) somam alguns KB; o
 * cache de `.osu` chega perto de 90MB com o teto padrão. Junto num arquivo só,
 * todo backup, cópia ou VACUUM carregava dezenas de MB de coisa regenerável —
 * e não dava para apagar o cache sem colocar o resto em risco.
 *
 * ATTACH em vez de uma segunda conexão: as consultas continuam num handle só
 * (transação atravessa os dois arquivos, `close()` fecha tudo), e a separação
 * aparece apenas no prefixo `cache.` das tabelas.
 */
// As aspas simples são dobradas porque é assim que o SQLite escapa uma aspa
// dentro de literal de texto. O caminho vem da configuração, não de usuário,
// então não é injeção — mas basta um apóstrofo em `C:\Users\O'Brien\KurataniBot`
// para o ATTACH virar SQL inválido e o bot não subir, com um erro de sintaxe que
// não menciona o nome da pasta em lugar nenhum.
const CACHE_DB_LITERAL = CACHE_DB.replace(/\\/g, '/').replace(/'/g, "''");
db.exec(`ATTACH DATABASE '${CACHE_DB_LITERAL}' AS cache`);
db.exec('PRAGMA cache.journal_mode = WAL');
db.exec('PRAGMA cache.synchronous = NORMAL');

function close() {
  try {
    db.close();
  } catch {
    // já fechado
  }
}

module.exports = { db, close };
