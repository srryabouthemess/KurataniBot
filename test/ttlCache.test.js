/**
 * O cache de TTL + teto, agora numa peça só.
 *
 * Três lugares tinham esta lógica escrita à mão, e as duas armadilhas dela
 * custaram a mesma correção em cada cópia. São elas que este arquivo trava —
 * agora num lugar só, para a próxima cópia não existir.
 */
const test = require('node:test');
const assert = require('node:assert');

const { TtlCache } = require('../src/ttlCache');

test('entrada vencida some na leitura', async () => {
  const cache = new TtlCache({ ttlMs: 40, max: 10 });
  cache.set('a', 1);

  assert.equal(cache.get('a'), 1);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(cache.get('a'), undefined, 'deveria ter vencido');
  assert.equal(cache.size, 0, 'a leitura deveria ter descartado a entrada');
});

test('o teto segura mesmo com tudo dentro do TTL', () => {
  // Armadilha 2: podar só o vencido não contém nada quando nada venceu. Com
  // tráfego para encher a tabela dentro da janela, o Map cresceria sem limite.
  const cache = new TtlCache({ ttlMs: 60_000, max: 100 });

  for (let i = 0; i < 350; i++) cache.set(`k${i}`, i);

  assert.ok(cache.size <= 100, `fechou com ${cache.size} entradas`);
  assert.equal(cache.get('k0'), undefined, 'a mais antiga deveria ter saído');
  assert.equal(cache.get('k349'), 349, 'a mais recente deveria ter ficado');
});

test('chave reusada sobrevive a quem entrou antes dela', () => {
  // Armadilha 1: no Map, reatribuir uma chave existente NÃO muda a posição
  // dela, e é a ordem de inserção que a evicção lê como "mais antigo". Sem o
  // delete antes do set, a chave consultada o tempo todo é descartada como se
  // estivesse fria.
  const cache = new TtlCache({ ttlMs: 60_000, max: 100 });

  cache.set('veterana', 'valor');
  for (let i = 0; i < 90; i++) cache.set(`antiga${i}`, i);

  cache.set('veterana', 'valor');            // reuso, ainda sem estourar o teto
  for (let i = 0; i < 50; i++) cache.set(`nova${i}`, i);  // agora estoura

  assert.equal(cache.get('veterana'), 'valor', 'a chave reaproveitada foi descartada');
  assert.equal(cache.get('antiga0'), undefined, 'a mais antiga sem reuso deveria ter saído');
});

test('has respeita o vencimento, e não só a presença', async () => {
  // O cache negativo de beatmap decide por `has`: se ele ignorasse o TTL, um
  // mapa submetido depois ficaria invisível para sempre.
  const cache = new TtlCache({ ttlMs: 40, max: 10 });
  cache.set('mapa', true);

  assert.equal(cache.has('mapa'), true);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(cache.has('mapa'), false);
});

test('valor falso ainda conta como presente', () => {
  // `get` devolve undefined para ausente, e não null/false — senão guardar
  // `false` (que é justamente o que um cache negativo faria) seria o mesmo que
  // não guardar nada.
  const cache = new TtlCache({ ttlMs: 60_000, max: 10 });

  cache.set('zero', 0);
  cache.set('falso', false);

  assert.equal(cache.get('zero'), 0);
  assert.equal(cache.get('falso'), false);
  assert.equal(cache.has('falso'), true);
});
