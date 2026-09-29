/**
 * Cliques concorrentes na paginação.
 *
 * O coletor não espera um handler terminar para entregar o próximo, e montar
 * uma página faz rede e cálculo de PP — então dois cliques seguidos rodam em
 * paralelo, com o lento podendo terminar depois do rápido.
 *
 * O estrago não era a tela desatualizada, era o cursor: o handler que falhava
 * fazia `page = shown` com o valor que ELE tinha visto, desfazendo o avanço de
 * outro clique que havia dado certo. O clique seguinte partia do lugar errado.
 */
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const { paginate } = require('../src/pagination');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Ambiente mínimo: coletor de mentira e um editReply que registra o que saiu. */
function harness(totalPages, buildEmbed, extra = {}) {
  const collector = new EventEmitter();
  const edits = [];
  const message = { createMessageComponentCollector: () => collector };

  const interaction = {
    user: { id: 'dono' },
    editReply: async payload => { edits.push(payload); return message; },
  };

  const clicar = (dir = 'next', userId = 'dono') => {
    const recebido = {};
    collector.emit('collect', {
      user: { id: userId },
      customId: `t_${dir}`,
      deferUpdate: async () => {},
      reply: async payload => { recebido.efemero = payload; },
      followUp: async payload => { recebido.aviso = payload; },
    });
    return recebido;
  };

  const iniciar = () => paginate(interaction, {
    id: 't', totalPages, buildEmbed, ...extra,
    strings: { pagination_not_yours: 'não é sua', pagination_refresh_error: 'essa play' },
  });

  /** Página do último embed que chegou à tela. */
  const naTela = () => {
    for (let i = edits.length - 1; i >= 0; i--) {
      if (edits[i].embeds) return edits[i].embeds[0].page;
    }
    return null;
  };

  return { iniciar, clicar, naTela, edits };
}

test('página lenta que falha não desfaz o avanço de um clique posterior', async () => {
  // A página 1 demora e estoura; as outras respondem na hora. É o caso real: a
  // dificuldade nova precisa baixar o .osu, a já vista está em cache.
  const buildEmbed = async page => {
    if (page === 1) { await sleep(40); throw new Error('falha ao montar a página 1'); }
    return { page };
  };

  const h = harness(5, buildEmbed);
  await h.iniciar();

  h.clicar();          // 0 → 1, vai falhar devagar
  await sleep(5);
  h.clicar();          // 1 → 2, dá certo antes
  await sleep(80);     // deixa a falha da página 1 acontecer

  assert.equal(h.naTela(), 2, 'a tela deve ficar na página que deu certo');

  // O que o bug estragava: o cursor. Se a falha tivesse revertido para 0, este
  // clique mostraria a 1 em vez da 3.
  h.clicar();
  await sleep(30);
  assert.equal(h.naTela(), 3, 'o clique seguinte parte da página que está na tela');
});

test('falha isolada ainda reverte o cursor', async () => {
  // Sem clique concorrente, o comportamento antigo continua valendo: a página
  // que nunca chegou à tela não pode virar o ponto de partida do próximo clique.
  let falhar = true;
  const buildEmbed = async page => {
    if (page === 1 && falhar) throw new Error('primeira tentativa falha');
    return { page };
  };

  const h = harness(5, buildEmbed);
  await h.iniciar();

  h.clicar();
  await sleep(30);
  assert.equal(h.naTela(), 0, 'a página que falhou não chegou à tela');

  falhar = false;
  h.clicar();
  await sleep(30);
  assert.equal(h.naTela(), 1, 'o cursor voltou para 0, então o próximo next é a 1');
});

test('navegação normal continua andando', async () => {
  const h = harness(4, async page => ({ page }));
  await h.iniciar();

  h.clicar('next'); await sleep(10);
  h.clicar('next'); await sleep(10);
  assert.equal(h.naTela(), 2);

  h.clicar('prev'); await sleep(10);
  assert.equal(h.naTela(), 1);
});

test('clique de outra pessoa é recusado e não navega', async () => {
  const h = harness(4, async page => ({ page }));
  await h.iniciar();

  const intruso = h.clicar('next', 'intruso');
  await sleep(20);

  assert.match(intruso.efemero?.content ?? '', /não é sua/);
  assert.equal(h.naTela(), 0, 'a página não pode ter mudado');
});

