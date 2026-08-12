# KurataniBot

Bot de Discord para estatísticas do **osu!** — perfil, plays recentes, top plays, comparações e simulações de PP.

Funciona no **Bancho** e em **servidores bancho.py**, quantos você configurar.

> **Como ler:** o essencial vem primeiro — comandos e instalação. Tudo que é opcional (servidores privados, comandos por texto, emojis, DM, administração e PP no Relax) está reunido no fim, em **[Opcionais](#opcionais)**. Nada de lá é preciso para o bot funcionar.

---

## Comandos

| Comando | O que faz |
|---|---|
| `/help` | Lista os comandos, agrupados |
| `/profile` | Perfil do jogador |
| `/recent` | Últimas plays, incluindo as que falharam |
| `/topplays` | Melhores plays, 5 por página |
| `/score` | Scores num mapa, com o PP que cada um valeria com FC |
| `/compare` | Compara dois jogadores |
| `/whatif <pp>` | Quanto PP você ganharia com uma play nova |
| `/pp <alvo>` | O que falta para chegar a um total de PP |
| `/simulate <mapa>` | Quanto PP daria uma play específica |
| `/link` | Vincula sua conta do osu! ao Discord |
| `/language` | Português, English ou Русский |

- Atalhos: `/osu`, `/rs`, `/top`, `/wi`, `/c` e `/choke`.
- Depois do `/link`, você não precisa digitar seu nome nos outros comandos.
- `/help` também mostra os servidores configurados e as chaves que a opção `server` aceita.
- Em `/topplays`, `/recent` e `/score` dá pra navegar com ◀️ ▶️ (só quem usou o comando; expiram após 2 min sem uso).
- `/score` sem `map` usa o último mapa que apareceu no canal.

### `/link`

| Subcomando | O que faz |
|---|---|
| `/link set <nick> [server]` | Vincula o nick daquele servidor e o torna padrão |
| `/link default <server>` | Troca o padrão |
| `/link status` | Lista seus vínculos, com ⭐ no padrão |
| `/link remove [server]` | Remove um vínculo — ou todos, se omitir |

Dá para ter um nick por servidor; os dois convivem.

### `/language`

| Subcomando | O que faz |
|---|---|
| `/language set <lang>` | Seu idioma pessoal |
| `/language server [lang]` | Idioma padrão do servidor — só Administrador; sem `lang`, volta ao padrão |
| `/language status` | Mostra seu idioma e o do servidor |

A escolha pessoal ganha da do servidor, que por sua vez ganha do padrão (português).

---

## Instalação

Você precisa de **Node.js 22.13+**, uma [aplicação no Discord](https://discord.com/developers/applications) e credenciais da [osu! API v2](https://osu.ppy.sh/home/account/edit#new-oauth-application) (necessárias mesmo usando só servidor privado).

```bash
git clone https://github.com/srryabouthemess/KurataniBot.git
cd KurataniBot
npm install
cp .env.example .env
```

Preencha o `.env`:

| Variável | O que é |
|---|---|
| `DISCORD_TOKEN` | Token do bot (Developer Portal → Bot) |
| `CLIENT_ID` | ID do bot (General Information) |
| `OSU_CLIENT_ID` e `OSU_CLIENT_SECRET` | Credenciais da osu! API v2 |

E suba:

```bash
npm start
```

O bot registra os comandos sozinho — na primeira vez e sempre que algum mudar. Para forçar, `npm run deploy`.

> A primeira execução cria o `bot.db` (SQLite) e migra dados de versões antigas. O cache de mapas fica num `cache.db` separado, que pode ser apagado a qualquer momento.

<details>
<summary><b>Instalando o Node no seu sistema</b></summary>

```powershell
# Windows
winget install OpenJS.NodeJS.LTS
```

```bash
# Debian/Ubuntu — o apt costuma trazer versão antiga demais, use nvm
nvm install 22 && nvm use 22

# Arch
sudo pacman -S nodejs npm

# Fedora
sudo dnf install nodejs

# macOS
brew install node
```

Confira com `node --version` — precisa ser 22.13 ou superior.

</details>

### Testes

```bash
npm test     # 167 casos, poucos segundos, sem tocar rede nem o bot.db real
npm run lint
npm run smoke  # confere contra as APIs de verdade
```

---

# Opcionais

Nada daqui é necessário: sem configurar, o bot funciona no Bancho com os comandos de barra.

## Servidores privados

Qualquer instância bancho.py, configurada no `.env`:

```bash
SERVERS=daycore
SERVER_DAYCORE_URL=https://daycore.org
SERVER_DAYCORE_RELAX=true          # cria também a variante RX
```

Só a URL é obrigatória — as de API seguem a convenção do [onl-docker](https://github.com/osu-NoLimits/onl-docker) (`api.<domínio>` e `a.<domínio>`), sobrescrevíveis com `SERVER_<CHAVE>_API` e `SERVER_<CHAVE>_AVATARS`. `SERVER_<CHAVE>_LABEL` muda o nome exibido.

A chave vira o valor da opção `server` (`daycore`, `daycore_rx`). Para mais servidores, separe por vírgula. Use `OSU_MODE` para escolher o padrão (`official` ou a chave de um deles).

- **Servidor novo exige reiniciar o bot** — as escolhas ficam gravadas no registro do comando no Discord, que é refeito no boot seguinte. O Discord limita 25 escolhas por opção.
- **"bancho.py" aqui é a stack completa.** Rank global e top plays vêm da **Shiina-Web** (o front-end), não do bancho.py. Outro front-end responde o resto e falha nesses dois — perfil sai *Unranked* e `/topplays` vazio.

## Comandos por texto (`k!`)

Com `COMMAND_PREFIX=k!` no `.env`, os mesmos comandos respondem escritos:

```
k!rs mrekk                    → /rs player:mrekk
k!rs fulano -daycore          → /rs player:fulano server:Daycore
k!score map:2298847 player:mrekk
k!pp 10000 avg:700 -randomize
```

- **Flags com `-`**: o valor já diz qual opção é (`-bancho`, `-daycore`, `-rank`, `-randomize`).
- Opções podem vir na ordem do slash, pelo nome (`player:mrekk`), como flag, ou misturado.
- Nick com espaço entre aspas: `k!rs "Some Player"`.
- Errou a sintaxe? O bot responde com a linha de uso. Texto sem o prefixo é ignorado.
- O prefixo sozinho (`k!`) responde com o caminho das pedras e aponta o `/help`. Já `k!qualqueroutracoisa` fica calado de propósito — o prefixo é curto e colide com conversa normal.
- Valem as mesmas regras do slash: valores aceitos, faixas, cargos e cooldown.

Só no modo texto: **responder** a uma mensagem usa o mapa dela, e link colado na conversa também vira contexto.

> Exige o **MESSAGE CONTENT INTENT** no [Developer Portal](https://discord.com/developers/applications) (app → **Bot** → *Privileged Gateway Intents*). Sem ele o Discord recusa a conexão e o bot não sobe.

## Emojis de rank

As grades (SS, S, A...) saem como emoji se você puser as imagens em [`assets/emojis`](assets/emojis). O bot envia cada uma no primeiro boot; sem elas, a grade sai em texto.

São **application emojis** — funcionam em qualquer servidor e em DM, sem precisar de "servidor de emojis". Nomes aceitos e formato em [`assets/emojis/README.md`](assets/emojis/README.md).

## Usando em DM

1. No Developer Portal, em **Installation**, marque **User Install**.
2. Cada pessoa clica em **"Add App"** no perfil do bot (diferente de "Add to Server").

## Administração do servidor

Habilita `/nominate`, `/moderate` e `/staff`, que **mudam o servidor de verdade**. Só interessa a quem hospeda o bot junto de um bancho.py-ex; com as variáveis vazias os comandos recusam tudo.

> Diferente do resto, esta parte atende **um servidor só**: o primeiro do `SERVERS`, travado num Discord específico.

**1. Deixe o Redis alcançável.** É por ele que as mudanças chegam. No `docker-compose.yml` do onl-docker o `redis` não publica porta:

```yaml
  redis:
    ports:
      - "127.0.0.1:6379:6379"
```

> Só com o bot na **mesma máquina**. Entre máquinas, use VPN ou túnel SSH — Redis aberto é controle administrativo para quem tiver a senha.

**2. Configure o `.env`:**

```bash
DAYCORE_GUILD_ID=123456789012345678   # trava os comandos nesse Discord
NOMINATION_THRESHOLD=1                # nomeações necessárias (padrão: 1)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASS=a_mesma_do_compose
```

**3. Registre a staff.** O poder vem do cargo no servidor de jogo (`NOMINATOR`, `ADMINISTRATOR`) — tirar o cargo lá revoga o acesso na hora:

```
/staff register member:@fulano player:<nick no servidor>
/staff list
/staff remove member:@fulano
```

Exige Administrador no Discord do `DAYCORE_GUILD_ID`. O `/link` comum **não** serve: ele é auto-declarado, então qualquer um linkaria o nick de um admin.

```
/nominate add map:<id ou link>        → nomeia; ao atingir o limiar, aplica
/nominate queue | withdraw | disqualify | force
/moderate check player:<nome>         → só lê, não altera nada
/moderate restrict|unrestrict player:<nome> reason:<motivo>
/moderate log                         → ações recentes feitas pelo bot
```

Como o bot não recebe confirmação ao publicar, ele relê o estado depois e avisa quando não conseguiu confirmar — em vez de reportar sucesso no escuro.

## Cálculo de PP no Relax

O Relax usa um sistema de PP diferente, calculado por uma biblioteca Python. **Sem isso o bot funciona normalmente** — só o PP do RX fica indisponível.

Precisa de **Python 3.11 ou anterior** (a lib não suporta 3.12+), instalado ao lado do seu e apontado por `PYTHON_BIN` no `.env`.

<details>
<summary><b>Como instalar</b></summary>

```powershell
# Windows
winget install --id Python.Python.3.11 --exact
py -3.11 -m pip install akatsuki-pp-py
# .env → PYTHON_BIN=C:/Users/SEU_USUARIO/AppData/Local/Programs/Python/Python311/python.exe
```

```bash
# Linux/macOS — instale o 3.11 (deadsnakes no Ubuntu, pyenv no Debian/Arch,
# dnf no Fedora, brew no macOS) e crie um venv:
python3.11 -m venv ~/.kuratanibot-venv
~/.kuratanibot-venv/bin/pip install akatsuki-pp-py
# .env → PYTHON_BIN=/home/SEU_USUARIO/.kuratanibot-venv/bin/python
```

O `venv` existe porque o `pip` costuma recusar instalação no Python do sistema.

</details>

Confira com `npm run smoke`: a última linha mostra o PP do Relax. Se vier "indisponível", a lib não está no Python que o `PYTHON_BIN` aponta.

## Outras variáveis

| Variável | O que faz |
|---|---|
| `OSU_MODE` | Servidor padrão dos comandos (`official` ou a chave de um configurado) |
| `BEATMAP_CACHE_MAX` | Quantos `.osu` manter em cache; padrão `1500` (~75–150 MB) |
| `EXIT_ON_UNCAUGHT` | `true` faz o bot sair com código 1 numa exceção não capturada, em vez de seguir rodando. Ligue **se** você usa supervisor (systemd, pm2, Docker com `restart`) — sem um, o bot ficaria fora do ar até alguém perceber |

---

MIT — histórico de mudanças em [CHANGELOG.md](CHANGELOG.md).
