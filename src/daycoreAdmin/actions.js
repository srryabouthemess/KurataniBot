/**
 * daycoreAdmin/actions.js
 * O que o bot publica no servidor. Cada função é UM publish, fire-and-forget:
 * quem chama confirma o efeito relendo o estado (ver verify.js).
 */

const { publish } = require('./redis');
const { CHANNELS } = require('./constants');
const { signReason } = require('./signature');
const { ROLES } = require('./privileges');

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

module.exports = {
  rankBeatmap,
  restrictPlayer,
  unrestrictPlayer,
  wipePlayer,
  wipeScore,
  wipeMapScores,
  addPrivilege,
  removePrivilege,
};
