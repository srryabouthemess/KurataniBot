/**
 * db/migrations.js
 * O caminho de quem partiu de uma versão anterior do bot.
 *
 * ── Por que existe um `user_version` ──────────────────────────────────────────
 * Estas migrações se detectam sozinhas: olham `PRAGMA table_info`, o
 * `sqlite_master` e flags no `meta` para decidir se já rodaram. Isso é robusto —
 * é idempotente por construção, e não depende de nenhum registro ter
 * sobrevivido —, mas custa uma dezena de consultas de sondagem em TODO boot,
 * para sempre, num banco que passou por elas anos atrás.
 *
 * O `user_version` fecha isso: depois que o conjunto roda uma vez, o banco é
 * carimbado e o boot seguinte sai daqui na primeira linha. As sondagens
 * continuam existindo (é o que torna seguro rodá-las num banco em qualquer
 * estado), só deixam de ser pagas para sempre.
 *
 * ── Ao acrescentar uma migração ───────────────────────────────────────────────
 * Suba o `VERSAO_ATUAL` e trate a faixa nova, no formato:
 *
 *     if (versao < 2) { ...  }
 *
 * ── E o que veio antes da numeração ───────────────────────────────────────────
 * A faixa 0→1 era o conjunto herdado: o cache saindo do bot.db, links por
 * conta, chaves de servidor, nomeações por conta de jogo e a importação dos
 * `links.json`/`languages.json` de antes do SQLite. Ela saiu daqui quando todo
 * banco em uso já tinha passado por ela — era um terço deste arquivo, rodando
 * sondagens num caminho que ninguém mais percorria.
 *
 * Um banco que ainda não passou por ela é RECUSADO (ver `conferirOrigem`), e a
 * mensagem aponta o commit que ainda sabe migrá-lo. Recusar é o lado seguro:
 * aplicar o schema atual por cima de tabelas antigas misturaria os dois
 * formatos sem erro nenhum na hora.
 *
 * ── E o que veio DEPOIS ───────────────────────────────────────────────────────
 * O caminho inverso também é recusado: um banco carimbado numa versão acima da
 * `VERSAO_ATUAL` é de um código mais novo do que este, e isto aqui não conhece
 * as colunas e tabelas que ele ganhou (ver `conferirVersao`). É o rollback de
 * código depois de uma migração — que só se desfaz com o backup de antes dela,
 * tirado sozinho por `backupAntesDeMigrar`.
 */

const fs   = require('fs');
const path = require('path');

const { DATA_DIR } = require('../paths');
const backup = require('./backup');

const VERSAO_ATUAL = 10;

/** A versão mais antiga que as migrações abaixo sabem levar até a atual. */
const VERSAO_MINIMA = 1;

/** O último commit com a faixa 0→1 — é para ele que a recusa manda. */
const COMMIT_COM_MIGRACAO_ANTIGA = '7016774';

// Dados de antes do SQLite. Não são mais importados; só denunciam que o banco
// que se está criando do zero deveria ter nascido deles.
const JSON_ANTIGOS = ['links.json', 'languages.json'];

/** Banco sem tabela nenhuma: acabou de ser criado, e o schema atual É o formato dele. */
function ehNovo(db) {
  return !db.prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' LIMIT 1").get();
}

/**
 * Recusa o banco de schema MAIS NOVO do que este código.
 *
 * Sem isto, voltar o código depois de uma migração subia normalmente: o
 * `run` via `versao >= VERSAO_ATUAL` e saía, e o bot seguia gravando num banco
 * cujo formato não conhece — coluna nova ficando sem valor, tabela nova sem
 * ninguém mantendo. O estrago aparece depois, e longe daqui.
 */
function conferirVersao(versao) {
  if (versao > VERSAO_ATUAL) {
    throw new Error(
      `O bot.db está na versão ${versao} do schema, e este código só conhece até a ${VERSAO_ATUAL}.\n` +
      '  Voltar o código depois de uma migração exige restaurar o backup de antes dela\n' +
      '  (data/backups/bot-pre-v<versão>-AAAA-MM-DD.db), com o bot parado — ou volte para o código novo.',
    );
  }
}

/**
 * Recusa o banco que estas migrações não sabem levar até a versão atual.
 *
 * Roda ANTES do `schema.apply`: os CREATE de lá sobre tabelas no formato antigo
 * não dariam erro nenhum, e o banco sairia misturado.
 *
 *   - banco existente sem carimbo (`user_version` 0): anterior à numeração;
 *   - banco novo com `links.json`/`languages.json` ao lado: os dados de verdade
 *     estão nesses arquivos, e criar um banco vazio seria perdê-los calado.
 */
