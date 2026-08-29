/**
 * announce.js
 * Anúncio público de mudança de status de mapa no Daycore.
 *
 * ── Por que existe ────────────────────────────────────────────────────────────
 * O bancho.py-ex não avisa o Discord quando um mapa muda de status: quem
 * acompanha o servidor só descobre entrando no site. O bot já sabe da mudança —
 * é ele que publica no canal `rank` e confirma o efeito relendo a API v2 —,
 * então anunciar é aproveitar o que já está em mãos, não uma consulta nova.
 *
 * ── Desligado por padrão ──────────────────────────────────────────────────────
 * Sem `DAYCORE_ANNOUNCE_CHANNEL_ID` no `.env`, nada é enviado e o comando segue
 * normal. Falhar fechado importa mais aqui do que no resto do bot: o alvo é um
 * canal público, e uma configuração errada não deixa de anunciar — ela anuncia
 * no lugar errado, para quem não devia ver.
 *
 * ── Nunca derruba o comando ───────────────────────────────────────────────────
 * Todo o envio é best-effort. A ação no servidor já aconteceu quando o anúncio
 * sai; deixar uma falha de Discord (canal apagado, permissão retirada, rede)
 * transformar uma nomeação bem-sucedida em "ocorreu um erro" seria mentir sobre
 * o que aconteceu no Daycore. Erro daqui vai para o log e para lugar nenhum
 * mais.
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const osu = require('./osuClient');
const servers = require('./servers');
const daycore = require('./daycoreAdmin');
const { md } = require('./markdown');
const { logError } = require('./logger');

// Cores por status: verde para ranked, rosa para loved, cinza para unranked.
// Mesma leitura do osu! oficial, para quem bate o olho não precisar ler.
const STATUS_COLOR = {
  0: 0x9b9b9b,
  2: 0x86d95f,
  5: 0xff66aa,
};

function channelId() {
  return process.env.DAYCORE_ANNOUNCE_CHANNEL_ID || null;
}

function isConfigured() {
  return Boolean(channelId());
}

/**
 * Canal do log de cargo — separado do de mapa DE PROPÓSITO.
 *
 * O anúncio de mapa é vitrine: serve para quem joga saber o que entrou. Cargo
 * mexido dentro do jogo é registro de staff, e no Daycore ele já convive com o
 * webhook de auditoria do próprio servidor num canal de log. Amarrar os dois na
 * mesma variável obrigaria a escolher entre publicar cargo na vitrine ou não
 * publicar nada.
 */
function privChannelId() {
  return process.env.DAYCORE_ROLE_LOG_CHANNEL_ID || null;
}

function isPrivLogConfigured() {
  return Boolean(privChannelId());
}

/**
 * O canal, se ele existir, for de texto e o bot puder falar nele.
 *
 * Os dois anúncios fazem a mesma checagem pelo mesmo motivo: conferir antes
 * deixa o motivo no log em vez de um DiscordAPIError genérico, e canal errado
 * ou permissão retirada são os dois erros de configuração mais prováveis.
 *
 * @returns {Promise<import('discord.js').TextBasedChannel|null>}
 */
async function resolveChannel(client, id, contexto) {
  // `fetch` e não o cache: o canal pode não ter sido visto ainda nesta sessão.
  const channel = await client.channels.fetch(id);
  if (!channel?.isTextBased?.()) {
    logError(contexto, new Error(`canal ${id} não é de texto (ou não existe)`));
    return null;
  }

  const me = channel.guild?.members?.me;
  if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    logError(contexto, new Error(`sem permissão de enviar em ${id}`));
    return null;
  }

  return channel;
}

