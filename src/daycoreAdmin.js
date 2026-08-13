/**
 * daycoreAdmin.js
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
 */

require('dotenv').config();
const { createClient } = require('redis');
const osu = require('./osuClient');
const { logError } = require('./logger');

// ─── Constantes espelhadas do bancho.py-ex ────────────────────────────────────
// Fonte: app/constants/privileges.py. Mantenha em sincronia se o fork mudar.
const Privileges = {
  UNRESTRICTED:    1 << 0,   // 1     — não banido
  VERIFIED:        1 << 1,   // 2     — já logou in-game
  WHITELISTED:     1 << 2,   // 4     — bypass de anticheat
  SUPPORTER:       1 << 4,   // 16
  PREMIUM:         1 << 5,   // 32
  ALUMNI:          1 << 7,   // 128
  TOURNEY_MANAGER: 1 << 10,  // 1024
  NOMINATOR:       1 << 11,  // 2048  — gerencia status de mapas
  MODERATOR:       1 << 12,  // 4096  — gerencia usuários (nível 1)
  ADMINISTRATOR:   1 << 13,  // 8192  — gerencia usuários (nível 2)
  DEVELOPER:       1 << 14,  // 16384 — controle total
};

// Valores aceitos pelo comando !map do bancho, e portanto pelo canal `rank`.
const RankedStatus = {
  UNRANK: 0,
  RANK:   2,
  LOVE:   5,
};

const STATUS_LABELS = {
  [RankedStatus.UNRANK]: 'unranked',
  [RankedStatus.RANK]:   'ranked',
  [RankedStatus.LOVE]:   'loved',
};

const CHANNELS = {
  RANK:       'rank',
  RESTRICT:   'restrict',
  UNRESTRICT: 'unrestrict',
};

// ─── Conexão com o Redis ──────────────────────────────────────────────────────
// Lazy e opcional: o bot precisa subir normalmente numa máquina de
// desenvolvimento sem Redis nenhum — só os comandos administrativos ficam
// indisponíveis, com mensagem clara, em vez de derrubar o processo no boot.

let _client     = null;
let _connecting = null;

function isConfigured() {
  return Boolean(process.env.REDIS_HOST);
}

async function getRedis() {
  if (!isConfigured()) return null;
  if (_client?.isOpen) return _client;
  if (_connecting) return _connecting;

  _connecting = (async () => {
    // Credenciais como campos separados, e não embutidas numa URL
    // `redis://user:senha@host`: a URL aparece em mensagem de erro de conexão
    // do client, que vai parar no log — e o log do bot é lido por gente que
    // não precisa ter a senha do Redis do servidor.
    const client = createClient({
      socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        connectTimeout: 5000,
        // Sem isso o client tenta reconectar para sempre e cada comando fica
        // pendurado; três tentativas e falha com erro que o comando trata.
        reconnectStrategy: (retries) => (retries > 3 ? false : Math.min(retries * 200, 1000)),
      },
      username: process.env.REDIS_USER || undefined,
      password: process.env.REDIS_PASS || undefined,
      database: Number(process.env.REDIS_DB || 0),
    });

    // O client emite 'error' em queda de conexão; sem listener o Node derruba
    // o processo inteiro com unhandled 'error' event.
    client.on('error', (err) => logError('daycoreAdmin:redis', err));

    await client.connect();
    _client = client;
    return client;
  })();

  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

async function closeRedis() {
  if (_client?.isOpen) await _client.quit();
  _client = null;
}

/**
 * Testa se dá para falar com o Redis agora.
 * @returns {Promise<{ok: true} | {ok: false, reason: 'unconfigured'|'unreachable', error?: string}>}
 */
async function checkConnection() {
  if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
  try {
    const client = await getRedis();
    await client.ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'unreachable', error: err.message };
  }
}

async function publish(channel, payload) {
  const client = await getRedis();
  if (!client) throw new Error('Redis não configurado (defina REDIS_HOST no .env).');
  // O bancho faz orjson.loads(message["data"]) — precisa ser JSON puro.
  await client.publish(channel, JSON.stringify(payload));
}

// ─── Ações ────────────────────────────────────────────────────────────────────

/**
 * Muda o status de UMA dificuldade.
 *
 * `frozen` impede o bancho de sobrescrever o status depois com o valor oficial
 * do osu!; o comando !map sempre marca como frozen ao mudar status, então
 * fazemos o mesmo para o resultado não ser revertido sozinho.
 */