function conferirOrigem(db, { novo = ehNovo(db), dataDir = DATA_DIR } = {}) {
  const versao = db.prepare('PRAGMA user_version').get().user_version;
  const instrucao =
    `Rode uma vez o commit ${COMMIT_COM_MIGRACAO_ANTIGA} do KurataniBot (git checkout ${COMMIT_COM_MIGRACAO_ANTIGA} && npm start),\n` +
    '  que ainda sabe migrar, pare o bot e volte para a versão atual.';

  conferirVersao(versao);

  if (!novo && versao < VERSAO_MINIMA) {
    throw new Error(`O bot.db é de uma versão do bot anterior à numeração do schema (user_version ${versao}).\n  ${instrucao}`);
  }

  const jsons = JSON_ANTIGOS.filter(f => fs.existsSync(path.join(dataDir, f)));
  if (novo && jsons.length > 0) {
    throw new Error(`Há dados de antes do SQLite (${jsons.join(', ')}) e nenhum bot.db para recebê-los.\n  ${instrucao}`);
  }
}

/**
 * Copia o bot.db antes de uma migração que vai de fato rodar.
 *
 * Roda ANTES do `schema.apply`, pela mesma razão da conferência: os CREATE de
 * lá já acrescentam tabelas ao banco antigo, e o backup tem que ser o banco
 * exatamente como o código anterior o deixou. Banco novo não tem o que copiar;
 * banco na versão atual não vai migrar.
 *
 * Se a cópia falhar, o boot falha junto. Migrar sem ela é justamente o que
 * deixaria um rollback sem volta — melhor o bot parado com o erro na tela.
 *
 * @returns {string|null} o arquivo gravado, ou null quando não há migração
 */
function backupAntesDeMigrar(db, { novo = ehNovo(db), dir } = {}) {
  const versao = db.prepare('PRAGMA user_version').get().user_version;
  if (novo || versao >= VERSAO_ATUAL) return null;

  const destino = backup.backupPreMigracao(db, versao, { dir });
  console.log(`[db] Backup antes de migrar da versão ${versao} para a ${VERSAO_ATUAL}: ${destino}`);
  return destino;
}

/** O banco recém-criado já nasce no formato atual: só falta dizer isso a ele. */
function carimbar(db) {
  db.exec(`PRAGMA user_version = ${VERSAO_ATUAL}`);
}

// ─── 1 → 2: os caches de cálculo, quando o motor de PP mudou ──────────────────

/**
 * map_difficulty e fc_pp passam a ter os mods por acrônimo, e são ESVAZIADAS.
 *
 * Duas mudanças de uma vez, e a segunda é a que obriga a jogar fora:
 *
 *   1. A chave era (mapa, bitmask, lazer) e virou (mapa, mods canônicos). O CL
 *      deixou de ser uma coluna booleana ao lado dos mods para ser um mod dentro
 *      deles, que é como o osu! o representa (ver canonicalMods em mods.js).
 *   2. Quem calcula deixou de ser o rosu-pp e passou a ser o lazer-calculator,
 *      que reproduz o número oficial exatamente. TODO valor guardado veio do
 *      motor antigo, e está entre 2% e 15% fora.
 *
 * Por isso é DROP e não conversão: converter a chave preservaria justamente os
 * números que a troca de motor veio corrigir, e eles não têm TTL para vencer —
 * as duas tabelas são "função pura do arquivo .osu", premissa que vale para o
 * arquivo mas não para o motor. Ficariam errados para sempre.
 *
 * O que se perde é cache, não dado: a primeira exibição de cada (mapa, mods)
 * recalcula e guarda de novo. O .osu em si continua no beatmap_files, então nem
 * download novo acontece.
 *
 * Detecção pelo próprio schema, e não por flag no `meta`: se a coluna
 * `mods_bits` ainda existe, a tabela é a antiga. Isso é idempotente por
 * construção e não depende de nenhum registro ter sobrevivido.
 */
