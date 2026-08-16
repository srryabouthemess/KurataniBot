/**
 * Fallback de espelho no download do `.osu`.
 *
 * O que se protege aqui não é o caminho feliz — é o que acontece quando o osu!
 * não responde. Isso é raro por definição, então ninguém percebe se quebrar: o
 * dia em que o fallback for necessário é justamente o dia em que não dá para
 * descobrir que ele parou de funcionar.
 *
 * Três coisas em particular:
 *
 *   1. enquanto o osu! responde, os espelhos NÃO são tocados (a fonte é a fonte);
 *   2. corpo vazio conta como falha daquele host, e não como resposta;
 *   3. todo host declarado tem balde no rate limiter — sem isso o `acquire`
 *      lança, e lança no pior momento possível, que é durante a queda.
 *
 * Sem rede e sem banco: axios, db e rateLimiter entram por require.cache, como
 * em limiterPorHost.test.js.
 */
const test = require('node:test');
const assert = require('node:assert');

// O rate limiter de verdade, carregado ANTES do stub: o teste usa os baldes
// reais dele para conferir que cada host tem o seu (ver item 3 acima).
const limiterReal = require('../src/rateLimiter');

const metrics = require('../src/metrics');

/** Estado que cada teste arma antes de chamar. */
let responder = null;
const pedidos = [];   // URLs pedidas, na ordem
const baldes  = [];   // baldes do rate limiter, na ordem
const salvos  = [];   // [mapId, bytes] escritos no cache em disco

const stubs = {
  axios: {
    get: async (url) => {
      pedidos.push(url);
      return responder(url);
    },
  },
  '../src/db': {
    getBeatmapFile: () => null,   // cache sempre frio: o assunto aqui é o download
    setBeatmapFile: (mapId, bytes) => { salvos.push([mapId, bytes]); },
  },
  '../src/rateLimiter': {
    acquire: async (nome) => {
      // O balde tem de existir no limiter REAL. Um host novo sem balde só
      // falharia em produção, no meio de uma queda do osu!.
      if (!(nome in limiterReal.BUCKETS)) {
        throw new Error(`rateLimiter: bucket desconhecido "${nome}"`);
      }
      baldes.push(nome);
    },
    BUCKETS: limiterReal.BUCKETS,
  },
};

for (const [caminho, exports] of Object.entries(stubs)) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

const { getBeatmapFile, HOSTS } = require('../src/beatmapFile');

const BYTES = new Uint8Array([111, 115, 117, 33]); // "osu!"

/** Uma resposta de download bem-sucedida, no formato que o axios devolve. */
const ok = (bytes = BYTES) => ({ data: Buffer.from(bytes) });

/** O erro que o axios lança num status de falha. */
function erroHttp(status) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status };
  return error;
}

/** Roteia por trecho da URL: `{ 'osu.ppy.sh': ..., 'catboy': ... }`. */
function rotas(mapa) {
  return (url) => {
    for (const [trecho, resposta] of Object.entries(mapa)) {
      if (url.includes(trecho)) {
        if (resposta instanceof Error) throw resposta;
        return typeof resposta === 'function' ? resposta() : resposta;
      }
    }
    throw new Error(`URL sem rota no teste: ${url}`);
  };
}

test.beforeEach(() => {
  pedidos.length = 0;
  baldes.length  = 0;
  salvos.length  = 0;
  responder = null;
});

// ─── A ordem ──────────────────────────────────────────────────────────────────

test('o osu! é o primeiro host, e é dele que o arquivo vem quando ele responde', async () => {
  responder = rotas({ 'osu.ppy.sh': ok() });

  const bytes = await getBeatmapFile(1);

  assert.deepStrictEqual([...bytes], [...BYTES]);
  // Um pedido só: enquanto a fonte responde, espelho nenhum é tocado.
  assert.strictEqual(pedidos.length, 1);
  assert.match(pedidos[0], /^https:\/\/osu\.ppy\.sh\/osu\/1$/);
  assert.deepStrictEqual(baldes, ['osuMapFile']);
  assert.deepStrictEqual(salvos, [[1, bytes]]);
});

