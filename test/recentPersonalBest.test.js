/**
 * O "PB #N" do /recent: em que posição do top do jogador a play está.
 *
 * Duas coisas são travadas aqui. A primeira é o casamento em si
 * (recentMerge.personalBestAt): pelo ID do score e só por ele, no top da chave
 * DA PLAY — mapa + mods + pp casaria uma play pior com a do top, e o embed
 * afirmaria um PB que não existe. A segunda é o fio no comando, pelo `execute`
 * de verdade: o top sai junto com os recentes (e não depois), e falhar nele
 * não pode derrubar o /recent — sem top, a resposta é a de sempre, sem a marca.
 *
 * osuClient, userLink e o desenho da play são dublês: o que se afirma é o
 * que o comando pede e o que ele passa para o embed.
 */
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

// ─── Dublês ──────────────────────────────────────────────────────────────────

const chamadas = { recent: [], best: [] };
let recentes = {};     // chave → lista que a API "responde" agora
let tops = {};         // chave → top, ou uma Error para rejeitar
let segurar = null;    // quando definido, as buscas esperam esta promise

const esperar = () => (segurar ? segurar : Promise.resolve());

const osuStub = {
  getModeLabel: mode => (mode === 'daycore_rx' ? 'Daycore RX' : 'Daycore'),
  getUser: async () => null,
  getRecentScores: async (id, limit, mode) => {
    chamadas.recent.push({ id, limit, mode });
    await esperar();
    return recentes[mode] ?? [];
  },
  getBestScores: async (id, limit, mode, opts) => {
    chamadas.best.push({ id, limit, mode, opts });
    await esperar();
    const top = tops[mode];
    if (top instanceof Error) throw top;
    return top ?? [];
  },
  enrichScores:      async scores => scores,
  enrichBeatmapData: async scores => scores.map(sc => ({ ...sc, beatmap: { id: sc.map ?? 1 } })),
  getBeatmapFile:    async () => null,
};

const linkStub = {
  resolvePlayer: () => ({ username: 7, mode: 'daycore', ownerId: 'dono' }),
  fetchPlayer: async (resolved, buscar) => ({
    user: { id: 7, username: 'kuratani' },
    scores: await buscar(7),
  }),
};

// O `personalBest` que o comando passou, e ele na tela, para dar para afirmar
// a partir do embed publicado.
let opcoesDoEmbed = null;  // o que o comando passou ao último `single`
const playStub = {
  author: user => ({ name: user.username }),
  single: async (play, opcoes) => { opcoesDoEmbed = opcoes; return desenhar(play, opcoes); },
};

function desenhar(play, { personalBest = null }) {
  return ({
    title: `play ${play.score_id ?? play.id}`,
    url: 'https://example/map',
    color: 0,
    thumbnail: null,
    description: personalBest ? `PB #${personalBest}` : 'sem PB',
    status: null,
    creator: null,
  });
}

for (const [caminho, exports] of [
  ['../src/osuClient', osuStub],
  ['../src/userLink', linkStub],
  ['../src/embeds/play', playStub],
  ['../src/mapContext', { remember: () => {} }],
]) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

const recentMerge = require('../src/recentMerge');
const recent = require('../src/commands/osu/recent');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Silencia o log de erro esperado, e devolve o que teria saído. */
async function calado(fn) {
  const original = console.error;
  const linhas = [];
  console.error = (...parts) => linhas.push(parts.join(' '));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return linhas;
}

