/**
 * db.js
 * Persistência do bot em SQLite (node:sqlite, nativo do Node — sem dependência
 * externa nem build nativo).
 *
 * Antes disso o bot usava dois arquivos JSON separados (links.json e
 * languages.json), escritos com fs.writeFileSync sem nenhuma garantia de
 * atomicidade entre requisições concorrentes. O SQLite resolve isso e também
 * deixa todas as preferências do usuário (link osu! + idioma, e no futuro
 * outras) numa tabela só.
 *
 * Tabelas:
 *   users           → discord_id (PK), osu_user, osu_server, lang
 *   guild_settings  → guild_id (PK), lang
 */

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  // node:sqlite chegou no v22.5.0, mas até o v22.12 exigia a flag
  // --experimental-sqlite; só a partir do v22.13/v23.4 funciona sem flag.
  console.error(
    `❌ Este bot requer Node.js 22.13+ (módulo nativo "node:sqlite" indisponível).\n` +
    `   Versão atual: ${process.version}. Atualize o Node.js e tente novamente.`
  );
  process.exit(1);
}

const fs   = require('fs');
const path = require('path');
const servers = require('./servers');
const { DATA_DIR, BOT_DB, CACHE_DB } = require('./paths');

// Os bancos ficam fora de src/: dado não acompanha reorganização de pasta de
// código (ver paths.js).
const DB_PATH        = BOT_DB;
const CACHE_PATH     = CACHE_DB;
const OLD_LINKS_PATH = path.join(DATA_DIR, 'links.json');
const OLD_LANGS_PATH = path.join(DATA_DIR, 'languages.json');

const db = new DatabaseSync(DB_PATH);

// WAL melhora leitura concorrente e deixa a escrita mais barata; o bot lê o
// cache de mapas com muito mais frequência do que escreve.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

/**
 * O cache de mapas mora em OUTRO arquivo, anexado a esta mesma conexão.
 *
 * Os dados que importam (links, idiomas, staff, nomeações) somam alguns KB; o
 * cache de `.osu` chega perto de 90MB com o teto padrão. Junto num arquivo só,
 * todo backup, cópia ou VACUUM carregava dezenas de MB de coisa regenerável —
 * e não dava para apagar o cache sem colocar o resto em risco.
 *
 * ATTACH em vez de uma segunda conexão: as consultas continuam num handle só
 * (transação atravessa os dois arquivos, `close()` fecha tudo), e a separação
 * aparece apenas no prefixo `cache.` das tabelas.
 */