async function rankBeatmap(beatmapId, status, frozen = true) {
  await publish(CHANNELS.RANK, {
    beatmap_id: Number(beatmapId),
    status:     Number(status),
    frozen:     Boolean(frozen),
  });
}

// ─── Assinatura do autor ──────────────────────────────────────────────────────
/**
 * O `userId` publicado é a conta de jogo do staff — é ela que o bancho grava
 * como autor no log de auditoria dele. Só que quem apertou o botão foi uma
 * conta do **Discord**, e o vínculo entre as duas vive só aqui dentro
 * (`staff_links`, alimentada pelo /staff register).
 *
 * Isso deixava o log do servidor contar meia verdade: quem tem Administrator no
 * Discord pode vincular a própria conta ao nick de outro staff e agir com o
 * privilégio dele — e a auditoria do servidor culparia o dono da conta, sem
 * nenhum rastro do Discord. O registro que aponta a conta real (`admin_actions`)
 * fica dentro do próprio bot, ou seja, dentro do componente que teria sido
 * comprometido.
 *
 * Anexar o Discord ao motivo faz o log do **servidor** guardar as duas pontas,
 * então a auditoria deixa de depender de o bot estar íntegro.
 *
 * Não resolve a raiz: o /staff register continua sendo auto-declarado, e a
 * correção de verdade é provar posse da conta (código temporário no perfil do
 * osu!, ou OAuth do próprio servidor) — ainda por fazer.
 */
const SIGNATURE_MARK = 'via KurataniBot';

// Teto do que vai publicado. O motivo do usuário é cortado se preciso; a
// assinatura nunca — ela é a parte que a auditoria precisa.
const PUBLISHED_REASON_MAX = 512;

function signReason(reason, actor) {
  const signature = ` | ${SIGNATURE_MARK}: @${actor.discordName ?? '?'} (${actor.discordId})`;

  const text = String(reason ?? '')
    // Quebra de linha e controle viram espaço: sem isso um motivo com \n
    // desenha linhas falsas em quem lê o log depois. O linter reclama de
    // caractere de controle em regex justamente porque costuma ser engano —
    // aqui é o alvo.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    // E o próprio marcador é neutralizado, para o motivo não conseguir forjar
    // uma segunda assinatura apontando para outra pessoa.
    .split(SIGNATURE_MARK).join('via-bot');

  const room = Math.max(0, PUBLISHED_REASON_MAX - signature.length);
  const clipped = text.length > room ? `${text.slice(0, Math.max(0, room - 1))}…` : text;

  return clipped + signature;
}

/**
 * `id` é o alvo e `userId` é quem está aplicando — o bancho registra o segundo
 * como `admin` no log de auditoria dele, então precisa ser o osu! ID real do
 * staff que rodou o comando no Discord, não o do bot.
 *
 * @param {{osuId: number, discordId: string, discordName?: string}} actor
 */
async function restrictPlayer(targetOsuId, actor, reason) {
  await publish(CHANNELS.RESTRICT, {
    id:     Number(targetOsuId),
    userId: Number(actor.osuId),
    reason: signReason(reason, actor),
  });
}

async function unrestrictPlayer(targetOsuId, actor, reason) {
  await publish(CHANNELS.UNRESTRICT, {
    id:     Number(targetOsuId),
    userId: Number(actor.osuId),
    reason: signReason(reason, actor),
  });
}

// ─── Permissões ───────────────────────────────────────────────────────────────

/**
 * Subconjunto de bits, NÃO hierarquia — e de propósito.
 *
 * É o mesmo teste que o bancho.py faz ao despachar um comando
 * (`player.priv & cmd.priv == cmd.priv`, em app/commands.py). Os docstrings do
 * upstream dizem "manage users (level 1)" e "(level 2)", o que lê como escada,
 * mas nada no servidor implementa isso: quem tem DEVELOPER sem o bit de
 * ADMINISTRATOR também é recusado pelo `!restrict` dentro do jogo.
 *
 * Transformar isto numa hierarquia concederia pelo Discord um acesso que o
 * próprio servidor nega — o oposto do que se quer num comando administrativo.
 */
function hasPriv(priv, flag) {
  return (Number(priv) & flag) === flag;
}