/** Roda o /recent e devolve o que foi para a tela e como clicar. */
async function rodar({ modo = null, dono = 'dono' } = {}) {
  const collector = new EventEmitter();
  collector.stop = motivo => collector.emit('end', new Map(), motivo);
  const edits = [];
  const message = { createMessageComponentCollector: () => collector };

  const interaction = {
    user: { id: dono }, guildId: null, locale: 'pt-BR',
    options: { getString: nome => (nome === 'modo' ? modo : null) },
    deferReply: async () => {},
    reply: async payload => { edits.push(payload); },
    editReply: async payload => { edits.push(payload); return message; },
  };

  await recent.execute(interaction);

  const clicar = (customId) => {
    collector.emit('collect', {
      user: { id: dono }, customId: `recent_${customId}`,
      deferUpdate: async () => {},
      reply: async () => {},
      followUp: async () => {},
    });
  };

  const tela = () => {
    const ultimo = edits.filter(x => x?.embeds).at(-1);
    if (!ultimo) return { texto: typeof edits.at(-1) === 'string' ? edits.at(-1) : null };
    const e = ultimo.embeds[0].toJSON();
    return { titulo: e.title, descricao: e.description, rodape: e.footer?.text };
  };

  return { edits, clicar, tela };
}

test.beforeEach(() => {
  chamadas.recent.length = 0;
  chamadas.best.length = 0;
  recentes = {};
  tops = {};
  segurar = null;
  opcoesDoEmbed = null;
});

// ─── scoreIdOf ───────────────────────────────────────────────────────────────

test('scoreIdOf: score_id ou id, sempre em string', () => {
  assert.equal(recentMerge.scoreIdOf({ score_id: 42 }), '42');
  assert.equal(recentMerge.scoreIdOf({ id: '42' }), '42');
  // bancho.py/Ripple/Gatari mandam `score_id`; ele ganha de um `id` que exista.
  assert.equal(recentMerge.scoreIdOf({ score_id: 1, id: 2 }), '1');
  assert.equal(recentMerge.scoreIdOf({}), null);
  assert.equal(recentMerge.scoreIdOf({ score_id: '' }), null);
  assert.equal(recentMerge.scoreIdOf(null), null);
});

// ─── personalBestAt ──────────────────────────────────────────────────────────

test('personalBestAt', async t => {
  const top = [{ score_id: 10 }, { score_id: 11 }, { score_id: 12 }];
  const porModo = new Map([['daycore', top]]);

  await t.test('posição começando em 1', () => {
    assert.equal(recentMerge.personalBestAt({ score_id: 10, _mode: 'daycore' }, porModo), 1);
    assert.equal(recentMerge.personalBestAt({ score_id: 12, _mode: 'daycore' }, porModo), 3);
  });

  await t.test('id em número de um lado e texto do outro é o mesmo score', () => {
    assert.equal(recentMerge.personalBestAt({ score_id: '11', _mode: 'daycore' }, porModo), 2);
  });

  await t.test('fora do top: sem marca', () => {
    assert.equal(recentMerge.personalBestAt({ score_id: 99, _mode: 'daycore' }, porModo), null);
  });

  await t.test('mesmo mapa, mods e pp, mas outro score: sem marca', () => {
    // O caso que casar por mapa + mods + pp erraria: uma play pior no mesmo
    // mapa, com os mesmos mods, não é a play do top.
    const noTop = { score_id: 10, beatmap: { id: 5 }, mods: ['HD'], pp: 300 };
    const agora = { score_id: 77, beatmap: { id: 5 }, mods: ['HD'], pp: 300, _mode: 'daycore' };
    assert.equal(recentMerge.personalBestAt(agora, new Map([['daycore', [noTop]]])), null);
  });

  await t.test('sem id na play: sem marca, em vez de chute', () => {
    assert.equal(recentMerge.personalBestAt({ beatmap: { id: 1 }, _mode: 'daycore' }, porModo), null);
  });

  await t.test('o top é o da chave DA PLAY', () => {
    // Uma play de RX não é procurada no top de VN, ainda que o id apareça lá.
    assert.equal(recentMerge.personalBestAt({ score_id: 10, _mode: 'daycore_rx' }, porModo), null);
    const ambos = new Map([['daycore', top], ['daycore_rx', [{ score_id: 50 }, { score_id: 10 }]]]);
    assert.equal(recentMerge.personalBestAt({ score_id: 10, _mode: 'daycore_rx' }, ambos), 2);
  });

  await t.test('sem top daquela chave: sem marca', () => {
    assert.equal(recentMerge.personalBestAt({ score_id: 10, _mode: 'daycore' }, new Map()), null);
    assert.equal(recentMerge.personalBestAt({ score_id: 10, _mode: 'daycore' }, undefined), null);
  });
});