test('comando superado (mensagem editada) larga os botões sem apagá-los', async () => {
  // No modo texto, editar o comando roda ele de novo NA MESMA resposta. Os
  // botões na tela passam a ser da execução nova: o coletor antigo tem que
  // parar, e sem o `editReply({ components: [] })` do fim normal — que
  // apagaria justamente os botões novos.
  const collector = new EventEmitter();
  collector.stop = (motivo) => collector.emit('end', new Map(), motivo);

  let superar = null;
  const edits = [];
  const message = { createMessageComponentCollector: () => collector };
  const interaction = {
    user: { id: 'dono' },
    editReply: async payload => { edits.push(payload); return message; },
    onSuperseded: fn => { superar = fn; },
  };

  await paginate(interaction, { id: 't', totalPages: 3, buildEmbed: async page => ({ page }), strings: {} });
  assert.equal(typeof superar, 'function', 'a paginação precisa se inscrever');

  let parou = null;
  collector.on('end', (_c, motivo) => { parou = motivo; });
  const antes = edits.length;
  superar();
  await sleep(5);

  assert.equal(parou, 'superseded');
  assert.equal(edits.length, antes, 'nada de limpar os botões da execução nova');
});

// ─── Botão 🔄 ────────────────────────────────────────────────────────────────

/** Os botões de um payload, como `{ id, off }` — ◀️ 🔄 ▶️ na ordem da tela. */
const botoes = payload => (payload?.components?.[0]?.components ?? [])
  .map(b => ({ id: b.data.custom_id, off: !!b.data.disabled }));

/** Os botões da última edição que trouxe a linha de componentes. */
const botoesNaTela = edits => {
  for (let i = edits.length - 1; i >= 0; i--) {
    if (edits[i].components?.length) return botoes(edits[i]);
  }
  return [];
};

test('com refresh, o botão aparece mesmo com uma página só', async () => {
  const h = harness(1, async page => ({ page }), { onRefresh: async () => {} });
  await h.iniciar();

  assert.deepEqual(botoes(h.edits[0]), [
    { id: 't_prev', off: true },
    { id: 't_refresh', off: false },
    { id: 't_next', off: true },
  ]);
});

test('sem refresh, uma página só continua sem botões', async () => {
  const h = harness(1, async page => ({ page }));
  await h.iniciar();

  assert.deepEqual(h.edits[0].components, []);
});

test('refresh que só renova a página atual invalida só ela no cache', async () => {
  // É o contrato do /rs: onRefresh não devolve nada, e as outras páginas —
  // que não mudaram — não podem ser refeitas.
  const montadas = [];
  const buildEmbed = async page => { montadas.push(page); return { page }; };

  const h = harness(3, buildEmbed, { onRefresh: async () => {} });
  await h.iniciar();
  h.clicar('next'); await sleep(10);
  h.clicar('prev'); await sleep(10);
  assert.deepEqual(montadas, [0, 1], 'voltar à 0 vem do cache');

  h.clicar('next'); await sleep(10);   // na página 1 (do cache)
  h.clicar('refresh'); await sleep(10);
  assert.deepEqual(montadas, [0, 1, 1], 'só a página 1 foi refeita');

  h.clicar('prev'); await sleep(10);
  assert.deepEqual(montadas, [0, 1, 1], 'a página 0 continua em cache');
  assert.equal(h.naTela(), 0);
});

test('recarga completa descarta o cache inteiro e prende a página no novo limite', async () => {
  // O top encolheu de 5 para 2 páginas com a pessoa na 4ª (índice 3): a página
  // não existe mais, e a tela tem que cair na última que existe.
  let total = 5;
  const montadas = [];
  const buildEmbed = async page => { montadas.push(page); return { page, total }; };

  const h = harness(5, buildEmbed, {
    onRefresh: async () => { total = 2; return { totalPages: 2 }; },
  });
  await h.iniciar();

  for (let i = 0; i < 3; i++) { h.clicar('next'); await sleep(10); }
  assert.equal(h.naTela(), 3);

  h.clicar('refresh'); await sleep(20);

  assert.equal(h.naTela(), 1, 'presa à última página do top novo');
  assert.equal(montadas.at(-1), 1);
  const ultimo = h.edits.filter(e => e.embeds).at(-1).embeds[0];
  assert.equal(ultimo.total, 2, 'a tela mostra o dado novo');
  assert.deepEqual(botoesNaTela(h.edits), [
    { id: 't_prev', off: false },
    { id: 't_refresh', off: false },
    { id: 't_next', off: true },
  ], '▶️ apagado: 1 é a última página agora');

  // Nenhuma página antiga sobreviveu: a 0 é refeita, não servida do cache.
  const antes = montadas.length;
  h.clicar('prev'); await sleep(10);
  assert.equal(h.naTela(), 0);
  assert.equal(montadas.length, antes + 1, 'a página 0 foi montada de novo');
});

test('recarga completa que cresce libera o ▶️', async () => {
  let total = 1;
  const h = harness(1, async page => ({ page, total }), {
    onRefresh: async () => { total = 3; return { totalPages: 3 }; },
  });
  await h.iniciar();

  h.clicar('refresh'); await sleep(20);
  assert.deepEqual(botoesNaTela(h.edits).map(b => b.off), [true, false, false]);

  h.clicar('next'); await sleep(10);
  assert.equal(h.naTela(), 1);
});

