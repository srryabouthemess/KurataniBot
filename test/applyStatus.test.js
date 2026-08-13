/**
 * Publicação de mudança de status: o que saiu, o que confirmou, e o que fazer
 * quando o transporte cai no meio.
 *
 * O canal `rank` age sobre uma dificuldade por mensagem, então um set de 100 são
 * 100 publicações. Se o Redis cair na 31ª, as 30 primeiras JÁ FORAM: o bancho
 * consome por conta própria e vai aplicá-las, independente do que o bot faça
 * depois. Antes a exceção subia até o catch do comando, que respondia "ocorreu
 * um erro" e pulava o registro de auditoria — o servidor mudava e o log do bot
 * não sabia de nada.
 *
 * O outro lado é a fila de nomeação: ela só pode ser descartada quando o set
 * inteiro chegou ao status pedido. Em 09/08 um `0/100 ok` apagou as nomeações
 * sem nada ter sido aplicado.
 */
const test = require('node:test');
const assert = require('node:assert');

// Trocados antes do require do comando: ele resolve os módulos no topo.
const daycorePath = require.resolve('../src/daycoreAdmin');
const daycoreMock = {
  RankedStatus:  { UNRANK: 0, RANK: 2, LOVE: 5 },
  STATUS_LABELS: { 0: 'unranked', 2: 'ranked', 5: 'loved' },
  Privileges:    { NOMINATOR: 2048, ADMINISTRATOR: 8192 },
};
require.cache[daycorePath] = {
  id: daycorePath, filename: daycorePath, loaded: true, exports: daycoreMock,
};

const { applyStatus } = require('../src/commands/nominate');

const RANKED = 2;
const diffs = (...ids) => ids.map(id => ({ id }));

/** rankBeatmap que falha a partir da enésima publicação. */
function publishFailsAt(n, mensagem = 'Redis connection lost') {
  let chamadas = 0;
  return async () => {
    chamadas++;
    if (chamadas >= n) throw new Error(mensagem);
  };
}

test('tudo publicado e confirmado: sem falha, nada pendente', async () => {
  daycoreMock.rankBeatmap = async () => {};
  daycoreMock.verifyMapStatus = async ids => ({ confirmed: [...ids], pending: [] });

  const r = await applyStatus(diffs(1, 2, 3), RANKED);
  assert.deepEqual(r.confirmed, [1, 2, 3]);
  assert.deepEqual(r.pending, []);
  assert.equal(r.failure, null);
  assert.equal(r.total, 3);
});

test('queda no meio: o que saiu é verificado, o resto entra como pendente', async () => {
  // O caso que motivou a mudança: 2 publicadas, a 3ª estoura.
  daycoreMock.rankBeatmap = publishFailsAt(3);
  daycoreMock.verifyMapStatus = async ids => ({ confirmed: [...ids], pending: [] });

  const r = await applyStatus(diffs(1, 2, 3, 4, 5), RANKED);

  assert.deepEqual(r.published, [1, 2], 'só as que saíram antes da falha');
  assert.deepEqual(r.confirmed, [1, 2]);
  // As que nunca foram publicadas não vão mudar sozinhas: são pendentes.
  assert.deepEqual(r.pending.sort(), [3, 4, 5]);
  assert.match(r.failure.message, /Redis connection lost/);
});

test('falha logo na primeira: não chega a verificar nada', async () => {
  daycoreMock.rankBeatmap = publishFailsAt(1);
  let verificou = false;
  daycoreMock.verifyMapStatus = async () => { verificou = true; return { confirmed: [], pending: [] }; };

  const r = await applyStatus(diffs(1, 2), RANKED);

  assert.deepEqual(r.published, []);
  assert.deepEqual(r.confirmed, []);
  assert.deepEqual(r.pending.sort(), [1, 2]);
  assert.equal(verificou, false, 'sem nada publicado, releitura seria requisição à toa');
});

test('publicado mas não confirmado continua pendente, sem falha de transporte', async () => {
  // Bancho não consumiu (o cenário de 08/08 e 09/08). A publicação funcionou;
  // o efeito é que não veio.
  daycoreMock.rankBeatmap = async () => {};
  daycoreMock.verifyMapStatus = async ids => ({ confirmed: [], pending: [...ids] });

  const r = await applyStatus(diffs(1, 2), RANKED);

  assert.deepEqual(r.published, [1, 2]);
  assert.deepEqual(r.confirmed, []);
  assert.deepEqual(r.pending, [1, 2]);
  assert.equal(r.failure, null, 'não houve falha ao publicar — só não confirmou');
});

test('a decisão de limpar a fila é pending.length === 0', async () => {
  // O comando usa exatamente isto. Confirmação parcial precisa manter a fila,
  // senão os votos somem por causa de uma queda transitória.
  daycoreMock.rankBeatmap = async () => {};
  daycoreMock.verifyMapStatus = async ids => ({ confirmed: ids.slice(0, 1), pending: ids.slice(1) });

  const r = await applyStatus(diffs(1, 2, 3), RANKED);
  assert.ok(r.pending.length > 0, 'parcial precisa sobrar pendência para a fila sobreviver');
});
