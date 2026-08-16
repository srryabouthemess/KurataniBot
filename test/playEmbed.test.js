/**
 * O desenho de uma play na tela.
 *
 * O que este arquivo trava não é gosto de layout — é o que o layout AFIRMA. As
 * mesmas armadilhas voltavam a cada comando que exibia um score:
 *
 *   1. um dado que não existe virar "0", "undefined" ou "NaN" na tela, que o
 *      leitor não tem como distinguir de resultado;
 *   2. o pp do FC aparecer em play que já era FC — ou sumir em play que não era.
 *
 * O til que marcava "calculado aqui" saiu quando o motor passou a bater exato
 * com o osu! (ver ppText em embeds/play.js): ele era uma ressalva de precisão, e
 * a imprecisão que ele ressalvava deixou de existir.
 *
 * O osuClient é trocado por um mock porque aqui nada disso depende de rede: o
 * que se testa é a forma, e a forma é função dos dados que chegam.
 */
const test = require('node:test');
const assert = require('node:assert');

// Trocado ANTES de carregar o módulo: ele resolve o osuClient no require do
// topo, e o scorePP (que também é usado lá dentro) faz o mesmo.
const clientPath = require.resolve('../src/osuClient');
const osuMock = {};
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true, exports: osuMock,
};

function setup({
  fcPP = null, stars = null, mapAttrs = null, beatmap = null, localPP = null,
} = {}) {
  osuMock.getFCpp          = async () => fcPP;
  osuMock.getAdjustedStars = async () => stars;
  osuMock.getMapAttrs      = async () => mapAttrs;
  osuMock.getBeatmap       = async () => beatmap;
  osuMock.simulatePP       = async () => (localPP === null ? null : { pp: localPP });
  osuMock.getMapUrl  = (mapId, setId) => `https://osu.ppy.sh/beatmapsets/${setId}#osu/${mapId}`;
  osuMock.getUserUrl = (userId) => `https://osu.ppy.sh/users/${userId}`;
}

const playEmbed = require('../src/embeds/play');
const s = require('../src/i18n/pt')({ ADMIN: 'Servidor' });

/** Uma play com tudo preenchido; cada teste estraga só o que lhe interessa. */
const jogada = (over = {}) => ({
  pp: 121.21,
  accuracy: 0.8148,
  rank: 'C',
  mods: ['HD'],
  max_combo: 55,
  passed: true,
  score: 1234567,
  created_at: '2026-08-14T16:04:37Z',
  statistics: { count_300: 148, count_100: 18, count_50: 0, count_miss: 23 },
  beatmap: { id: 1, version: 'JOGA ACELERA', max_combo: 284, difficulty_rating: 4.82 },
  beatmapset: { id: 2, title: 'MONTAGEM BATCHI', artist: 'MC', covers: { list: 'capa.jpg' } },
  ...over,
});

const jogador = (over = {}) => ({
  id: 7,
  username: 'pudim2',
  country_code: 'BR',
  statistics: { pp: 4821.3, global_rank: 12, country_rank: 3 },
  ...over,
});

// ─── PP ───────────────────────────────────────────────────────────────────────

test('a play e o FC dela ficam na mesma fração', async () => {
  setup({ fcPP: 457.95 });
  const bloco = await playEmbed.single(jogada(), { mode: 'official', s });

  assert.match(bloco.description, /\*\*121\.21\*\*\/457\.95pp/);
});

test('play que já era FC não ganha segundo número', async () => {
  // O getFCpp devolve null para FC, e é esse null que decide — não uma segunda
  // conta de choke feita aqui, que podia discordar dele.
  setup({ fcPP: null });
  const bloco = await playEmbed.single(jogada({ max_combo: 284, statistics: {
    count_300: 189, count_100: 0, count_50: 0, count_miss: 0,
  } }), { mode: 'official', s });

  assert.match(bloco.description, /\*\*121\.21\*\*pp/);
  // A fração é o que diz "houve choke"; sem segundo número não há barra.
  assert.doesNotMatch(bloco.description, /\d\/\d/);
});

