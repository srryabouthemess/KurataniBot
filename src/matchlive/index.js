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
const { criarPoller } = require('./poller');
const render = require('./render');
const daycore = require('./sources/daycore');
const { gameMessagesIniciais } = require('./diff');

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
 */
function iniciar(client, strings) {
  if (poller) return;
  const chave = chaveDoDaycore();
  poller = criarPoller({
    client,
    db,
    fontes: chave ? { [chave]: daycore } : {},
    render,
    strings,
    siteUrl: (serverKey, matchId) => {
      const base = servers.get(serverKey)?.webUrl;
      return base ? `${base.replace(/\/+$/, '')}/matches/${matchId}` : null;
    },
  });
  poller.start();
}

module.exports = { iniciar, fontePara, gameMessagesIniciais, LIMITE_POR_CANAL, LIMITE_GLOBAL };