// As aspas simples são dobradas porque é assim que o SQLite escapa uma aspa
// dentro de literal de texto. O caminho vem do __dirname, não de usuário, então
// não é injeção — mas basta um apóstrofo em `C:\Users\O'Brien\KurataniBot` para
// o ATTACH virar SQL inválido e o bot não subir, com um erro de sintaxe que não
// menciona o nome da pasta em lugar nenhum.
const CACHE_DB_LITERAL = CACHE_PATH.replace(/\\/g, '/').replace(/'/g, "''");
db.exec(`ATTACH DATABASE '${CACHE_DB_LITERAL}' AS cache`);
db.exec('PRAGMA cache.journal_mode = WAL');
db.exec('PRAGMA cache.synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    discord_id  TEXT PRIMARY KEY,
    osu_user    TEXT,
    osu_server  TEXT,
    lang        TEXT
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    lang     TEXT
  );

  -- Um link por CONTA, não por opção de servidor: um servidor e a variante RX
  -- dele são o mesmo cadastro, mudando só o mode (0 vs 4). Guardar os dois
  -- separadamente obrigaria a pessoa a linkar o mesmo nick duas vezes. O
  -- namespace é a chave do servidor no registro (ver servers.js).
  CREATE TABLE IF NOT EXISTS user_links (
    discord_id TEXT    NOT NULL,
    namespace  TEXT    NOT NULL,  -- 'official' | 'daycore'
    osu_user   TEXT    NOT NULL,
    osu_id     INTEGER,
    PRIMARY KEY (discord_id, namespace)
  );

  -- Estado interno do bot (ex: hash do conjunto de slash commands já
  -- registrado no Discord).
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- ── Vínculo de staff do Daycore ────────────────────────────────────────────
  -- SEPARADA de user_links de propósito, e não é a mesma coisa.
  --
  -- user_links é auto-declarado: /link set só confere que a conta existe, não
  -- que você é dono dela. Isso é inofensivo no propósito original (os comandos
  -- de consulta só mostram dados públicos — fingir ser outro não dá nada), e
  -- seria desastroso como base de permissão: bastaria linkar o nick de um
  -- admin para herdar os poderes dele.
  --
  -- Aqui o vínculo só entra por quem tem Administrator no Discord do Daycore,
  -- que é uma autoridade real: aquele servidor é controlado por quem manda no
  -- Daycore. O priv continua sendo lido do Daycore a cada comando, então
  -- tirar o cargo de alguém lá revoga o acesso no bot na hora.
  CREATE TABLE IF NOT EXISTS staff_links (
    discord_id  TEXT    PRIMARY KEY,
    osu_id      INTEGER NOT NULL,
    osu_name    TEXT,
    added_by    TEXT    NOT NULL,
    added_at    INTEGER NOT NULL
  );

  -- Desafio pendente de vínculo: o código que prova posse da conta de jogo.
  --
  -- O /staff register nasceu auto-declarado — quem tinha Administrator no
  -- Discord apontava o próprio Discord para o nick de qualquer staff e herdava
  -- o privilégio dele. Enquanto o pior caso era uma restrição reversível isso
  -- passou; com o /wipe, que apaga scores sem volta, deixou de passar.
  --
  -- Agora o register só emite um código. Quem controla a conta de jogo escreve
  -- esse código no perfil dela (userpage_content, editável apenas por quem
  -- entra na conta) e roda /staff confirm — e é o confirm que cria o vínculo.
  -- Um administrador do Discord não consegue escrever no perfil alheio, então
  -- não consegue mais se vincular a uma conta que não é dele.
  CREATE TABLE IF NOT EXISTS staff_link_challenges (
    discord_id   TEXT    PRIMARY KEY,
    osu_id       INTEGER NOT NULL,
    osu_name     TEXT,
    code         TEXT    NOT NULL,
    requested_by TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  );

  -- ── Nomeação de mapas do Daycore ───────────────────────────────────────────
  -- O bancho.py-ex não tem conceito de "fila de nomeação": ele só sabe aplicar
  -- um status final num mapa. Todo o processo social (quem nomeou, quantos
  -- faltam, histórico) vive aqui, e o Daycore só é tocado na decisão final.
  --
  -- A chave inclui o status alvo para que nomear um set para "ranked" e para
  -- "loved" sejam filas independentes.
  --
  -- A identidade que conta é a conta do JOGO, não a do Discord: é dela que o
  -- privilégio de nominator é lido, e é ela que o limiar quer contar. Com a
  -- chave em discord_id, duas contas do Discord apontando para o mesmo osu! id
  -- valiam como duas nomeações — uma pessoa sozinha atingia um limiar de 2.
  -- O discord_id continua guardado, mas como registro de quem operou.
  CREATE TABLE IF NOT EXISTS map_nominations (
    set_id        INTEGER NOT NULL,
    target_status INTEGER NOT NULL,
    osu_id        INTEGER NOT NULL,
    discord_id    TEXT    NOT NULL,
    osu_name      TEXT,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (set_id, target_status, osu_id)
  );

  -- Cache do que o mapa é, para a fila poder ser listada sem uma chamada de
  -- API por linha.
  CREATE TABLE IF NOT EXISTS nomination_maps (
    set_id     INTEGER PRIMARY KEY,
    artist     TEXT,
    title      TEXT,
    creator    TEXT,
    diff_count INTEGER,
    cached_at  INTEGER NOT NULL
  );

  -- Log local de tudo que o bot mandou o Daycore fazer. O bancho tem o log de
  -- auditoria dele (e recebe o osu! ID de quem pediu), mas ele não sabe que a
  -- ação veio do Discord nem de qual conta do Discord — isso só existe aqui.
  CREATE TABLE IF NOT EXISTS admin_actions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    action            TEXT    NOT NULL,  -- 'rank' | 'restrict' | 'unrestrict'
    target            TEXT    NOT NULL,  -- set_id ou osu_id do alvo
    detail            TEXT,
    actor_discord_id  TEXT    NOT NULL,
    actor_osu_id      INTEGER NOT NULL,
    actor_osu_name    TEXT,
    created_at        INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions (created_at DESC);
`);

// ─── Cache de mapas (arquivo separado) ────────────────────────────────────────
// Tudo aqui é regenerável: pode ser apagado a qualquer momento que o bot só
// baixa de novo. Por isso mora fora do bot.db.
db.exec(`
  -- Conteúdo bruto dos arquivos .osu. Antes eram baixados de novo (≈50KB cada)
  -- a cada cálculo de PP — inclusive ao virar página no /topplays, que refaz o
  -- cálculo das mesmas 5 plays. Equivale à osu_map_file_content do BathBot.
  CREATE TABLE IF NOT EXISTS cache.beatmap_files (
    map_id     INTEGER PRIMARY KEY,
    content    BLOB    NOT NULL,
    fetched_at INTEGER NOT NULL,
    last_used  INTEGER
  );

  -- A evicção ordena por "usado menos recentemente" a cada download novo, e sem
  -- índice isso varre a tabela inteira, que é onde os BLOBs moram. Medido com o
  -- cache cheio (1500 mapas, 87MB): 41ms de event loop parado por mapa novo,
  -- contra 0,07ms com o índice.
  CREATE INDEX IF NOT EXISTS cache.idx_beatmap_files_lru
    ON beatmap_files (COALESCE(last_used, fetched_at));

  -- Metadados de beatmap (max_combo, difficulty_rating, título, artista).
  -- Substitui o beatmap_cache.json, que reescrevia o arquivo inteiro a cada
  -- mapa novo e não tinha limite de tamanho.
  CREATE TABLE IF NOT EXISTS cache.beatmap_meta (
    map_id    INTEGER PRIMARY KEY,
    data      TEXT    NOT NULL,
    cached_at INTEGER NOT NULL
  );

  -- Atributos de dificuldade já calculados, por combinação mapa+mods+mecânica.
  -- Espelha a osu_map_difficulty do BathBot (PRIMARY KEY (map_id, mods)) e
  -- elimina o POST em /beatmaps/{id}/attributes que o getAdjustedStars fazia
  -- a cada exibição.
  CREATE TABLE IF NOT EXISTS cache.map_difficulty (
    map_id    INTEGER NOT NULL,
    mods_bits INTEGER NOT NULL,
    lazer     INTEGER NOT NULL,
    stars     REAL    NOT NULL,
    max_combo INTEGER,
    PRIMARY KEY (map_id, mods_bits, lazer)
  );

  -- PP que o score teria rendido em FC.
  --
  -- A map_difficulty acima já poupava o cálculo das ESTRELAS, e o do FC pp
  -- continuava sendo refeito do zero a cada exibição: parse do .osu, atributos
  -- de dificuldade e performance, tudo de novo, para um número que só depende
  -- de coisas que não mudam. Medido nos 12 maiores .osu do cache: 1,54ms de
  -- parse + 4,28ms de dificuldade + 0,34ms de performance por play, ou ~30ms de
  -- event loop parado por página de /topplays — em TODA renderização, inclusive
  -- num mapa já calculado mil vezes antes.
  --
  -- A coluna "engine" está na chave porque os dois motores dão números
  -- diferentes de propósito (rosu-pp para o algoritmo oficial, akatsuki-pp para
  -- o Relax), e a mecânica lazer/stable separa o rosu em dois — é a mesma
  -- dimensão que a map_difficulty guarda na coluna "lazer".
  --
  -- SEM TTL, como a map_difficulty: o resultado é função pura do arquivo .osu,
  -- que para mapa ranqueado não muda. O caso não coberto é o mesmo das duas
  -- tabelas — reupload de mapa loved/graveyard mantém o número antigo até a
  -- entrada ser descartada pelo teto abaixo.
  CREATE TABLE IF NOT EXISTS cache.fc_pp (
    map_id    INTEGER NOT NULL,
    mods_bits INTEGER NOT NULL,
    engine    TEXT    NOT NULL,  -- 'rosu-lazer' | 'rosu-stable' | 'akatsuki'
    n300      INTEGER NOT NULL,  -- já com os misses somados (ver pp.js)
    n100      INTEGER NOT NULL,
    n50       INTEGER NOT NULL,
    pp        REAL    NOT NULL,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (map_id, mods_bits, engine, n300, n100, n50)
  );

  -- Mesma razão do índice de LRU dos arquivos: sem ele a evicção ordena
  -- varrendo a tabela inteira a cada inserção.
  CREATE INDEX IF NOT EXISTS cache.idx_fc_pp_age ON fc_pp (cached_at);
`);

// ─── Migração: cache sai do bot.db para o cache.db ────────────────────────────
// As três tabelas nasceram dentro do bot.db. Movê-las é o que faz o backup do
// que importa deixar de carregar dezenas de MB de coisa descartável.
{
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

// ─── Migração de schema: users.osu_id ─────────────────────────────────────────
// O link guardava só o nome do jogador, então quem trocasse de nick no osu!
// tinha o link quebrado silenciosamente (aparecia como "jogador não
// encontrado"). O ID nunca muda — passamos a guardá-lo e a usá-lo como fonte
// da verdade, mantendo o nome só para exibição.
// SQLite não tem ADD COLUMN IF NOT EXISTS, então checamos antes.
{
  const columns = db.prepare('PRAGMA table_info(users)').all();
  if (!columns.some(c => c.name === 'osu_id')) {
    db.exec('ALTER TABLE users ADD COLUMN osu_id INTEGER');
  }
  // (a coluna `proof` de staff_links é migrada mais abaixo, junto do resto do
  // fluxo de vínculo)
  // Servidor usado quando o comando não especifica um. Guarda a chave completa
  // (com o `_rx` quando for o caso) para lembrar a preferência entre vanilla e
  // RX, que compartilham a mesma conta.
  if (!columns.some(c => c.name === 'preferred_server')) {
    db.exec('ALTER TABLE users ADD COLUMN preferred_server TEXT');
  }
}

// ─── Migração: como cada vínculo de staff foi estabelecido ────────────────────
// Três origens, e a diferença entre elas decide quem pode avalizar outro:
//
//   'self'   — a pessoa provou a posse da conta (código no perfil). Só estes,
//              e com DEVELOPER no jogo, podem avalizar vínculo de terceiro.
//   'vouch'  — criado por um DEVELOPER de vínculo 'self'. A identidade foi
//              AFIRMADA, não provada, então não avaliza mais ninguém: sem isso
//              uma afirmação viraria poder de afirmar, em cadeia.
//   NULL     — anterior à prova existir. Continua valendo (revogá-los trancaria
//              o dono fora do próprio bot), mas não avaliza: quem tivesse
//              explorado o furo antes de ele ser fechado seguiria com o poder
//              que o furo dava.
//
// SQLite não tem ADD COLUMN IF NOT EXISTS, então checamos antes.
{
  const columns = db.prepare('PRAGMA table_info(staff_links)').all();
  if (!columns.some(c => c.name === 'proof')) {
    db.exec('ALTER TABLE staff_links ADD COLUMN proof TEXT');
  }
}

// A marca de último uso (LRU em vez de FIFO na evicção) já nasce na tabela do
// cache.db; nos bancos antigos ela veio junto na migração acima.

/**
 * Namespace de conta a que um servidor pertence.
 * Vanilla e RX do mesmo servidor são a mesma conta, então compartilham o link.
 */
function linkNamespace(server) {
  return servers.namespace(server);
}

// ─── Migração: link único → link por conta ────────────────────────────────────
// O modelo antigo guardava um só link em users(osu_user, osu_server, osu_id),
// então linkar o Daycore apagava o link do Bancho. Move o link existente para
// user_links e adota o servidor dele como preferido.
{
  const alreadyMigrated = db.prepare("SELECT value FROM meta WHERE key = 'links_migrated'").get();
  if (!alreadyMigrated) {
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
}

// ─── Migração: nomes fixos de servidor → chaves do registro ───────────────────
// Enquanto só existia um servidor privado, ele era 'private'/'private_rx' e o
// namespace era 'daycore', ambos escritos no código. Agora os dois saem do
// registro (servers.js), então as linhas antigas passam a apontar para o
// primeiro servidor configurado — o mesmo que elas significavam.
{
  const alreadyMigrated = db.prepare("SELECT value FROM meta WHERE key = 'servers_migrated'").get();
  if (!alreadyMigrated) {
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
}

// ─── Migração: nomeação passa a ser única por conta de jogo ───────────────────
// A chave era (set_id, target_status, discord_id), o que contava contas do
// Discord em vez de contas do servidor: duas contas do Discord ligadas ao mesmo
// osu! id valiam duas nomeações, e uma pessoa sozinha atingia um limiar de 2.
//
// Detecção pelo próprio schema em vez de flag no `meta`: se `discord_id` ainda
// faz parte da PK, a tabela é a antiga. Assim a migração é idempotente por
// construção, e não depende de o registro da flag ter sobrevivido.
{
  const columns = db.prepare('PRAGMA table_info(map_nominations)').all();
  const discordIsPk = columns.some(c => c.name === 'discord_id' && c.pk > 0);

  if (discordIsPk) {
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
}

// ─── Migração única dos arquivos JSON antigos ─────────────────────────────────
// Só roda se ainda houver arquivos antigos no disco e a tabela estiver vazia
// (evita reimportar toda vez que o bot sobe).
function migrateFromJsonIfNeeded() {
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

migrateFromJsonIfNeeded();

// ─── Links osu! ────────────────────────────────────────────────────────────────

/**
 * Cria ou atualiza o link do usuário para a conta do servidor indicado e
 * adota esse servidor como preferido (o último linkado vira o padrão).
 */
function setLink(discordId, server, osuUser, osuId = null) {
  db.prepare(`
    INSERT INTO user_links (discord_id, namespace, osu_user, osu_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id, namespace) DO UPDATE SET
      osu_user = excluded.osu_user, osu_id = excluded.osu_id
  `).run(discordId, linkNamespace(server), osuUser, osuId);

  setPreferredServer(discordId, server);
}

/** Link do usuário para a conta do servidor indicado, ou null. */
function getLink(discordId, server) {
  const row = db
    .prepare('SELECT osu_user, osu_id FROM user_links WHERE discord_id = ? AND namespace = ?')
    .get(discordId, linkNamespace(server));
  if (!row) return null;
  return { osu_user: row.osu_user, osu_id: row.osu_id ?? null };
}

/** Todos os links do usuário: [{ namespace, osu_user, osu_id }] */
function getAllLinks(discordId) {
  return db
    .prepare('SELECT namespace, osu_user, osu_id FROM user_links WHERE discord_id = ? ORDER BY namespace')
    .all(discordId);
}

/**
 * Remove o link de um servidor, ou todos se `server` for null.
 * @returns {number} quantos links foram removidos
 */
function removeLink(discordId, server = null) {
  if (server === null) {
    const result = db.prepare('DELETE FROM user_links WHERE discord_id = ?').run(discordId);
    db.prepare('UPDATE users SET preferred_server = NULL WHERE discord_id = ?').run(discordId);
    return result.changes;
  }

  const namespace = linkNamespace(server);
  const result = db
    .prepare('DELETE FROM user_links WHERE discord_id = ? AND namespace = ?')
    .run(discordId, namespace);

  // Se o preferido apontava para a conta removida, cai para o que sobrou.
  const preferred = getPreferredServer(discordId);
  if (preferred && linkNamespace(preferred) === namespace) {
    const remaining = getAllLinks(discordId)[0];
    db.prepare('UPDATE users SET preferred_server = ? WHERE discord_id = ?')
      .run(remaining ? servers.keyForNamespace(remaining.namespace) : null, discordId);
  }

  return result.changes;
}

// ─── Servidor preferido ───────────────────────────────────────────────────────

function setPreferredServer(discordId, server) {
  db.prepare(`
    INSERT INTO users (discord_id, preferred_server) VALUES (?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET preferred_server = excluded.preferred_server
  `).run(discordId, server);
}

function getPreferredServer(discordId) {
  return db.prepare('SELECT preferred_server FROM users WHERE discord_id = ?').get(discordId)?.preferred_server ?? null;
}

// ─── Idioma do usuário ──────────────────────────────────────────────────────────

function setUserLang(discordId, lang) {
  db.prepare(`
    INSERT INTO users (discord_id, lang) VALUES (?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET lang = excluded.lang
  `).run(discordId, lang);
}

function getUserLang(discordId) {
  return db.prepare('SELECT lang FROM users WHERE discord_id = ?').get(discordId)?.lang ?? null;
}

function removeUserLang(discordId) {
  if (!getUserLang(discordId)) return false;
  db.prepare('UPDATE users SET lang = NULL WHERE discord_id = ?').run(discordId);
  return true;
}

// ─── Idioma do servidor ─────────────────────────────────────────────────────────

function setServerLang(guildId, lang) {
  if (lang === null) return removeServerLang(guildId);
  db.prepare(`
    INSERT INTO guild_settings (guild_id, lang) VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET lang = excluded.lang
  `).run(guildId, lang);
}

function getServerLang(guildId) {
  return db.prepare('SELECT lang FROM guild_settings WHERE guild_id = ?').get(guildId)?.lang ?? null;
}

function removeServerLang(guildId) {
  const result = db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId);
  return result.changes > 0;
}

// ─── Cache: arquivos .osu ─────────────────────────────────────────────────────

// Mapas ranked não mudam; os que mudam (loved/graveyard reupload) são raros o
// bastante para um TTL longo resolver sem precisar de checksum.
const MAP_FILE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

/**
 * Teto de mapas em cache. Cada .osu costuma ter ~50KB (mapas longos passam de
 * 300KB), então 1500 ≈ 75–150MB.
 *
 * Sem teto, qualquer pessoa com acesso ao bot podia encher o disco: basta
 * chamar /simulate com IDs de mapa diferentes em sequência, e cada um grava um
 * arquivo novo permanentemente. O cooldown limita a taxa, não o total.
 */
const MAP_FILE_MAX_ROWS = Number(process.env.BEATMAP_CACHE_MAX || 1500);

// Só reescreve last_used se a marca estiver velha, para um mapa lido em loop
// (ex: virar página no /topplays) não gerar uma escrita por leitura.
const LAST_USED_REFRESH_MS = 60 * 60 * 1000; // 1 hora

/** @returns {Uint8Array|null} */
function getBeatmapFile(mapId) {
  const row = db
    .prepare('SELECT content, fetched_at, last_used FROM cache.beatmap_files WHERE map_id = ?')
    .get(mapId);
  if (!row) return null;

  const now = Date.now();
  if (now - row.fetched_at > MAP_FILE_TTL_MS) {
    db.prepare('DELETE FROM cache.beatmap_files WHERE map_id = ?').run(mapId);
    return null;
  }

  if (now - (row.last_used ?? 0) > LAST_USED_REFRESH_MS) {
    db.prepare('UPDATE cache.beatmap_files SET last_used = ? WHERE map_id = ?').run(now, mapId);
  }

  return row.content;
}

function setBeatmapFile(mapId, bytes) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO cache.beatmap_files (map_id, content, fetched_at, last_used) VALUES (?, ?, ?, ?)
    ON CONFLICT(map_id) DO UPDATE SET
      content = excluded.content, fetched_at = excluded.fetched_at, last_used = excluded.last_used
  `).run(mapId, bytes, now, now);

  evictBeatmapFilesIfNeeded();
}

/** Descarta os menos usados recentemente até voltar ao teto. */
function evictBeatmapFilesIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM cache.beatmap_files').get().c;
  if (count <= MAP_FILE_MAX_ROWS) return 0;

  const excess = count - MAP_FILE_MAX_ROWS;
  const result = db.prepare(`
    DELETE FROM cache.beatmap_files WHERE map_id IN (
      SELECT map_id FROM cache.beatmap_files
      ORDER BY COALESCE(last_used, fetched_at) ASC
      LIMIT ?
    )
  `).run(excess);

  return result.changes;
}

