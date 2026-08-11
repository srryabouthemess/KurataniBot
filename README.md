# KurataniBot

Bot de Discord para ver estatísticas do **osu!** — perfil, plays recentes, top plays, comparações e simulações de PP.

Funciona no **Bancho** (servidor oficial) e em **servidores bancho.py**, quantos você configurar — cada um com a variante **Relax** se tiver. Veja [Servidores](#servidores).

---

## Comandos

| Comando | O que faz |
|---|---|
| `/profile` | Mostra o perfil do jogador |
| `/recent` | Últimas plays, incluindo as que falharam |
| `/topplays` | Melhores plays, 5 por página |
| `/score` | Todos os scores de um jogador em um mapa, com o PP que cada um valeria com FC |
| `/compare` | Compara as estatísticas de dois jogadores |
| `/whatif <pp>` | Quanto PP você ganharia com uma nova play de X pp |
| `/pp <alvo>` | O que falta para chegar a um total de PP: numa play só, ou em quantas plays de X pp |
| `/simulate <mapa>` | Quanto PP daria uma play específica num mapa (mods, 100s, misses, combo) |
| `/link` | Vincula sua conta do osu! ao Discord |
| `/language` | Muda o idioma — Português, English ou Русский |

Comandos de staff do servidor administrado (desativados por padrão — veja [Administração do servidor](#administração-do-servidor-opcional)):

| Comando | O que faz |
|---|---|
| `/nominate` | Fila de nomeação de mapas: nomear, retirar, ver a fila, desqualificar |
| `/moderate` | Restringir/liberar jogador, consultar privilégios, ver o log de ações |
| `/staff` | Registra quais contas do Discord correspondem a contas de staff do servidor |

Alguns detalhes úteis:

- Depois de usar `/link`, você não precisa mais digitar seu nome nos outros comandos.
- Todos os comandos aceitam a opção **servidor**, montada a partir dos que você configurou.
- Em `/topplays`, `/recent` e `/score` dá pra navegar com os botões ◀️ ▶️ (só quem usou o comando; expiram após 2 minutos **sem uso**, e o contador reinicia a cada clique).
- Atalhos: `/wi` para o `/whatif`, `/rs` para o `/recent` e `/c` ou `/choke` para o `/score`.
- Todo comando também funciona **escrito**, com prefixo — veja abaixo.

### Comandos por texto (`k!`)

Se o `COMMAND_PREFIX` estiver preenchido no `.env`, os mesmos comandos respondem escritos:

```
k!rs pudim2                         → /rs player:pudim2
k!rs pudim2 -daycore                → /rs player:pudim2 server:Daycore
k!score map:2298847 player:mrekk
k!link set desgracadogames -daycore
k!pp 10000 avg:700 -randomize
```

- **Flags com `-`**: o valor já diz qual opção é, então não precisa escrever `server:`. Servidor: `-bancho`, `-daycore`, `-daycorerx`. Vale para as outras opções de lista fechada (`-rank` e `-love` no `/nominate`, `-pt`/`-en`/`-ru` no `/language`) e para as de sim/não (`-randomize`).
- As opções podem vir **na ordem** em que aparecem no slash command, **pelo nome** (`player:mrekk`), como **flag**, ou tudo misturado.
- Nome com espaço vai entre aspas: `k!rs "Some Player"`.
- Opção de sim/não pode vir solta: `randomize` é o mesmo que `randomize:true`.
- Errou a sintaxe? O bot responde com a linha de uso do comando. Texto que não começa com o prefixo, ou comando que não existe, é ignorado em silêncio.
- Valem as mesmas regras do slash — valores aceitos, faixas numéricas, cargos de staff, cooldown. O modo texto não é um caminho paralelo, é a mesma execução.
- O que no slash seria resposta só para você aparece no canal: mensagem comum não tem o recurso.

> Para ligar, além do `.env` é preciso habilitar o **MESSAGE CONTENT INTENT** no [Developer Portal](https://discord.com/developers/applications) (seu app → **Bot** → *Privileged Gateway Intents*). Sem ele o Discord recusa a conexão e o bot não sobe.

### Respondendo à play de outra pessoa

O `/score` sem a opção `map` usa **o último mapa que apareceu no canal**:

```
Fulano:  /rs                → mostra a play recente dele
Você:    /score             → seus scores nesse mesmo mapa, sem precisar do link
```

Vale também para **link colado na conversa**, não só embed do bot:

```
Fulano:  https://osu.ppy.sh/beatmapsets/2291108#osu/5036232
Você:    k!c -bancho        → seus scores nesse mapa
Você:    k!c nunca -bancho  → os scores do "nunca" nesse mapa
```

No modo texto o `k!c` entende sozinho se o que você escreveu é mapa ou jogador: `k!c 2298847` é mapa, `k!c nunca` é jogador. (No slash a ordem é `map`, `player`, `server`.)

E se você **responder** a uma mensagem, o mapa dela tem prioridade sobre o resto do canal — dá para voltar numa play de meia hora atrás sem precisar recolar o link. Funciona respondendo tanto ao link cru quanto ao embed de uma play do próprio bot. (Só no modo texto: não dá para responder a uma mensagem com slash command.)

`/recent`, `/topplays`, `/simulate` e o próprio `/score` alimentam esse contexto (no `/recent` e no `/topplays`, o mapa acompanha a página em que os botões pararam). O contexto é do canal e vale por 6 horas. Se o bot tiver reiniciado e não souber de nada, ele dá uma olhada nas últimas 50 mensagens antes de desistir — então um link postado enquanto ele estava fora ainda funciona. Se mesmo assim não achar, é só passar o mapa na mão:

```
/score map:https://osu.ppy.sh/beatmapsets/1100333#osu/2298847
/score map:2298847 player:mrekk
```

### Vinculando mais de um servidor

Dá pra ter um nick diferente em cada servidor — útil se seu nome no Daycore não é o mesmo do Bancho:

```
/link set desgracadogames          → vincula no Bancho
/link set desgrasa server:Daycore  → vincula no Daycore
```

Os dois convivem. Comandos sem a opção `server` usam o seu **servidor padrão**, que é o do último `/link set`.

| Subcomando | O que faz |
|---|---|
| `/link set <nick> [server]` | Vincula (ou atualiza) o nick daquele servidor e o torna o padrão |
| `/link default <server>` | Troca o padrão sem precisar vincular de novo |
| `/link status` | Lista todos os seus vínculos, marcando o padrão com ⭐ |
| `/link remove [server]` | Remove o vínculo de um servidor — ou todos, se omitir |

> Um servidor e a variante **RX** dele são a mesma conta (muda só o modo de jogo), então vincular em um vale para o outro.

---

## Servidores

O osu! oficial já vem embutido, com a chave `official`. Os demais são
**qualquer instância bancho.py**, configurada no `.env` — o bot não tem nenhum
servidor específico escrito no código:

```bash
SERVERS=daycore
SERVER_DAYCORE_URL=https://daycore.org
SERVER_DAYCORE_RELAX=true
```

Só a URL do site é obrigatória. As URLs de API seguem a convenção do
[onl-docker](https://github.com/osu-NoLimits/onl-docker) (`api.<domínio>` e
`a.<domínio>` para avatares) e podem ser sobrescritas com
`SERVER_<CHAVE>_API` e `SERVER_<CHAVE>_AVATARS`. `SERVER_<CHAVE>_LABEL` muda o
nome exibido, e `SERVER_<CHAVE>_KEY` guarda a api key quando o servidor exigir.

A chave vira o valor da opção `server` nos comandos (`daycore`, `daycore_rx`) e
a flag do modo texto (`-daycore`, `-daycorerx`). Para adicionar outro, é só
separar por vírgula:

```bash
SERVERS=daycore,outroservidor
SERVER_OUTROSERVIDOR_URL=https://exemplo.org
```

Duas coisas para saber:

- **Servidor novo exige reiniciar o bot.** As escolhas ficam gravadas no
  registro do slash command no Discord; o bot re-registra sozinho no boot
  seguinte, ao notar que o conjunto mudou. O Discord também limita a **25**
  escolhas por opção, o que dá 12 servidores com RX.
- **"bancho.py" aqui quer dizer a stack completa.** O rank global e as top
  plays vêm de `get_rank_cache` e `get_player_scores`, que são da
  **Shiina-Web** (o front-end), não do bancho.py. Um servidor com outro
  front-end responde o resto e falha nesses dois — perfil sai como *Unranked* e
  `/topplays` vem vazio.

> Configuração antiga (`PRIVATE_SERVER_URL` / `PRIVATE_API_KEY`) continua
> funcionando: ela vira um servidor com a chave tirada do próprio domínio, com
> RX ligado. Os links e preferências já salvos são migrados no primeiro boot.

---

## Emojis de rank (opcional)

As grades das plays (SS, S, A...) saem como emoji se você puser as imagens em
[`assets/emojis`](assets/emojis) — `rank_ss.png`, `rank_s.png`, `rank_a.png` e
companhia. O bot envia cada uma no primeiro boot e reaproveita depois; sem
elas, a grade continua saindo em texto.

São **application emojis**: pertencem ao aplicativo, não a um servidor, então
funcionam em qualquer guild e em DM sem o bot precisar estar num "servidor de
emojis" nem de permissão de emoji externo. Os nomes esperados e as regras de
formato estão em [`assets/emojis/README.md`](assets/emojis/README.md).

---

## Instalação

### Você vai precisar de

- **Node.js 22.13** ou superior
- Uma aplicação criada no [Discord Developer Portal](https://discord.com/developers/applications)
- Credenciais da [osu! API v2](https://osu.ppy.sh/home/account/edit#new-oauth-application) — necessárias mesmo se for usar só o Daycore

### Passo a passo

```bash
git clone https://github.com/srryabouthemess/KurataniBot.git
cd KurataniBot
npm install
cp .env.example .env
```

Depois abra o `.env` e preencha:

| Variável | O que é |
|---|---|
| `DISCORD_TOKEN` | Token do bot (Developer Portal → Bot) |
| `CLIENT_ID` | ID do bot (General Information) |
| `OSU_CLIENT_ID` e `OSU_CLIENT_SECRET` | Credenciais da osu! API v2 |
| `OSU_MODE` | Servidor padrão: `official`, `private` ou `private_rx` |
| `COMMAND_PREFIX` | *(opcional)* Liga os [comandos por texto](#comandos-por-texto-k) (ex: `k!`). Exige o **Message Content Intent**; vazio = só slash |
| `PYTHON_BIN` | *(opcional)* Caminho do Python usado no cálculo de PP dos servidores Relax — veja a seção mais abaixo |
| `BEATMAP_CACHE_MAX` | *(opcional)* Quantos arquivos `.osu` manter em cache; padrão `1500` (~75–150 MB) |

Por fim:

```bash
npm start
```

Só isso. O bot registra os comandos no Discord sozinho, na primeira vez e sempre que algum comando mudar — ele compara um hash do conjunto com o último registrado, então reinícios normais não gastam chamada de API.

Se precisar forçar um registro manual (raro), ainda dá:

```bash
npm run deploy
```

> A primeira execução também cria o `bot.db` (SQLite) e migra automaticamente qualquer dado de versões antigas. O cache de mapas fica num `cache.db` separado — ele é regenerável, então pode ser apagado a qualquer momento sem prejuízo, e o backup do que importa não carrega dezenas de MB junto.

### Testes

```bash
npm test
```

São 128 casos no runner nativo do Node (sem dependência extra), rodando em
poucos segundos. Nenhum deles toca a rede nem o `bot.db` real.

Para conferir contra as APIs de verdade — útil depois de mexer no `osuClient`
ou no registro de servidores:

```bash
npm run smoke
```

### Instalando o Node no seu sistema

<details>
<summary><b>Windows</b></summary>

```powershell
winget install OpenJS.NodeJS.LTS
```

Ou baixe o instalador em [nodejs.org](https://nodejs.org/).

</details>

<details>
<summary><b>Linux — Debian / Ubuntu</b></summary>

O `apt` costuma trazer uma versão antiga demais. Use o [nvm](https://github.com/nvm-sh/nvm) ou o repositório do [NodeSource](https://github.com/nodesource/distributions):

```bash
# com nvm (não precisa de root)
nvm install 22
nvm use 22
```

</details>

<details>
<summary><b>Linux — Arch</b></summary>

```bash
sudo pacman -S nodejs npm
```

</details>

<details>
<summary><b>Linux — Fedora</b></summary>

```bash
sudo dnf install nodejs
```

</details>

<details>
<summary><b>macOS</b></summary>

```bash
brew install node
```

</details>

Confira a versão com `node --version` — precisa ser **22.13 ou superior**.

---

## Administração do servidor (opcional)

Habilita `/nominate`, `/moderate` e `/staff`, que **mudam o servidor de verdade**. Só interessa a quem hospeda o bot junto de um servidor bancho.py-ex — com as variáveis vazias os comandos recusam qualquer ação e o resto do bot funciona normal.

> Diferente do resto do bot, esta parte atende **um servidor só**: o primeiro do `SERVERS`, travado num Discord específico. As mensagens usam o nome dele (`SERVER_<CHAVE>_LABEL`).

### 1. Deixar o Redis alcançável

É por ele que as mudanças chegam no servidor. No `docker-compose.yml` do [onl-docker](https://github.com/osu-NoLimits/onl-docker) o `redis` não publica porta nenhuma, então adicione:

```yaml
  redis:
    ports:
      - "127.0.0.1:6379:6379"
```

Isso o deixa visível só para o próprio host. Depois, `docker compose up -d redis`.

> Faça isso apenas com o bot rodando na **mesma máquina**. Entre máquinas diferentes, use VPN ou túnel SSH: Redis aberto para a internet é controle administrativo do servidor para quem tiver a senha.

### 2. Configurar o `.env`

```bash
DAYCORE_GUILD_ID=123456789012345678   # trava os comandos nesse Discord
NOMINATION_THRESHOLD=1                # nomeações necessárias (padrão: 1)

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASS=a_mesma_do_compose
REDIS_DB=0
```

### 3. Registrar a staff

O que cada um pode fazer vem do cargo no **servidor** (`NOMINATOR` para mapas, `ADMINISTRATOR` para contas) — tirar o cargo lá revoga o acesso na hora. O bot só precisa saber qual conta é de quem:

```
/staff register member:@fulano player:<nick no servidor>
/staff list
/staff remove member:@fulano
```

Exige Administrador no Discord configurado em DAYCORE_GUILD_ID. O `/link` comum **não** serve aqui: ele é auto-declarado, então qualquer um poderia linkar o nick de um admin e herdar os poderes dele.

### Comandos

```
/nominate add map:<id ou link>        → nomeia; ao atingir o limiar, aplica no servidor
                                        (padrão: 1 nomeação, ou seja, aplica direto)
/nominate queue                       → o que está esperando
/nominate withdraw map:<id>           → retira a sua
/nominate disqualify map:<id>         → unrank imediato, sem precisar de votos
/nominate force map:<id> status:<...> → ignora a fila (Administrator)

/moderate check player:<nome>         → privilégios e status (não altera nada)
/moderate restrict player:<nome> reason:<motivo>
/moderate unrestrict player:<nome> reason:<motivo>
/moderate log                         → ações recentes feitas pelo bot
```

A fila de nomeação vive no `bot.db` e o servidor só é tocado na decisão final, sempre no set inteiro. O motivo da moderação vai para o log de auditoria do servidor junto do osu! ID de quem rodou o comando.

Como o bot não recebe confirmação do servidor ao publicar, ele relê o estado depois e avisa quando não conseguiu confirmar — em vez de reportar sucesso no escuro.

---

## Cálculo de PP no Relax (opcional)

O Relax usa um sistema de PP diferente, calculado por uma biblioteca Python. **Sem esse passo o bot funciona normalmente** no Bancho e no Daycore vanilla — só os valores de PP do RX ficam indisponíveis.

Para habilitar, você precisa de **Python 3.11 ou anterior** — a biblioteca não tem suporte para 3.12+. Como os sistemas atuais já vêm com versões mais novas, quase sempre é preciso instalar um 3.11 ao lado e apontar o bot para ele com a variável `PYTHON_BIN` no `.env`.

<details>
<summary><b>Windows</b></summary>

```powershell
winget install --id Python.Python.3.11 --exact
py -3.11 -m pip install akatsuki-pp-py
```

No `.env`:

```
PYTHON_BIN=C:/Users/SEU_USUARIO/AppData/Local/Programs/Python/Python311/python.exe
```

</details>

<details>
<summary><b>Linux — Debian / Ubuntu</b></summary>

```bash
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt update
sudo apt install python3.11 python3.11-venv

python3.11 -m venv ~/.kuratanibot-venv
~/.kuratanibot-venv/bin/pip install akatsuki-pp-py
```

No `.env`:

```
PYTHON_BIN=/home/SEU_USUARIO/.kuratanibot-venv/bin/python
```

> O PPA `deadsnakes` é para Ubuntu. No Debian, instale o 3.11 pelo [pyenv](https://github.com/pyenv/pyenv).

</details>

<details>
<summary><b>Linux — Arch</b></summary>

O Arch só empacota o Python mais recente, então instale o 3.11 pelo AUR (pacote `python311`) ou pelo [pyenv](https://github.com/pyenv/pyenv). Depois:

```bash
python3.11 -m venv ~/.kuratanibot-venv
~/.kuratanibot-venv/bin/pip install akatsuki-pp-py
```

No `.env`:

```
PYTHON_BIN=/home/SEU_USUARIO/.kuratanibot-venv/bin/python
```

</details>

<details>
<summary><b>Linux — Fedora</b></summary>

```bash
sudo dnf install python3.11

python3.11 -m venv ~/.kuratanibot-venv
~/.kuratanibot-venv/bin/pip install akatsuki-pp-py
```

No `.env`:

```
PYTHON_BIN=/home/SEU_USUARIO/.kuratanibot-venv/bin/python
```

</details>

<details>
<summary><b>macOS</b></summary>

```bash
brew install python@3.11

python3.11 -m venv ~/.kuratanibot-venv
~/.kuratanibot-venv/bin/pip install akatsuki-pp-py
```

No `.env`:

```
PYTHON_BIN=/Users/SEU_USUARIO/.kuratanibot-venv/bin/python
```

</details>

**Por que o ambiente virtual (`venv`) no Linux e no macOS?** Nesses sistemas o `pip` costuma recusar instalações no Python do sistema. O `venv` cria uma instalação isolada e evita esse erro — e o `PYTHON_BIN` faz o bot usar exatamente esse Python.

Para conferir se deu certo, rode o comando abaixo dentro da pasta do bot (depois de preencher o `.env`):

```bash
node -e "require('./osuClient').simulatePP(1103981, ['DT'], { n100: 5 }, 'private_rx').then(r => console.log(r))"
```

Deu certo se a saída for esta:

```
{ pp: 88.7373, stars: 4.5402, maxCombo: 313 }
```

Se vier `null`, a biblioteca não está instalada no Python que o `PYTHON_BIN` aponta.

> O teste passa pelo mesmo caminho que o bot usa de verdade — baixa o mapa, guarda em cache e entrega ao Python. Chamar o `pp_calc.py` direto no terminal não funciona: ele lê o conteúdo do `.osu` da entrada padrão, e quem envia isso é o bot.

---

## Usando o bot em DM

O bot funciona em conversas privadas, não só em servidores. Para isso:

1. No [Developer Portal](https://discord.com/developers/applications), em **Installation**, marque a opção **User Install**.
2. Cada pessoa que quiser usar em DM precisa clicar em **"Add App"** no perfil do bot — é diferente de "Add to Server", e instala o bot na conta pessoal.

---

## Licença

MIT — veja o histórico de mudanças em [CHANGELOG.md](CHANGELOG.md).
