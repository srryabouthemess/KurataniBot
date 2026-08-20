/**
 * db/schema.js
 * O formato ATUAL das tabelas — o que um banco novo ganha de saída.
 *
 * A diferença para `migrations.js` importa: aqui está o destino, lá está o
 * caminho de quem partiu de uma versão anterior. Um banco novo aplica só este
 * arquivo e já nasce pronto; um banco antigo aplica este (que não mexe no que
 * existe, por causa do IF NOT EXISTS) e depois as migrações, que acertam o que
 * ficou para trás.
 *
 * Consequência para quem for mexer: **coluna nova entra nos DOIS lugares**.
 * Aqui, para o banco novo já vir com ela; e como migração, para o banco que já
 * existe ganhá-la. Só aqui, e o bot de quem já usa quebra na primeira consulta.
 */

function apply(db) {
  db.exec(`
    -- As colunas osu_id, preferred_server e preferred_modo chegaram por ALTER
    -- TABLE e estão aqui já no CREATE: banco novo nasce completo, banco antigo
    -- as recebe pela migração correspondente.
    CREATE TABLE IF NOT EXISTS users (
      discord_id       TEXT PRIMARY KEY,
      osu_user         TEXT,
      osu_server       TEXT,
      lang             TEXT,
      osu_id           INTEGER,
      preferred_server TEXT,
      -- 'vn' | 'rx' | 'both' | NULL (sem preferência). Só o /recent e o /rs
      -- leem: é o modo: que /link default grava, pra combinar VN e RX (ou
      -- filtrar pra um só lado) sem precisar repetir a opção toda vez.
      preferred_modo    TEXT
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

    -- ── Vínculo de staff do Daycore ──────────────────────────────────────────
    -- SEPARADA de user_links de propósito, e não é a mesma coisa.
    --
    -- user_links é auto-declarado: /link set só confere que a conta existe, não
    -- que você é dono dela. Isso é inofensivo no propósito original (os comandos
    -- de consulta só mostram dados públicos — fingir ser outro não dá nada), e
    -- seria desastroso como base de permissão: bastaria linkar o nick de um
    -- admin para herdar os poderes dele.
    --
    -- Aqui o vínculo só entra por quem provou a posse da conta de jogo. O priv
    -- continua sendo lido do Daycore a cada comando, então tirar o cargo de
    -- alguém lá revoga o acesso no bot na hora.
    --
    -- A coluna "proof" diz COMO o vínculo foi estabelecido, e a diferença decide quem
    -- pode avalizar outro:
    --   'self'  — provou a posse (código no perfil). Só estes, e com DEVELOPER
    --             no jogo, avalizam vínculo de terceiro.
    --   'vouch' — criado por um DEVELOPER de vínculo 'self'. A identidade foi
    --             AFIRMADA, não provada, então não avaliza mais ninguém: senão
    --             uma afirmação viraria poder de afirmar, em cadeia.
    --   NULL    — anterior à prova existir. Continua valendo (revogá-los
    --             trancaria o dono fora do próprio bot), mas não avaliza.
    CREATE TABLE IF NOT EXISTS staff_links (
      discord_id  TEXT    PRIMARY KEY,
      osu_id      INTEGER NOT NULL,
      osu_name    TEXT,
      added_by    TEXT    NOT NULL,
      added_at    INTEGER NOT NULL,
      proof       TEXT
    );

    -- Desafio pendente de vínculo: o código que prova posse da conta de jogo.
    --
    -- O /staff register nasceu auto-declarado — quem tinha Administrator no
    -- Discord apontava o próprio Discord para o nick de qualquer staff e herdava
    -- o privilégio dele. Enquanto o pior caso era uma restrição reversível isso
    -- passou; com o /wipe, que apaga scores sem volta, deixou de passar.
    --
    -- Agora o register só emite um código. Quem controla a conta de jogo escreve
    -- esse código no perfil dela (editável apenas por quem entra na conta) e
    -- roda /staff confirm — e é o confirm que cria o vínculo. Um administrador
    -- do Discord não consegue escrever no perfil alheio.
    CREATE TABLE IF NOT EXISTS staff_link_challenges (
      discord_id   TEXT    PRIMARY KEY,
      osu_id       INTEGER NOT NULL,
      osu_name     TEXT,
      code         TEXT    NOT NULL,
      requested_by TEXT    NOT NULL,
      created_at   INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL
    );

    -- ── Nomeação de mapas do Daycore ─────────────────────────────────────────
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

  // ─── Cache de mapas (arquivo separado) ──────────────────────────────────────
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
    --
    -- A chave é a lista de mods em forma canônica ('CL,DT,HD'), e não mais o
    -- bitmask com uma coluna "lazer" ao lado. Os dois motivos estão no
    -- canonicalMods (mods.js): o CL não tem bit, e bit nenhum guarda ajuste de
    -- mod — um DT a 1,3x e um a 1,5x colidiam na mesma linha com números
    -- diferentes.
    CREATE TABLE IF NOT EXISTS cache.map_difficulty (
      map_id    INTEGER NOT NULL,
      mods      TEXT    NOT NULL,
      stars     REAL    NOT NULL,
      max_combo INTEGER,
      PRIMARY KEY (map_id, mods)
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
    -- diferentes de propósito: o lazer-calculator para o algoritmo oficial, o
    -- akatsuki-pp para o Relax. A mecânica lazer/stable NÃO é mais uma dimensão
    -- separada — ela virou o mod CL dentro de "mods", como no osu! de verdade.
    --
    -- SEM TTL, como a map_difficulty: o resultado é função pura do arquivo .osu,
    -- que para mapa ranqueado não muda. O caso não coberto é o mesmo das duas
    -- tabelas — reupload de mapa loved/graveyard mantém o número antigo até a
    -- entrada ser descartada pelo teto.
    CREATE TABLE IF NOT EXISTS cache.fc_pp (
      map_id    INTEGER NOT NULL,
      mods      TEXT    NOT NULL,  -- forma canônica, ex.: 'CL,DT,HD'
      engine    TEXT    NOT NULL,  -- 'lazer' | 'akatsuki'
      n300      INTEGER NOT NULL,  -- já com os misses somados (ver pp.js)
      n100      INTEGER NOT NULL,
      n50       INTEGER NOT NULL,
      pp        REAL    NOT NULL,
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (map_id, mods, engine, n300, n100, n50)
    );

    -- Mesma razão do índice de LRU dos arquivos: sem ele a evicção ordena
    -- varrendo a tabela inteira a cada inserção.
    CREATE INDEX IF NOT EXISTS cache.idx_fc_pp_age ON fc_pp (cached_at);
  `);
}

module.exports = { apply };
