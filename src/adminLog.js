/**
 * adminLog.js
 * A gravação do log de auditoria do bot, isolada do resto do comando.
 *
 * ── Por que isto não é um `db.logAdminAction` direto ──────────────────────────
 * Os três comandos administrativos (/role, /moderate, /wipe) seguem a mesma
 * ordem: publicam no Redis, releem o servidor para confirmar o efeito e só
 * então registram o que fizeram. Enquanto essa última linha ficava dentro do
 * `try` do `execute`, um erro de SQLite (disco cheio, arquivo travado, banco
 * aberto somente para leitura) caía no mesmo `catch` da publicação, e a
 * resposta virava `admin_action_failed`: "nada foi confirmado — verifique o
 * estado antes de tentar de novo".
 *
 * A essa altura a ação JÁ tinha sido aplicada no servidor de jogo e JÁ tinha
 * sido confirmada pela releitura. A única coisa que faltou foi a linha no
 * banco daqui — e a resposta dizia justamente o contrário. Quem rodou o
 * comando concluía que não aconteceu nada e tentava de novo: no /role isso é
 * um `removepriv` repetido (inofensivo, mas confuso); no /wipe, que não tem
 * volta, é apagar de novo o que já tinha sido apagado.
 *
 * ── O que este módulo garante ─────────────────────────────────────────────────
 * A falha de escrita não sobe. Ela vira um `false` que o comando transforma em
 * AVISO ao lado de uma resposta que continua descrevendo o que de fato
 * aconteceu no servidor. Perder o registro é um problema real — e é por isso
 * que o aviso existe —, mas é um problema menor que uma resposta que mente
 * sobre o estado do servidor de jogo, porque essa convida a repetir a ação.
 *
 * ── O conteúdo vai para o log do processo, não só a causa ─────────────────────
 * `logError` registraria só o "SQLITE_FULL". O que se perde no /wipe é a linha
 * inteira: os números lidos antes de apagar (`3076pp, 679 plays`) não existem
 * em mais lugar nenhum depois do DELETE, e o `admin_actions` era a única cópia
 * deles. Imprimir a linha aqui deixa uma segunda cópia onde ainda dá para
 * achá-la, mesmo que o banco tenha recusado a escrita.
 */

const db = require('./db');
const { logError } = require('./logger');

/**
 * Registra a ação administrativa, sem deixar uma falha de escrita derrubar o
 * comando que já mexeu no servidor.
 *
 * @param {string} contexto nome do comando, para o log (`role`, `moderate`, `wipe`)
 * @param {object} entrada o mesmo objeto que `db.logAdminAction` recebe
 * @returns {boolean} se a linha chegou ao banco — `false` pede aviso na resposta
 */
function registrarAcao(contexto, entrada) {
  try {
    db.logAdminAction(entrada);
    return true;
  } catch (error) {
    logError(`${contexto}:auditoria`, error);
    // A linha perdida, em texto: ver o cabeçalho. Vai depois da causa porque é
    // a causa que explica por que ela está aqui.
    console.error(`[${contexto}:auditoria] linha não gravada: ${JSON.stringify(entrada)}`);
    return false;
  }
}

module.exports = { registrarAcao };
