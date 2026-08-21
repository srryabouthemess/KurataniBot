/**
 * O /compare com um servidor de cada lado.
 *
 * O comando resolvia UM servidor e usava ele nas duas chamadas de perfil, então
 * "kuratani no Bancho contra ckz no Akatsuki" não tinha como ser escrito. Agora
 * são duas resoluções, e o que este arquivo guarda é a herança entre elas: com
 * `server2:` vazio o segundo lado tem que ser EXATAMENTE o primeiro.
 *
 * É a parte que erra em silêncio. Uma herança errada não estoura nada — sai um
 * embed plausível, com o segundo jogador buscado no servidor errado, e quem lê
 * só estranha o pp.
 */
const test = require('node:test');
const assert = require('node:assert');

let servidorSalvo = null;
let modoSalvo     = null;
let links         = {};

// Trocado ANTES de carregar o userLink e o comando: os dois resolvem o db no
// require do topo (mesmo padrão de preferredModo.test.js).
{
  const resolvido = require.resolve('../src/db');
  require.cache[resolvido] = {
    id: resolvido,
    filename: resolvido,
    loaded: true,
    exports: {
      getLink:            (_id, chave) => links[chave] ?? null,
      getPreferredServer: () => servidorSalvo,
      getPreferredModo:   () => modoSalvo,
      getUserLang:        () => 'en',
      getServerLang:      () => null,
    },
  };
}

const { resolveServer, resolveSecondServer } = require('../src/userLink');
const compare = require('../src/commands/compare');
const servers = require('../src/servers');
const osu = require('../src/osuClient');

/** Uma interação com as opções que o comando declarou, e nada além. */
function interacao(opcoes = {}) {
  return {
    user:    { id: 'u1', username: 'lucas' },
    guildId: null,
    options: { getString: nome => opcoes[nome] ?? null },
  };
}

/** As duas chaves que o comando vai usar, dado o que foi digitado e o salvo. */
function ladosDe(opcoes = {}, { servidor = null, modo = null } = {}) {
  servidorSalvo = servidor;
  modoSalvo     = modo;
  const um = resolveServer(interacao(opcoes));
  return [um, resolveSecondServer(interacao(opcoes), um)];
}

test('o segundo lado herda o primeiro quando nada foi dito', async t => {
  await t.test('sem server2 nem modo2, as duas chaves são a mesma', () => {
    assert.deepEqual(ladosDe({ server: 'akatsuki' }), ['akatsuki', 'akatsuki']);
  });

  await t.test('a herança é do PRIMEIRO LADO, não da preferência salva', () => {
    // O buraco que a herança fecha: passar o segundo lado pelo resolveServer
    // daria a prioridade dele (`opção || preferência || padrão`), e aí um
    // `server:` explícito valeria só para o user1 — dois jogadores do mesmo
    // servidor virariam comparação cruzada sem ninguém ter pedido.
    assert.deepEqual(
      ladosDe({ server: 'akatsuki' }, { servidor: 'daycore' }),
      ['akatsuki', 'akatsuki'],
    );
  });

  await t.test('o _rx da chave salva sobrevive à herança', () => {
    // Quem tem `daycore_rx` salvo sem preferência de modo nenhuma: refazer a
    // conta no segundo lado perderia o sufixo (ver modo.apply com modo nulo) e
    // compararia o RX de um com o vanilla do outro.
    assert.deepEqual(ladosDe({}, { servidor: 'daycore_rx' }), ['daycore_rx', 'daycore_rx']);
  });
});

test('o segundo lado quando alguma opção dele foi dita', async t => {
  await t.test('server2 troca só o segundo', () => {
    assert.deepEqual(
      ladosDe({ server: 'official', server2: 'akatsuki' }),
      ['official', 'akatsuki'],
    );
  });

  await t.test('o modo do primeiro lado acompanha o server2', () => {
    // `modo:` sem `modo2:` vale para os dois: quem joga Relax compara RX com RX
    // sem repetir a opção.
    assert.deepEqual(
      ladosDe({ server: 'daycore', modo: 'rx', server2: 'akatsuki' }),
      ['daycore_rx', 'akatsuki_rx'],
    );
  });

  await t.test('modo2 vence o modo herdado', () => {
    assert.deepEqual(
      ladosDe({ server: 'daycore', modo: 'rx', server2: 'akatsuki', modo2: 'vn' }),
      ['daycore_rx', 'akatsuki'],
    );
  });

  await t.test('modo2 sozinho compara VN com RX no mesmo servidor', () => {
    assert.deepEqual(ladosDe({ server: 'daycore', modo2: 'rx' }), ['daycore', 'daycore_rx']);
  });

  await t.test('a preferência de modo alcança os dois lados', () => {
    assert.deepEqual(
      ladosDe({ server2: 'daycore' }, { servidor: 'akatsuki', modo: 'rx' }),
      ['akatsuki_rx', 'daycore_rx'],
    );
  });
});

// ─── O comando inteiro ───────────────────────────────────────────────────────

