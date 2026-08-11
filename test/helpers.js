/**
 * Peças compartilhadas pelos testes.
 *
 * O runner é o nativo do Node (`node --test`), então não há dependência nova:
 * cada arquivo roda no próprio processo, o que deixa cada um mexer em
 * `process.env` e em módulos globais sem contaminar os outros.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Uma `Message` do Discord com o mínimo que o bot toca. */
function fakeMessage(content, {
  guildId = '111',
  mentions = [],
  admin = true,
  sent = [],
} = {}) {
  const replyMessage = {
    edit: async payload => { sent.push(['edit', payload]); return replyMessage; },
    delete: async () => {},
  };

  const message = {
    content,
    author:     { id: String(Math.floor(Math.random() * 1e15)), bot: false },
    webhookId:  null,
    guildId,
    guild:      guildId ? { id: guildId, preferredLocale: 'pt-BR' } : null,
    channelId:  '222',
    member:     guildId ? { permissions: { has: () => admin } } : null,
    mentions:   { users: new Map(mentions.map(u => [u.id, u])) },
    channel: {
      sendTyping: async () => {},
      send: async payload => { sent.push(['send', payload]); return replyMessage; },
    },
    reply: async payload => { sent.push(['reply', payload]); return replyMessage; },
  };

  message.client = { users: { fetch: async id => ({ id }) } };
  return message;
}

/** Texto da primeira resposta enviada, seja string ou payload. */
function firstReply(sent) {
  const payload = sent[0]?.[1];
  if (payload === undefined) return '';
  return typeof payload === 'string' ? payload : payload.content ?? JSON.stringify(payload);
}

/** O listener do prefixo é fire-and-forget; deixa as promises drenarem. */
const drain = () => new Promise(resolve => setTimeout(resolve, 30));

module.exports = { ROOT, fakeMessage, firstReply, drain };
