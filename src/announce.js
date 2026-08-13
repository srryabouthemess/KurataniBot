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
 * Capa do beatmapset, servida pelo CDN do osu! oficial.
 *
 * Vale para mapa de servidor privado também: o `set_id` é o mesmo do osu!, que
 * é de onde o mapa veio. Mapa que nunca existiu lá não tem capa, e aí o embed
 * simplesmente sai sem imagem — o Discord ignora URL que não resolve.
 */
const coverUrl = setId => `https://assets.ppy.sh/beatmaps/${Number(setId)}/covers/cover.jpg`;

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
    // `fetch` e não o cache: o canal pode não ter sido visto ainda nesta sessão.
    const channel = await client.channels.fetch(id);
    if (!channel?.isTextBased?.()) {
      logError('announce', new Error(`canal ${id} não é de texto (ou não existe)`));
      return false;
    }

    // Checar antes de tentar deixa o motivo no log em vez de um DiscordAPIError
    // genérico — e é o erro de configuração mais provável depois do ID errado.
    const me = channel.guild?.members?.me;
    if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
      logError('announce', new Error(`sem permissão de enviar em ${id}`));
      return false;
    }

    const mapUrl = osu.getMapUrl(info.diffs[0]?.id, info.setId, osu.PRIVATE_MODE);

    const embed = new EmbedBuilder()
      .setColor(STATUS_COLOR[info.status] ?? 0x99ccff)
      .setTitle(s.ann_title(info.statusLabel))
      .setURL(mapUrl)
      .setDescription(
        `**[${info.label}](${mapUrl})**\n` +
        s.ann_diffs(info.confirmed) +
        (info.actorName ? `\n${s.ann_by(info.actorName)}` : ''),
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

module.exports = { isConfigured, announceStatus, coverUrl };
