/**
 * daycoreMysql.js
 * A conexão com o MySQL `bancho` do Daycore, compartilhada.
 *
 * Nasceu dentro do daycoreInvites.js, quando o /invitecode era o único a falar
 * com esse banco. O /matchcost passou a ler dele também (as tabelas `dc_match_*`
 * do patch do bancho.py-ex), e duas cópias do pool seriam duas configurações de
 * conexão para manter iguais e o dobro de conexões abertas no mesmo servidor.
 *
 * Lazy e opcional, como o Redis em daycoreAdmin/: o bot precisa subir numa
 * máquina sem esse banco por perto — só os comandos que dependem dele ficam
 * indisponíveis, com mensagem clara, em vez de derrubar o processo no boot.
 *
 * ── Credencial ──────────────────────────────────────────────────────────────
 * Um usuário MySQL dedicado, com o mínimo que cada comando precisa — ver o
 * `.env.example` para os GRANTs. Não o DB_USER do Shiina, que tem acesso amplo
 * ao banco inteiro.
 */

const config = require('./config');

let _pool = null;

function isConfigured() {
  return config.daycoreMysql !== null;
}

function getPool() {
  if (!isConfigured()) return null;
  if (_pool) return _pool;

  // require aqui dentro, e não no topo do arquivo: numa instância sem
  // DAYCORE_MYSQL_HOST configurado (a maioria dos que rodam este bot para
  // outro servidor), mysql2 nunca precisa ser carregado.
  const mysql = require('mysql2/promise');

  _pool = mysql.createPool({
    ...config.daycoreMysql,
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

module.exports = { isConfigured, getPool, checkConnection, closePool };
