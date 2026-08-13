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
function harness(totalPages, buildEmbed) {
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
    });
    return recebido;
  };

  const iniciar = () => paginate(interaction, {
    id: 't', totalPages, buildEmbed, strings: { pagination_not_yours: 'não é sua' },
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