test('cada host declarado tem balde próprio no rate limiter', () => {
  const nomes = HOSTS.map(h => h.bucket);

  for (const nome of nomes) {
    assert.ok(nome in limiterReal.BUCKETS, `host sem balde no rateLimiter: ${nome}`);
  }
  // Próprio, e não compartilhado: são máquinas diferentes, e a fila de uma não
  // deve segurar a da outra.
  assert.strictEqual(new Set(nomes).size, nomes.length, 'dois hosts dividindo o mesmo balde');
});

// ─── A queda ──────────────────────────────────────────────────────────────────

test('osu! fora, o espelho entrega — e o contador registra que ele salvou', async () => {
  responder = rotas({ 'osu.ppy.sh': erroHttp(503), 'catboy': ok() });

  const antes = metrics.get('mapFile.espelhoSalvou');
  const bytes = await getBeatmapFile(2);

  assert.deepStrictEqual([...bytes], [...BYTES]);
  assert.strictEqual(metrics.get('mapFile.espelhoSalvou'), antes + 1);
  // O último pedido é do espelho, e o arquivo foi para o cache do mesmo jeito:
  // quem chamou não fica sabendo de onde veio.
  assert.match(pedidos.at(-1), /catboy\.best\/osu\/2$/);
  assert.deepStrictEqual(salvos, [[2, bytes]]);
  assert.strictEqual(baldes.at(-1), 'mapFileCatboy');
});

test('corpo vazio é falha do host, não resposta — e não vira cinco esperas', async () => {
  // 200 com corpo vazio é o que o osu! responde para mapa que ele não tem
  // (medido no id 2087304). Antes, isso rendia cinco retentativas no mesmo
  // endereço; agora custa duas e passa adiante.
  responder = rotas({ 'osu.ppy.sh': () => ok(new Uint8Array(0)), 'catboy': ok() });

  const bytes = await getBeatmapFile(3);

  assert.deepStrictEqual([...bytes], [...BYTES]);
  const noOsu = pedidos.filter(u => u.includes('osu.ppy.sh'));
  assert.strictEqual(noOsu.length, 2, 'o osu! deveria ter sido tentado duas vezes, não mais');
});

test('espelho fora também cai para o próximo', async () => {
  responder = rotas({
    'osu.ppy.sh': erroHttp(500),
    'catboy':     erroHttp(502),
    'osu.direct': ok(),
  });

  const bytes = await getBeatmapFile(4);

  assert.deepStrictEqual([...bytes], [...BYTES]);
  assert.deepStrictEqual(
    [...new Set(baldes)],
    ['osuMapFile', 'mapFileCatboy', 'mapFileOsuDirect'],
    'os três hosts deveriam ter sido tentados, nessa ordem',
  );
});

// ─── Quando não há de onde tirar ──────────────────────────────────────────────

test('com os três fora, o erro diz o que cada um respondeu', async () => {
  responder = rotas({
    'osu.ppy.sh': erroHttp(404),
    'catboy':     erroHttp(404),
    'osu.direct': erroHttp(404),
  });

  await assert.rejects(
    () => getBeatmapFile(5),
    (erro) => {
      // A mensagem é o que vai para o log: sem os três motivos, "falhou" não
      // distingue mapa inexistente (404 em todos) de rede daqui (timeouts).
      for (const host of HOSTS) {
        assert.ok(erro.message.includes(host.nome), `faltou o host ${host.nome}: ${erro.message}`);
      }
      assert.ok(erro.message.includes('HTTP 404'), erro.message);
      assert.ok(erro.message.includes('5'), 'o id do mapa deveria estar na mensagem');
      // A causa é a falha da fonte, que é a pilha que costuma explicar o resto.
      assert.strictEqual(erro.cause?.response?.status, 404);
      return true;
    },
  );

  // Nada foi para o cache: um mapa sem arquivo não pode virar arquivo vazio em
  // disco, ou o erro passaria a ser servido pelo cache sem nem tentar a rede.
  assert.deepStrictEqual(salvos, []);
});