// ─── Cache: metadados de beatmap ──────────────────────────────────────────────

const MAP_META_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function getBeatmapMeta(mapId) {
  const row = db.prepare('SELECT data, cached_at FROM cache.beatmap_meta WHERE map_id = ?').get(mapId);
  if (!row) return null;
  if (Date.now() - row.cached_at > MAP_META_TTL_MS) {
    db.prepare('DELETE FROM cache.beatmap_meta WHERE map_id = ?').run(mapId);
    return null;
  }
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function setBeatmapMeta(mapId, data) {
  db.prepare(`
    INSERT INTO cache.beatmap_meta (map_id, data, cached_at) VALUES (?, ?, ?)
    ON CONFLICT(map_id) DO UPDATE SET data = excluded.data, cached_at = excluded.cached_at
  `).run(mapId, JSON.stringify(data), Date.now());
}

// ─── Cache: atributos de dificuldade ──────────────────────────────────────────

/** @returns {{stars: number, maxCombo: number|null}|null} */
function getMapDifficulty(mapId, modsBits, lazer) {
  const row = db
    .prepare('SELECT stars, max_combo FROM cache.map_difficulty WHERE map_id = ? AND mods_bits = ? AND lazer = ?')
    .get(mapId, modsBits, lazer ? 1 : 0);
  return row ? { stars: row.stars, maxCombo: row.max_combo ?? null } : null;
}

function setMapDifficulty(mapId, modsBits, lazer, stars, maxCombo) {
  db.prepare(`
    INSERT INTO cache.map_difficulty (map_id, mods_bits, lazer, stars, max_combo) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(map_id, mods_bits, lazer) DO UPDATE SET
      stars = excluded.stars, max_combo = excluded.max_combo
  `).run(mapId, modsBits, lazer ? 1 : 0, stars, maxCombo ?? null);
}

// ─── Cache: PP de FC ──────────────────────────────────────────────────────────

/**
 * Teto de entradas.
 *
 * Ao contrário das outras duas tabelas de cache, esta cresce por SCORE e não
 * por mapa: a chave inclui a distribuição de hits, então o mesmo mapa rende uma
 * linha por combinação distinta. Sem teto ela só aumenta — o mesmo cuidado que
 * o beatmap_files já toma, e pela mesma razão (quem usa o bot escolhe quantos
 * scores distintos passam por ele).
 *
 * Cada linha são algumas dezenas de bytes, então 20 mil ≈ 1–2MB: generoso o
 * bastante para o teto nunca ser sentido em uso normal.
 */
const FC_PP_MAX_ROWS = Number(process.env.FC_PP_CACHE_MAX || 20000);

/**
 * @param {{mapId: number, modsBits: number, engine: string,
 *          n300: number, n100: number, n50: number}} key
 * @returns {number|null}
 */
function getCachedFCpp({ mapId, modsBits, engine, n300, n100, n50 }) {
  const row = db.prepare(`
    SELECT pp FROM cache.fc_pp
    WHERE map_id = ? AND mods_bits = ? AND engine = ? AND n300 = ? AND n100 = ? AND n50 = ?
  `).get(mapId, modsBits, engine, n300, n100, n50);

  return row ? row.pp : null;
}

function setCachedFCpp({ mapId, modsBits, engine, n300, n100, n50 }, pp) {
  db.prepare(`
    INSERT INTO cache.fc_pp (map_id, mods_bits, engine, n300, n100, n50, pp, cached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(map_id, mods_bits, engine, n300, n100, n50) DO UPDATE SET
      pp = excluded.pp, cached_at = excluded.cached_at
  `).run(mapId, modsBits, engine, n300, n100, n50, pp, Date.now());

  evictFCppIfNeeded();
}

/**
 * Descarta as entradas mais antigas até voltar ao teto.
 *
 * Por idade de inserção, e não por último uso como no beatmap_files: aqui a
 * leitura não escreve nada (é uma consulta por score exibido, e marcar uso
 * transformaria toda página em escrita), então a idade é o único sinal
 * disponível — e ela ainda limita por quanto tempo um número pode ficar
 * desatualizado depois de um reupload.
 */
function evictFCppIfNeeded() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM cache.fc_pp').get().c;
  if (count <= FC_PP_MAX_ROWS) return 0;

  // O desempate por rowid não é detalhe: `cached_at` tem resolução de
  // milissegundo, e uma página de /topplays grava as 5 plays dentro do mesmo
  // milissegundo. Sem ele, o SQLite escolhe qualquer uma das empatadas — e a
  // evicção poderia comer a entrada recém-gravada em vez da antiga.
  return db.prepare(`
    DELETE FROM cache.fc_pp WHERE rowid IN (
      SELECT rowid FROM cache.fc_pp ORDER BY cached_at ASC, rowid ASC LIMIT ?
    )
  `).run(count - FC_PP_MAX_ROWS).changes;
}