test('pp calculado aqui sai igual ao do servidor, sem ressalva', async () => {
  // O til que marcava "este veio de cá" saiu com a troca de motor: ele
  // prometia menos precisão do que o número tem. Um til reaparecendo aqui é
  // sinal de que a convenção antiga voltou sem querer.
  setup({ localPP: 99 });
  const bloco = await playEmbed.single(jogada({ pp: null }), { mode: 'official', s });

  assert.match(bloco.description, /\*\*99\.00\*\*pp/);
  assert.doesNotMatch(bloco.description, /~/);
});

test('FC que daria MENOS que a play não vira promessa ao contrário', async () => {
  // Exibir os dois diria "se tivesse acertado tudo, teria ganhado menos", que
  // não é o que a linha significa. No vanilla isso praticamente não acontece
  // mais desde que o motor passou a bater exato com o oficial; a guarda fica
  // pelo Relax, onde quem calcula é outro motor (o akatsuki-pp) e um choke de um
  // combo só pode divergir nas casas decimais.
  setup({ fcPP: 118.4 });
  const bloco = await playEmbed.single(jogada({ pp: 121.21 }), { mode: 'official', s });

  assert.match(bloco.description, /\*\*121\.21\*\*pp/);
  assert.doesNotMatch(bloco.description, /118\.4/);
});

test('pp que não dá para calcular vira "?", não zero', async () => {
  setup({ localPP: null });
  const bloco = await playEmbed.single(jogada({ pp: null }), { mode: 'official', s });

  assert.match(bloco.description, /\*\*\?\*\*pp/);
  assert.doesNotMatch(bloco.description, /0\.00pp/);
});

// ─── Play interrompida ────────────────────────────────────────────────────────

test('play interrompida mostra até onde foi, e muda de cor', async () => {
  // 189 objetos jogados de 400 = 47%. O denominador vem do .osu; sem ele a
  // marca some, em vez de virar um "@0%" que parece nota.
  setup({ mapAttrs: { cs: 4, ar: 9.4, od: 9.6, hp: 5, clockRate: 1, bpm: 128, objects: 400 } });
  const bloco = await playEmbed.single(jogada({ passed: false }), { mode: 'official', s });

  assert.match(bloco.description, /@47%/);
  assert.equal(bloco.color, playEmbed.COLOR_FAIL);
});

test('sem os atributos do mapa, o progresso não é inventado', async () => {
  setup({ mapAttrs: null });
  const bloco = await playEmbed.single(jogada({ passed: false }), { mode: 'official', s });

  assert.doesNotMatch(bloco.description, /@/);
  assert.equal(bloco.color, playEmbed.COLOR_FAIL);
});

// ─── O que pode faltar ────────────────────────────────────────────────────────

test('servidor que não manda nada não imprime undefined nem NaN', async () => {
  // O caso do bancho.py: sem score total, sem status, sem mapper, sem .osu para
  // calcular atributos, e com artista vazio.
  setup();
  const bloco = await playEmbed.single(jogada({
    score: null,
    beatmapset: { id: null, title: 'MONTAGEM BATCHI', artist: '', covers: {} },
  }), { mode: 'daycore', s });

  for (const proibido of ['undefined', 'NaN', 'null']) {
    assert.ok(!bloco.description.includes(proibido), `"${proibido}" vazou na descrição`);
    assert.ok(!bloco.title.includes(proibido), `"${proibido}" vazou no título`);
  }
  assert.equal(bloco.status, null);
  assert.equal(bloco.creator, null);
  assert.equal(bloco.thumbnail, null);
});

test('a linha do mapa junta duração, atributos e BPM já com os mods', async () => {
  setup({
    mapAttrs: { cs: 4, ar: 10.33, od: 9.11, hp: 5, clockRate: 1.5, bpm: 180, objects: 400 },
    beatmap:  { total_length: 180, status: 'graveyard', beatmapset: { creator: 'dectopia' } },
  });
  const bloco = await playEmbed.single(jogada({ mods: ['DT'] }), { mode: 'official', s });

  // 180s no clock 1,5 = 02:00. O AR/OD já vêm convertidos pelo rosu-pp.
  assert.match(bloco.description, /`02:00`/);
  assert.match(bloco.description, /`CS 4 AR 10\.33 OD 9\.11 HP 5`/);
  assert.match(bloco.description, /`180 BPM`/);
});

