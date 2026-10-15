/**
 * matchlive/index.js
 * A peça que liga o /matchlive ao bot de verdade: as fontes por servidor, os
 * limites e o poller único, ligado no `clientReady`.
 *
 * Sem i18n e sem discord.js (o test/architecture restringe os dois): as strings
 * por guild chegam injetadas por quem chama — o próprio comando.
 */

const servers = require('../servers');
const db = require('../db');
const { chaveDoDaycore } = require('../multiplayer/daycore');
const { criarPoller, MAX_LINHAS_LOG } = require('./poller');
const render = require('./render');
const daycore = require('./sources/daycore');
const { gameMessagesIniciais, inicioDoLog, LOGAVEIS } = require('./diff');

const LIMITE_POR_CANAL = 3;
const LIMITE_GLOBAL = 20;

/** A fonte das partidas deste servidor, ou null se o /matchlive não o atende. */
function fontePara(serverKey) {
  return serverKey && serverKey === chaveDoDaycore() ? daycore : null;
}

let poller = null;

/**
 * Liga o poller uma vez só (um segundo `clientReady`, num reconnect, não cria
 * outro loop). Os tracks gravados antes do restart voltam no primeiro tick.
 *
 * @param {import('discord.js').Client} client
 * @param {(guildId: string|null) => object} strings as strings de cada guild
 * @param {object} [extras]
 * @param {(mapId: number) => Promise<{setId: number, segundos: number}|null>} [extras.infoDoMapa]
 *   capa e duração do mapa (da API do osu!, que fica fora daqui)
 * @param {(grade: string) => string} [extras.rotuloDaGrade] o emote da grade
 */
function iniciar(client, strings, { infoDoMapa, rotuloDaGrade } = {}) {
  if (poller) return;
  const chave = chaveDoDaycore();
  poller = criarPoller({
    client,
    db,
    fontes: chave ? { [chave]: daycore } : {},
    render,
    strings,
    infoDoMapa,
    rotuloDaGrade,
    siteUrl: (serverKey, matchId) => {
      const base = servers.get(serverKey)?.webUrl;
      return base ? `${base.replace(/\/+$/, '')}/matches/${matchId}` : null;
    },
  });
  poller.start();
}

// Até quantas mensagens o histórico de um track novo posta (o EMBED_LIMIT do
// Bathbot): uma de log do passado e o resto em mapas.
const LIMITE_HISTORICO = 10;

module.exports = {
  iniciar, fontePara, gameMessagesIniciais, inicioDoLog, LIMITE_POR_CANAL, LIMITE_GLOBAL, LIMITE_HISTORICO, MAX_LINHAS_LOG, LOGAVEIS,
};