const PERFIS = {
  official: {
    id: 1, username: 'kuratani', avatar_url: 'https://a.ppy.sh/1',
    statistics: {
      global_rank: 12345, pp: 4321.5, hit_accuracy: 98.12,
      level: { current: 99 }, maximum_combo: 1234, play_count: 5678,
    },
  },
  akatsuki: {
    id: 2, username: 'ckz', avatar_url: 'https://a.akatsuki.gg/2',
    statistics: {
      global_rank: 777, pp: 9876.5, hit_accuracy: 99.01,
      level: { current: 100 }, maximum_combo: 2345, play_count: 6789,
    },
  },
};

/** Roda o /compare de verdade e devolve o que ele respondeu. */
async function roda(opcoes, { servidor = null, modo = null, comLinks = {} } = {}) {
  servidorSalvo = servidor;
  modoSalvo     = modo;
  links         = comLinks;

  const pedidos = [];
  const original = osu.getUser;
  osu.getUser = async (nome, chave) => {
    pedidos.push({ nome: String(nome), chave });
    return PERFIS[servers.rootKey(chave)] ?? PERFIS.official;
  };

  let resposta = null;
  const interaction = {
    ...interacao(opcoes),
    deferReply: async () => {},
    reply:      async payload => { resposta = payload; },
    editReply:  async payload => { resposta = payload; },
  };

  try {
    await compare.execute(interaction);
  } finally {
    osu.getUser = original;
  }

  return { resposta, pedidos };
}

test('cada jogador é buscado no seu servidor', async () => {
  const { pedidos } = await roda({ user1: 'kuratani', user2: 'ckz', server: 'official', server2: 'akatsuki' });
  assert.deepEqual(pedidos, [
    { nome: 'kuratani', chave: 'official' },
    { nome: 'ckz',      chave: 'akatsuki' },
  ]);
});

test('user2 vazio numa cruzada cai no link do autor naquele servidor', async () => {
  // O caso de uso mais direto do comando cruzado: comparar a pessoa com ela
  // mesma nos dois servidores, sem digitar nick nenhum.
  const { pedidos } = await roda(
    { server: 'official', server2: 'akatsuki' },
    { comLinks: {
      official: { osu_id: 1, osu_user: 'kuratani' },
      akatsuki: { osu_id: 2, osu_user: 'kuratani' },
    } },
  );

  assert.deepEqual(pedidos, [
    { nome: '1', chave: 'official' },
    { nome: '2', chave: 'akatsuki' },
  ]);
});

test('sem link no segundo servidor, a mensagem nomeia o servidor', async () => {
  // E não o pedido genérico de nick: o que falta é o `/link set` lá, e mandar
  // digitar um nick não diz isso.
  const { resposta, pedidos } = await roda(
    { server: 'official', server2: 'akatsuki' },
    { comLinks: { official: { osu_id: 1, osu_user: 'kuratani' } } },
  );

  assert.equal(pedidos.length, 0);
  assert.match(resposta.content, /Akatsuki/);
});

test('no mesmo servidor, user2 vazio continua pedindo o segundo jogador', async () => {
  // Aqui o fallback não existe de propósito: compararia o autor com o autor.
  const { resposta, pedidos } = await roda(
    { server: 'official' },
    { comLinks: { official: { osu_id: 1, osu_user: 'kuratani' } } },
  );

  assert.equal(pedidos.length, 0);
  assert.match(resposta.content, /second player/i);
});

test('o rótulo do servidor só entra no embed quando os dois lados diferem', async t => {
  await t.test('cruzada: rótulo em cada nome e os dois no rodapé', async () => {
    const { resposta } = await roda({ user1: 'kuratani', user2: 'ckz', server: 'official', server2: 'akatsuki' });
    const embed = resposta.embeds[0].data;

    assert.match(embed.description, /\*\*kuratani\*\* \(Bancho\)/);
    assert.match(embed.description, /\*\*ckz\*\* \(Akatsuki\)/);
    assert.equal(embed.footer.text, 'Requested by lucas • Bancho vs Akatsuki');
  });

  await t.test('mesmo servidor: embed igual ao de sempre', async () => {
    const { resposta } = await roda({ user1: 'kuratani', user2: 'outro', server: 'official' });
    const embed = resposta.embeds[0].data;

    assert.doesNotMatch(embed.description, /\(Bancho\)/);
    assert.equal(embed.footer.text, 'Requested by lucas • Bancho');
  });
});

test('a tabela continua dentro do orçamento de largura do celular', async () => {
  // O rótulo do servidor vai na linha de fora justamente para não entrar aqui:
  // o Discord mobile não rola bloco de código na horizontal.
  const { resposta } = await roda({ user1: 'kuratani', user2: 'ckz', server: 'official', server2: 'akatsuki' });
  const tabela = resposta.embeds[0].data.description.split('```')[1].replace(/^arm\n/, '');

  for (const linha of tabela.trim().split('\n')) {
    assert.ok(linha.length <= 26, `linha de ${linha.length} colunas: ${linha}`);
  }
});
