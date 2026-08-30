/**
 * Mapa que só existe no servidor privado.
 *
 * A API oficial não conhece o id, então tudo que o embed mostra sobre o MAPA
 * — combo máximo, estrelas, status, mapper, duração, capa — voltava vazio: o
 * `?x` no lugar do combo era o sintoma visível. A fonte passa a ser o
 * `/v2/maps/{id}` do próprio bancho.py, que responde para os dois tipos de id.
 */
const test = require('node:test');
const assert = require('node:assert');

process.env.SERVERS                  = 'testsrv';
process.env.SERVER_TESTSRV_URL       = 'https://exemplo.org';
process.env.SERVER_TESTSRV_COVERS    = 'https://osu.exemplo.org/mirror-cover';
process.env.SERVER_TESTSRV_MAPFILES  = 'https://osu.exemplo.org/mirror-osu/';

const servers = require('../src/servers');
const { mergeServerMap } = require('../src/osu/banchoPyApi');

// Como o bancho.py responde um mapa custom (id na faixa privada).
const MAPA = {
  id: 100000007, set_id: 100000002, status: 5,
  artist: 't.A.T.u.', title: 'All The Things She Said (Ans Remix)',
  version: 'XX AR9.8', creator: 'pudim2',
  total_length: 262, max_combo: 1349, mode: 0,
  bpm: 180.0, cs: 5.0, ar: 9.8, od: 9.0, hp: 2.0, diff: 7.697,
};

/** Um score como o normalizeScorePrivate o entrega: mapa em branco. */
function scoreVazio() {
  return {
    beatmap:    { id: 100000007, version: '?', max_combo: null, difficulty_rating: 0 },
    beatmapset: { id: 100000002, title: '', artist: '', covers: { list: 'https://assets.ppy.sh/x' } },
  };
}

test('configuracao do servidor', async t => {
  await t.test('COVERS e MAPFILES entram no registro', () => {
    const s = servers.get('testsrv');
    assert.equal(s.covers, 'https://osu.exemplo.org/mirror-cover');
    // Barra final removida: quem monta a URL sempre acrescenta a sua.
    assert.equal(s.mapFiles, 'https://osu.exemplo.org/mirror-osu');
  });

  await t.test('servidor sem as variaveis fica com null, nao undefined', () => {
    const oficial = servers.get('official');
    assert.equal(oficial.covers ?? null, null);
    assert.equal(oficial.mapFiles ?? null, null);
  });
});

test('mergeServerMap preenche o que a API oficial nao tem', async t => {
  await t.test('combo, estrelas, versao e duracao', () => {
    const p = mergeServerMap(scoreVazio(), MAPA);
    assert.equal(p.beatmap.max_combo, 1349);
    assert.equal(p.beatmap.difficulty_rating, 7.697);
    assert.equal(p.beatmap.version, 'XX AR9.8');
    assert.equal(p.beatmap.total_length, 262);
  });

  await t.test('titulo, artista e mapper', () => {
    const p = mergeServerMap(scoreVazio(), MAPA);
    assert.equal(p.beatmapset.title, 'All The Things She Said (Ans Remix)');
    assert.equal(p.beatmapset.artist, 't.A.T.u.');
    assert.equal(p.beatmapset.creator, 'pudim2');
  });

  await t.test('status numerico vira o rotulo que o embed escreve', () => {
    assert.equal(mergeServerMap(scoreVazio(), { ...MAPA, status: 5 }).beatmap.status, 'loved');
    assert.equal(mergeServerMap(scoreVazio(), { ...MAPA, status: 2 }).beatmap.status, 'ranked');
    assert.equal(mergeServerMap(scoreVazio(), { ...MAPA, status: 0 }).beatmap.status, 'pending');
    assert.equal(mergeServerMap(scoreVazio(), { ...MAPA, status: -1 }).beatmap.status, 'graveyard');
  });

  await t.test('capa do servidor quando ele tem uma; senao a do ppy', () => {
    // Com `/list` no fim: o campo alimenta o setThumbnail do embed, que quer o
    // 150x110, e a raiz do espelho responde a faixa de 900x250.
    const comEspelho = mergeServerMap(scoreVazio(), MAPA, 'https://osu.exemplo.org/mirror-cover');
    assert.equal(comEspelho.beatmapset.covers.list, 'https://osu.exemplo.org/mirror-cover/100000002/list');

    const sem = mergeServerMap(scoreVazio(), MAPA);
    assert.equal(sem.beatmapset.covers.list, 'https://assets.ppy.sh/x');
  });
});