// ─── fetchTops ───────────────────────────────────────────────────────────────

test('fetchTops', async t => {
  await t.test('todas respondem', async () => {
    const out = await recentMerge.fetchTops(['daycore', 'daycore_rx'], async mode => [{ mode }]);
    assert.deepEqual([...out], [['daycore', [{ mode: 'daycore' }]], ['daycore_rx', [{ mode: 'daycore_rx' }]]]);
  });

  await t.test('uma falha fica de fora, e vai pro log', async () => {
    let out;
    const linhas = await calado(async () => {
      out = await recentMerge.fetchTops(['daycore', 'daycore_rx'], async mode => {
        if (mode === 'daycore_rx') throw new Error('top RX fora do ar');
        return [{ mode }];
      });
    });
    assert.deepEqual([...out.keys()], ['daycore']);
    assert.ok(linhas.some(l => l.includes('top RX fora do ar')));
  });

  await t.test('todas falham: mapa vazio, e NÃO rejeita', async () => {
    let out;
    await calado(async () => {
      out = await recentMerge.fetchTops(['daycore'], async () => { throw new Error('caiu'); });
    });
    assert.equal(out.size, 0);
  });

  await t.test('throw síncrono também não escapa', async () => {
    let out;
    await calado(async () => {
      out = await recentMerge.fetchTops(['daycore'], () => { throw new Error('síncrono'); });
    });
    assert.equal(out.size, 0);
  });
});

// ─── O comando ───────────────────────────────────────────────────────────────

test('play no top: o embed recebe a posição', async () => {
  recentes.daycore = [{ score_id: 3, play_time: '2026-09-30T10:00:00Z' }];
  tops.daycore = [{ score_id: 1 }, { score_id: 2 }, { score_id: 3 }];

  const { tela } = await rodar();

  assert.equal(tela().descricao, 'PB #3');
  // O mesmo pedido do /topplays: mesma chave de cache no getBestScores.
  assert.deepEqual(chamadas.best.map(c => [c.id, c.limit, c.mode]), [[7, 100, 'daycore']]);
});

test('play fora do top: sem marca', async () => {
  recentes.daycore = [{ score_id: 9, play_time: '2026-09-30T10:00:00Z' }];
  tops.daycore = [{ score_id: 1 }];

  const { tela } = await rodar();
  assert.equal(tela().descricao, 'sem PB');
});

test('top e recentes saem juntos, e não um depois do outro', async () => {
  recentes.daycore = [{ score_id: 1, play_time: '2026-09-30T10:00:00Z' }];
  tops.daycore = [{ score_id: 1 }];

  let soltar;
  segurar = new Promise(r => { soltar = r; });
  const rodando = rodar();
  await sleep(10);

  // As duas buscas já partiram enquanto nenhuma respondeu.
  assert.equal(chamadas.recent.length, 1);
  assert.equal(chamadas.best.length, 1);

  soltar();
  const { tela } = await rodando;
  assert.equal(tela().descricao, 'PB #1');
});

test('top falhando não derruba o /recent: responde sem a marca', async () => {
  recentes.daycore = [{ score_id: 1, play_time: '2026-09-30T10:00:00Z' }];
  tops.daycore = new Error('top fora do ar');

  let tela;
  const linhas = await calado(async () => { ({ tela } = await rodar()); });

  assert.equal(tela().titulo, 'play 1');
  assert.equal(tela().descricao, 'sem PB');
  assert.match(tela().rodape, /Play 1\/1/);
  assert.ok(linhas.some(l => l.includes('top fora do ar')), 'a falha do top deveria ter sido logada');
});

