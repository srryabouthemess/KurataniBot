/**
 * Os dois caches em memória: teto de verdade e chave que serve as duas pontas.
 *
 * Ambos podavam só o que tinha EXPIRADO ao passar do teto. Com tráfego para
 * encher a tabela dentro da janela do TTL, tudo está fresco, nada é descartado
 * e o Map cresce sem limite — a condição volta a ser verdadeira na inserção
 * seguinte, e assim por diante. É invisível num bot pequeno e é vazamento num
 * bot grande, que é justamente o caso de quem hospeda isto para muita gente.
 */
const test = require('node:test');
const assert = require('node:assert');

const officialApi = require('../src/osu/officialApi');
const osu = require('../src/osuClient');
// O mapContext é carregado por caso, em instância limpa (ver freshMapContext).

// ─── Cache de usuário: nome e ID são a mesma pessoa ───────────────────────────

test('consultar por nome e por ID gasta uma chamada só', async () => {
  // O userLink manda o osu_id quando o link tem; quem digita o comando manda o
  // nome. Antes, a entrada indexada por ID era escrita e nunca lida.
  let chamadas = 0;
  const original = officialApi.fetchUser;
  officialApi.fetchUser = async () => {
    chamadas++;
    return { id: 987654, username: 'Fulano' };
  };

  try {
    const porNome = await osu.getUser('Fulano', 'official');
    const porId   = await osu.getUser(987654, 'official');
    const outraGrafia = await osu.getUser('FULANO', 'official');

    assert.equal(porNome.id, 987654);
    assert.equal(porId.id, 987654);
    assert.equal(outraGrafia.id, 987654);
    assert.equal(chamadas, 1, 'a consulta por ID deveria ter vindo do cache');
  } finally {
    officialApi.fetchUser = original;
  }
});

// ─── Cache negativo: mapa que a API oficial não conhece ───────────────────────

/** Faz o officialGet falhar com o status pedido, contando as chamadas. */
async function comFalha(status, fn) {
  let chamadas = 0;
  const original = officialApi.officialGet;
  const originalErro = console.error;

  officialApi.officialGet = async () => {
    chamadas++;
    throw Object.assign(new Error(`falha ${status}`), { response: { status } });
  };
  console.error = () => {};

  try {
    await fn();
  } finally {
    officialApi.officialGet = original;
    console.error = originalErro;
  }
  return chamadas;
}

test('mapa que a API não conhece não é pedido de novo', async () => {
  // Sem cache negativo, o `precisaEnriquecer` continua verdadeiro para aquele
  // score para sempre: cada renderização gastava balde do rate limiter para
  // receber o mesmo 404. É o caso do mapa exclusivo de servidor privado.
  const id = 900000001;

  const chamadas = await comFalha(404, async () => {
    assert.equal(await osu.getBeatmap(id), null);
    assert.equal(await osu.getBeatmap(id), null);
    assert.equal(await osu.getBeatmap(id), null);
  });

  assert.equal(chamadas, 1, 'o 404 deveria ter ficado em cache');
});

test('falha passageira não vira cache negativo', async () => {
  // Um 5xx ou uma queda de rede passam em segundos. Guardá-los faria um blip
  // esconder o mapa por dez minutos — trocando uma falha visível por dados
  // faltando no embed, que é bem pior de diagnosticar.
  const id = 900000002;

  const chamadas = await comFalha(502, async () => {
    await osu.getBeatmap(id);
    await osu.getBeatmap(id);
  });

  assert.equal(chamadas, 2, 'o 502 não deveria ter sido guardado');
});

// ─── Contexto de mapa: o teto precisa segurar ─────────────────────────────────

const fakeInteraction = channelId => ({ channelId });
const MAX_CHANNELS = 1000;  // igual ao mapContext.js

/**
 * Instância limpa a cada caso: o Map é estado de módulo, e um teste que
 * enchesse o teto deixaria o seguinte partindo de um lugar imprevisível.
 */
function freshMapContext() {
  delete require.cache[require.resolve('../src/mapContext')];
  return require('../src/mapContext');
}

test('o teto de canais segura mesmo com tudo dentro do TTL', async () => {
  const ctx = freshMapContext();

  // Todos registrados agora: nenhum expirou, então só a evicção por excesso
  // pode conter o crescimento. Sem ela o Map fecharia com 1200 entradas.
  for (let i = 0; i < MAX_CHANNELS + 200; i++) {
    ctx.remember(fakeInteraction(`canal_${i}`), 100 + i, 'official');
  }

  // O mais antigo saiu...
  assert.equal(await ctx.recall(fakeInteraction('canal_0')), null);
  // ...e o mais recente continua lá.
  const recente = await ctx.recall(fakeInteraction(`canal_${MAX_CHANNELS + 199}`));
  assert.equal(recente?.mapId, 100 + MAX_CHANNELS + 199);
});

test('canal usado de novo sobrevive a quem foi inserido antes dele', async () => {
  const ctx = freshMapContext();
  const veterano = 'canal_veterano';

  // 1) O veterano entra primeiro — é o mais antigo de todos.
  ctx.remember(fakeInteraction(veterano), 555, 'official');

  // 2) 900 canais depois dele, ainda sem estourar o teto.
  for (let i = 0; i < 900; i++) {
    ctx.remember(fakeInteraction(`antigo_${i}`), 200 + i, 'official');
  }

  // 3) O veterano reaparece. É aqui que o `delete` antes do `set` conta: sem
  //    ele, o canal continuaria na posição da PRIMEIRA inserção e seria o
  //    primeiro a ser descartado, apesar de ser o mais recentemente usado.
  ctx.remember(fakeInteraction(veterano), 555, 'official');

  // 4) Mais 200 estouram o teto, e a evicção precisa comer os `antigo_*`.
  for (let i = 0; i < 200; i++) {
    ctx.remember(fakeInteraction(`novo_${i}`), 300 + i, 'official');
  }

  const sobrevivente = await ctx.recall(fakeInteraction(veterano));
  assert.equal(sobrevivente?.mapId, 555, 'o canal reaproveitado foi descartado');
  assert.equal(
    await ctx.recall(fakeInteraction('antigo_0')), null,
    'o mais antigo sem reuso deveria ter saído',
  );
});
