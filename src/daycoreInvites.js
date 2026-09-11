/**
 * daycoreInvites.js
 * Códigos de convite do Daycore — geração compatível com o painel do site.
 *
 * ── Por que INSERT direto, e não Redis como o resto de daycoreAdmin.js ────────
 * O convite não é do bancho.py-ex: é do Shiina (site Java), e o Shiina não
 * publica nada no Redis para criar um — `CreateInvite.java`
 * (routes/ap/post/) faz só um INSERT via JDBC, direto na tabela
 * `invite_codes` do MySQL `bancho`. Não existe rota HTTP nem canal pub/sub
 * para reaproveitar aqui; a única lógica que existe é esse INSERT, e é ela
 * que este módulo replica.
 *
 * Lido direto do código-fonte no VPS (`ssh kuratani-vps`,
 * /home/onl-docker/shiina/src/main/java/dev/osunolimits/routes/ap/post/CreateInvite.java)
 * em 11/09/2026 — nem o patch nem o `shiina-extra/` do repo `daycore` tinham
 * esse arquivo, então nada aqui é suposição:
 *
 *   - alfabeto ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (33 caracteres — sem
 *     I/O/0/1, que se confundem visualmente), 10 caracteres, gerado com
 *     SecureRandom;
 *   - INSERT INTO invite_codes (code, created_by, max_uses, expires_at,
 *     note, creation_time) VALUES (...);
 *   - `code` tem UNIQUE KEY no schema (SHOW CREATE TABLE), mas o
 *     CreateInvite.java original não trata colisão — só deixa a exceção
 *     subir. Aqui isso vira um retry curto (ver createInviteCode), que é
 *     mais robusto sem mudar formato nem comportamento observável: o espaço
 *     de códigos é 33^10 ≈ 1.6×10^15, então colisão nunca aconteceu em
 *     produção.
 *
 * ── Rede ────────────────────────────────────────────────────────────────────
 * O MySQL do onl-docker já publica em 127.0.0.1:3306 no host da VPS (mesmo
 * padrão do Redis em daycoreAdmin.js) — nada a mudar no docker-compose.
 *
 * ── Credencial ──────────────────────────────────────────────────────────────
 * Usa um usuário MySQL dedicado, só com INSERT/SELECT em
 * `bancho.invite_codes` — não o DB_USER do Shiina, que tem acesso amplo ao
 * banco inteiro. Ver `.env.example` para o GRANT.
 */

require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');
const { logError } = require('./logger');

// Mesmo alfabeto do CreateInvite.java — não mude sem checar o fork primeiro.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

// Tentativas extras em colisão de UNIQUE(code). O original não tem nenhuma;
// isto é só robustez a mais, sem mudar o formato do código.
const MAX_INSERT_ATTEMPTS = 3;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  }
  return code;
}

// ─── Conexão com o MySQL ───────────────────────────────────────────────────
// Lazy e opcional, como o Redis em daycoreAdmin.js: o bot precisa subir numa
// máquina sem esse banco por perto — só o /invitecode fica indisponível, com
// mensagem clara, em vez de derrubar o processo no boot.

let _pool = null;

function isConfigured() {
  return Boolean(process.env.DAYCORE_MYSQL_HOST);
}

function getPool() {
  if (!isConfigured()) return null;
  if (_pool) return _pool;

  // require aqui dentro, e não no topo do arquivo: numa instância sem
  // DAYCORE_MYSQL_HOST configurado (a maioria dos que rodam este bot para
  // outro servidor), mysql2 nunca precisa ser carregado.
  const mysql = require('mysql2/promise');

  _pool = mysql.createPool({
    host:     process.env.DAYCORE_MYSQL_HOST,
    port:     Number(process.env.DAYCORE_MYSQL_PORT || 3306),
    user:     process.env.DAYCORE_MYSQL_USER,
    password: process.env.DAYCORE_MYSQL_PASS,
    database: process.env.DAYCORE_MYSQL_DATABASE || 'bancho',
    waitForConnections: true,
    connectionLimit: 3,
    connectTimeout: 5000,
  });

  return _pool;
}

/**
 * Testa se dá para falar com o MySQL agora.
 * @returns {Promise<{ok: true} | {ok: false, reason: 'unconfigured'|'unreachable', error?: string}>}
 */
async function checkConnection() {
  if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'unreachable', error: err.message };
  }
}

async function closePool() {
  if (_pool) await _pool.end();
  _pool = null;
}

/**
 * Cria um convite, do mesmo jeito que o painel do site cria.
 *
 * @param {object} params
 * @param {number} params.maxUses quantos registros o código aceita (padrão 1)
 * @param {number|null} params.expiresDays dias até expirar, ou null (nunca expira)
 * @param {string|null} params.note anotação livre, até 255 caracteres
 * @param {number} params.createdByOsuId conta osu! do staff que está criando —
 *   é o que o site grava como `created_by`, e o `resolveStaff` do bot já
 *   resolve isso (conta vinculada e verificada, não a do bot)
 * @returns {Promise<string>} o código gerado
 */
async function createInviteCode({ maxUses = 1, expiresDays = null, note = null, createdByOsuId }) {
  const pool = getPool();
  if (!pool) throw new Error('MySQL do Daycore não configurado (defina DAYCORE_MYSQL_HOST no .env).');

  const safeMaxUses = Math.max(1, Number(maxUses) || 1);
  const expiresAt = expiresDays
    ? Math.floor(Date.now() / 1000) + Math.floor(Number(expiresDays)) * 86400
    : null;
  const safeNote = note ? String(note).slice(0, 255) : null;
  const creationTime = Math.floor(Date.now() / 1000);

  const insertSql = 'INSERT INTO `invite_codes`(`code`, `created_by`, `max_uses`, `expires_at`, `note`, `creation_time`) VALUES (?,?,?,?,?,?)';

  let lastError;
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const code = randomCode();
    try {
      await pool.execute(insertSql, [code, Number(createdByOsuId), safeMaxUses, expiresAt, safeNote, creationTime]);
      return code;
    } catch (err) {
      // Só colisão de UNIQUE(code) merece nova tentativa — qualquer outro
      // erro (FK inválida, coluna errada, banco fora do ar) sobe na hora.
      if (err.code !== 'ER_DUP_ENTRY') throw err;
      lastError = err;
      logError('daycoreInvites:retry', err);
    }
  }
  throw lastError;
}

module.exports = {
  isConfigured,
  checkConnection,
  closePool,
  createInviteCode,
  CODE_CHARS,
  CODE_LENGTH,

  // Exposto para teste.
  randomCode,
};
