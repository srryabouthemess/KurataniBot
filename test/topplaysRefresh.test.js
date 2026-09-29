/**
 * O botão 🔄 do /topplays, pelo `execute` de verdade.
 *
 * O refresh recarrega a lista INTEIRA e reaplica sort/mods/reverse: uma play
 * nova muda a ordem, as posições, o recorte e o número de páginas. O que se
 * afirma aqui é o que chega à tela depois disso — osuClient, userLink e o
 * desenho da play são dublês.
 */
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const chamadas = { best: [], fetchPlayer: [] };
let lista = [];        // o que a API "responde" agora
let jogadorAtual = { id: 7, username: 'kuratani', pp: 1000 };
let falhar = false;

const osuStub = {
  getMapUrl:    () => 'https://example/map',
  getModeLabel: () => 'Daycore',
  getBestScores: async (id, limit, mode, opts) => {
    chamadas.best.push({ id, limit, mode, opts });
    if (falhar) throw new Error('API caiu');
    return lista;
  },
  enrichScores:      async scores => scores,
  enrichBeatmapData: async scores => scores.map(sc => ({ ...sc, beatmap: { id: sc.id }, beatmapset: { id: sc.id } })),
};
const linkStub = {
  resolvePlayer: () => ({ username: 'kuratani', mode: 'daycore' }),
  fetchPlayer: async (resolved, buscar, opts) => {
    chamadas.fetchPlayer.push({ username: resolved.username, opts });
    const user = jogadorAtual;
    return { user, scores: await buscar(user.id) };
  },
};
const playStub = {
  COLOR: 0x123456,
  author: user => ({ name: `${user.username}: ${user.pp}pp` }),
  listItem: async (play, { index }) => `#${index} play${play.id}`,
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

const topplays = require('../src/commands/osu/topplays');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** `n` plays em ordem decrescente de pp, como a API entrega. */
const plays = (n, { hd = () => false } = {}) => Array.from({ length: n }, (_, i) => ({
  id: i + 1, pp: 500 - i, mods: hd(i) ? ['HD'] : [],
}));

/** Roda o /topplays e devolve como clicar e o que foi para a tela. */
async function rodar({ sort = null, mods = null, reverse = null, dono = 'dono' } = {}) {
  const collector = new EventEmitter();
  collector.stop = motivo => collector.emit('end', new Map(), motivo);
  const edits = [];
  const respostas = [];
  const message = { createMessageComponentCollector: () => collector };

  const interaction = {
    user: { id: dono }, guildId: null,
    options: {
      getString:  nome => ({ sort, mods }[nome] ?? null),
      getBoolean: nome => (nome === 'reverse' ? reverse : null),
    },
    deferReply: async () => {},
    reply: async payload => { respostas.push(payload); },
    editReply: async payload => { edits.push(payload); return message; },
  };

  await topplays.execute(interaction);

  const clicar = (customId, userId = dono) => {
    const clique = {};
    collector.emit('collect', {
      user: { id: userId }, customId: `topplays_${customId}`,
      deferUpdate: async () => {},
      reply: async payload => { clique.efemero = payload; },
      followUp: async payload => { clique.aviso = payload; },
    });
    return clique;
  };

  const tela = () => {
    const e = edits.filter(x => x.embeds).at(-1)?.embeds[0].toJSON();
    return { descricao: e?.description, rodape: e?.footer?.text, autor: e?.author?.name };
  };
  const botoes = () => {
    const p = edits.filter(x => x.components?.length).at(-1);
    return (p?.components[0].components ?? []).map(b => ({ id: b.data.custom_id.replace('topplays_', ''), off: !!b.data.disabled }));
  };

  return { edits, respostas, clicar, tela, botoes };
}

test.beforeEach(() => {
  chamadas.best.length = 0; chamadas.fetchPlayer.length = 0;
  jogadorAtual = { id: 7, username: 'kuratani', pp: 1000 };
  lista = plays(12);
  falhar = false;
});

test('uma página só: o 🔄 aparece, com ◀️ e ▶️ apagados', async () => {
  lista = plays(3);
  const { botoes, tela } = await rodar();

  assert.deepEqual(botoes(), [
    { id: 'prev', off: true }, { id: 'refresh', off: false }, { id: 'next', off: true },
  ]);
  assert.match(tela().rodape, /Página 1\/1/);
});

test('refresh recarrega a lista inteira, sem cache, pelo id já conhecido', async () => {
  const { clicar } = await rodar();
  lista = plays(12);

  clicar('refresh'); await sleep(20);

  const busca = chamadas.best.at(-1);
  assert.deepEqual([busca.id, busca.limit, busca.mode, busca.opts?.fresh], [7, 100, 'daycore', true]);
  // Pelo id, e não pelo nome digitado: sobrevive a troca de nick e poupa a consulta.
  assert.equal(chamadas.fetchPlayer.at(-1).username, 7);
  assert.equal(chamadas.fetchPlayer.at(-1).opts?.fresh, true);
});

test('o top mudou de tamanho: número de páginas, footer e posições acompanham', async () => {
  const { clicar, tela, botoes } = await rodar();       // 12 plays → 3 páginas
  assert.match(tela().rodape, /Página 1\/3/);

  lista = plays(7).map(p => ({ ...p, pp: p.pp + 100 }));
  jogadorAtual = { id: 7, username: 'kuratani', pp: 1234 };
  clicar('refresh'); await sleep(20);

  assert.match(tela().rodape, /Página 1\/2/);
  assert.match(tela().descricao, /#1 play1\n\n#2 play2/);
  assert.equal(tela().autor, 'kuratani: 1234pp', 'o pp do autor também é o novo');
  assert.deepEqual(botoes().map(b => b.off), [true, false, false]);
});

test('o top encolheu com a pessoa na última página: presa ao novo limite', async () => {
  const { clicar, tela } = await rodar();               // 12 plays → 3 páginas
  clicar('next'); await sleep(10);
  clicar('next'); await sleep(10);
  assert.match(tela().rodape, /Página 3\/3/);

  lista = plays(6);                                     // 2 páginas
  clicar('refresh'); await sleep(20);

  assert.match(tela().rodape, /Página 2\/2/);
  assert.match(tela().descricao, /#6 play6/);
});

test('encolheu para uma página só: sobra o 🔄', async () => {
  const { clicar, tela, botoes } = await rodar();
  clicar('next'); await sleep(10);

  lista = plays(4);
  clicar('refresh'); await sleep(20);

  assert.match(tela().rodape, /Página 1\/1/);
  assert.deepEqual(botoes().map(b => b.off), [true, false, true]);
});

test('reaplica sort, mods e reverse, e o recorte acompanha', async () => {
  // Cada play de índice par tem HD. Com o filtro, a posição mostrada continua
  // sendo a do top ORIGINAL (a 1ª e a 3ª...), e `reverse` inverte a fatia.
  lista = plays(12, { hd: i => i % 2 === 0 });
  const { clicar, tela } = await rodar({ mods: 'HD', reverse: true });
  assert.match(tela().rodape, /6\/12 plays/);
  assert.match(tela().descricao, /^#11 play11/);

  // Agora só as 3 primeiras são HD, num top de 20.
  lista = plays(20, { hd: i => i < 3 });
  clicar('refresh'); await sleep(20);

  assert.match(tela().rodape, /Página 1\/1 • 3\/20 plays/);
  assert.match(tela().descricao, /^#3 play3\n\n#2 play2\n\n#1 play1$/, 'reverse continua valendo');
});

test('lista vazia no refresh é erro: mantém o embed e avisa', async () => {
  const { clicar, tela, edits, botoes } = await rodar();
  const antes = tela();
  const embedsAntes = edits.filter(e => e.embeds).length;

  lista = [];
  const clique = clicar('refresh'); await sleep(20);

  assert.equal(edits.filter(e => e.embeds).length, embedsAntes);
  assert.deepEqual(tela(), antes);
  assert.match(clique.aviso?.content ?? '', /atualizar o top/);
  assert.equal(botoes().find(b => b.id === 'refresh').off, false, 'o botão volta');

  // E o estado não foi trocado: a próxima página ainda é a do top antigo.
  clicar('next'); await sleep(10);
  assert.match(tela().rodape, /Página 2\/3/);
});

test('nenhuma play passa pelo filtro no refresh: erro, não tela vazia', async () => {
  lista = plays(12, { hd: () => true });
  const { clicar, tela } = await rodar({ mods: 'HD' });
  const antes = tela();

  lista = plays(12);                                    // ninguém mais tem HD
  const clique = clicar('refresh'); await sleep(20);

  assert.deepEqual(tela(), antes);
  assert.ok(clique.aviso);
});

test('falha da API no refresh mantém o embed e avisa', async () => {
  const { clicar, tela } = await rodar();
  const antes = tela();

  falhar = true;
  const clique = clicar('refresh'); await sleep(20);

  assert.deepEqual(tela(), antes);
  assert.match(clique.aviso?.content ?? '', /atualizar o top/);
});

test('refresh de outra pessoa é recusado e não busca', async () => {
  const { clicar } = await rodar();
  const antes = chamadas.best.length;

  const clique = clicar('refresh', 'intruso'); await sleep(20);

  assert.match(clique.efemero?.content ?? '', /Apenas quem usou o comando/);
  assert.equal(chamadas.best.length, antes);
});
