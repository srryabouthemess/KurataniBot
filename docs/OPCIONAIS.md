# Opcionais

Nada aqui é necessário: sem configurar nada disto, o bot funciona no Bancho com os comandos de barra (ver [README](../README.md)).

Cada seção é independente — ligue só o que você quer.

- [Servidores privados](#servidores-privados)
- [Comandos por texto (`k!`)](#comandos-por-texto-k)
- [Emojis de rank](#emojis-de-rank)
- [Usando em DM](#usando-em-dm)
- [O cálculo de PP](#o-cálculo-de-pp)
- [Administração do servidor](#administração-do-servidor)
- [Outras variáveis](#outras-variáveis)
- [Backup](#backup)
- [Testes](#testes)

---

## Servidores privados

O **Akatsuki** (`akatsuki`, `akatsuki_rx`), o **EZPP Farm** (`ezpp`, `ezpp_rx`) e o **Gatari** (`gatari`, `gatari_rx`) já vêm de fábrica. Para escolher quais embutidos carregar:

```bash
BUILTIN_SERVERS=                 # nenhum
BUILTIN_SERVERS=akatsuki,ezpp,gatari  # todos (padrão, se a linha não existir)
BUILTIN_SERVERS=ezpp                  # só esse
```

A chave do EZPP é curta de propósito — é ela que se digita no modo texto (`k!rs fulano -ezpp`, `-ezpprx`). O nome antigo `ezppfarm` ainda resolve, para o que tenha ficado escrito por aí.

Qualquer instância bancho.py entra pelo `.env`:

```bash
SERVERS=daycore
SERVER_DAYCORE_URL=https://daycore.org
SERVER_DAYCORE_RELAX=true          # cria também a variante RX
```

Só a URL é obrigatória. A chave (`daycore`, `daycore_rx`) vira o valor da opção `server`; para mais servidores, separe por vírgula; `OSU_MODE` escolhe o padrão.

**Servidor novo exige reiniciar o bot** — as escolhas ficam gravadas no registro do comando no Discord, refeito no boot seguinte.

<details>
<summary>Endereços de API e limites conhecidos</summary>

As URLs de API seguem a convenção do [onl-docker](https://github.com/osu-NoLimits/onl-docker) — `api.<domínio>` e `a.<domínio>` —, sobrescrevíveis com `SERVER_<CHAVE>_API` e `SERVER_<CHAVE>_AVATARS`. `SERVER_<CHAVE>_LABEL` muda o nome exibido. O Discord limita 25 escolhas por opção.

**Plays e ranks não dependem do front-end.** As top plays e as recentes saem do `get_player_scores` da v1 do bancho.py-ex, e o rank global e o do país do `get_player_info` da mesma v1 — em qualquer servidor desses, com Shiina-Web ou não. (As plays já vieram da Shiina-Web: ela manda pp e acc truncados e nenhum acerto, e o bot pagava uma requisição de detalhe por play para completar.)

**O front-end só decide os grupos.** Se o seu servidor roda outro front-end que não a Shiina-Web, diga:

```bash
SERVER_<CHAVE>_WEB=none
```

É o que o EZPP Farm usa. O campo também aceita um endereço, para front-end que serve a API noutro lugar: `SERVER_<CHAVE>_WEB=https://front.exemplo.org/api/v1`.

**Sem Shiina-Web não há grupos de jogador.** Os selos embaixo do nick (✅ Legit, ❌ Closet Cheating…) são desenho dela — o `/leaderboard` e o `/topscores` simplesmente não os exibem, e o `/topscores` deixa de filtrar por grupo.

**Ripple/Hanayo não se configura pelo `.env`.** A API é outra (tudo em `<site>/api/v1`), então precisa de adaptador próprio — o `kind: 'ripple'` existe e atende o Akatsuki. Para outro, acrescente aos embutidos em `src/servers.js`.

</details>

---

## Comandos por texto (`k!`)

```bash
COMMAND_PREFIX=k!
```

Os mesmos comandos passam a responder escritos:

```
k!rs mrekk                    → /rs player:mrekk
k!rs fulano -daycore          → /rs player:fulano server:Daycore
k!score map:2298847 player:mrekk
k!pp 10000 avg:700 -randomize
```

- Opções na ordem do slash, pelo nome (`player:mrekk`), como flag (`-daycore`) ou misturado.
- Nick com espaço entre aspas: `k!rs "Some Player"`.
- Só no modo texto: **responder** a uma mensagem usa o mapa dela, e link colado na conversa vira contexto.

> Exige o **MESSAGE CONTENT INTENT** no [Developer Portal](https://discord.com/developers/applications) (app → **Bot** → *Privileged Gateway Intents*). Sem ele o bot não sobe.

<details>
<summary>Detalhes do parser</summary>

Errou a sintaxe? O bot responde com a linha de uso. Texto sem o prefixo é ignorado.

O prefixo sozinho (`k!`) responde com o caminho das pedras e aponta o `/help`. Já `k!qualqueroutracoisa` fica calado de propósito — o prefixo é curto e colide com conversa normal.

Nas flags, o valor já diz qual opção é: `-bancho`, `-daycore`, `-rank`, `-randomize`.

Valem as mesmas regras do slash: valores aceitos, faixas, cargos e cooldown.

</details>

---

## Emojis de rank

Ponha as imagens em [`assets/emojis`](../assets/emojis) e reinicie. Sem elas, a grade sai em texto (`**A**`).

São *application emojis*: funcionam em qualquer servidor e em DM, sem "servidor de emojis". Nomes aceitos em [`assets/emojis/README.md`](../assets/emojis/README.md).

---

## Usando em DM

1. No Developer Portal, em **Installation**, marque **User Install**.
2. Cada pessoa clica em **"Add App"** no perfil do bot (diferente de "Add to Server").

---

## O cálculo de PP

Cada servidor calcula no motor que **ele próprio** roda — um FC pp ou uma estrela vindos de outro rework mostrariam um número que nenhum score daquele servidor teria. A escolha mora em [`src/pp/engines.js`](../src/pp/engines.js):

| Servidor | Vanilla | Relax |
|---|---|---|
| Bancho (osu! oficial) | `rosu-pp-bancho` | — |
| Daycore | `rosu-pp-daycore` | `akatsuki-pp-daycore` |
| Akatsuki | `akatsuki-pp-akatsuki` | `akatsuki-pp-akatsuki` |
| Qualquer outro (EZPP, Gatari, bancho.py do `.env`) | `rosu-pp-daycore` | `akatsuki-pp-daycore` |

Os dois `rosu-pp-*` são o [`rosu-pp-js`](https://github.com/MaxOhn/rosu-pp-js) compilado contra o [fork do rosu-pp](https://github.com/srryabouthemess/rosu-pp):

- **`rosu-pp-bancho`** segue a branch `pp-update-lazer-master`, que acompanha o **osu!lazer master**. Conferido contra a API oficial, ele reproduz o número publicado: erro relativo na casa de **1e-6**, choke incluído (613 scores dos quatro modos no pp-check, e 40 top plays pelo caminho do próprio bot).
- **`rosu-pp-daycore`** fica no commit que o bancho.py do Daycore roda (hoje o mesmo `67a9c11`), e só anda quando o servidor anda. Ele imita o servidor também no que recebe: mecânica stable e **sem** o score total, então num choke só a estimativa de miss por combo opera, como lá.

Os dois `akatsuki-pp-*` são o [`osuAkatsuki/akatsuki-pp-rs`](https://github.com/osuAkatsuki/akatsuki-pp-rs) — o motor do Relax dos servidores —, compilado pelo binding mínimo de [`vendor/akatsuki-pp-js`](../vendor/akatsuki-pp-js). O binding faz a mesma escolha que o servidor: Relax no osu!std sai do `osu_2019`, o resto do cálculo genérico com `lazer(false)`.

- **`akatsuki-pp-akatsuki`** fica no commit que o [performance-service](https://github.com/osuAkatsuki/performance-service) do Akatsuki roda (hoje `c0e499e`), e recebe o que o score-service manda: **accuracy + misses, sem os hits**. O motor redistribui 100s e 50s pela conta dele, e o número muda com isso — com os hits, até 29pp de diferença. Conferido contra o perfil: 200 top plays de RX e 150 de vanilla batem no centésimo.
- **`akatsuki-pp-daycore`** fica no commit do `akatsuki-rx-py` do bancho.py do Daycore (hoje `591de0d`), e recebe os **hits**, como lá. Conferido: 255 de 256 top plays de RX batem (a que sobra é de antes de o servidor trocar de motor).

Nenhum precisa de nada para instalar: é Wasm, roda em qualquer plataforma com Node, e já vem compilado no repositório, em [`vendor/`](../vendor). O `npm install` só aponta o `node_modules` para lá. Sem um deles, o PP daquele servidor aparece como `?pp` e a estrela cai na publicada pela API.

Cada build roda no seu worker thread, porque Wasm é síncrono e pararia o event loop; a thread só nasce no primeiro cálculo daquele build. A linha de informação do mapa (CS/AR/OD/HP, BPM, objetos) sai sempre do build do Bancho, porque não depende de rework. O `/diag` mostra uma linha por build com quantos cálculos ela serviu.

### Atualizando um dos builds

Para refazer um deles depois de mexer no fork (Arch: `pacman -S rust-wasm wasm-pack binaryen`):

```bash
# no rosu-pp-js, branch fork-lazer-master
# 1. Cargo.toml: rosu-pp = { git = "https://github.com/srryabouthemess/rosu-pp", rev = "<commit>" }
wasm-pack build --target nodejs --release
cp pkg/{LICENSE,README.md,rosu_pp_js.js,rosu_pp_js.d.ts,rosu_pp_js_bg.wasm,rosu_pp_js_bg.wasm.d.ts} \
   ../../KurataniBot/vendor/rosu-pp-bancho/     # ou rosu-pp-daycore
# 2. vendor/rosu-pp-<build>/package.json: "version": "4.0.1-lazer-master.<commit>"
#    (o `name` fica o do build, não o rosu-pp-js do pkg)
```

O `rosu-pp-daycore` acompanha o `docker/rosu-pp-<commit>.tar.gz` do bancho.py do Daycore: quando o servidor trocar de commit, troque este junto.

Se o fork mudar algum campo público dos atributos, o `cargo check` do `rosu-pp-js` acusa — é só expor o campo novo nos três arquivos de `src/attributes/` e `src/strains.rs`. Depois, `npm install` e `npm test`: o `rosuWorker.test.js` roda contra os dois builds de verdade.

Os `akatsuki-pp-*` se refazem do mesmo jeito, a partir do binding que está no repositório:

```bash
cd vendor/akatsuki-pp-js
# 1. Cargo.toml: akatsuki-pp = { git = "https://github.com/osuAkatsuki/akatsuki-pp-rs", rev = "<commit>" }
wasm-pack build --target nodejs --release
cp pkg/{akatsuki_pp_js.js,akatsuki_pp_js.d.ts,akatsuki_pp_js_bg.wasm,akatsuki_pp_js_bg.wasm.d.ts} \
   ../akatsuki-pp-akatsuki/     # ou akatsuki-pp-daycore
# 2. ../akatsuki-pp-<build>/package.json: "version": "1.1.2-<commit>"
```

De onde vem cada commit: o do Akatsuki é o `rev` do `akatsuki-pp-rs` no `Cargo.toml` do performance-service; o do Daycore, o `AKATSUKI_PP_REV` do `Dockerfile` do bancho.py dele. O `akatsukiWorker.test.js` roda contra os dois builds de verdade.

Não precisa limpar cache: a chave da `map_difficulty` e da `fc_pp` leva a versão do pacote (`bancho@4.0.1-lazer-master.67a9c11`, `akatsuki@1.1.2-c0e499e`), então o build novo não encontra os números do antigo — por isso a versão tem de mudar junto com o commit.

---

## Administração do servidor

Habilita `/nominate`, `/moderate`, `/wipe`, `/scorewipe` e `/staff`, que **mudam o servidor de jogo de verdade**. Só interessa a quem hospeda o bot junto de um bancho.py-ex; com as variáveis vazias, os comandos recusam tudo.

> Esta parte atende **um servidor só**: o primeiro do `SERVERS`, travado num Discord específico.

### 1. Redis alcançável

É por ele que as mudanças chegam. No `docker-compose.yml` do onl-docker o `redis` não publica porta:

```yaml
  redis:
    ports:
      - "127.0.0.1:6379:6379"
```

> Só com o bot na **mesma máquina**. Entre máquinas, use VPN ou túnel SSH — Redis aberto é controle administrativo para quem tiver a senha.

### 2. `.env`

```bash
DAYCORE_GUILD_ID=123456789012345678   # trava os comandos nesse Discord
NOMINATION_THRESHOLD=1                # nomeações necessárias (padrão: 1)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASS=a_mesma_do_compose
DAYCORE_ANNOUNCE_CHANNEL_ID=          # opcional: canal dos anúncios de status
DAYCORE_ROLE_LOG_CHANNEL_ID=          # opcional: canal do log de cargo mexido in-game
```

### 3. Staff

O poder vem do cargo no servidor de jogo (`NOMINATOR`, `ADMINISTRATOR`, `DEVELOPER`) — tirar o cargo lá revoga o acesso na hora. Vincular exige prova de posse da conta:

```
/staff register member:@fulano player:<nick>   → emite um código
/staff confirm                                 → rodado por @fulano, cria o vínculo
/staff list | remove member:@fulano
```

O código vai no campo **"sobre mim"** do perfil daquela conta no site do servidor. Como só quem entra na conta edita aquele perfil, ninguém se vincula a uma conta alheia.

### Os comandos

```
/nominate add map:<id ou link>        → nomeia; ao atingir o limiar, aplica
/nominate queue | withdraw | disqualify | force
/moderate check player:<nome>         → só lê, não altera nada
/moderate restrict|unrestrict player:<nome> reason:<motivo>
/moderate log                         → ações recentes feitas pelo bot
/wipe player:<nome> mode:<modo> reason:<motivo>   → IRREVERSÍVEL, só Developer
/scorewipe player:<nome> mode:<modo> reason:<motivo>  → um score só (reversível), só Developer
```

Com `DAYCORE_ANNOUNCE_CHANNEL_ID` preenchido, todo mapa que vira **ranked** ou **loved** é anunciado nesse canal — inclusive os rankeados dentro do jogo com `!map`. Vazio desliga.

Com `DAYCORE_ROLE_LOG_CHANNEL_ID` preenchido, cargo dado ou tirado **dentro do jogo** (`!addpriv`/`!rmpriv`) vira embed nesse canal. Vazio desliga.

> Os dois são canais diferentes de propósito, e este segundo cobre **só** o caminho in-game: o que passa pelo `/role` e pelo admin panel já sai no webhook de auditoria do próprio servidor (`DISCORD_AUDIT_LOG_WEBHOOK`), porque os dois publicam nos canais `addpriv`/`removepriv` e quem os atende registra. Os comandos in-game não passam por receptor nenhum — não havia registro deles em lugar algum.

Do lado do servidor isso exige o fork publicar `ex:priv_change` no `!addpriv`/`!rmpriv` (`app/commands.py`), como já faz com `ex:map_status_change` no `!map`. Sem essa publicação o bot assina um canal que ninguém alimenta e nada acontece.

<details>
<summary>Como cada um se comporta por baixo</summary>

- **Prova de posse.** Antes bastava ter Administrador no Discord para apontar o próprio Discord ao nick de um admin e herdar o cargo dele. O código só é aceito dentro do bloco do userpage — se o tema do site mudar, o `confirm` para de confirmar (com log dizendo o porquê) em vez de voltar a aceitar a página inteira.
- **Atalho do vínculo:** quem já provou a própria conta **e** é `DEVELOPER` no jogo vincula direto, sem código. Um Developer já controla o servidor todo — o código nunca protegeu contra ele.
- **Permissões:** exige Administrador no Discord do `DAYCORE_GUILD_ID`, exceto o `confirm`, rodado pela própria pessoa. O `/link` comum **não** serve: ele é auto-declarado.
- **`/nominate` aceita mapa que o servidor ainda não conhece.** As dificuldades vêm da API do osu!, e o bancho cadastra o mapa ao aplicar o status.
- **`/wipe` apaga os scores de um modo e zera as estatísticas, sem volta.** Pede confirmação por botão mostrando o que será destruído, e o log guarda esses números — depois do wipe eles não existem em lugar nenhum. O bancho **não** confere privilégio nesse canal: a exigência de `DEVELOPER` é do bot, e é a única que existe.
- **`/scorewipe` apaga UM score, e esse tem volta.** O `wipe_score` do bancho não apaga a linha: estaciona o score no status `-1`, fora do `SubmissionStatus`, e toda consulta que seleciona `status = 2` já o descarta. Junto vão as consequências que a submissão tinha deixado para trás: o próximo melhor score do jogador naquele mapa assume o `status = 2`, a linha de `stats` é reescrita sem a play (`plays`, `playtime`, `tscore` e `total_hits` subtraídos; `rscore`, `max_combo`, grades, `pp` e `acc` recalculados) e o pp novo vai para o Redis. Desfazer é um UPDATE no banco — o bot não tem comando para isso.
- **Quando o alvo tem mais de uma play no mapa do score escolhido, a confirmação ganha um botão do lote.** Ele leva a uma segunda confirmação, com as plays listadas (cortada com "e mais N" quando é longa), e só o confirmar de lá publica. O servidor recebe isso pelo canal `mapwipe`, próprio para o lote, e escreve **uma** entrada de auditoria com a contagem e os ids, em vez de uma por score. Os failed entram no lote — contam em `plays`. Com uma play só, o botão não aparece: este comando já fazia exatamente isso. Se a leitura que conta as plays falhar (endpoint fora do ar), o botão também não aparece, e o `/scorewipe` de um score continua igual. Como o `scorewipe`, exige o fork com o canal atendido do lado do servidor — sem isso o publish some no vazio.
- **Como escolher o score:** o id está na URL da página do score no site (`/scores/<id>`), mas chegar até ela exige passar pela leaderboard do mapa certo, e os embeds do bot não trazem o id. Então o comando lista as dez melhores plays do alvo (ou as dez mais recentes, com `list:recent`) e deixa escolher num menu; o `score:` existe para quem já tem o id em mãos. Nos dois caminhos o jogador e o modo são obrigatórios: no caminho do id eles viram conferência, e o comando recusa se o score for de outra pessoa ou de outro modo.
- **Nenhum funciona no modo texto:** respondem em ephemeral, e o adaptador do prefixo precisa descartar essa flag.
- **Confirmação.** O bot não recebe resposta ao publicar no Redis, então relê o estado depois e avisa quando não conseguiu confirmar, em vez de reportar sucesso no escuro. A janela cresce com o tamanho do set, porque o servidor baixa o `.osu` de cada dificuldade que não tem.
- **Autor do anúncio in-game** só aparece se o fork incluir `author_id`/`author_name` no publish do `_map` (`app/commands.py`). Sem isso sai como "aplicado in-game".

</details>

---

## Outras variáveis

| Variável | O que faz |
|---|---|
| `OSU_MODE` | Servidor padrão dos comandos (`official` ou a chave de um configurado) |
| `BEATMAP_CACHE_MAX` | Quantos `.osu` manter em cache; padrão `5000` (~300 MB) |
| `PP_THREADS` | Threads por motor de cálculo de pp; padrão 1 ou 2, conforme os núcleos. Mais threads calculam ao mesmo tempo, ao custo de uma instância Wasm cada |
| `FC_PP_CACHE_MAX` | Quantos valores de "PP se tivesse sido FC" manter; padrão `20000` (~1–2 MB) |
| `SCORE_STORE_MAX` | Quantos scores manter no `scores.db`; padrão `300000` (~64 MB). Passando do teto, saem os sem pp e os de menor pp |
| `KURATANI_DATA_DIR` | Onde ficam `bot.db`, `cache.db` e `scores.db`; vazio = `data/`, dentro do projeto. No `npm test` ela é preenchida sozinha (ver [Testes](#testes)) |
| `EXIT_ON_UNCAUGHT` | `true` faz o bot sair com código 1 numa exceção não capturada. Ligue **se** você usa supervisor (systemd, pm2, Docker com `restart`) |

---

## Backup

Só o `bot.db` importa: links, idiomas, preferências e vínculos de staff não se refazem. O `cache.db` fica de fora — o bot baixa e recalcula tudo dele de novo.

```bash
npm run backup
```

Grava `data/backups/bot-AAAA-MM-DD.db` (rodar de novo no mesmo dia sobrescreve) e apaga os com mais de 14 dias. Pode rodar com o bot no ar.

Para um por dia, às 4h, no `crontab -e` de quem roda o bot:

```bash
0 4 * * * cd /caminho/do/KurataniBot && /usr/bin/node scripts/backup.js >> data/backup.log 2>&1
```

O cron não carrega o seu shell: use o caminho que `which node` mostrar (com nvm, é um dentro de `~/.nvm`).

**Antes de migrar, o bot copia sozinho.** Quando uma atualização muda o formato do banco, o boot grava `bot-pre-v<versão>-AAAA-MM-DD.db` antes de mexer em qualquer coisa. E um código mais antigo que o banco **se recusa a subir**, em vez de gravar num formato que não conhece.

<details>
<summary>Voltar para uma versão anterior</summary>

Se a atualização não migrou o banco, basta voltar o código. Se migrou, o bot antigo recusa o banco novo, e é preciso o backup de antes:

```bash
pm2 stop kuratanibot                         # o nome que o `pm2 ls` mostrar
cd data && rm -f bot.db-wal bot.db-shm
cp backups/bot-pre-v8-2026-09-30.db bot.db   # o de antes da migração
cd .. && git checkout <commit anterior> && pm2 start kuratanibot
```

O `-wal` e o `-shm` saem **antes**: são do banco que está sendo substituído, e o SQLite os aplicaria por cima da cópia. O que foi gravado depois da migração se perde.

</details>

Os backups ficam no mesmo disco do bot — contra disco perdido, copie `data/backups/` para fora da máquina.

---

## Testes

| Comando | O que faz | Toca a rede? |
|---|---|---|
| `npm test` | unitários, contra dublês e bancos descartáveis | não |
| `npm run lint` | eslint | não |
| `npm run smoke` | um jogador por servidor, pela camada de cliente | sim |
| `npm run smoke:commands` | roda o `execute` de cada comando com uma interação simulada | sim |
| `npm run post <canalId> -- --enviar` | manda os embeds para um canal, para ver como ficam | sim |

Os dois `smoke` ficam fora do `npm test` de propósito: dependem de rede e de credencial, então uma falha neles não quer dizer que o código regrediu.

### Onde o `npm test` grava

Em lugar nenhum que dure. O script carrega o [`test/setup.js`](../test/setup.js) antes de tudo, e ele aponta o `KURATANI_DATA_DIR` de **cada processo de teste** para uma pasta temporária própria, apagada quando a rodada acaba.

São duas coisas de uma vez. Rodar a suíte não mexe mais no `bot.db` de desenvolvimento da máquina — antes mexia, e os links e preferências que apareciam ali eram os de verdade. E `node --test` roda os arquivos em processos **paralelos**: com todos apontando para o mesmo SQLite, dois escrevendo ao mesmo tempo davam `SQLITE_BUSY`, que aparecia como um `database is locked` intermitente em um arquivo qualquer, sem relação com o que o teste afirmava.

Definir a variável **antes** de chamar o `npm test` continua valendo, e aí os processos voltam a dividir a mesma pasta. Serve para ir olhar o banco depois que a suíte termina; para o dia a dia, deixe vazia.

<details>
<summary>O que o smoke:commands cobre, e o que não cobre</summary>

É o mesmo caminho que o Discord dispararia — link, cooldown, i18n, enriquecimento, cálculo de PP e montagem do embed —, sem o Discord.

Fica de fora o que é do Discord: validação de opção, permissão por cargo e canal, renderização do embed e o clique nos botões de paginação. Os comandos administrativos entram só para provar que **recusam** — disparar de verdade mudaria o servidor de jogo.

</details>

<details>
<summary>Por que o bot roda em um processo só</summary>

Sem sharding, o que é o certo hoje: o Discord só passa a exigir acima de 2500 servidores, e antes disso ele só acrescentaria complexidade.

Fica registrado porque a decisão tem consequências que não são óbvias no dia em que ela precisar mudar. Estes quatro guardam estado **no processo**, e viveriam separados em cada shard:

| Onde | O que guarda | O que quebra com mais de um processo |
|---|---|---|
| `osuClient.js` | perfis e top plays consultados (60s) | o mesmo jogador é buscado uma vez por shard |
| `mapContext.js` | último mapa de cada canal | `/score` sem argumento não acha o mapa se o embed saiu por outro shard |
| `cooldowns.js` | tickets por usuário | o limite por pessoa passa a ser por shard — quem alterna canais dribla |
| `rateLimiter.js` | tokens por recurso | **o mais sério**: o teto da API do osu! vira N vezes o configurado |

O `bot.db`/`cache.db` não entram: SQLite em WAL aceita vários processos no mesmo arquivo.

O `rateLimiter` é o que decide. Os outros três degradam (mais requisições, um comando ocasionalmente sem contexto); ele não — um limite global aplicado localmente deixa de ser um limite, e o preço é 429 na API oficial.

</details>