/** Rótulo do cargo mais alto, só para exibição. */
function privLabel(priv) {
  if (hasPriv(priv, Privileges.DEVELOPER))     return 'Developer';
  if (hasPriv(priv, Privileges.ADMINISTRATOR)) return 'Administrator';
  if (hasPriv(priv, Privileges.MODERATOR))     return 'Moderator';
  if (hasPriv(priv, Privileges.NOMINATOR))     return 'Nominator';
  return 'Player';
}

/**
 * Privilégios de um jogador no Daycore, lidos da API v2.
 * @returns {Promise<{id: number, name: string, priv: number} | null>}
 */
async function getPlayerPrivileges(osuId) {
  const player = await osu.getServerPlayerRaw(osuId);
  if (!player) return null;
  return { id: player.id, name: player.name, priv: Number(player.priv ?? 0) };
}

// ─── Verificação pós-publicação ───────────────────────────────────────────────
// Como o pub/sub não devolve resultado, relemos o estado pela API v2 para
// confirmar. O bancho processa em milissegundos, mas damos uma folga porque a
// ação envolve I/O (ele baixa o .osu se não tiver em disco).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Quanto tempo esperar o bancho terminar, em função do tamanho do set.
 *
 * O trabalho dele é proporcional ao número de dificuldades — baixa o .osu de
 * cada uma que não tem em disco —, então a janela fixa que servia para uma
 * dificuldade fechava cedo demais para um set grande. O `Hardtekk Jump
 * Training` (100 diffs) reportou 90/100, e a releitura seguinte mostrou
 * 100/100: nada tinha falhado, a janela é que era curta. O efeito prático era
 * a resposta chamar de "parcial" uma ação que deu certo inteira.
 *
 * O teto existe porque quem espera do outro lado é uma interação do Discord,
 * que expira — melhor reportar pendente do que não conseguir responder.
 */
const VERIFY_BASE_MS    = 4000;
const VERIFY_PER_MAP_MS = 900;
const VERIFY_MAX_MS     = 180000;

function verifyBudget(mapCount) {
  return Math.min(VERIFY_BASE_MS + mapCount * VERIFY_PER_MAP_MS, VERIFY_MAX_MS);
}

/**
 * Confirma que as dificuldades chegaram no status esperado.
 *
 * Repete até todas confirmarem ou a janela fechar, sempre com pelo menos uma
 * releitura — cada passada custa uma requisição por dificuldade ainda pendente,
 * e a lista encolhe conforme elas confirmam.
 *
 * @returns {Promise<{confirmed: number[], pending: number[]}>}
 */
async function verifyMapStatus(beatmapIds, expectedStatus, { delayMs = 1200, budgetMs } = {}) {
  let pending = [...beatmapIds];
  const confirmed = [];
  const deadline = Date.now() + (budgetMs ?? verifyBudget(pending.length));

  do {
    await sleep(delayMs);

    const still = [];
    for (const id of pending) {
      try {
        const map = await osu.getServerMap(id);
        if (map && Number(map.status) === Number(expectedStatus)) confirmed.push(id);
        else still.push(id);
      } catch {
        still.push(id);
      }
    }
    pending = still;
  } while (pending.length > 0 && Date.now() < deadline);

  return { confirmed, pending };
}

/**
 * Confirma se o jogador ficou (ou deixou de estar) restrito.
 *
 * Aqui a janela continua fixa, e não escalonada como a de mapa: o alvo é sempre
 * um só, e restringir é uma escrita no banco do bancho — não tem download pelo
 * meio para fazer o tempo depender do tamanho de nada.
 */
async function verifyRestricted(osuId, expectRestricted, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const player = await osu.getServerPlayerRaw(osuId);
      if (player) {
        const restricted = !hasPriv(player.priv, Privileges.UNRESTRICTED);
        if (restricted === expectRestricted) return true;
      }
    } catch {
      // tenta de novo
    }
  }
  return false;
}

module.exports = {
  Privileges,
  RankedStatus,
  STATUS_LABELS,
  CHANNELS,
  isConfigured,
  checkConnection,
  closeRedis,
  rankBeatmap,
  restrictPlayer,
  unrestrictPlayer,
  hasPriv,
  privLabel,
  getPlayerPrivileges,
  verifyMapStatus,
  verifyRestricted,

  // Exportado para teste: é o que decide entre reportar "parcial" e esperar o
  // servidor terminar.
  verifyBudget,
};