test('status e mapper saem para o rodapé, que é quem os traduz', async () => {
  setup({ beatmap: { total_length: 120, status: 'graveyard', beatmapset: { creator: 'dectopia' } } });
  const bloco = await playEmbed.single(jogada(), { mode: 'official', s });

  assert.equal(bloco.status, 'Graveyard');
  assert.equal(bloco.creator, 'dectopia');
  assert.match(s.recent_footer(2, 50, 'Daycore', bloco.status, bloco.creator), /Graveyard • mapa de dectopia/);
});

// ─── Listas ───────────────────────────────────────────────────────────────────

test('item de lista com link põe o mapa na primeira linha e a grade na segunda', async () => {
  setup({ stars: '8.31' });
  const item = await playEmbed.listItem(jogada(), {
    mode: 'official', index: 3, mapUrl: 'https://exemplo/1',
  });

  const [cabecalho, numeros, hits] = item.split('\n');
  // Os colchetes da dificuldade saem escapados (ver markdown.js): o Discord
  // renderiza `\[` como `[`, então na tela o título continua igual.
  assert.match(cabecalho, /^\*\*#3\*\* \[MC - MONTAGEM BATCHI \\\[JOGA ACELERA\\\]\]\(https:\/\/exemplo\/1\)/);
  assert.match(cabecalho, /\[8\.31★\]$/);
  assert.match(numeros, /^\*\*C\*\*/);
  assert.equal(hits, '{ 148 / 18 / 0 / 23 }');
});

test('item de lista sem link (mesmo mapa nas cinco linhas) começa pela grade', async () => {
  setup({ stars: '8.31' });
  const item = await playEmbed.listItem(jogada(), { mode: 'official', index: 1 });

  const [cabecalho, numeros] = item.split('\n');
  assert.match(cabecalho, /^\*\*#1\*\* \*\*C\*\* \*\*\+HD\*\* \[8\.31★\]$/);
  assert.doesNotMatch(numeros, /^\*\*C\*\*/);
});

test('título de mapa hostil não forja um link no item de lista', async () => {
  // Mapa graveyard não passa por moderação: o nome é escolhido por quem subiu,
  // e cai em posição de link. Ver markdown.js e test/markdown.test.js.
  setup({ stars: '5.00' });
  const item = await playEmbed.listItem(
    jogada({ beatmapset: { id: 2, title: 'Musica](https://sitefalso.example) [clique', artist: 'MC', covers: {} } }),
    { mode: 'official', index: 1, mapUrl: 'https://osu.ppy.sh/b/1' },
  );

  assert.ok(!item.includes('](https://sitefalso.example'), 'o link forjado sobreviveu ao escape');
  assert.equal((item.match(/(?<!\\)\]\(/g) ?? []).length, 1, 'sobrou um `](` sem escape na primeira linha');
});

test('sem estrelas conhecidas o item não escreve "?★"', async () => {
  setup({ stars: null });
  const item = await playEmbed.listItem(
    jogada({ beatmap: { id: 1, version: 'v', max_combo: 284, difficulty_rating: 0 } }),
    { mode: 'official', index: 1 },
  );

  assert.doesNotMatch(item, /★/);
});

// ─── Autor ────────────────────────────────────────────────────────────────────

test('o autor traz pp e rank de quem jogou', async () => {
  setup();
  const autor = playEmbed.author(jogador(), 'official', s);

  // Separador de milhar no idioma de quem lê: em pt-BR, 4.821,30.
  assert.equal(autor.name, 'pudim2: 4.821,30pp (#12 BR#3)');
  assert.match(autor.iconURL, /br\.png$/);
});

test('conta sem rank não vira "#null"', async () => {
  setup();
  const autor = playEmbed.author(
    jogador({ statistics: { pp: 0, global_rank: null, country_rank: null } }),
    'official', s,
  );

  assert.equal(autor.name, `pudim2: 0,00pp (${s.profile_unranked} BR)`);
});

test('rank regional escondido some, e o país fica', async () => {
  // Conta restrita: o country_rank existe na resposta, mas não é para exibir.
  setup();
  const autor = playEmbed.author(jogador({ _private: true }), 'official', s);

  assert.equal(autor.name, 'pudim2: 4.821,30pp (#12 BR)');
});
