/**
 * Peças compartilhadas pelos testes.
 *
 * O runner é o nativo do Node (`node --test`), então não há dependência nova:
 * cada arquivo roda no próprio processo, o que deixa cada um mexer em
 * `process.env` e em módulos globais sem contaminar os outros.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');

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

/**
 * Um `db` novo, gravando num diretório temporário que some no fim do teste.
 *
 * Antes cada arquivo copiava `src/db.js`, `servers.js` e `paths.js` para uma
 * pasta que imitava o layout do projeto, porque o caminho do banco saía de
 * `src/` e não havia como desviá-lo. Isso amarrava o teste à LISTA de arquivos
 * do módulo — e quebrou quando o `db.js` virou uma pasta. Com o
 * `KURATANI_DATA_DIR`, o teste usa os módulos de verdade e só troca onde o
 * arquivo é gravado.
 *
 * O cache do `require` precisa perder o pacote `db/` INTEIRO, e não só o
 * `index`: os submódulos guardam a conexão aberta, então reimportar só a fachada
 * devolveria o banco anterior — já fechado pelo teste que passou antes.
 */
function dbWorkspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-db-'));
  process.env.KURATANI_DATA_DIR = dir;

  const opened = [];

  const load = () => {
    // O cache do `require` precisa perder o pacote `db/` INTEIRO, e não só o
    // `index`: os submódulos guardam a conexão aberta, então reimportar só a
    // fachada devolveria o banco anterior — já fechado pelo teste que passou
    // antes. O `paths` vai junto porque é ele que lê a variável de ambiente.
    const pacoteDb = path.join(ROOT, 'db');
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(pacoteDb) || key === require.resolve(path.join(ROOT, 'paths.js'))) {
        delete require.cache[key];
      }
    }

    const db = require(path.join(ROOT, 'db'));
    opened.push(db);
    return db;
  };

  // Todo handle é fechado ANTES de apagar a pasta: no Windows um banco ainda
  // aberto trava o arquivo e o rmSync falha com EPERM.
  t.after(() => {
    for (const db of opened) { try { db.close(); } catch { /* já fechado */ } }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  return { dir, dbPath: path.join(dir, 'bot.db'), load };
}

/** Atalho para quem só precisa de um banco limpo, carregado uma vez. */
const freshDb = (t) => dbWorkspace(t).load();

module.exports = { ROOT, fakeMessage, firstReply, drain, dbWorkspace, freshDb };
