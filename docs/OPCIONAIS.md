# Opcionais

Nada aqui é necessário: sem configurar nada disto, o bot funciona no Bancho com os comandos de barra (ver [README](../README.md)).

Cada seção é independente — ligue só o que você quer.

- [Servidores privados](#servidores-privados)
- [Comandos por texto (`k!`)](#comandos-por-texto-k)
- [Emojis de rank](#emojis-de-rank)
- [Usando em DM](#usando-em-dm)
- [PP no Relax](#pp-no-relax)
- [Administração do servidor](#administração-do-servidor)
- [Outras variáveis](#outras-variáveis)
- [Testes](#testes)

---

## Servidores privados

O **Akatsuki** já vem de fábrica (`akatsuki` e `akatsuki_rx`). Para escolher quais embutidos carregar:

```bash
BUILTIN_SERVERS=            # nenhum
BUILTIN_SERVERS=akatsuki    # só esse (padrão)
```

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

**"bancho.py" aqui é a stack completa.** Rank global e top plays vêm da Shiina-Web (o front-end), não do bancho.py. Outro front-end responde o resto e falha nesses dois — perfil sai *Unranked* e `/topplays` vazio.

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

## PP no Relax

O Relax usa outro sistema de PP, calculado por uma biblioteca Python. **Sem ela o bot funciona normalmente** — só o PP do RX aparece como `?pp`.

Precisa de **Python 3.11** com a lib instalada, apontado no `.env`:

```bash
PYTHON_BIN=C:/Users/SEU_USUARIO/AppData/Local/Programs/Python/Python311/python.exe
```

> **`PYTHON_BIN` vazio é a causa mais comum de "não funciona".** Vazio, o bot chama o `python` do PATH — que costuma ser uma versão mais nova, sem a lib.

Confira com `npm run smoke`: a última linha mostra o PP do Relax.

<details>
<summary>Como instalar</summary>

```powershell
# Windows
winget install --id Python.Python.3.11 --exact
py -3.11 -m pip install akatsuki-pp-py
```

```bash
# Linux/macOS — instale o 3.11 (deadsnakes no Ubuntu, pyenv no Debian/Arch,
# dnf no Fedora, brew no macOS) e crie um venv:
python3.11 -m venv ~/.kuratanibot-venv
~/.kuratanibot-venv/bin/pip install akatsuki-pp-py
# .env → PYTHON_BIN=/home/SEU_USUARIO/.kuratanibot-venv/bin/python
```

O `venv` existe porque o `pip` costuma recusar instalação no Python do sistema.

**Por que 3.11:** a lib publica wheel pronto até essa versão. Em versões mais novas o `pip` cai no build a partir do fonte e exige o toolchain do Rust — dá para fazer, mas instalar o 3.11 ao lado é bem mais barato.

**Como ele roda:** um processo de vida longa, iniciado na primeira play de RX e encerrado junto do bot. Antes era um interpretador novo por número, e só subi-lo custava 47ms por cálculo. Numa máquina sem a lib, a causa é logada uma vez e o bot para de tentar por um minuto.

</details>

---

## Administração do servidor

Habilita `/nominate`, `/moderate`, `/wipe` e `/staff`, que **mudam o servidor de jogo de verdade**. Só interessa a quem hospeda o bot junto de um bancho.py-ex; com as variáveis vazias, os comandos recusam tudo.

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
```

Com `DAYCORE_ANNOUNCE_CHANNEL_ID` preenchido, todo mapa que vira **ranked** ou **loved** é anunciado nesse canal — inclusive os rankeados dentro do jogo com `!map`. Vazio desliga.

<details>
<summary>Como cada um se comporta por baixo</summary>

- **Prova de posse.** Antes bastava ter Administrador no Discord para apontar o próprio Discord ao nick de um admin e herdar o cargo dele. O código só é aceito dentro do bloco do userpage — se o tema do site mudar, o `confirm` para de confirmar (com log dizendo o porquê) em vez de voltar a aceitar a página inteira.
- **Atalho do vínculo:** quem já provou a própria conta **e** é `DEVELOPER` no jogo vincula direto, sem código. Um Developer já controla o servidor todo — o código nunca protegeu contra ele.
- **Permissões:** exige Administrador no Discord do `DAYCORE_GUILD_ID`, exceto o `confirm`, rodado pela própria pessoa. O `/link` comum **não** serve: ele é auto-declarado.
- **`/nominate` aceita mapa que o servidor ainda não conhece.** As dificuldades vêm da API do osu!, e o bancho cadastra o mapa ao aplicar o status.
- **`/wipe` apaga os scores de um modo e zera as estatísticas, sem volta.** Pede confirmação por botão mostrando o que será destruído, e o log guarda esses números — depois do wipe eles não existem em lugar nenhum. O bancho **não** confere privilégio nesse canal: a exigência de `DEVELOPER` é do bot, e é a única que existe.
- **Nenhum funciona no modo texto:** respondem em ephemeral, e o adaptador do prefixo precisa descartar essa flag.
- **Confirmação.** O bot não recebe resposta ao publicar no Redis, então relê o estado depois e avisa quando não conseguiu confirmar, em vez de reportar sucesso no escuro. A janela cresce com o tamanho do set, porque o servidor baixa o `.osu` de cada dificuldade que não tem.
- **Autor do anúncio in-game** só aparece se o fork incluir `author_id`/`author_name` no publish do `_map` (`app/commands.py`). Sem isso sai como "aplicado pelo jogo".

</details>

---

## Outras variáveis

| Variável | O que faz |
|---|---|
| `OSU_MODE` | Servidor padrão dos comandos (`official` ou a chave de um configurado) |
| `BEATMAP_CACHE_MAX` | Quantos `.osu` manter em cache; padrão `1500` (~75–150 MB) |
| `FC_PP_CACHE_MAX` | Quantos valores de "PP se tivesse sido FC" manter; padrão `20000` (~1–2 MB) |
| `KURATANI_DATA_DIR` | Onde ficam `bot.db` e `cache.db`; vazio = raiz do projeto |
| `EXIT_ON_UNCAUGHT` | `true` faz o bot sair com código 1 numa exceção não capturada. Ligue **se** você usa supervisor (systemd, pm2, Docker com `restart`) |

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