test('modo both: cada play é procurada no top do SEU modo', async () => {
  recentes.daycore    = [{ score_id: 1, play_time: '2026-09-30T09:00:00Z' }];
  recentes.daycore_rx = [{ score_id: 2, play_time: '2026-09-30T10:00:00Z' }];
  // O id da play de VN também aparece no top de RX: não pode contar.
  tops.daycore    = [{ score_id: 5 }];
  tops.daycore_rx = [{ score_id: 1 }, { score_id: 2 }];

  const { tela, clicar } = await rodar({ modo: 'both' });
  assert.deepEqual(chamadas.best.map(c => c.mode).sort(), ['daycore', 'daycore_rx']);

  // Página 1 é a de RX (mais recente), #2 no top de RX.
  assert.equal(tela().descricao, 'PB #2');
  clicar('next'); await sleep(20);
  assert.equal(tela().descricao, 'sem PB');
});

test('🔄 busca o top de novo, sem cache, e a marca acompanha', async () => {
  recentes.daycore = [{ score_id: 4, play_time: '2026-09-30T10:00:00Z' }];
  tops.daycore = [{ score_id: 1 }];   // top guardado, de antes da play

  const { tela, clicar } = await rodar();
  assert.equal(tela().descricao, 'sem PB');

  tops.daycore = [{ score_id: 1 }, { score_id: 4 }];
  clicar('refresh'); await sleep(20);

  const busca = chamadas.best.at(-1);
  assert.deepEqual([busca.mode, busca.opts?.fresh], ['daycore', true]);
  assert.equal(tela().descricao, 'PB #2');
});

test('🔄 com o top falhando mantém o top de antes', async () => {
  recentes.daycore = [{ score_id: 4, play_time: '2026-09-30T10:00:00Z' }];
  tops.daycore = [{ score_id: 4 }];

  const { tela, clicar } = await rodar();
  assert.equal(tela().descricao, 'PB #1');

  tops.daycore = new Error('caiu no refresh');
  await calado(async () => { clicar('refresh'); await sleep(20); });

  assert.equal(tela().descricao, 'PB #1');
});

// ─── Layout do /builder ──────────────────────────────────────────────────────

const db = require('../src/db');

test('o layout passado ao embed é o de quem PEDIU, não o do dono das plays', async () => {
  recentes.daycore = [{ score_id: 1, play_time: '2026-09-30T10:00:00Z' }];
  db.setEmbedLayout('quem-pediu', ['pb', 'pp']);
  db.setEmbedLayout('dono', ['hits']);

  await rodar({ dono: 'quem-pediu' });
  assert.deepEqual([...opcoesDoEmbed.layout], ['pb', 'pp']);
});

test('quem nunca usou o /builder passa layout null, o embed completo', async () => {
  recentes.daycore = [{ score_id: 1, play_time: '2026-09-30T10:00:00Z' }];

  await rodar({ dono: 'nunca-usou' });
  assert.equal(opcoesDoEmbed.layout, null);
  assert.equal(chamadas.best.length, 1, 'com o PB ligado o top continua sendo buscado');
});

test('sem a linha do PB, o top não é buscado — nem no 🔄', async () => {
  recentes.daycore = [{ score_id: 3, play_time: '2026-09-30T10:00:00Z' }];
  tops.daycore = [{ score_id: 3 }];
  db.setEmbedLayout('sem-pb', ['pp', 'combo']);

  const { tela, clicar } = await rodar({ dono: 'sem-pb' });
  assert.equal(chamadas.best.length, 0);
  assert.equal(tela().descricao, 'sem PB');

  clicar('refresh'); await sleep(20);
  assert.equal(chamadas.best.length, 0);
  assert.equal(chamadas.recent.length, 2, 'o 🔄 continua buscando a play');
});
