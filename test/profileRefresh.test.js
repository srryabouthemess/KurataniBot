/**
 * O botão 🔄 do /profile, pelo `execute` de verdade: o osuClient e o userLink
 * são dublês (o que se afirma é o que o comando faz com o que eles devolvem), e
 * a interação é um coletor de mentira que registra cada edição.
 *
 * O ponto delicado é o avatar de servidor privado, que vai ANEXADO à mensagem:
 * o edit do refresh tem que continuar mostrando a thumbnail sem duplicar o
 * anexo.
 */
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const chamadas = { getUser: [], best: [], fetchPlayer: [] };
let perfil = null;       // o que o servidor "responde" agora
let falhar = false;

const osuStub = {
  getMapUrl:    (mapId, setId) => `https://osu.ppy.sh/beatmapsets/${setId}#osu/${mapId}`,
  getUserUrl:   (userId) => `https://osu.ppy.sh/users/${userId}`,
  getModeLabel: () => 'Daycore',
  getUser: async (username, mode, opts) => {
    chamadas.getUser.push({ username, opts });
    if (falhar) throw new Error('API caiu');
    return perfil;
  },
  getBestScores: async (id, limit, mode, opts) => {
    chamadas.best.push({ id, limit, opts });
    return [];
  },
  enrichScores: async () => [],
};
const linkStub = {
  resolvePlayer: () => ({ username: 'kuratani', mode: 'daycore' }),
  // Mesma forma do real: perfil primeiro, depois as plays do id resolvido.
  fetchPlayer: async (resolved, buscar, opts) => {
    chamadas.fetchPlayer.push(opts);
    const user = await osuStub.getUser(resolved.username, resolved.mode, opts);
    return { user, scores: user ? await buscar(user.id) : [] };
  },
};

for (const [caminho, exports] of [['../src/osuClient', osuStub], ['../src/userLink', linkStub]]) {
  const resolvido = require.resolve(caminho);
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports };
}

// O download do avatar: o `axios.get` é lido em cada chamada, então trocá-lo
// aqui vale para o comando.
const axios = require('axios');
let avatarOk = true;
axios.get = async () => {
  if (!avatarOk) throw new Error('timeout');
  return { headers: { 'content-type': 'image/png' }, data: Buffer.from('png') };
};

const profile = require('../src/commands/osu/profile');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const jogador = (pp, over = {}) => ({
  id: 7, username: 'kuratani', country_code: 'BR', avatar_url: 'https://a.example/7',
  statistics: { pp, global_rank: 100, country_rank: 10, hit_accuracy: 98 },
  ...over,
});

/** Roda o /profile e devolve como clicar e o que foi para a tela. */
async function rodar({ dono = 'dono' } = {}) {
  const collector = new EventEmitter();
  collector.stop = motivo => collector.emit('end', new Map(), motivo);
  const edits = [];
  const message = { createMessageComponentCollector: () => collector };
  let superar = null;

  const interaction = {
    user: { id: dono }, guildId: null, options: { getString: () => null },
    deferReply: async () => {},
    reply: async () => {},
    editReply: async payload => { edits.push(payload); return message; },
    onSuperseded: fn => { superar = fn; },
  };

  await profile.execute(interaction);

  const clicar = (userId = dono, customId = 'profile_refresh') => {
    const clique = {};
    collector.emit('collect', {
      user: { id: userId }, customId,
      deferUpdate: async () => {},
      reply: async payload => { clique.efemero = payload; },
      followUp: async payload => { clique.aviso = payload; },
    });
    return clique;
  };

  return { edits, clicar, collector, superar: () => superar?.() };
}

const botao = payload => {
  const b = payload.components?.[0]?.components?.[0];
  return b && { id: b.data.custom_id, off: !!b.data.disabled };
};
const embedsDe = edits => edits.filter(e => e.embeds).map(e => e.embeds[0].toJSON());

test.beforeEach(() => {
  chamadas.getUser.length = 0; chamadas.best.length = 0; chamadas.fetchPlayer.length = 0;
  perfil = jogador(1000);
  falhar = false;
  avatarOk = true;
});

test('o perfil sai com o botão 🔄', async () => {
  const { edits } = await rodar();
  assert.deepEqual(botao(edits[0]), { id: 'profile_refresh', off: false });
  assert.match(embedsDe(edits)[0].author.name, /1\.000,00pp/);
});

test('refresh troca o embed, buscando SEM cache', async () => {
  const { edits, clicar } = await rodar();

  perfil = jogador(1234.5);
  clicar(); await sleep(20);

  const embeds = embedsDe(edits);
  assert.equal(embeds.length, 2, 'a mesma mensagem foi reescrita');
  assert.match(embeds.at(-1).author.name, /1\.234,50pp/);
  // Sem `fresh` o osuClient devolveria o perfil do cache — o botão não faria nada.
  assert.equal(chamadas.fetchPlayer.at(-1)?.fresh, true);
  assert.equal(chamadas.best.at(-1).opts?.fresh, true);
  assert.deepEqual(botao(edits.at(-1)), { id: 'profile_refresh', off: false });
});

