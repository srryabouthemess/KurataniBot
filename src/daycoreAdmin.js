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

require('dotenv').config({ quiet: true });
const { createClient } = require('redis');
const osu = require('./osuClient');
const servers = require('./servers');
const { logError } = require('./logger');
const { mapLimit } = require('./concurrency');

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

/**
 * Quem o bancho considera staff: `STAFF = MODERATOR | ADMINISTRATOR | DEVELOPER`
 * (app/constants/privileges.py). NOMINATOR fica de fora — quem só gerencia mapa
 * não é alvo protegido.
 *
 * ATENÇÃO: isto é MÁSCARA, e o teste é `priv & STAFF` — qualquer um dos bits
 * basta. Não dá para passar no `hasPriv`, que exige o conjunto inteiro: por lá,
 * um Moderator puro não seria reconhecido como staff e a proteção não valeria
 * justamente para quem tem o cargo mais baixo dos três.
 */
const STAFF_MASK = Privileges.MODERATOR | Privileges.ADMINISTRATOR | Privileges.DEVELOPER;

/** Se o bancho trataria essa conta como membro da staff. */
function isStaff(priv) {
  return (Number(priv) & STAFF_MASK) !== 0;
}

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
  WIPE:       'wipe',
  SCOREWIPE:  'scorewipe',
  MAPWIPE:    'mapwipe',
  ADDPRIV:    'addpriv',
  REMOVEPRIV: 'removepriv',
};

/**
 * Modos de jogo do bancho.py, com os nomes que ele mesmo usa no log
 * (app/api/utils.py, dicionário `mode_names`). O wipe age sobre UM modo — os
 * scores dos outros continuam intactos.
 */