test('recarga completa que encolhe para uma página deixa só o 🔄 ativo', async () => {
  const h = harness(3, async page => ({ page }), {
    onRefresh: async () => ({ totalPages: 1 }),
  });
  await h.iniciar();
  h.clicar('next'); await sleep(10);

  h.clicar('refresh'); await sleep(20);
  assert.equal(h.naTela(), 0);
  assert.deepEqual(botoesNaTela(h.edits).map(b => b.off), [true, false, true]);
});

test('refresh que falha mantém o embed e avisa em efêmero', async () => {
  const h = harness(3, async page => ({ page }), {
    onRefresh: async () => { throw new Error('API caiu'); },
    refreshError: 'não deu pro top',
  });
  await h.iniciar();
  h.clicar('next'); await sleep(10);
  const embedsAntes = h.edits.filter(e => e.embeds).length;

  const clique = h.clicar('refresh'); await sleep(20);

  assert.equal(h.edits.filter(e => e.embeds).length, embedsAntes, 'nenhum embed novo');
  assert.equal(h.naTela(), 1);
  assert.equal(clique.aviso?.content, 'não deu pro top', 'o aviso do comando, e não o da play');
  assert.equal(botoesNaTela(h.edits).find(b => b.id === 't_refresh').off, false, 'o botão volta');
});

test('sem refreshError, o aviso é o padrão da play (o /rs não muda)', async () => {
  const h = harness(3, async page => ({ page }), {
    onRefresh: async () => { throw new Error('API caiu'); },
  });
  await h.iniciar();

  const clique = h.clicar('refresh'); await sleep(20);
  assert.equal(clique.aviso?.content, 'essa play');
});

test('recarga inválida (totalPages 0) é erro, não tela vazia', async () => {
  const h = harness(3, async page => ({ page }), {
    onRefresh: async () => ({ totalPages: 0 }),
  });
  await h.iniciar();
  const embedsAntes = h.edits.filter(e => e.embeds).length;

  const clique = h.clicar('refresh'); await sleep(20);

  assert.equal(h.edits.filter(e => e.embeds).length, embedsAntes);
  assert.ok(clique.aviso, 'a pessoa é avisada');
  assert.equal(h.naTela(), 0);
});

test('refresh de outra pessoa é recusado e não busca nada', async () => {
  let buscas = 0;
  const h = harness(1, async page => ({ page }), { onRefresh: async () => { buscas++; } });
  await h.iniciar();

  const intruso = h.clicar('refresh', 'intruso'); await sleep(20);

  assert.match(intruso.efemero?.content ?? '', /não é sua/);
  assert.equal(buscas, 0);
});

test('clique de spam no 🔄 não empilha buscas', async () => {
  let buscas = 0;
  const h = harness(1, async page => ({ page }), {
    onRefresh: async () => { buscas++; await sleep(30); },
  });
  await h.iniciar();

  h.clicar('refresh');
  await sleep(5);
  assert.equal(botoesNaTela(h.edits).find(b => b.id === 't_refresh').off, true, 'apagado durante a busca');

  h.clicar('refresh'); h.clicar('refresh');
  await sleep(60);

  assert.equal(buscas, 1);
  assert.equal(botoesNaTela(h.edits).find(b => b.id === 't_refresh').off, false);
});

test('navegar durante uma recarga completa não deixa página velha nem fora do limite', async () => {
  // A pessoa clica ▶️ enquanto o refresh busca. A página que ela pediu estava
  // sendo montada com a lista ANTIGA (5 páginas); quando a recarga termina, o
  // top tem 2. Nada da lista velha pode ficar em cache nem na tela.
  let total = 5;
  const montadas = [];
  const buildEmbed = async page => {
    montadas.push(`${page}@${total}`);
    const daquiPraTras = total;
    await sleep(page === 3 ? 30 : 0);
    return { page, total: daquiPraTras };
  };

  const h = harness(5, buildEmbed, {
    onRefresh: async () => { await sleep(10); total = 2; return { totalPages: 2 }; },
  });
  await h.iniciar();
  for (let i = 0; i < 2; i++) { h.clicar('next'); await sleep(10); }   // página 2

  h.clicar('next');           // 2 → 3, lenta, montada com a lista antiga
  h.clicar('refresh');        // recarga: top de 2 páginas
  await sleep(120);

  assert.equal(h.naTela(), 1, 'presa ao limite novo');
  const ultimo = h.edits.filter(e => e.embeds).at(-1).embeds[0];
  assert.equal(ultimo.total, 2, 'a tela não ficou com a lista antiga');
});
