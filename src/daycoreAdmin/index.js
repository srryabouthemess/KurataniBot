/**
 * daycoreAdmin/index.js
 * Ações administrativas no Daycore (rankear mapa, restringir jogador).
 *
 * ── Por que Redis e não HTTP ──────────────────────────────────────────────────
 * O bancho.py-ex expõe uma API v2 **somente leitura** (app/api/v2/) — não há
 * nenhuma rota POST/PUT para ações administrativas. O caminho de escrita que
 * ele oferece é Redis pub/sub: no boot ele roda `start_pubsub_recievers()`
 * (app/api/start.py) e fica escutando canais, aplicando a ação em quem
 * publicar. É o mesmo mecanismo que o admin panel do Shiina-Web usa.
 *
 * Consequência importante: **publicar é fire-and-forget**. O bancho não
 * responde ao publisher — ele loga o resultado no console dele e pronto. Por
 * isso todo comando que publica deve confirmar o efeito relendo o estado pela
 * API v2 (ver `verifyMapStatus` e `verifyRestricted`), em vez de assumir que
 * deu certo.
 *
 * ── Rede ──────────────────────────────────────────────────────────────────────
 * No docker-compose do onl-docker o serviço `redis` não publica porta nenhuma:
 * só é alcançável de dentro da rede do compose. Para o bot (que roda no host
 * da mesma VPS) chegar nele, o compose precisa bindar em localhost:
 *
 *     redis:
 *       ports:
 *         - "127.0.0.1:6379:6379"
 *
 * Isso não expõe nada para a internet. O próprio compose já usa esse padrão
 * para o Prometheus do bancho.
 *
 * ── Como está dividido ────────────────────────────────────────────────────────
 *   constants.js   o que é espelhado do bancho: bits, status, canais, modos
 *   redis.js       a conexão de escrita e o `publish`
 *   signature.js   o motivo limpo e assinado que vai para o log do servidor
 *   actions.js     um publish por ação (rank, restrict, wipe, cargos…)
 *   privileges.js  leitura da máscara de privilégios e o menu do /role
 *   reads.js       o servidor administrado e os privilégios de um jogador
 *   verify.js      a releitura que confirma cada ação
 *
 * Tudo continua saindo de `require('./daycoreAdmin')`, com os mesmos nomes, como
 * no db/: quem chama não precisa saber como isto está dividido.
 */

const constants  = require('./constants');
const redis      = require('./redis');
const actions    = require('./actions');
const privileges = require('./privileges');
const reads      = require('./reads');
const verify     = require('./verify');

module.exports = {
  ...constants,

  isConfigured:    redis.isConfigured,
  checkConnection: redis.checkConnection,
  closeRedis:      redis.closeRedis,

  ...actions,
  ...privileges,
  ...reads,
  ...verify,
};