function migrarCachesDeCalculoParaMods(db) {
  const temColuna = (tabela, coluna) => db
    .prepare(`PRAGMA cache.table_info(${tabela})`).all()
    .some(c => c.name === coluna);

  let refeitas = 0;

  if (temColuna('map_difficulty', 'mods_bits')) {
    db.exec(`
      DROP TABLE cache.map_difficulty;
      CREATE TABLE cache.map_difficulty (
        map_id    INTEGER NOT NULL,
        mods      TEXT    NOT NULL,
        stars     REAL    NOT NULL,
        max_combo INTEGER,
        PRIMARY KEY (map_id, mods)
      );
    `);
    refeitas++;
  }

  if (temColuna('fc_pp', 'mods_bits')) {
    db.exec(`
      DROP TABLE cache.fc_pp;
      CREATE TABLE cache.fc_pp (
        map_id    INTEGER NOT NULL,
        mods      TEXT    NOT NULL,
        engine    TEXT    NOT NULL,
        n300      INTEGER NOT NULL,
        n100      INTEGER NOT NULL,
        n50       INTEGER NOT NULL,
        pp        REAL    NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY (map_id, mods, engine, n300, n100, n50)
      );
      CREATE INDEX IF NOT EXISTS cache.idx_fc_pp_age ON fc_pp (cached_at);
    `);
    refeitas++;
  }

  if (refeitas > 0) {
    // Mesma razão do VACUUM da migração anterior: DROP TABLE não devolve o
    // espaço ao sistema de arquivos, e estas duas são as que mais crescem
    // depois dos próprios .osu.
    db.exec('PRAGMA cache.wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM cache');
    console.log(`[db] Caches de cálculo recriados para o motor novo (${refeitas} tabela(s)); serão repovoados sob demanda.`);
  }
}

// ─── 2 → 3: preferência de modo (VN/RX/combinado) do /recent e /rs ────────────

/**
 * `users.preferred_modo`: o `modo:` que `/link default` grava, pra quem quer
 * VN+RX combinado (ou só um dos dois) sem repetir a opção em todo `/recent`.
 * Nasce NULL — sem essa coluna a preferência simplesmente não existia, então
 * NULL é o mesmo "sem preferência" que já vale pra quem nunca configurou.
 */
function acrescentarColunaPreferredModo(db) {
  const colunas = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!colunas.includes('preferred_modo')) {
    db.exec('ALTER TABLE users ADD COLUMN preferred_modo TEXT');
  }
}

// ─── 3 → 4: a estrela do Relax deixa de dividir linha com a do vanilla ────────

/**
 * `map_difficulty` ganha a coluna `engine`, como a `fc_pp` já tinha.
 *
 * A tabela guardava a estrela por (mapa, mods), o que só bastava enquanto UM
 * motor calculava todas elas. Não era o caso: o Relax é calculado pelo
 * akatsuki-pp, que zera a dimensão de velocidade, e o vanilla pelo
 * lazer-calculator — dois números legítimos para a mesma chave.
 *
 * Na prática a colisão não chegou a acontecer, porque score de Relax sempre
 * carrega o mod RX e isso já separava as chaves. O que acontecia era mais
 * silencioso: o caminho do Relax nem chegava ao akatsuki-pp, então a linha com
 * RX guardava o que o LAZER achava de um mapa com RX. Agora que o motor certo
 * responde, essas linhas precisam sair — e sem TTL para vencer, sair quer dizer
 * aqui.
 *
 * O resto do cache é preservado (vira `engine = 'lazer'`, que é o que de fato
 * calculou): são os mapas vanilla, a maioria das linhas, e recalculá-los custa
 * baixar e reprocessar .osu à toa.
 *
 * Detecção pelo próprio schema, como as anteriores: sem a coluna `engine`, a
 * tabela é a antiga.
 */
function acrescentarEngineNaMapDifficulty(db) {
  const temEngine = db.prepare('PRAGMA cache.table_info(map_difficulty)').all()
    .some(c => c.name === 'engine');
  if (temEngine) return;

  db.exec(`
    BEGIN;
    CREATE TABLE cache.map_difficulty_new (
      map_id    INTEGER NOT NULL,
      mods      TEXT    NOT NULL,
      engine    TEXT    NOT NULL,
      stars     REAL    NOT NULL,
      max_combo INTEGER,
      PRIMARY KEY (map_id, mods, engine)
    );
    INSERT INTO cache.map_difficulty_new (map_id, mods, engine, stars, max_combo)
      SELECT map_id, mods, 'lazer', stars, max_combo
      FROM cache.map_difficulty
      WHERE ',' || mods || ',' NOT LIKE '%,RX,%';
    DROP TABLE cache.map_difficulty;
    ALTER TABLE cache.map_difficulty_new RENAME TO map_difficulty;
    COMMIT;
  `);

  console.log('[db] map_difficulty agora separa lazer de akatsuki; as estrelas de RX serão recalculadas sob demanda.');
}

