/**
 * db/index.js
 * Persistência do bot em SQLite, e a porta única para ela.
 *
 * Antes disso o bot usava dois arquivos JSON (links.json e languages.json),
 * escritos com fs.writeFileSync sem nenhuma garantia de atomicidade entre
 * requisições concorrentes. O SQLite resolve isso, e o `node:sqlite` faz sem
 * dependência externa nem build nativo.
 *
 * ── Como está dividido ────────────────────────────────────────────────────────
 *   connection.js   abre os dois arquivos e o ATTACH que os une numa conexão
 *   schema.js       o formato ATUAL das tabelas — o que um banco novo ganha
 *   migrations.js   o caminho de quem partiu de uma versão anterior
 *   users.js        links de conta, servidor preferido, idioma
 *   staff.js        vínculo de staff e a prova de posse da conta
 *   nominations.js  fila de nomeação e log de ação administrativa
 *   mapCache.js     os quatro caches de mapa, todos no cache.db
 *
 * Era um arquivo de mil linhas em que o schema, seis migrações e sete assuntos
 * de consulta se intercalavam, e onde acrescentar uma tabela significava mexer
 * em três pontos distantes.
 *
 * ── A superfície não mudou ────────────────────────────────────────────────────
 * Tudo continua saindo de `require('./db')`, com os mesmos nomes: os cerca de
 * vinte pontos que chamam o banco não sabem que ele foi dividido, e não deveriam
 * mesmo saber. Um `db.getLink(...)` que passasse a ser `db.users.getLink(...)`
 * seria a divisão vazando para quem ela não ajuda em nada.
 */

const connection  = require('./connection');
const schema      = require('./schema');
const migrations  = require('./migrations');

const users       = require('./users');
const staff       = require('./staff');
const nominations = require('./nominations');
const mapCache    = require('./mapCache');
const meta        = require('./meta');

// A ordem é obrigatória: o schema cria o que as migrações vão acertar, e as
// migrações precisam terminar antes de qualquer consulta rodar.
schema.apply(connection.db);
migrations.run(connection.db);

module.exports = {
  ...users,
  ...staff,
  ...nominations,
  ...mapCache,
  ...meta,

  close: connection.close,

  // Exposto para teste e diagnóstico: diz se as migrações herdadas ainda vão
  // rodar no próximo boot.
  SCHEMA_VERSION: migrations.VERSAO_ATUAL,
};