/**
 * Capa do beatmapset, pelo espelho do servidor quando ele tem um.
 *
 * Mapa registrado no proprio servidor recebe um `set_id` da faixa privada, que
 * nao existe no CDN do osu!: pedir a capa la devolve 404 e o embed sai liso. O
 * espelho extrai a capa do `.osz` guardado e redireciona para o assets.ppy.sh
 * quando o id e oficial, entao a mesma URL cobre os dois casos. Sem espelho
 * configurado (`SERVER_<chave>_COVERS`), continua valendo o CDN oficial.
 *
 * A base entra por parametro para o teste cobrir os dois caminhos sem depender
 * do `.env` da maquina.
 */
const coverUrl = (setId, base = servers.get(osu.PRIVATE_MODE).covers) => (
  base
    ? `${base}/${Number(setId)}`
    : `https://assets.ppy.sh/beatmaps/${Number(setId)}/covers/cover.jpg`
);

/**
 * Manda o anúncio, se estiver configurado e der.
 *
 * @param {import('discord.js').Client} client
 * @param {object} info
 * @param {number} info.setId
 * @param {object[]} info.diffs      Dificuldades atingidas
 * @param {number} info.status       RankedStatus alvo
 * @param {string} info.statusLabel  'ranked' | 'loved' | 'unranked'
 * @param {string} info.label        "artista - título (criador)"
 * @param {string} info.actorName    Conta de jogo de quem aplicou
 * @param {number} info.confirmed    Quantas dificuldades confirmaram
 * @param {object} s                 Strings de i18n já resolvidas
 * @returns {Promise<boolean>} se o anúncio saiu
 */
async function announceStatus(client, info, s) {
  const id = channelId();
  if (!id) return false;

  try {
    const channel = await resolveChannel(client, id, 'announce');
    if (!channel) return false;

    const mapUrl = osu.getMapUrl(info.diffs[0]?.id, info.setId, osu.PRIVATE_MODE);

    const embed = new EmbedBuilder()
      .setColor(STATUS_COLOR[info.status] ?? 0x99ccff)
      .setTitle(s.ann_title(info.statusLabel))
      .setURL(mapUrl)
      .setDescription(
        // O rótulo é artista/título/criador do mapa — texto de terceiro, e este
        // embed vai para um canal PÚBLICO. Sem escape, um mapa com `](url)` no
        // nome faz o bot publicar um link forjado (ver markdown.js).
        `**[${md(info.label)}](${mapUrl})**\n` +
        s.ann_diffs(info.confirmed) +
        // De onde veio muda a linha: aplicado pelo bot é rastreável até uma
        // conta do Discord, aplicado no jogo não — e quem lê o canal precisa
        // saber a diferença em vez de supor que todo anúncio passou por aqui.
        (info.actorName
          ? `\n${info.fromGame ? s.ann_by_ingame(info.actorName) : s.ann_by(info.actorName)}`
          : (info.fromGame ? `\n${s.ann_ingame_unknown}` : '')),
      )
      .setImage(coverUrl(info.setId))
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    // A ação no Daycore já valeu; o anúncio é o que falhou.
    logError('announce', error);
    return false;
  }
}

/**
 * Anuncia uma mudança de status feita DENTRO DO JOGO (`!map`).
 *
 * O bancho publica esse evento sozinho, e ele traz os IDs afetados mas não os
 * metadados do mapa — daí a releitura de uma dificuldade, que é de onde saem
 * artista, título e criador para o embed. Uma só: o anúncio é do set, e o
 * evento já vem agrupado (um `!map rank set` de 100 dificuldades é UMA
 * mensagem, não cem).
 *
 * @param {import('discord.js').Client} client
 * @param {object} evento saída do `parseEvent` do daycoreEvents
 * @param {object} s strings de i18n já resolvidas
 */