const GameModes = {
  0: 'vn!std',
  1: 'vn!taiko',
  2: 'vn!catch',
  3: 'vn!mania',
  4: 'rx!std',
  5: 'rx!taiko',
  6: 'rx!catch',
  8: 'ap!std',
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
 * Isso deixava o log do servidor contar meia verdade: quando o vínculo era
 * auto-declarado, quem tinha Administrator no Discord podia apontar a própria
 * conta para o nick de outro staff e agir com o privilégio dele — e a auditoria
 * do servidor culparia o dono da conta, sem nenhum rastro do Discord. O registro
 * que aponta a conta real (`admin_actions`) fica dentro do próprio bot, ou seja,
 * dentro do componente que teria sido comprometido.
 *
 * Anexar o Discord ao motivo faz o log do **servidor** guardar as duas pontas,
 * então a auditoria deixa de depender de o bot estar íntegro.
 *
 * A raiz foi resolvida depois, e este comentário já a descreveu como pendente
 * por mais tempo do que devia: o `/staff register` só emite um código, e quem
 * cria o vínculo é o `/staff confirm`, depois de achar esse código no userpage
 * da conta de jogo — página que só muda por quem entra nela (ver commands/
 * staff.js). A assinatura continua valendo pelo que ela sempre fez: amarrar a
 * ação a uma conta do Discord dentro do log de quem recebeu a ação.
 */
const SIGNATURE_MARK = 'via KurataniBot';

// Teto do que vai publicado. O motivo do usuário é cortado se preciso; a
// assinatura nunca — ela é a parte que a auditoria precisa.
const PUBLISHED_REASON_MAX = 512;

/**
 * Caractere fora do BMP — na prática, todo emoji moderno.
 *
 * ── Por que ele não pode sair daqui ───────────────────────────────────────────
 * O bancho grava o motivo em `logs.msg`, que é `varchar(2048) charset utf8`. E
 * `utf8` no MySQL é o **utf8mb3**: três bytes por caractere, teto em U+FFFF. Um
 * 😀 (U+1F600) precisa de quatro, o INSERT devolve o erro 1366 ("Incorrect
 * string value") e a exceção sobe pela tarefa que escuta o pub/sub — que é o
 * que quem usa vê como "o servidor morre" ao restringir com emoji no motivo.
 *
 * Não dá para consertar a coluna daqui, e nem seria o lugar: quem publica é
 * quem tem de mandar algo que o receptor aguente guardar.
 *
 * ── E o corte, que era o mesmo defeito por outro caminho ──────────────────────
 * Emoji ocupa DUAS posições numa string de JavaScript (o par substituto), e o
 * corte em 512 conta posições. Cortar no meio do par deixa um substituto órfão,
 * que não é UTF-8 válido — e aí o `orjson.loads` do bancho recusa a mensagem
 * inteira, sem nem chegar no banco. Limpar ANTES de cortar resolve os dois: sem
 * par nenhum, não há o que partir ao meio.
 */
const FORA_DO_BMP = /[\u{10000}-\u{10FFFF}]/gu;

/** O que sobra quando o motivo inteiro era emoji — e ele é obrigatório. */
const SEM_MOTIVO = '(sem motivo legível)';

/** Texto que o log do servidor consegue guardar. */
function paraOServidor(texto) {
  return String(texto ?? '')
    // Quebra de linha e controle viram espaço: sem isso um motivo com \n
    // desenha linhas falsas em quem lê o log depois. O linter reclama de
    // caractere de controle em regex justamente porque costuma ser engano —
    // aqui é o alvo.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(FORA_DO_BMP, '')
    // O que sai deixa buraco: "cheat 😀 confirmado" ficaria com dois espaços.
    .replace(/ {2,}/g, ' ')
    .trim();
}

function signReason(reason, actor) {
  const signature = ` | ${SIGNATURE_MARK}: @${paraOServidor(actor.discordName) || '?'} (${actor.discordId})`;

  // A limpeza vem ANTES de neutralizar o marcador, e a ordem é parte da defesa:
  // tirar o emoji de `via 😀KurataniBot` PRODUZ o marcador. Na ordem inversa, um
  // motivo forjaria a segunda assinatura escondendo-a atrás de um emoji.
  const text = paraOServidor(reason)
    // E o próprio marcador é neutralizado, para o motivo não conseguir forjar
    // uma segunda assinatura apontando para outra pessoa.
    .split(SIGNATURE_MARK).join('via-bot')
    || SEM_MOTIVO;

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

/**
 * Apaga os scores de um jogador NUM modo e zera as estatísticas dele ali.
 *
 * ── Por que este é diferente de todos os outros ───────────────────────────────
 * É IRREVERSÍVEL. O `wipe_user` do bancho (app/api/utils.py) faz
 * `DELETE FROM scores`, zera a linha de `stats` e tira o jogador dos sorted
 * sets de leaderboard no Redis. Não há soft-delete, não há cópia: depois de
 * publicado, nem o dono do servidor desfaz.
 *
 * E, ao contrário do `restrict`, ele **não confere privilégio nenhum** — só
 * checa se o alvo existe. O `restrict` recusa sozinho quem não é DEVELOPER
 * mexendo em staff; aqui o servidor aceita qualquer publish. Ou seja, quem
 * chama daqui é a ÚNICA tranca que existe, e é por isso que o comando exige
 * DEVELOPER em vez do ADMINISTRATOR que basta para restringir.
 *
 * O campo é `adminId` (e não `userId`, como no restrict): é o nome que o
 * receptor lê, e ele usa isso para escrever o nome do autor no log do servidor.
 *
 * @param {number} modeNum chave de GameModes — o wipe é por modo
 */
async function wipePlayer(targetOsuId, modeNum, actor, reason) {
  await publish(CHANNELS.WIPE, {
    id:      Number(targetOsuId),
    mode:    Number(modeNum),
    adminId: Number(actor.osuId),
    reason:  signReason(reason, actor),
  });
}

/**
 * O status em que o score apagado fica.
 *
 * Espelha o `WIPED_SCORE_STATUS` do bancho (app/api/utils.py). Não é 0: 0 é
 * FAILED, e `plays` conta score falhado — em 0 o score apagado ficaria
 * indistinguível de um fail de verdade. -1 está fora do `SubmissionStatus`, e é
 * por isso que toda consulta que seleciona `status = 2` já o descarta.
 */
const WIPED_SCORE_STATUS = -1;

/**
 * Apaga UM score, em vez do perfil inteiro que o `wipePlayer` apaga.
 *
 * ── O que o servidor faz com isto ─────────────────────────────────────────────
 * O `wipe_score` do bancho não faz DELETE: ele estaciona o score no
 * `WIPED_SCORE_STATUS`, promove o próximo melhor score do jogador naquele mapa,
 * reescreve a linha de `stats` sem a play e regrava o pp nos sorted sets do
 * Redis. Ou seja, ao contrário do `wipePlayer`, isto TEM volta — um UPDATE
 * devolve o score ao status anterior.
 *
 * Mas continua sendo ação de staff sem receptor que a filtre: o
 * `channel_scorewipe_reciever` aceita qualquer publish, exatamente como o do
 * `wipe`. Quem chama daqui é a única tranca, e por isso o comando exige
 * DEVELOPER.
 *
 * O campo é `adminId` (e não `userId`): é o nome que o receptor lê para
 * escrever o autor no log do servidor. Mesmo formato do `wipePlayer`, e pela
 * mesma razão.
 */
async function wipeScore(scoreId, actor, reason) {
  await publish(CHANNELS.SCOREWIPE, {
    id:      Number(scoreId),
    adminId: Number(actor.osuId),
    reason:  signReason(reason, actor),
  });
}

/**
 * Apaga TODAS as plays de um jogador num mapa e num modo, de uma vez.
 *
 * Existe pelo log de auditoria do servidor, e não por atalho: o `wipe_score`
 * faz um `post_audit_log` por chamada, então dez plays viram dez embeds no
 * webhook. O `wipe_map_scores` do outro lado escreve um só, com a contagem e
 * os ids.
 *
 * O `id` aqui é o JOGADOR — no canal `scorewipe` ele é o score. Trocar os dois
 * não dá erro em lugar nenhum: o receptor lê o número que chegou.
 *
 * Os failed entram junto (o lote é `status >= 0` do lado de lá), porque eles
 * contam em `plays`.
 */
async function wipeMapScores(targetOsuId, mapMd5, modeNum, actor, reason) {
  await publish(CHANNELS.MAPWIPE, {
    id:      Number(targetOsuId),
    md5:     String(mapMd5),
    mode:    Number(modeNum),
    adminId: Number(actor.osuId),
    reason:  signReason(reason, actor),
  });
}

/**
 * Concede ou tira um cargo.
 *
 * ── O motivo não vai junto, e isso é uma garantia a menos ─────────────────────
 * O receptor lê só `id`, `privs` e `userId` (app/api/start.py,
 * channel_addpriv_reciever), e o post_audit_log do bancho grava `reason=""`
 * para estas duas ações. Não existe onde pendurar a assinatura que o restrict
 * usa para fazer o log do SERVIDOR guardar também a conta do Discord (ver
 * signReason). Aqui o rastro do Discord fica só no `admin_actions` — dentro do
 * bot, que é justamente o componente que a assinatura existe para não precisar
 * supor íntegro.
 *
 * Não é crítico hoje: o vínculo de staff exige prova de posse da conta desde o
 * /staff confirm, e só DEVELOPER concede bit de staff. Fecha de vez com três
 * linhas no channel_addpriv_reciever lendo `data.get("reason")`, que é mudança
 * no servidor.
 *
 * @param {{osuId: number}} actor quem concede; o bancho grava como `admin`
 */
function publishPriv(channel, targetOsuId, roleKey, actor) {
  // Recusa aqui, e não só no comando: um chamador com chave inventada receberia
  // do bancho um `Invalid privilege` que nunca volta para cá.
  if (!Object.hasOwn(ROLES, roleKey)) {
    throw new Error(`cargo desconhecido: "${roleKey}"`);
  }
  return publish(channel, {
    id:     Number(targetOsuId),
    privs:  [roleKey],
    userId: Number(actor.osuId),
  });
}

async function addPrivilege(targetOsuId, roleKey, actor) {
  await publishPriv(CHANNELS.ADDPRIV, targetOsuId, roleKey, actor);
}

async function removePrivilege(targetOsuId, roleKey, actor) {
  await publishPriv(CHANNELS.REMOVEPRIV, targetOsuId, roleKey, actor);
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

/**
 * Rótulo de exibição de cada bit, do mais alto para o mais baixo.
 *
 * Fonte única do nome: é daqui que sai tanto o texto do `/moderate check`
 * quanto o rótulo das choices do `/role`. Dois lugares com o nome do mesmo bit
 * divergiriam no primeiro que alguém renomeasse.
 *
 * UNRESTRICTED fica de fora de propósito: ele não é cargo, é estado de
 * restrição, e o `/moderate check` já o mostra em campo próprio. Listá-lo aqui
 * faria todo jogador comum aparecer com um "cargo" chamado Unrestricted.
 *
 * VERIFIED fica — mesmo sendo, pela mesma razão acima, um bit que toda conta
 * que já logou tem (bancho.py seta sozinho no primeiro login). A diferença é
 * que o `/role` concede e remove `verified` de propósito, então o
 * `/moderate check` PRECISA conseguir mostrar esse bit específico mudando. Não
 * tire VERIFIED daqui achando que é a mesma limpeza do UNRESTRICTED acima —
 * quem quer um rótulo único sem essa poluição usa `privLabel`, que filtra só
 * ali embaixo.
 */
const PRIV_LABELS = [
  [Privileges.DEVELOPER,       'Developer'],
  [Privileges.ADMINISTRATOR,   'Administrator'],
  [Privileges.MODERATOR,       'Moderator'],
  [Privileges.NOMINATOR,       'Nominator'],
  [Privileges.TOURNEY_MANAGER, 'Tourney Manager'],
  [Privileges.ALUMNI,          'Alumni'],
  [Privileges.PREMIUM,         'Premium'],
  [Privileges.SUPPORTER,       'Supporter'],
  [Privileges.WHITELISTED,     'Whitelisted'],
  [Privileges.VERIFIED,        'Verified'],
];

/** O nome de exibição de um bit isolado. */
function labelOfBit(bit) {
  return PRIV_LABELS.find(([b]) => b === bit)?.[1] ?? String(bit);
}

/**
 * Nomes de cargo como o BANCHO os aceita, para traduzir o que ele publica.
 *
 * Não dá para reaproveitar a tabela ROLES aqui: ela é o menu do `/role`, e o
 * que chega pelo `ex:priv_change` é o que alguém digitou no jogo — inclusive
 * cargo que o `/role` não oferece (`normal`, `supporter`, `premium`).
 *
 * `moderator` e `mod` são o MESMO bit com dois nomes, e isso é do servidor, não
 * daqui: o `str_priv_dict` de `app/commands.py` (in-game) diz `moderator`, e o
 * de `app/api/utils.py` (canais Redis) diz `mod`. Aceitar os dois é o que faz o
 * rótulo sair certo venha o evento de onde vier.
 */
const PRIV_BY_NAME = {
  normal:      Privileges.UNRESTRICTED,
  verified:    Privileges.VERIFIED,
  whitelisted: Privileges.WHITELISTED,
  supporter:   Privileges.SUPPORTER,
  premium:     Privileges.PREMIUM,
  alumni:      Privileges.ALUMNI,
  tournament:  Privileges.TOURNEY_MANAGER,
  nominator:   Privileges.NOMINATOR,
  moderator:   Privileges.MODERATOR,
  mod:         Privileges.MODERATOR,
  admin:       Privileges.ADMINISTRATOR,
  developer:   Privileges.DEVELOPER,
};

/**
 * UNRESTRICTED fica fora de PRIV_LABELS porque ninguém quer lê-lo na lista de
 * cargos de uma conta (ver `privNames`). Aqui o cargo É o assunto da frase —
 * "cargo concedido: 1" não diz nada a ninguém.
 */
const EXTRA_LABELS = { [Privileges.UNRESTRICTED]: 'Unrestricted' };

/**
 * O nome de exibição de um cargo pelo nome que o bancho usa.
 *
 * Nome fora da tabela sai como veio, em minúsculo: o bancho recusa antes de
 * aplicar (`Not found: x.`), então isto é caminho de payload forjado — e mostrar
 * o texto recebido é melhor que inventar um rótulo ou engolir o anúncio.
 */
function labelOfPrivName(name) {
  const chave = String(name).trim().toLowerCase();
  if (!Object.hasOwn(PRIV_BY_NAME, chave)) return chave;

  const bit = PRIV_BY_NAME[chave];
  return PRIV_LABELS.find(([b]) => b === bit)?.[1] ?? EXTRA_LABELS[bit] ?? chave;
}

/**
 * TODOS os cargos ligados, do mais alto para o mais baixo.
 *
 * O `privLabel` devolve só o topo, e para conferir uma concessão isso não
 * serve: quem acabou de receber `whitelisted` sem ter mais nada aparecia no
 * `/moderate check` como "Player", ou seja, o comando não mostrava o que tinha
 * acabado de mudar.
 */
function privNames(priv) {
  const nomes = PRIV_LABELS.filter(([bit]) => hasPriv(priv, bit)).map(([, label]) => label);
  return nomes.length > 0 ? nomes : ['Player'];
}

/**
 * Rótulo de UM cargo só, só para exibição — para frases que pedem um único
 * nome, como "seu cargo lá: **X**" (`admin_missing_priv`, em staffGuard.js) ou
 * "alvo já é staff: X" (`mod_target_is_staff`, em moderate.js e role.js), e os
 * quatro rótulos do /staff (staff.js).
 *
 * NÃO é fonte do texto do `/moderate check` nem dos rótulos das choices do
 * `/role` — isso aqui era verdade do `PRIV_LABELS`/`labelOfBit` ali em cima, e
 * este parágrafo tinha sido copiado de lá por engano. O `/moderate check` lê
 * `privNames` direto (a lista inteira, sem passar por `privLabel`), e as
 * choices do `/role` leem `labelOfBit` direto — nenhum dos dois passa por
 * aqui, então um rótulo esquisito só de `privLabel` não afeta os dois.
 *
 * ── Por que filtra VERIFIED na mão, e UNRESTRICTED nem precisa ─────────────────
 * UNRESTRICTED nunca aparece aqui porque nem está em PRIV_LABELS — `privNames`
 * já não o lista. VERIFIED está, porque é bit real que o /role liga e desliga,
 * e o `/moderate check` precisa mostrar essa mudança. Só que, como estado que
 * toda conta logada tem, é exatamente o mesmo caso de UNRESTRICTED para quem
 * só quer o cargo que distingue a pessoa — daí o filtro aqui, e não em
 * `privNames`: tirar de `privNames` esconderia do `/moderate check` que
 * VERIFIED mudou; tirar só daqui deixa a conta comum (UNRESTRICTED | VERIFIED)
 * de volta como "Player" nas frases de rótulo único, sem afetar quem lê a
 * lista inteira.
 *
 * ── Mudança de comportamento em relação ao antecessor ──────────────────────────
 * O antecessor era uma cadeia if/else que só reconhecia os quatro cargos de
 * staff (DEVELOPER, ADMINISTRATOR, MODERATOR, NOMINATOR) e colapsava tudo mais
 * baixo em "Player". Agora `privLabel` devolve o topo real de `privNames`:
 *   - Quem tem WHITELISTED (mas não nada mais acima) aparecia como "Player",
 *     agora aparece como "Whitelisted".
 *   - Quem tem SUPPORTER ou PREMIUM agora aparece com o cargo, não "Player".
 *   - Quem só tem UNRESTRICTED | VERIFIED — toda conta que já logou —
 *     continua sendo "Player".
 * O `/moderate check` lê assim a priv inteira e identifica o cargo de verdade,
 * sem perder os que ficavam ocultos. O `/moderate restrict` mira em staff
 * definido no servidor (staff mask), então nenhum cargo novo nessa lista o
 * afeta.
 */
function privLabel(priv) {
  return privNames(priv & ~Privileges.VERIFIED)[0];
}

/**
 * Os cargos que o /role distribui: o bit que cada chave liga, e o privilégio
 * que o BOT exige de quem concede.
 *
 * ── A chave sai do str_priv_dict de app/api/utils.py, e isso importa ─────────
 * O bancho.py-ex tem DOIS dicionários com esse nome, e eles divergem: o de
 * app/commands.py chama MODERATOR de "moderator", o de app/api/utils.py chama
 * de "mod". Quem atende o pub/sub é o segundo — os receptores de `addpriv` e
 * `removepriv` importam dali. Publicar "moderator" devolve
 * `Invalid privilege: moderator`, e devolve para o console do bancho: pub/sub
 * não responde a quem publica, então daqui o sintoma seria um "não confirmado"
 * seco, sem pista do motivo.
 *
 * ── Por que o privilégio exigido não é o mesmo para todos ─────────────────────
 * Conceder `developer` dá controle total do servidor. Se ADMINISTRATOR
 * bastasse, um administrador obteria por procuração exatamente o que o bancho
 * não lhe dá — então os três bits de staff exigem DEVELOPER. Os outros cinco
 * param em ADMINISTRATOR porque nenhum deles concede poder sobre outras contas,
 * e travá-los no privilégio mais alto faria o dono virar gargalo para dar
 * nominator a um mapper novo.
 *
 * ── O que NÃO está aqui ───────────────────────────────────────────────────────
 *   supporter, premium — o addpriv recusa os dois (`return "use givedonor."`),
 *     porque o caminho deles é o canal `givedonator`, que leva duração e não
 *     tem contrapartida para remover.
 *   normal — é o bit UNRESTRICTED. Tirá-lo por aqui bane sem passar pelo
 *     Player.restrict(): sem registro de restrição, sem sair das leaderboards,
 *     e o alvo continua aparecendo limpo no /moderate check. Quem bane é o
 *     /moderate restrict.
 */
const ROLES = {
  verified:    { bit: Privileges.VERIFIED,        requires: Privileges.ADMINISTRATOR },
  whitelisted: { bit: Privileges.WHITELISTED,     requires: Privileges.ADMINISTRATOR },
  alumni:      { bit: Privileges.ALUMNI,          requires: Privileges.ADMINISTRATOR },
  tournament:  { bit: Privileges.TOURNEY_MANAGER, requires: Privileges.ADMINISTRATOR },
  nominator:   { bit: Privileges.NOMINATOR,       requires: Privileges.ADMINISTRATOR },
  mod:         { bit: Privileges.MODERATOR,       requires: Privileges.DEVELOPER },
  admin:       { bit: Privileges.ADMINISTRATOR,   requires: Privileges.DEVELOPER },
  developer:   { bit: Privileges.DEVELOPER,       requires: Privileges.DEVELOPER },
};

/**
 * Qual servidor as leituras administrativas consultam, para o log.
 *
 * As escritas vão para o Redis apontado pelo .env; as leituras vão para o
 * `PRIVATE_MODE` do osuClient, que sai do registro de servidores. São duas
 * configurações independentes que precisam falar do MESMO servidor, e quando
 * elas divergiram não havia como perceber pela mensagem de erro.
 */
function adminServerLabel() {
  return servers.label(osu.PRIVATE_MODE);
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
/**
 * Quantas releituras ao mesmo tempo.
 *
 * Alinhado ao balde `server:` do rate limiter, que é quem de fato limita a
 * vazão. Em série, cada dificuldade pagava o tempo de ida e volta sozinha, uma
 * depois da outra — num set de 100, isso é 100 viagens enfileiradas antes de a
 * primeira passada terminar.
 */
const VERIFY_CONCURRENCY = 5;

async function verifyMapStatus(beatmapIds, expectedStatus, { delayMs = 1200, budgetMs } = {}) {
  let pending = [...beatmapIds];
  const confirmed = [];
  const deadline = Date.now() + (budgetMs ?? verifyBudget(pending.length));

  do {
    await sleep(delayMs);

    // O erro é tratado DENTRO do fn de propósito: um mapa que some da API é
    // "ainda não confirmou", não motivo para abandonar a verificação dos outros.
    const confirmou = await mapLimit(pending, VERIFY_CONCURRENCY, async (id) => {
      try {
        const map = await osu.getServerMap(id);
        return Boolean(map) && Number(map.status) === Number(expectedStatus);
      } catch {
        return false;
      }
    });

    const still = [];
    pending.forEach((id, i) => (confirmou[i] ? confirmed.push(id) : still.push(id)));
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

/**
 * Confirma que o wipe pegou: pp e plays zerados naquele modo.
 *
 * Mesma necessidade das outras verificações — pub/sub não devolve resultado —,
 * mas aqui ela pesa mais: sem confirmação, um comando destrutivo que falhou em
 * silêncio deixaria quem rodou achando que o serviço foi feito.
 */
async function verifyWiped(osuId, modeNum, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const stats = await osu.getServerPlayerStats(osuId, modeNum);
      if (stats && Number(stats.pp) === 0 && Number(stats.plays) === 0) return true;
    } catch {
      // tenta de novo
    }
  }
  return false;
}

/**
 * Confirma que o score saiu: o `status` dele passou a ser o de score apagado.
 *
 * Mesma necessidade das outras verificações — pub/sub não devolve resultado.
 * Aqui a leitura é mais direta que a do `verifyWiped`: o wipe de um score não
 * zera nada visível no perfil (o pp cai, mas para um número que ninguém sabe de
 * antemão), então o que se confere é o estado do próprio score.
 */
async function verifyScoreWiped(scoreId, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const score = await osu.getServerScore(scoreId);
      if (score && Number(score.status) === WIPED_SCORE_STATUS) return true;
    } catch {
      // tenta de novo
    }
  }
  return false;
}

/**
 * Confirma que o bit ficou (ou deixou de estar) ligado.
 *
 * Janela fixa, como a do verifyRestricted e ao contrário da de mapa: o alvo é
 * sempre um só, e o `add_privs` do bancho é um UPDATE na tabela `users` — não
 * há download pelo meio para fazer o tempo depender do tamanho de nada.
 */
async function verifyPriv(osuId, bit, expectPresent, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const player = await osu.getServerPlayerRaw(osuId);
      if (player && hasPriv(player.priv, bit) === expectPresent) return true;
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
  GameModes,
  CHANNELS,
  isConfigured,
  checkConnection,
  closeRedis,
  rankBeatmap,
  restrictPlayer,
  unrestrictPlayer,
  wipePlayer,
  verifyWiped,
  wipeScore,
  wipeMapScores,
  verifyScoreWiped,
  WIPED_SCORE_STATUS,
  hasPriv,
  isStaff,
  STAFF_MASK,
  privLabel,
  labelOfBit,
  labelOfPrivName,
  privNames,
  ROLES,
  PRIV_BY_NAME,
  addPrivilege,
  removePrivilege,
  verifyPriv,
  adminServerLabel,
  getPlayerPrivileges,
  verifyMapStatus,
  verifyRestricted,

  // Exportado para teste: é o que decide entre reportar "parcial" e esperar o
  // servidor terminar.
  verifyBudget,
};
