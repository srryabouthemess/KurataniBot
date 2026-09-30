/**
 * db/backup.js
 * Cópias do bot.db — o banco que não se refaz sozinho e sem o qual o bot não
 * funciona.
 *
 * Links, idiomas, preferências e vínculos de staff só existem ali. O cache.db
 * fica de fora de propósito: é regenerável por desenho (ver connection.js), e
 * copiá-lo seria carregar dezenas de MB de coisa que o bot baixa de novo.
 *
 * O scores.db também fica de fora, por outra razão. Ele não se refaz sozinho,
 * mas é acessório: são dados públicos que voltam aos poucos com o uso, e perdê-
 * lo não tira resposta de comando nenhum. Copiá-lo seriam até 64MB por dia,
 * guardados por `DIAS_DE_RETENCAO` dias — e um score apagado a pedido
 * (`forgetPlayer`) continuaria nas cópias por esse tempo todo.
 *
 * Dois momentos usam isto:
 *
 *   - o `npm run backup` (scripts/backup.js), no cron diário;
 *   - o boot, antes de uma migração rodar (ver migrations.js). Uma migração
 *     muda o formato do banco, e o código de antes dela não sabe mais abri-lo:
 *     voltar o código exige o bot.db de antes, e é esta cópia.
 *
 * `VACUUM INTO` e não `fs.copyFile`: com o bot rodando em WAL, as escritas
 * recentes moram no -wal, e copiar só o .db levaria um retrato sem elas (ou
 * rasgado no meio de um checkpoint). O VACUUM INTO lê pelo SQLite, dentro de uma
 * transação de leitura, e grava um arquivo único e consistente.
 */

const fs   = require('fs');
const path = require('path');

const { BACKUPS_DIR } = require('../paths');

/** Por quantos dias um backup fica guardado. */
const DIAS_DE_RETENCAO = 14;

/**
 * O nome de todo backup: `bot-AAAA-MM-DD.db`, `bot-pre-v7-AAAA-MM-DD.db` e, se
 * a mesma migração tentou rodar duas vezes no dia, `bot-pre-v7-AAAA-MM-DD-2.db`.
 * A data do NOME é o que a limpeza lê — o mtime muda a cada sobrescrita.
 */
const NOME_DE_BACKUP = /^bot-(?:pre-v\d+-)?(\d{4})-(\d{2})-(\d{2})(?:-\d+)?\.db$/;

/** AAAA-MM-DD no fuso da máquina — o mesmo em que o cron roda. */
function dataLocal(agora) {
  const p = n => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

/**
 * Grava o `main` da conexão em `destino`, sobrescrevendo o que houver lá.
 *
 * Passa por um `.tmp` porque o VACUUM INTO se recusa a escrever num arquivo que
 * já existe — e apagar o de destino antes deixaria o dia sem backup nenhum se a
 * cópia falhasse no meio. O rename no fim troca um pelo outro de uma vez.
 */
function copiar(db, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const tmp = `${destino}.tmp`;
  fs.rmSync(tmp, { force: true });

  // Mesmo escape do ATTACH em connection.js: aspa simples dobrada é como o
  // SQLite escreve uma aspa dentro de literal, e um apóstrofo no caminho
  // (`C:\Users\O'Brien\...`) viraria SQL inválido.
  const literal = tmp.replace(/\\/g, '/').replace(/'/g, "''");
  try {
    db.exec(`VACUUM main INTO '${literal}'`);
    fs.renameSync(tmp, destino);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return destino;
}

/** O backup do dia: `bot-AAAA-MM-DD.db`. Rodar de novo no mesmo dia sobrescreve. */
function backupDiario(db, { dir = BACKUPS_DIR, agora = new Date() } = {}) {
  return copiar(db, path.join(dir, `bot-${dataLocal(agora)}.db`));
}

/**
 * O backup de antes de migrar a partir de `versao`: `bot-pre-v<versao>-AAAA-MM-DD.db`.
 *
 * Este NUNCA sobrescreve. Nem toda migração é uma transação só: uma que falhe
 * no meio deixa o banco pela metade e o `user_version` ainda na origem, e o
 * boot seguinte tentaria de novo — sobrescrever aí trocaria o único retrato
 * bom pelo quebrado. Um nome ocupado ganha `-2`, `-3`...
 */
function backupPreMigracao(db, versao, { dir = BACKUPS_DIR, agora = new Date() } = {}) {
  const base = `bot-pre-v${versao}-${dataLocal(agora)}`;
  let destino = path.join(dir, `${base}.db`);
  for (let n = 2; fs.existsSync(destino); n++) {
    destino = path.join(dir, `${base}-${n}.db`);
  }
  return copiar(db, destino);
}

/**
 * Apaga os backups com mais de `dias` dias, os de antes de migração inclusive.
 *
 * Inclusive porque backup também é retenção: quem usa `/link remove` espera que
 * o link suma, e uma cópia guardada para sempre o manteria em algum lugar.
 * Voltar o código para antes de uma migração de semanas atrás também perderia
 * tudo o que aconteceu desde então — não é mais rollback, é outro problema.
 *
 * Só toca no que tem o nome de backup: o que mais estiver na pasta é de alguém.
 *
 * @returns {string[]} os arquivos apagados
 */
function limparAntigos({ dir = BACKUPS_DIR, dias = DIAS_DE_RETENCAO, agora = new Date() } = {}) {
  if (!fs.existsSync(dir)) return [];

  const limite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - dias);
  const apagados = [];

  for (const nome of fs.readdirSync(dir)) {
    const m = NOME_DE_BACKUP.exec(nome);
    if (!m) continue;
    const data = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (data < limite) {
      fs.rmSync(path.join(dir, nome), { force: true });
      apagados.push(nome);
    }
  }
  return apagados;
}

module.exports = { backupDiario, backupPreMigracao, limparAntigos, DIAS_DE_RETENCAO };
