/**
 * O botão 🔄 do /recent, pelo `execute` de verdade.
 *
 * Quem clica acabou de jogar e quer ver a play nova: o refresh busca a lista
 * INTEIRA de novo e volta para a primeira página. Antes ele só re-buscava a
 * play da página atual — um score enviado não muda, então o clique deixava a
 * tela exatamente igual. osuClient, userLink e o desenho da play são dublês.
 */
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const chamadas = { recent: [], best: [], fetchPlayer: [] };
let lista = [];        // o que a API "responde" agora, da mais nova para a mais velha
let jogadorAtual = { id: 7, username: 'kuratani', pp: 1000 };
let falhar = false;

const osuStub = {
  getModeLabel: () => 'Daycore',
  getRecentScores: async (id, limit, mode) => {
    chamadas.recent.push({ id, limit, mode });
    if (falhar) throw new Error('API caiu');
    return lista;
  },
  getBestScores: async (id, limit, mode, opts) => {
    chamadas.best.push({ id, limit, mode, opts });
    return [];
  },
  getUser: async () => jogadorAtual,
  getBeatmapFile: async () => null,
  enrichScores:      async scores => scores,
  enrichBeatmapData: async scores => scores.map(sc => ({ ...sc, beatmap: { id: sc.id } })),
};
const linkStub = {
  resolvePlayer: () => ({ username: 'kuratani', mode: 'daycore', ownerId: 'dono' }),
  fetchPlayer: async (resolved, buscar, opts) => {
    chamadas.fetchPlayer.push({ username: resolved.username, mode: resolved.mode, opts });
    const user = jogadorAtual;
    return { user, scores: await buscar(user.id) };
  },
};
const playStub = {
  author: user => ({ name: `${user.username}: ${user.pp}pp` }),
  single: async play => ({ title: `play${play.id}`, url: null, color: 0x123456, thumbnail: null, description: `play${play.id}` }),
};
const contextoStub = { remember: () => {} };

for (const [caminho, exports] of [
  ['../src/osuClient', osuStub],
  ['../src/userLink', linkStub],
  ['../src/embeds/play', playStub],
  ['../src/mapContext', contextoStub],
]) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

const recent = require('../src/commands/osu/recent');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** `n` plays, da mais nova (id maior) para a mais velha, cada uma num mapa. */
const plays = (n, { primeiro = n } = {}) => Array.from({ length: n }, (_, i) => ({
  id: primeiro - i, score_id: primeiro - i, created_at: 1_700_000_000 + (primeiro - i) * 60,
}));

/** Roda o /recent e devolve como clicar e o que foi para a tela. */
async function rodar({ dono = 'dono' } = {}) {
  const collector = new EventEmitter();
  collector.stop = motivo => collector.emit('end', new Map(), motivo);
  const edits = [];
  const message = { createMessageComponentCollector: () => collector };

  const interaction = {
    user: { id: dono }, guildId: null,
    options: { getString: () => null },
    deferReply: async () => {},
    reply: async () => {},
    editReply: async payload => { edits.push(payload); return message; },
  };

  await recent.execute(interaction);

  const clicar = (customId, userId = dono) => {
    const clique = {};
    collector.emit('collect', {
      user: { id: userId }, customId: `recent_${customId}`,
      deferUpdate: async () => {},
      reply: async payload => { clique.efemero = payload; },
      followUp: async payload => { clique.aviso = payload; },
    });
    return clique;
  };

  const tela = () => {
    const e = edits.filter(x => x.embeds).at(-1)?.embeds[0].toJSON();
    return { titulo: e?.title, rodape: e?.footer?.text, autor: e?.author?.name };
  };
  const botoes = () => {
    const p = edits.filter(x => x.components?.length).at(-1);
    return (p?.components[0].components ?? []).map(b => ({ id: b.data.custom_id.replace('recent_', ''), off: !!b.data.disabled }));
  };

  return { edits, clicar, tela, botoes };
}

test.beforeEach(() => {
  chamadas.recent.length = 0; chamadas.best.length = 0; chamadas.fetchPlayer.length = 0;
  jogadorAtual = { id: 7, username: 'kuratani', pp: 1000 };
  lista = plays(3);
  falhar = false;
});

test('play nova depois do comando: o 🔄 mostra ela, na primeira página', async () => {
  const { clicar, tela } = await rodar();
  assert.equal(tela().titulo, 'play3');
  assert.match(tela().rodape, /Play 1\/3/);

  lista = plays(4);                                     // jogou o mapa 4
  clicar('refresh'); await sleep(20);

  assert.equal(tela().titulo, 'play4');
  assert.match(tela().rodape, /Play 1\/4/);
});

test('refresh numa página do meio volta para a mais recente', async () => {
  const { clicar, tela, botoes } = await rodar();
  clicar('next'); await sleep(10);
  clicar('next'); await sleep(10);
  assert.equal(tela().titulo, 'play1');

  lista = plays(4);
  clicar('refresh'); await sleep(20);

  assert.equal(tela().titulo, 'play4');
  assert.deepEqual(botoes().map(b => b.off), [true, false, false]);

  clicar('next'); await sleep(10);
  assert.equal(tela().titulo, 'play3', 'as outras páginas também são da lista nova');
});

test('busca pelo id já conhecido e renova o perfil do cabeçalho', async () => {
  const { clicar, tela } = await rodar();

  lista = plays(4);
  jogadorAtual = { id: 7, username: 'kuratani', pp: 1234 };
  clicar('refresh'); await sleep(20);

  const busca = chamadas.fetchPlayer.at(-1);
  assert.deepEqual([busca.username, busca.mode, busca.opts?.fresh], [7, 'daycore', true]);
  assert.deepEqual(chamadas.recent.at(-1), { id: 7, limit: 50, mode: 'daycore' });
  assert.equal(tela().autor, 'kuratani: 1234pp');
});

test('falha na busca nova mantém a tela e avisa', async () => {
  const { clicar, tela, edits } = await rodar();
  const antes = tela();
  const embedsAntes = edits.filter(e => e.embeds).length;

  falhar = true;
  const clique = clicar('refresh'); await sleep(20);

  assert.equal(edits.filter(e => e.embeds).length, embedsAntes);
  assert.deepEqual(tela(), antes);
  assert.match(clique.aviso?.content ?? '', /plays recentes/);
});

test('lista vazia no refresh é erro, não tela vazia', async () => {
  const { clicar, tela } = await rodar();
  const antes = tela();

  lista = [];
  const clique = clicar('refresh'); await sleep(20);

  assert.deepEqual(tela(), antes);
  assert.ok(clique.aviso, 'avisou');
});