test('artista e titulo vem do mesmo lugar', async t => {
  // O normalizeScorePrivate extrai os dois de "Artista - Titulo (Mapper) [Dif]"
  // e a regex nao os separa: title fica com o artista grudado, artist fica vazio.
  function scoreDoNomeDeArquivo() {
    const score = scoreVazio();
    score.beatmapset.title  = 't.A.T.u. - All The Things She Said (Ans Remix)';
    score.beatmapset.artist = '';
    return score;
  }

  await t.test('artista vazio troca o PAR inteiro, e nao so o artista', () => {
    const p = mergeServerMap(scoreDoNomeDeArquivo(), MAPA);
    assert.equal(p.beatmapset.artist, 't.A.T.u.');
    // Antes: 't.A.T.u. - t.A.T.u. - All The Things She Said (Ans Remix)'
    assert.equal(p.beatmapset.title, 'All The Things She Said (Ans Remix)');
  });

  await t.test('artista preenchido continua ganhando do servidor', () => {
    const score = scoreVazio();
    score.beatmapset.artist = 'Artista Oficial';
    score.beatmapset.title  = 'Titulo Oficial';

    const p = mergeServerMap(score, MAPA);
    assert.equal(p.beatmapset.artist, 'Artista Oficial');
    assert.equal(p.beatmapset.title,  'Titulo Oficial');
  });

  await t.test('sem artista dos dois lados, o titulo ainda aparece', () => {
    const p = mergeServerMap(scoreDoNomeDeArquivo(), { ...MAPA, artist: '', title: '' });
    assert.equal(p.beatmapset.artist, '');
    assert.equal(p.beatmapset.title, 't.A.T.u. - All The Things She Said (Ans Remix)');
  });
});

test('o que o score ja sabe nao e sobrescrito', async t => {
  // Mapa oficial jogado no servidor privado: a API oficial pode ter enriquecido
  // antes, e o dado dela e o mais completo dos dois.
  await t.test('combo e estrelas ja preenchidos permanecem', () => {
    const score = scoreVazio();
    score.beatmap.max_combo = 999;
    score.beatmap.difficulty_rating = 6.5;

    const p = mergeServerMap(score, MAPA);
    assert.equal(p.beatmap.max_combo, 999);
    assert.equal(p.beatmap.difficulty_rating, 6.5);
  });

  await t.test('mapa ausente devolve o score intacto', () => {
    const score = scoreVazio();
    assert.deepEqual(mergeServerMap(score, null), score);
  });

  await t.test('campo zerado no servidor nao apaga o que ja existe', () => {
    const score = scoreVazio();
    score.beatmap.max_combo = 500;
    const p = mergeServerMap(score, { ...MAPA, max_combo: 0, diff: 0 });
    assert.equal(p.beatmap.max_combo, 500);
    assert.equal(p.beatmap.difficulty_rating, 0);
  });
});

test('espelho de .osu do servidor entra na fila de download', async t => {
  const { HOSTS } = require('../src/beatmapFile');

  await t.test('depois dos tres publicos, nunca antes', () => {
    const nomes = HOSTS.map(h => h.nome);
    assert.deepEqual(nomes.slice(0, 3), ['osu', 'catboy', 'osuDirect']);
    assert.equal(nomes.at(-1), 'testsrv');
  });

  await t.test('monta a URL com o id do mapa', () => {
    assert.equal(
      HOSTS.at(-1).url(100000007),
      'https://osu.exemplo.org/mirror-osu/100000007',
    );
  });

  await t.test('divide o balde com a API do mesmo servidor', () => {
    assert.equal(HOSTS.at(-1).bucket, 'server:testsrv');
  });
});
