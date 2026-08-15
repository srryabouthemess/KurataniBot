/**
 * O ranking de pp, nos três tipos de servidor.
 *
 * As três APIs devolvem a mesma lista com nomes diferentes: o id é `user.id`,
 * `player_id` ou `id`; a acurácia é `hit_accuracy`, `acc` ou `accuracy`; e o
 * Ripple ainda guarda as estatísticas dentro de `chosen_mode`. Errar a tradução
 * não estoura nada — sai uma linha plausível com o número de outro campo, que é
 * o tipo de defeito que só aparece quando alguém estranha a tela.
 *
 * Os payloads abaixo são recortes de respostas de verdade dos três servidores.
 */
const test = require('node:test');
const assert = require('node:assert');

const oficial  = require('../src/osu/officialApi');
const banchoPy = require('../src/osu/banchoPyApi');
const ripple   = require('../src/osu/rippleApi');
const { bandeira } = require('../src/commands/leaderboard');

// ─── osu! oficial: /rankings/osu/performance ─────────────────────────────────

const OFICIAL = {
  pp: 32138.7, hit_accuracy: 98.2564, play_count: 240595, global_rank: 1,
  user: {
    id: 7562902, username: 'mrekk', country_code: 'AU',
    avatar_url: 'https://a.ppy.sh/7562902?1771675022.jpeg',
  },
};

test('oficial: os campos do jogador vêm de dentro de user', () => {
  const e = oficial.normalizeRankingEntry(OFICIAL);
  assert.equal(e.id, 7562902);
  assert.equal(e.username, 'mrekk');
  assert.equal(e.country, 'AU');
  assert.equal(e.pp, 32138.7);
  assert.equal(e.playCount, 240595);
});

test('oficial: a acurácia continua de 0 a 100', () => {
  // O resto do bot lê acurácia de SCORE de 0 a 1, e a de perfil de 0 a 100.
  // Uma linha de ranking é perfil: dividir aqui daria "0.98%" na tela.
  assert.equal(oficial.normalizeRankingEntry(OFICIAL).accuracy, 98.2564);
});

// ─── bancho.py: /v1/get_leaderboard ──────────────────────────────────────────

const BANCHOPY = {
  player_id: 11, name: 'noober', country: 'br',
  tscore: 787752390, rscore: 597464092,
  pp: 12753.0, plays: 498, playtime: 16820, acc: 95.743, max_combo: 2774,
  clan_id: null, clan_name: null, clan_tag: null,
};

test('bancho.py: todo campo tem outro nome, e nenhum é o do oficial', () => {
  const e = banchoPy.normalizeRankingEntry(BANCHOPY);
  assert.equal(e.id, 11);
  assert.equal(e.username, 'noober');
  assert.equal(e.pp, 12753);
  assert.equal(e.accuracy, 95.743);
  assert.equal(e.playCount, 498);
});

test('bancho.py: o país vem minúsculo e sobe para maiúsculo', () => {
  // A bandeira é montada a partir das letras, e os indicadores regionais só
  // existem para maiúsculas.
  assert.equal(banchoPy.normalizeRankingEntry(BANCHOPY).country, 'BR');
});

test('bancho.py: conta sem país não inventa um', () => {
  assert.equal(banchoPy.normalizeRankingEntry({ ...BANCHOPY, country: '' }).country, null);
});

// ─── Ripple: /api/v1/leaderboard ─────────────────────────────────────────────

const RIPPLE = {
  id: 101966, username: 'originset', country: 'US', privileges: 3,
  chosen_mode: {
    ranked_score: 940023116, playcount: 17786, accuracy: 97.091305915469,
    pp: 31372, global_leaderboard_rank: 1, country_leaderboard_rank: 1,
  },
};

test('Ripple: as estatísticas saem de chosen_mode, não da raiz', () => {
  const e = ripple.normalizeRankingEntry(RIPPLE);
  assert.equal(e.id, 101966);
  assert.equal(e.username, 'originset');
  assert.equal(e.country, 'US');
  assert.equal(e.pp, 31372);
  assert.equal(e.accuracy, 97.091305915469);
  assert.equal(e.playCount, 17786);
});

test('Ripple: modo nunca jogado não derruba a linha', () => {
  // Conta que existe no ranking de vanilla e não tem nada em RX.
  const e = ripple.normalizeRankingEntry({ id: 1, username: 'a', country: 'BR' });
  assert.equal(e.pp, 0);
  assert.equal(e.playCount, 0);
});

// ─── O contrato entre os três ────────────────────────────────────────────────

test('os três devolvem exatamente os mesmos campos', () => {
  // É o que permite ao comando montar a linha sem perguntar de qual servidor
  // ela veio. Um campo esquecido em um adaptador só apareceria como `undefined`
  // no meio do embed.
  const chaves = (obj) => Object.keys(obj).sort();
  const base = chaves(oficial.normalizeRankingEntry(OFICIAL));

  assert.deepEqual(chaves(banchoPy.normalizeRankingEntry(BANCHOPY)), base);
  assert.deepEqual(chaves(ripple.normalizeRankingEntry(RIPPLE)), base);
});

test('o rank que a API manda NÃO é publicado', () => {
  // Decisão do comando: a coluna da esquerda é a posição na lista. O rank do
  // oficial e o do Ripple são GLOBAIS mesmo numa consulta por país (o #1 do
  // Brasil chega como #51), e o bancho.py não manda rank nenhum — publicá-lo
  // daria uma numeração que não bate com a ordem exibida.
  for (const entrada of [
    oficial.normalizeRankingEntry(OFICIAL),
    banchoPy.normalizeRankingEntry(BANCHOPY),
    ripple.normalizeRankingEntry(RIPPLE),
  ]) {
    for (const chave of Object.keys(entrada)) {
      assert.doesNotMatch(chave, /rank/i, `"${chave}" reintroduz um rank vindo da API`);
    }
  }
});

// ─── Bandeira ────────────────────────────────────────────────────────────────

test('o código do país vira a bandeira', () => {
  assert.equal(bandeira('BR'), '🇧🇷');
  assert.equal(bandeira('au'), '🇦🇺');
});

test('sem país, nenhuma bandeira — inclusive no XX do bancho.py', () => {
  // 'XX' é o que o bancho.py grava para conta sem país; ele viraria 🇽🇽, que
  // não é bandeira de lugar nenhum.
  assert.equal(bandeira('XX'), '');
  assert.equal(bandeira(null), '');
  assert.equal(bandeira(''), '');
  assert.equal(bandeira('Brasil'), '');
});