async function announceGameStatus(client, evento, s) {
  if (!isConfigured()) return false;

  const primeira = await osu.getServerMap(evento.mapIds[0]).catch(() => null);
  if (!primeira?.set_id) {
    logError('announce:game', new Error(`sem metadados para o mapa ${evento.mapIds[0]}`));
    return false;
  }

  // Metadados vêm do .osu enviado por terceiro; o mesmo teto do /nominate.
  const label = `${primeira.artist ?? '?'} - ${primeira.title ?? '?'} (${primeira.creator ?? '?'}`
    .slice(0, 149) + ')';

  return announceStatus(client, {
    setId:       primeira.set_id,
    diffs:       [{ id: primeira.id }],
    status:      evento.status,
    statusLabel: daycore.STATUS_LABELS[evento.status] ?? String(evento.status),
    label,
    actorName:   evento.authorName,
    confirmed:   evento.mapIds.length,
    fromGame:    true,
  }, s);
}

// Mesmas cores que o webhook de auditoria do servidor usa para estas duas
// ações (`AUDIT_LOG_STYLE`, em app/discord.py). O canal é o mesmo, e ler duas
// paletas para o mesmo assunto é ruído.
const PRIV_COLOR = {
  addpriv: 0x3498db,
  rmpriv:  0x992d22,
};

/** Avatar da conta no servidor privado — mesma origem que o resto do bot usa. */
const avatarUrl = osuId => `${servers.get(osu.PRIVATE_MODE).avatars}/${Number(osuId)}`;

/**
 * Anuncia um cargo dado ou tirado DENTRO DO JOGO (`!addpriv` / `!rmpriv`).
 *
 * ── Por que só o caminho in-game ──────────────────────────────────────────────
 * O `/role` daqui e o admin panel publicam nos canais `addpriv`/`removepriv`,
 * e quem os atende no servidor já manda um embed para o webhook de auditoria.
 * Anunciar esses dois aqui colocaria a mesma ação duas vezes no mesmo canal.
 * Os comandos in-game não passam por lá — é o buraco que este anúncio fecha.
 *
 * ── Não relê o servidor ───────────────────────────────────────────────────────
 * Ao contrário do anúncio de mapa, o evento já traz nome do alvo e de quem
 * aplicou: o `!addpriv` roda com os dois objetos em mãos. Não há o que
 * completar por API, então não há requisição nenhuma no caminho do anúncio.
 *
 * @param {import('discord.js').Client} client
 * @param {object} evento saída do `parsePrivEvent` do daycoreEvents
 * @param {object} s strings de i18n já resolvidas
 * @returns {Promise<boolean>} se o anúncio saiu
 */
async function announcePrivChange(client, evento, s) {
  const id = privChannelId();
  if (!id) return false;

  try {
    const channel = await resolveChannel(client, id, 'announce:priv');
    if (!channel) return false;

    const concedeu   = evento.type === 'addpriv';
    const perfilUrl  = osu.getUserUrl(evento.targetId, osu.PRIVATE_MODE);
    const cargos     = evento.privs.map(daycore.labelOfPrivName).join(', ');
    // Nome de jogador é texto de terceiro em canal público, e o do alvo vai em
    // posição de link — sem escape, um nick com `](url)` forja o destino.
    const alvo       = md(evento.targetName ?? `#${evento.targetId}`);

    const embed = new EmbedBuilder()
      .setColor(PRIV_COLOR[evento.type] ?? 0x99ccff)
      .setTitle(concedeu ? s.priv_ann_title_give : s.priv_ann_title_take)
      .setURL(perfilUrl)
      .setDescription(
        `**[${alvo}](${perfilUrl})** \`#${evento.targetId}\`\n` +
        s.priv_ann_roles(cargos) +
        // Quem aplicou só existe se o fork mandar o campo — mesma regra do
        // anúncio de mapa. Sem ele sai "aplicado in-game", não sai errado.
        `\n${evento.authorName ? s.priv_ann_by_ingame(md(evento.authorName)) : s.priv_ann_ingame_unknown}`,
      )
      .setThumbnail(avatarUrl(evento.targetId))
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    // A mudança de cargo no Daycore já valeu; o anúncio é o que falhou.
    logError('announce:priv', error);
    return false;
  }
}

module.exports = {
  isConfigured, announceStatus, announceGameStatus, coverUrl,
  isPrivLogConfigured, announcePrivChange, avatarUrl,
};
