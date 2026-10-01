/**
 * /builder: o menu, a prévia e o que cada botão grava.
 *
 * Roda o `execute` de verdade, com o banco de verdade (um por processo, ver
 * setup.js) e um coletor de mentira — o mesmo jeito do test/pagination.test.js.
 * O que não dá para afirmar daqui é como o cliente do Discord desenha o menu e
 * a prévia: isso só se vê no Discord.
 */
const test = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const db = require('../src/db');
const { CHAVES } = require('../src/embedLayout');
const { IDLE_MS } = require('../src/pagination');
const builder = require('../src/commands/user/builder');
const { previa } = require('../src/commands/user/builder/format');

const LANGS = ['pt', 'en', 'ru'];
const strings = lang => require(`../src/i18n/${lang}`)({ ADMIN: 'Servidor' });
const s = strings('pt');

let contador = 0;
const novoUsuario = () => `builder-${process.pid}-${++contador}`;

/** Abre o /builder e devolve o que foi para a tela e como interagir. */
async function abrir(dono = novoUsuario()) {
  const collector = new EventEmitter();
  let opcoesDoColetor = null;
  const message = {
    createMessageComponentCollector: opcoes => { opcoesDoColetor = opcoes; return collector; },
  };

  const edits = [];
  const interaction = {
    user: { id: dono },
    guildId: null,
    client: { user: { displayAvatarURL: () => 'https://cdn.example/avatar.png' } },
    editReply: async payload => { edits.push(payload); return message; },
  };

  await builder.execute(interaction);

  /** Dispara um componente; devolve o que a interação do componente recebeu. */
  async function interagir(customId, { values, quem = dono } = {}) {
    const recebido = { update: null, reply: null, deferido: false };
    collector.emit('collect', {
      user: { id: quem },
      customId,
      values,
      update: async payload => { recebido.update = payload; },
      reply: async payload => { recebido.reply = payload; },
      deferUpdate: async () => { recebido.deferido = true; },
    });
    await new Promise(r => setImmediate(r));
    return recebido;
  }

  const expirar = () => collector.emit('end', new Map(), 'idle');

  return { dono, edits, interagir, expirar, opcoesDoColetor: () => opcoesDoColetor };
}

/** O que um payload (editReply ou update) mostra, já em JSON. */
function ler(payload) {
  const [linhaMenu, linhaBotoes] = payload.components.map(c => c.toJSON());
  const menu = linhaMenu.components[0];
  return {
    content:   payload.content,
    embed:     payload.embeds?.[0]?.toJSON() ?? null,
    linhas:    payload.components.length,
    menu,
    marcados:  menu.options.filter(o => o.default).map(o => o.value),
    botoes:    linhaBotoes.components,
  };
}

// ─── Abrir ────────────────────────────────────────────────────────────────────