test('durante a busca o botão fica apagado, e clique de spam não busca de novo', async () => {
  const { edits, clicar } = await rodar();
  const antes = chamadas.getUser.length;

  const original = osuStub.getUser;
  osuStub.getUser = async (...args) => { await sleep(40); return original(...args); };
  try {
    clicar(); await sleep(10);
    assert.deepEqual(botao(edits.at(-1)), { id: 'profile_refresh', off: true });

    clicar(); clicar(); await sleep(80);
  } finally {
    osuStub.getUser = original;
  }

  assert.equal(chamadas.getUser.length - antes, 1);
  assert.deepEqual(botao(edits.at(-1)), { id: 'profile_refresh', off: false });
});

test('erro no refresh preserva o embed e avisa em efêmero', async () => {
  const { edits, clicar } = await rodar();
  const embedsAntes = embedsDe(edits).length;

  falhar = true;
  const clique = clicar(); await sleep(20);

  assert.equal(embedsDe(edits).length, embedsAntes, 'nenhum embed novo');
  assert.match(clique.aviso?.content ?? '', /atualizar o perfil/);
  assert.notEqual(clique.aviso?.flags, undefined, 'efêmero');
  assert.deepEqual(botao(edits.at(-1)), { id: 'profile_refresh', off: false }, 'o botão volta');
});

test('jogador que sumiu no refresh é erro, não embed vazio', async () => {
  const { edits, clicar } = await rodar();
  const embedsAntes = embedsDe(edits).length;

  perfil = null;
  const clique = clicar(); await sleep(20);

  assert.equal(embedsDe(edits).length, embedsAntes);
  assert.ok(clique.aviso);
});

test('clique de outra pessoa é recusado e não busca', async () => {
  const { clicar } = await rodar();
  const antes = chamadas.getUser.length;

  const clique = clicar('intruso'); await sleep(20);

  assert.match(clique.efemero?.content ?? '', /Apenas quem usou o comando/);
  assert.equal(chamadas.getUser.length, antes);
});

test('idle: os botões saem quando o coletor expira; superado, ficam', async () => {
  const a = await rodar();
  a.collector.stop('idle');
  await sleep(5);
  assert.deepEqual(a.edits.at(-1).components, []);

  const b = await rodar();
  const antes = b.edits.length;
  b.superar();
  await sleep(5);
  assert.equal(b.edits.length, antes, 'os botões da execução nova não podem ser apagados');
});

// ─── Avatar anexado (servidor privado) ───────────────────────────────────────

const privado = pp => jogador(pp, { _private: true });

test('avatar anexado: a primeira resposta leva o arquivo e a thumbnail aponta para ele', async () => {
  perfil = privado(1000);
  const { edits } = await rodar();

  assert.equal(edits[0].files.length, 1);
  assert.equal(edits[0].files[0].name, 'avatar.png');
  assert.equal(embedsDe(edits)[0].thumbnail.url, 'attachment://avatar.png');
});

test('refresh com avatar novo SUBSTITUI o anexo, sem duplicar', async () => {
  perfil = privado(1000);
  const { edits, clicar } = await rodar();

  perfil = privado(1500);
  clicar(); await sleep(20);

  const final = edits.at(-1);
  assert.equal(final.files.length, 1, 'um arquivo novo');
  // `attachments: []` é o que diz ao Discord para largar o anexo antigo: sem ele
  // o novo entraria ao lado, com o mesmo nome.
  assert.deepEqual(final.attachments, []);
  assert.equal(embedsDe(edits).at(-1).thumbnail.url, 'attachment://avatar.png');
});

test('refresh com o download do avatar falhando mantém o anexo que já está lá', async () => {
  perfil = privado(1000);
  const { edits, clicar } = await rodar();

  perfil = privado(1500);
  avatarOk = false;
  clicar(); await sleep(20);

  const final = edits.at(-1);
  // Nem `files` nem `attachments`: o Discord mantém o que a mensagem já tem.
  assert.equal(final.files, undefined);
  assert.equal(final.attachments, undefined);
  assert.equal(embedsDe(edits).at(-1).thumbnail.url, 'attachment://avatar.png',
    'a thumbnail não volta para o link que não renderiza');
  assert.match(embedsDe(edits).at(-1).author.name, /1\.500,00pp/);
});

test('servidor público não anexa nada, e o refresh também não', async () => {
  perfil = jogador(1000);
  const { edits, clicar } = await rodar();
  assert.deepEqual(edits[0].files, []);

  perfil = jogador(1100);
  clicar(); await sleep(20);

  const final = edits.at(-1);
  assert.deepEqual(final.files, []);
  assert.equal(embedsDe(edits).at(-1).thumbnail.url, 'https://a.example/7');
});
