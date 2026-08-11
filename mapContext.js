/**
 * mapContext.js
 * Lembra o último mapa que apareceu em cada canal.
 *
 * É o que permite `/score` sem argumento: alguém roda `/rs`, e quem estiver no
 * canal responde `/score` para ver as próprias plays no mesmo mapa, sem
 * precisar caçar o link. Os bots de osu! chamam isso de "map context".
 *
 * "Apareceu" inclui link colado na conversa, não só embed do bot — foi o
 * primeiro tropeço real: alguém posta o link do mapa, manda `k!c` embaixo e
 * ouve que não dava para identificar o mapa, sendo que ele estava logo ali.
 *
 * O escopo é o CANAL, não quem rodou o comando — a graça é justamente reagir à
 * play de outra pessoa. Fica em memória: reiniciar o bot esquece o contexto, e
 * isso é aceitável porque o dado só vale enquanto a conversa está viva (o TTL
 * abaixo é bem mais curto que o intervalo típico entre reinícios).
 */

const osu = require('./osuClient');
const servers = require('./servers');

// Uma conversa esfria bem antes disso; o TTL existe mais para o mapa de ontem
// não voltar do além num canal parado do que para economizar memória.
const TTL_MS = 6 * 60 * 60 * 1000;

// Teto de canais guardados. Cada entrada são ~3 números, então o limite é
// generoso de propósito: serve só para o Map não crescer sem fim num bot que
// fica semanas no ar.
const MAX_CHANNELS = 1000;

// channelId → { mapId, mode, at }
const _last = new Map();

/**
 * Registra o mapa que acabou de aparecer no canal.
 *
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {number|string|null} mapId
 * @param {string} mode  servidor em que o mapa foi exibido
 */
function remember(interaction, mapId, mode) {
  const channelId = interaction?.channelId;
  if (!channelId || !mapId) return;

  _last.set(channelId, { mapId: Number(mapId), mode, at: Date.now() });

  // Poda preguiçosa (mesma ideia do cache de usuário do osuClient): só corre a
  // lista quando ela passa do teto, evitando mais um timer no processo.
  if (_last.size > MAX_CHANNELS) {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, entry] of _last) {
      if (entry.at < cutoff) _last.delete(id);
    }
  }
}

/**
 * Só link dos servidores configurados — jogar o texto inteiro no
 * parseBeatmapId acharia "mapa" em qualquer `algumsite.com/b/12` que passasse
 * pela conversa. O domínio também diz de qual servidor o mapa é.
 *
 * Vem do registro, então adicionar um servidor no `.env` já faz o link dele
 * ser reconhecido no chat.
 */
const HOSTS = new Map(
  servers.all()
    .filter(server => !server.relax)  // vanilla e RX dividem o mesmo domínio
    .map(server => {
      try { return [new URL(server.webUrl).hostname.toLowerCase(), server.key]; }
      catch { return null; }
    })
    .filter(Boolean)
);

const MAP_LINK = new RegExp(
  `https?://(?:[\\w-]+\\.)*(${[...HOSTS.keys()].map(h => h.replace(/\./g, '\\.')).join('|')})/\\S+`,
  'gi'
);

/**
 * Mapa citado numa mensagem, ou null. Olha o texto e os embeds — responder ao
 * embed de uma play do próprio bot é tão natural quanto responder ao link cru.
 *
 * @returns {{mapId: number, mode: string}|null}
 */
function fromMessage(message, { skipContent = false } = {}) {
  if (!message) return null;

  const haystacks = skipContent ? [] : [message.content ?? ''];
  for (const embed of message.embeds ?? []) {
    haystacks.push(embed.url ?? '', embed.description ?? '');
  }

  // De trás para frente: com mais de um link na mesma mensagem, o último é o
  // que a pessoa acabou de citar.
  for (const text of haystacks.reverse()) {
    const links = [...text.matchAll(MAP_LINK)].reverse();
    for (const [url, host] of links) {
      const mapId = osu.parseBeatmapId(url);
      if (mapId) return { mapId, mode: HOSTS.get(host.toLowerCase()) ?? servers.OFFICIAL_KEY };
    }
  }

  return null;
}

/**
 * Registra o mapa de uma mensagem qualquer da conversa.
 * Exige o intent de conteúdo de mensagem (ver prefixCommands.js).
 */
function watch(message) {
  if (message.author?.id === message.client?.user?.id) return; // o próprio bot já usa remember()

  const found = fromMessage(message);
  if (found) remember(message, found.mapId, found.mode);
}

/**
 * Mapa que o comando deve usar quando ninguém passou nenhum.
 *
 * Ordem: primeiro o link da mensagem que a pessoa **respondeu**, depois o
 * último mapa do canal. Responder é um gesto explícito — quem faz isso está
 * apontando para aquele mapa, e não para o que rolou no canal enquanto ela
 * digitava.
 *
 * @returns {Promise<{mapId: number, mode: string}|null>}
 */
async function recall(interaction) {
  // Só existe no modo texto: não dá para responder a uma mensagem com slash.
  const replied   = await interaction?.fetchRepliedMessage?.();
  const fromReply = fromMessage(replied);
  if (fromReply) return fromReply;

  const remembered = recallFromMemory(interaction?.channelId);
  if (remembered) return remembered;

  // Nada na memória: o mapa pode ter sido postado antes de o bot subir, já que
  // isto aqui não sobrevive a restart. Vale uma olhada no histórico em vez de
  // dizer que não achou um link que está logo ali na tela.
  const found = await searchHistory(interaction?.channel);
  if (found) remember(interaction, found.mapId, found.mode);
  return found;
}

function recallFromMemory(channelId) {
  if (!channelId) return null;

  const entry = _last.get(channelId);
  if (!entry) return null;

  if (Date.now() - entry.at > TTL_MS) {
    _last.delete(channelId);
    return null;
  }

  return { mapId: entry.mapId, mode: entry.mode };
}

/** Quantas mensagens olhar para trás — uma chamada só, e só quando dá miss. */
const HISTORY_LIMIT = 50;

/** Procura o mapa mais recente no histórico do canal. */
async function searchHistory(channel) {
  const messages = await channel?.messages?.fetch?.({ limit: HISTORY_LIMIT }).catch(() => null);
  if (!messages) return null;

  // Mesmo corte da memória: link de anteontem não é "o mapa da conversa".
  const cutoff = Date.now() - TTL_MS;
  const selfId = channel.client?.user?.id;

  // fetch() devolve da mais nova para a mais antiga.
  for (const message of messages.values()) {
    if (message.createdTimestamp < cutoff) break;

    // Das mensagens do próprio bot, só o embed conta: o texto de "não
    // identifiquei o mapa" traz um link de exemplo (`.../beatmapsets/123#osu/456`)
    // e o bot acharia o próprio exemplo como se fosse o mapa da conversa.
    const found = fromMessage(message, { skipContent: message.author?.id === selfId });
    if (found) return found;
  }

  return null;
}

module.exports = { remember, recall, watch, fromMessage };