test('abre com a prévia completa e tudo marcado para quem nunca usou', async () => {
  const { edits } = await abrir();
  const tela = ler(edits[0]);

  assert.equal(tela.linhas, 2);
  assert.deepEqual(tela.marcados, CHAVES);
  assert.equal(tela.menu.custom_id, 'builder_select');
  assert.equal(tela.menu.min_values, 0);
  assert.equal(tela.menu.max_values, CHAVES.length);
  assert.deepEqual(tela.botoes.map(b => b.custom_id), ['builder_save', 'builder_reset']);
  assert.ok(tela.content.startsWith(s.builder_intro));
  assert.ok(!tela.content.includes(s.builder_unsaved));

  // A prévia é a play de exemplo com tudo: PB, pp do FC, miss, mapa, capa.
  assert.match(tela.embed.description, /Top #12 pessoal/);
  assert.match(tela.embed.description, /\*\*287\.45\*\*\/341\.90pp/);
  assert.match(tela.embed.description, /BPM/);
  assert.equal(tela.embed.thumbnail.url, 'https://cdn.example/avatar.png');
  assert.equal(tela.embed.url, undefined, 'o mapa de exemplo não existe: sem link');
});

test('quem já salvou abre com a escolha dela marcada e na prévia', async () => {
  const dono = novoUsuario();
  db.setEmbedLayout(dono, ['pp', 'hits']);

  const { edits } = await abrir(dono);
  const tela = ler(edits[0]);

  assert.deepEqual(tela.marcados, ['pp', 'hits']);
  assert.equal(tela.embed.description.split('\n').length, 3);
  assert.doesNotMatch(tela.embed.description, /Top #|BPM|96\.48%/);
  assert.equal(tela.embed.thumbnail, undefined);
});

test('a prévia segue o formato de score de quem abriu', async () => {
  const dono = novoUsuario();
  db.setScoreFormat(dono, 'standardised');

  const { edits } = await abrir(dono);
  assert.match(ler(edits[0]).embed.description, /812\.345/);
});

test('o coletor expira pela mesma inatividade da paginação', async () => {
  const { opcoesDoColetor } = await abrir();
  assert.deepEqual(opcoesDoColetor(), { idle: IDLE_MS });
});

// ─── Select ───────────────────────────────────────────────────────────────────

test('mexer no menu atualiza a prévia e não grava nada', async () => {
  const { dono, interagir } = await abrir();

  const { update } = await interagir('builder_select', { values: ['pp', 'combo'] });
  const tela = ler(update);

  assert.deepEqual(tela.marcados, ['pp', 'combo']);
  assert.deepEqual(tela.embed.description.split('\n'), ['**A** **+HDDT**', '**287.45**/341.90pp • 812x/1024x']);
  assert.ok(tela.content.includes(s.builder_unsaved));
  assert.equal(db.getEmbedLayout(dono), null, 'o menu sozinho não grava');
});

test('desmarcar tudo deixa só título, grade e mods', async () => {
  const { interagir } = await abrir();

  const tela = ler((await interagir('builder_select', { values: [] })).update);
  assert.equal(tela.embed.description, '**A** **+HDDT**');
  assert.equal(tela.embed.thumbnail, undefined);
  assert.ok(tela.embed.title.includes('Example Song'));
});

test('valor fora do conjunto no menu é ignorado', async () => {
  const { interagir } = await abrir();
  const tela = ler((await interagir('builder_select', { values: ['pp', 'cor'] })).update);
  assert.deepEqual(tela.marcados, ['pp']);
});

// ─── Salvar e restaurar ───────────────────────────────────────────────────────

test('salvar grava a seleção e confirma', async () => {
  const { dono, interagir } = await abrir();

  await interagir('builder_select', { values: ['misses', 'pb'] });
  const tela = ler((await interagir('builder_save')).update);

  assert.deepEqual([...db.getEmbedLayout(dono)], ['pb', 'misses']);
  assert.ok(tela.content.includes(s.builder_saved));
  assert.ok(!tela.content.includes(s.builder_unsaved));
  assert.deepEqual(tela.marcados, ['pb', 'misses']);
});

test('salvar com nada marcado grava "tudo desligado", não o padrão', async () => {
  const { dono, interagir } = await abrir();

  await interagir('builder_select', { values: [] });
  await interagir('builder_save');

  assert.equal(db.getEmbedLayout(dono).size, 0);
});

test('salvar com tudo marcado grava NULL (o padrão)', async () => {
  const dono = novoUsuario();
  db.setEmbedLayout(dono, ['pp']);
  const { interagir } = await abrir(dono);

  await interagir('builder_select', { values: [...CHAVES] });
  await interagir('builder_save');

  assert.equal(db.getEmbedLayout(dono), null);
});

test('restaurar grava NULL e volta a prévia e o menu ao padrão', async () => {
  const dono = novoUsuario();
  db.setEmbedLayout(dono, ['pp']);
  const { interagir } = await abrir(dono);

  const tela = ler((await interagir('builder_reset')).update);

  const { db: conexao } = require('../src/db/connection');
  const bruto = conexao.prepare('SELECT embed_layout FROM users WHERE discord_id = ?').get(dono);
  assert.equal(bruto.embed_layout, null);
  assert.equal(db.getEmbedLayout(dono), null);
  assert.deepEqual(tela.marcados, CHAVES);
  assert.ok(tela.content.includes(s.builder_reset_done));
  assert.match(tela.embed.description, /BPM/);
});

// ─── Quem pode, e até quando ──────────────────────────────────────────────────

test('outra pessoa não mexe: recebe aviso efêmero e nada muda', async () => {
  const { dono, interagir } = await abrir();
  db.setEmbedLayout(dono, ['hits']);

  for (const customId of ['builder_select', 'builder_save', 'builder_reset']) {
    const recebido = await interagir(customId, { values: ['pp'], quem: 'intruso' });
    assert.equal(recebido.update, null, customId);
    assert.equal(recebido.reply.content, s.builder_not_yours);
    assert.ok(recebido.reply.flags, 'o aviso é efêmero');
  }
  assert.deepEqual([...db.getEmbedLayout(dono)], ['hits']);
});

test('ao expirar, os componentes ficam desabilitados e a seleção não salva é avisada', async () => {
  const { edits, interagir, expirar } = await abrir();

  await interagir('builder_select', { values: ['pp'] });
  expirar();
  await new Promise(r => setImmediate(r));

  const final = edits.at(-1);
  const tela = ler(final);
  assert.equal(tela.menu.disabled, true);
  assert.ok(tela.botoes.every(b => b.disabled === true));
  assert.deepEqual(tela.marcados, ['pp'], 'o menu fica mostrando o que estava escolhido');
  assert.ok(tela.content.includes(s.builder_expired));
  assert.ok(tela.content.includes(s.builder_unsaved));
  assert.equal(final.embeds, undefined, 'a prévia fica como estava');
});

// ─── Limites do Discord ───────────────────────────────────────────────────────

test('cabe nos limites do Discord, em todos os idiomas', () => {
  for (const lang of LANGS) {
    const sl = strings(lang);
    assert.ok(CHAVES.length <= 25, 'select com até 25 opções');
    for (const chave of CHAVES) {
      const rotulo = sl.builder_element(chave);
      assert.ok(rotulo && rotulo !== chave, `${lang}: ${chave} sem rótulo`);
      assert.ok(rotulo.length <= 100, `${lang}: rótulo de ${chave} passa de 100`);
    }
    assert.ok(sl.builder_placeholder.length <= 150);
    assert.ok(sl.builder_save.length <= 80 && sl.builder_reset.length <= 80);
    assert.ok(sl.builder_intro.length + sl.builder_unsaved.length + sl.builder_expired.length < 2000);

    const bloco = previa(new Set(CHAVES), { s: sl, agora: Date.now(), capa: null, mode: 'official' });
    assert.ok(bloco.title.length <= 256 && bloco.description.length <= 4096);
  }
});