// ─── 4 → 5: o vanilla passa a ser calculado pelo rosu-pp ──────────────────────

/**
 * Apaga as linhas do motor `lazer` da map_difficulty e da fc_pp.
 *
 * O vanilla trocou o lazer-calculator pelo rosu-pp do fork, e a chave passou a
 * dizer `engine = 'rosu'`. As linhas antigas deixariam de ser encontradas de
 * qualquer jeito, mas nenhuma das duas tabelas tem TTL que as vença — ficariam
 * ocupando espaço para sempre. Não se aproveitam como `rosu` porque o fork segue
 * o lazer master, que pode estar à frente do build do lazer-calculator que as
 * gravou; aproveitá-las seria misturar dois momentos do algoritmo na mesma tela.
 *
 * O Relax (`akatsuki`) fica: é outro motor, e ele não mudou.
 */
function descartarCacheDoLazer(db) {
  const apagadas =
    db.prepare("DELETE FROM cache.map_difficulty WHERE engine = 'lazer'").run().changes +
    db.prepare("DELETE FROM cache.fc_pp WHERE engine = 'lazer'").run().changes;

  if (apagadas > 0) {
    console.log(`[db] ${apagadas} valor(es) do lazer-calculator descartados; o rosu-pp recalcula sob demanda.`);
  }
}

// ─── 5 → 6: um rosu-pp por servidor ───────────────────────────────────────────

/**
 * Apaga as linhas do motor `rosu` da map_difficulty e da fc_pp.
 *
 * O rosu-pp virou dois builds, um para o Bancho e outro para o Daycore e quem
 * não tem rework próprio (ver pp/engines.js), e a chave passou a dizer qual —
 * com a versão do pacote junto, para um rework novo não herdar os números do
 * anterior. As linhas `rosu` não se sabe de qual servidor vieram, e as duas
 * tabelas não têm TTL que as vença.
 *
 * O `akatsuki` fica: o motor é o mesmo, e a chave dele não mudou.
 */
function descartarCacheDoRosuUnico(db) {
  const apagadas =
    db.prepare("DELETE FROM cache.map_difficulty WHERE engine = 'rosu'").run().changes +
    db.prepare("DELETE FROM cache.fc_pp WHERE engine = 'rosu'").run().changes;

  if (apagadas > 0) {
    console.log(`[db] ${apagadas} valor(es) do rosu-pp sem servidor descartados; recalculados sob demanda.`);
  }
}

// ─── 6 → 7: o akatsuki-pp no commit de cada servidor ──────────────────────────

/**
 * Apaga as linhas do motor `akatsuki` da map_difficulty e da fc_pp.
 *
 * Elas vieram do akatsuki-pp-py do PyPI, num commit do akatsuki-pp-rs que
 * nenhum dos servidores roda. Os builds novos (ver pp/engines.js) gravam sob
 * `akatsuki@<versão>` e `daycore_rx@<versão>`, então as antigas nunca mais
 * seriam lidas — só ocupariam espaço, sem TTL que as vença.
 */
function descartarCacheDoAkatsukiPy(db) {
  const apagadas =
    db.prepare("DELETE FROM cache.map_difficulty WHERE engine = 'akatsuki'").run().changes +
    db.prepare("DELETE FROM cache.fc_pp WHERE engine = 'akatsuki'").run().changes;

  if (apagadas > 0) {
    console.log(`[db] ${apagadas} valor(es) do akatsuki-pp-py descartados; recalculados sob demanda.`);
  }
}

// ─── 7 → 8: o link do modelo antigo sai da tabela users ──────────────────────

/**
 * Zera `users.osu_user`, `osu_server` e `osu_id`.
 *
 * É onde o modelo antigo guardava o único link de cada um. A migração para
 * `user_links` copiou os valores e deixou a origem como estava, e desde então
 * nada lê nem grava essas colunas — então o `/link remove` não as alcançava, e
 * o nick de quem linkou naquela época ficava guardado sem motivo nenhum.
 */
function zerarLinkAntigoDeUsers(db) {
  const zeradas = db.prepare(`
    UPDATE users SET osu_user = NULL, osu_server = NULL, osu_id = NULL
    WHERE osu_user IS NOT NULL OR osu_server IS NOT NULL OR osu_id IS NOT NULL
  `).run().changes;

  if (zeradas > 0) {
    console.log(`[db] Link do modelo antigo apagado de ${zeradas} usuário(s); os links valem só em user_links.`);
  }
}