// ─── Estado interno ───────────────────────────────────────────────────────────

function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

function setMeta(key, value) {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// ─── Vínculo de staff ─────────────────────────────────────────────────────────

/**
 * @param {'self'|'vouch'} proof como a identidade foi estabelecida — ver a
 *   migração da coluna. Vínculos anteriores a ela têm NULL.
 */
function setStaffLink(discordId, osuId, osuName, addedBy, proof = null) {
  db.prepare(`
    INSERT INTO staff_links (discord_id, osu_id, osu_name, added_by, added_at, proof)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      osu_id = excluded.osu_id, osu_name = excluded.osu_name,
      added_by = excluded.added_by, added_at = excluded.added_at,
      proof = excluded.proof
  `).run(discordId, osuId, osuName ?? null, addedBy, Date.now(), proof);
}

function getStaffLink(discordId) {
  return db.prepare('SELECT * FROM staff_links WHERE discord_id = ?').get(discordId) ?? null;
}

/**
 * Quem já está vinculado àquela conta de jogo.
 *
 * A PK da tabela é o `discord_id`, então nada no schema impede dois Discords
 * apontando para o mesmo `osu_id` — e isso já aconteceu em produção. Para
 * nomeação não era problema (a PK de map_nominations é por osu_id, então não
 * vira voto duplo), mas para moderação são duas identidades do Discord agindo
 * como a mesma pessoa no log do servidor de jogo.
 */
function getStaffLinkByOsuId(osuId) {
  return db.prepare('SELECT * FROM staff_links WHERE osu_id = ?').get(osuId) ?? null;
}

function removeStaffLink(discordId) {
  return db.prepare('DELETE FROM staff_links WHERE discord_id = ?').run(discordId).changes > 0;
}

// ─── Desafio de posse de conta ────────────────────────────────────────────────

/**
 * Cria (ou substitui) o desafio pendente daquele Discord.
 *
 * Um por Discord: pedir um vínculo novo cancela o anterior, para não ficarem
 * dois códigos válidos ao mesmo tempo apontando para contas diferentes.
 */
function setStaffChallenge({ discordId, osuId, osuName, code, requestedBy, ttlMs }) {
  const agora = Date.now();
  db.prepare(`
    INSERT INTO staff_link_challenges
      (discord_id, osu_id, osu_name, code, requested_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      osu_id = excluded.osu_id, osu_name = excluded.osu_name,
      code = excluded.code, requested_by = excluded.requested_by,
      created_at = excluded.created_at, expires_at = excluded.expires_at
  `).run(discordId, osuId, osuName ?? null, code, requestedBy, agora, agora + ttlMs);
}

/** O desafio pendente, ou null se não existir ou já ter expirado. */
function getStaffChallenge(discordId) {
  const row = db.prepare('SELECT * FROM staff_link_challenges WHERE discord_id = ?').get(discordId);
  if (!row) return null;

  // Expirado é o mesmo que inexistente, e some na leitura: sem isso um código
  // velho ficaria no banco esperando alguém tentar usá-lo.
  if (row.expires_at <= Date.now()) {
    clearStaffChallenge(discordId);
    return null;
  }
  return row;
}

function clearStaffChallenge(discordId) {
  return db.prepare('DELETE FROM staff_link_challenges WHERE discord_id = ?').run(discordId).changes > 0;
}

function listStaffLinks() {
  return db.prepare('SELECT * FROM staff_links ORDER BY added_at ASC').all();
}

// ─── Nomeação de mapas ────────────────────────────────────────────────────────

/** Registra (ou reafirma) a nomeação de um set por uma pessoa. */
/**
 * Registra a nomeação daquela CONTA DE JOGO. Nomear de novo (inclusive de outra
 * conta do Discord) atualiza a linha existente em vez de virar um segundo voto.
 */
function addNomination(setId, targetStatus, discordId, osuId, osuName) {
  db.prepare(`
    INSERT INTO map_nominations (set_id, target_status, osu_id, discord_id, osu_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(set_id, target_status, osu_id) DO UPDATE SET
      discord_id = excluded.discord_id, osu_name = excluded.osu_name
  `).run(setId, targetStatus, osuId, discordId, osuName ?? null, Date.now());
}

/**
 * Retira a nomeação da conta de jogo. É por osu_id, e não por Discord, para
 * quem nomeou de um Discord conseguir retirar de outro — é a mesma pessoa.
 */
function removeNomination(setId, targetStatus, osuId) {
  const res = db.prepare(`
    DELETE FROM map_nominations WHERE set_id = ? AND target_status = ? AND osu_id = ?
  `).run(setId, targetStatus, osuId);
  return res.changes > 0;
}

function getNominations(setId, targetStatus) {
  return db.prepare(`
    SELECT osu_id, discord_id, osu_name, created_at
    FROM map_nominations
    WHERE set_id = ? AND target_status = ?
    ORDER BY created_at ASC
  `).all(setId, targetStatus);
}

/** Limpa a fila de um set — usado após aplicar, ou para descartar. */
function clearNominations(setId, targetStatus) {
  const res = db.prepare(`
    DELETE FROM map_nominations WHERE set_id = ? AND target_status = ?
  `).run(setId, targetStatus);
  return res.changes;
}

/** Fila completa, agrupada por set + status alvo. */
function listPendingNominations(limit = 25) {
  return db.prepare(`
    SELECT n.set_id, n.target_status, COUNT(*) AS votes, MAX(n.created_at) AS last_at,
           m.artist, m.title, m.creator, m.diff_count
    FROM map_nominations n
    LEFT JOIN nomination_maps m ON m.set_id = n.set_id
    GROUP BY n.set_id, n.target_status
    ORDER BY last_at DESC
    LIMIT ?
  `).all(limit);
}

function cacheNominationMap(setId, { artist, title, creator, diffCount }) {
  db.prepare(`
    INSERT INTO nomination_maps (set_id, artist, title, creator, diff_count, cached_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(set_id) DO UPDATE SET
      artist = excluded.artist, title = excluded.title,
      creator = excluded.creator, diff_count = excluded.diff_count,
      cached_at = excluded.cached_at
  `).run(setId, artist ?? null, title ?? null, creator ?? null, diffCount ?? null, Date.now());
}

// ─── Log de ações administrativas ─────────────────────────────────────────────

function logAdminAction({ action, target, detail, actorDiscordId, actorOsuId, actorOsuName }) {
  db.prepare(`
    INSERT INTO admin_actions
      (action, target, detail, actor_discord_id, actor_osu_id, actor_osu_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    action, String(target), detail ?? null,
    actorDiscordId, actorOsuId, actorOsuName ?? null, Date.now(),
  );
}

function listAdminActions(limit = 15) {
  return db.prepare(`
    SELECT action, target, detail, actor_osu_name, actor_discord_id, created_at
    FROM admin_actions ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

// ─── Encerramento ─────────────────────────────────────────────────────────────

function close() {
  try {
    db.close();
  } catch {
    // já fechado
  }
}

module.exports = {
  setLink, getLink, getAllLinks, removeLink, linkNamespace,
  setPreferredServer, getPreferredServer,
  setUserLang, getUserLang, removeUserLang,
  setServerLang, getServerLang, removeServerLang,
  getBeatmapFile, setBeatmapFile, evictBeatmapFilesIfNeeded,
  getBeatmapMeta, setBeatmapMeta,
  getMapDifficulty, setMapDifficulty,
  getCachedFCpp, setCachedFCpp, evictFCppIfNeeded,
  getMeta, setMeta,
  setStaffLink, getStaffLink, getStaffLinkByOsuId, removeStaffLink, listStaffLinks,
  setStaffChallenge, getStaffChallenge, clearStaffChallenge,
  addNomination, removeNomination, getNominations, clearNominations,
  listPendingNominations, cacheNominationMap,
  logAdminAction, listAdminActions,
  close,
};
