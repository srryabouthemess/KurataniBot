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
 * A faixa 0→1 é o conjunto herdado, de quando não havia numeração — por isso
 * ela é um bloco só, e não uma migração por assunto.
 */

const fs   = require('fs');
const path = require('path');

const servers = require('../servers');
const { DATA_DIR } = require('../paths');

const VERSAO_ATUAL = 3;

// Dados de versões antigas do bot, que viviam como JSON na raiz.
const OLD_LINKS_PATH = path.join(DATA_DIR, 'links.json');
const OLD_LANGS_PATH = path.join(DATA_DIR, 'languages.json');

/** Namespace de conta a que um servidor pertence. */
const linkNamespace = (server) => servers.namespace(server);

// ─── 0 → 1: tudo que existia antes da numeração ───────────────────────────────

/**
 * O cache de mapas sai do bot.db para o cache.db.
 *
 * As três tabelas nasceram dentro do bot.db. Movê-las é o que faz o backup do
 * que importa deixar de carregar dezenas de MB de coisa descartável.
 */
function moverCacheParaArquivoProprio(db) {
  const inMain = name => db
    .prepare("SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);

  let moved = 0;

  if (inMain('beatmap_files')) {
    // A coluna `last_used` só existe em bancos que passaram pela migração de
    // LRU; nos mais antigos, o `fetched_at` faz as vezes dela.
    const hasLastUsed = db.prepare('PRAGMA main.table_info(beatmap_files)').all()
      .some(c => c.name === 'last_used');

    db.exec(`
      INSERT OR IGNORE INTO cache.beatmap_files (map_id, content, fetched_at, last_used)
      SELECT map_id, content, fetched_at, ${hasLastUsed ? 'last_used' : 'fetched_at'}
      FROM main.beatmap_files;
      DROP TABLE main.beatmap_files;
    `);
    moved++;
  }

  if (inMain('beatmap_meta')) {
    db.exec(`
      INSERT OR IGNORE INTO cache.beatmap_meta SELECT * FROM main.beatmap_meta;
      DROP TABLE main.beatmap_meta;
    `);
    moved++;
  }

  if (inMain('map_difficulty')) {
    db.exec(`
      INSERT OR IGNORE INTO cache.map_difficulty SELECT * FROM main.map_difficulty;
      DROP TABLE main.map_difficulty;
    `);
    moved++;
  }

  if (moved > 0) {
    // DROP TABLE não devolve o espaço ao sistema de arquivos: sem isto o
    // bot.db continuaria do tamanho que tinha com o cache dentro, que é
    // justamente o que a separação queria resolver. O checkpoint vem antes
    // porque o VACUUM sozinho não recolhe o que ainda está no -wal — medido:
    // 444KB antes, 68KB depois.
    db.exec('PRAGMA main.wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM main');
    console.log(`[db] Cache de mapas movido para cache.db (${moved} tabela(s)).`);
  }
}

/**
 * Colunas que chegaram por ALTER TABLE.
 *
 * Num banco novo elas já vêm do schema, e este passo não faz nada. SQLite não
 * tem ADD COLUMN IF NOT EXISTS, então a checagem é manual.
 *
 * - `users.osu_id`: o link guardava só o nome, então quem trocasse de nick tinha
 *   o link quebrado em silêncio. O ID nunca muda.
 * - `users.preferred_server`: servidor usado quando o comando não diz qual.
 *   Guarda a chave completa (com o `_rx`) para lembrar a preferência entre
 *   vanilla e RX, que compartilham a conta.
 * - `staff_links.proof`: como o vínculo foi estabelecido (ver schema.js).
 */
function acrescentarColunas(db) {
  const colunas = (tabela) => db.prepare(`PRAGMA table_info(${tabela})`).all().map(c => c.name);

  const users = colunas('users');
  if (!users.includes('osu_id'))           db.exec('ALTER TABLE users ADD COLUMN osu_id INTEGER');
  if (!users.includes('preferred_server')) db.exec('ALTER TABLE users ADD COLUMN preferred_server TEXT');

  if (!colunas('staff_links').includes('proof')) {
    db.exec('ALTER TABLE staff_links ADD COLUMN proof TEXT');
  }
}

/**
 * Link único → link por conta.
 *
 * O modelo antigo guardava um só link em users(osu_user, osu_server, osu_id),
 * então linkar o Daycore apagava o link do Bancho. Move o link existente para
 * user_links e adota o servidor dele como preferido.
 */
function migrarLinksParaPorConta(db) {
  if (db.prepare("SELECT value FROM meta WHERE key = 'links_migrated'").get()) return;

  const rows = db
    .prepare('SELECT discord_id, osu_user, osu_server, osu_id FROM users WHERE osu_user IS NOT NULL')
    .all();

  const insert = db.prepare(`
    INSERT INTO user_links (discord_id, namespace, osu_user, osu_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id, namespace) DO NOTHING
  `);
  const setPreferred = db.prepare('UPDATE users SET preferred_server = ? WHERE discord_id = ?');

  for (const row of rows) {
    const server = row.osu_server ?? 'official';
    insert.run(row.discord_id, linkNamespace(server), row.osu_user, row.osu_id ?? null);
    setPreferred.run(server, row.discord_id);
  }

  db.prepare("INSERT INTO meta (key, value) VALUES ('links_migrated', ?)").run(String(Date.now()));
  if (rows.length > 0) {
    console.log(`[db] Migrados ${rows.length} link(s) para o modelo por conta (user_links).`);
  }
}

/**
 * Nomes fixos de servidor → chaves do registro.
 *
 * Enquanto só existia um servidor privado, ele era 'private'/'private_rx' e o
 * namespace era 'daycore', ambos escritos no código. Agora os dois saem do
 * registro (servers.js), então as linhas antigas passam a apontar para o
 * primeiro servidor configurado — o mesmo que elas significavam.
 */
function migrarChavesDeServidor(db) {
  if (db.prepare("SELECT value FROM meta WHERE key = 'servers_migrated'").get()) return;

  const vanilla = servers.resolveKey('private');
  const relax   = servers.resolveKey('private_rx');

  let moved = 0;
  if (vanilla) {
    // UPDATE OR IGNORE: se a pessoa já tiver link no namespace de destino, o
    // antigo é descartado em vez de estourar a chave primária.
    moved += db.prepare("UPDATE OR IGNORE user_links SET namespace = ? WHERE namespace = 'daycore'")
      .run(servers.namespace(vanilla)).changes;
    moved += db.prepare("UPDATE users SET preferred_server = ? WHERE preferred_server = 'private'")
      .run(vanilla).changes;
    moved += db.prepare("UPDATE users SET preferred_server = ? WHERE preferred_server = 'private_rx'")
      .run(relax ?? vanilla).changes;
  }

  db.prepare("INSERT INTO meta (key, value) VALUES ('servers_migrated', ?)").run(String(Date.now()));
  if (moved > 0) console.log(`[db] ${moved} registro(s) apontados para as chaves de servidor novas.`);
}

/**
 * Nomeação passa a ser única por conta de jogo.
 *
 * A chave era (set_id, target_status, discord_id), o que contava contas do
 * Discord em vez de contas do servidor: duas contas do Discord ligadas ao mesmo
 * osu! id valiam duas nomeações, e uma pessoa sozinha atingia um limiar de 2.
 *
 * Detecção pelo próprio schema em vez de flag no `meta`: se `discord_id` ainda
 * faz parte da PK, a tabela é a antiga. Assim a migração é idempotente por
 * construção, e não depende de o registro da flag ter sobrevivido.
 */
function migrarNomeacoesParaPorConta(db) {
  const columns = db.prepare('PRAGMA table_info(map_nominations)').all();
  if (!columns.some(c => c.name === 'discord_id' && c.pk > 0)) return;

  // Numa colisão fica a nomeação MAIS ANTIGA: é a que de fato aconteceu
  // primeiro; as seguintes eram o voto duplicado que não deveria existir.
  // (Em SQLite, colunas "nuas" num GROUP BY com MIN() vêm da linha do mínimo.)
  db.exec(`
    BEGIN;
    CREATE TABLE map_nominations_new (
      set_id        INTEGER NOT NULL,
      target_status INTEGER NOT NULL,
      osu_id        INTEGER NOT NULL,
      discord_id    TEXT    NOT NULL,
      osu_name      TEXT,
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (set_id, target_status, osu_id)
    );
    INSERT INTO map_nominations_new
      (set_id, target_status, osu_id, discord_id, osu_name, created_at)
      SELECT set_id, target_status, osu_id, discord_id, osu_name, MIN(created_at)
      FROM map_nominations
      GROUP BY set_id, target_status, osu_id;
    DROP TABLE map_nominations;
    ALTER TABLE map_nominations_new RENAME TO map_nominations;
    COMMIT;
  `);

  const kept = db.prepare('SELECT COUNT(*) AS c FROM map_nominations').get().c;
  console.log(`[db] Nomeações passaram a ser únicas por conta de jogo (${kept} na fila).`);
}

/**
 * Os arquivos JSON de antes do SQLite.
 *
 * Só roda se ainda houver arquivos antigos no disco e a tabela estiver vazia —
 * evita reimportar por cima de dado mais novo.
 */
function migrarDoJson(db) {
  const usersEmpty = db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0;
  if (!usersEmpty) return;

  const hasOldFiles = fs.existsSync(OLD_LINKS_PATH) || fs.existsSync(OLD_LANGS_PATH);
  if (!hasOldFiles) return;

  console.log('[db] Migrando links.json / languages.json antigos para bot.db...');

  const links = fs.existsSync(OLD_LINKS_PATH)
    ? JSON.parse(fs.readFileSync(OLD_LINKS_PATH, 'utf8'))
    : {};
  const langs = fs.existsSync(OLD_LANGS_PATH)
    ? JSON.parse(fs.readFileSync(OLD_LANGS_PATH, 'utf8'))
    : { users: {}, servers: {} };

  const discordIds = new Set([
    ...Object.keys(links),
    ...Object.keys(langs.users ?? {}),
  ]);

  const upsertUser = db.prepare(`
    INSERT INTO users (discord_id, osu_user, osu_server, lang)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      osu_user = excluded.osu_user, osu_server = excluded.osu_server, lang = excluded.lang
  `);
  for (const id of discordIds) {
    const link = links[id];
    const lang = langs.users?.[id] ?? null;
    upsertUser.run(id, link?.osu_user ?? null, link?.server ?? null, lang);
  }

  const upsertGuild = db.prepare(`
    INSERT INTO guild_settings (guild_id, lang) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET lang = excluded.lang
  `);
  for (const [guildId, lang] of Object.entries(langs.servers ?? {})) {
    upsertGuild.run(guildId, lang);
  }

  // Renomeia os arquivos antigos em vez de apagar — fica como backup.
  for (const p of [OLD_LINKS_PATH, OLD_LANGS_PATH]) {
    if (fs.existsSync(p)) fs.renameSync(p, `${p}.migrated`);
  }

  console.log(`[db] Migração concluída: ${discordIds.size} usuário(s), ${Object.keys(langs.servers ?? {}).length} servidor(es).`);
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

// ─── Execução ─────────────────────────────────────────────────────────────────

function run(db) {
  const versao = db.prepare('PRAGMA user_version').get().user_version;
  if (versao >= VERSAO_ATUAL) return versao;

  if (versao < 1) {
    // A ORDEM importa: as colunas precisam existir antes de quem escreve nelas,
    // e o cache sai do bot.db antes do VACUUM que recolhe o espaço.
    moverCacheParaArquivoProprio(db);
    acrescentarColunas(db);
    migrarLinksParaPorConta(db);
    migrarChavesDeServidor(db);
    migrarNomeacoesParaPorConta(db);
    migrarDoJson(db);
  }

  if (versao < 2) {
    migrarCachesDeCalculoParaMods(db);
  }

  if (versao < 3) {
    acrescentarColunaPreferredModo(db);
  }

  // Interpolado porque PRAGMA não aceita parâmetro; o valor é uma constante do
  // código, não entrada de ninguém.
  db.exec(`PRAGMA user_version = ${VERSAO_ATUAL}`);
  return VERSAO_ATUAL;
}

module.exports = { run, VERSAO_ATUAL };