// ─── 8 → 9: formato do score total (classic/standardised) ─────────────────────

/**
 * `users.score_format`: se o score total dos embeds de play sai no formato do
 * stable (`legacy_total_score`) ou no standardised do lazer (`total_score`).
 * Nasce NULL, que é o padrão — o clássico, o que o bot já mostrava.
 */
function acrescentarColunaScoreFormat(db) {
  const colunas = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!colunas.includes('score_format')) {
    db.exec('ALTER TABLE users ADD COLUMN score_format TEXT');
  }
}

// ─── 9 → 10: layout do embed do /recent ───────────────────────────────────────

/**
 * `users.embed_layout`: quais pedaços do embed do /recent a pessoa quer ver
 * (ver embedLayout.js). Nasce NULL, que é o padrão — o embed completo, o que o
 * bot já mostrava.
 */
function acrescentarColunaEmbedLayout(db) {
  const colunas = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!colunas.includes('embed_layout')) {
    db.exec('ALTER TABLE users ADD COLUMN embed_layout TEXT');
  }
}

// ─── scores.db: a trilha própria ──────────────────────────────────────────────

/**
 * A versão do schema do scores.db — separada da `VERSAO_ATUAL`, que é do bot.db.
 *
 * Separada porque o arquivo é outro. Subir a `VERSAO_ATUAL` por causa de uma
 * tabela que nem mora no bot.db faria o `conferirVersao` recusar o código
 * anterior, e voltar o código passaria a exigir restaurar backup — por uma
 * mudança que não tocou um byte do bot.db.
 *
 * Ao acrescentar uma migração do scores.db, suba esta e trate a faixa nova em
 * `runScores`, no mesmo formato de `run`.
 */
const VERSAO_SCORES = 1;

/**
 * Leva o scores.db até a `VERSAO_SCORES`, e diz se ele pode ser usado.
 *
 * Arquivo novo (versão 0) já foi criado no formato atual pelo `schema.apply`:
 * só falta o carimbo.
 *
 * Arquivo MAIS NOVO que este código NÃO derruba o boot, ao contrário do bot.db:
 * guardar score é acessório, e o bot responde igual sem ele. O store se desliga
 * (ver scoreStore.js), e o aviso diz por quê.
 *
 * @returns {boolean} se o scores.db está numa versão que este código conhece
 */
function runScores(db) {
  const versao = db.prepare('PRAGMA scores.user_version').get().user_version;

  if (versao > VERSAO_SCORES) {
    console.warn(
      `[db] O scores.db está na versão ${versao}, e este código só conhece até a ${VERSAO_SCORES}. ` +
      'Os scores não serão gravados até o código ser atualizado.',
    );
    return false;
  }

  if (versao < VERSAO_SCORES) {
    db.exec(`PRAGMA scores.user_version = ${VERSAO_SCORES}`);
  }
  return true;
}

// ─── Execução ─────────────────────────────────────────────────────────────────

function run(db) {
  const versao = db.prepare('PRAGMA user_version').get().user_version;
  conferirVersao(versao);
  if (versao === VERSAO_ATUAL) return versao;

  if (versao < 2) {
    migrarCachesDeCalculoParaMods(db);
  }

  if (versao < 3) {
    acrescentarColunaPreferredModo(db);
  }

  if (versao < 4) {
    acrescentarEngineNaMapDifficulty(db);
  }

  if (versao < 5) {
    descartarCacheDoLazer(db);
  }

  if (versao < 6) {
    descartarCacheDoRosuUnico(db);
  }

  if (versao < 7) {
    descartarCacheDoAkatsukiPy(db);
  }

  if (versao < 8) {
    zerarLinkAntigoDeUsers(db);
  }

  if (versao < 9) {
    acrescentarColunaScoreFormat(db);
  }

  if (versao < 10) {
    acrescentarColunaEmbedLayout(db);
  }

  // Interpolado porque PRAGMA não aceita parâmetro; o valor é uma constante do
  // código, não entrada de ninguém.
  db.exec(`PRAGMA user_version = ${VERSAO_ATUAL}`);
  return VERSAO_ATUAL;
}

module.exports = {
  run, ehNovo, conferirOrigem, backupAntesDeMigrar, carimbar, VERSAO_ATUAL, VERSAO_MINIMA,
  runScores, VERSAO_SCORES,
};
