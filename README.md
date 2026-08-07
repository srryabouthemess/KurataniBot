# KurataniBot

Bot de Discord para ver estatísticas do **osu!** — perfil, plays recentes, top plays, comparações e simulações de PP.

Funciona no **Bancho** (servidor oficial), no **Daycore** e no **Daycore RX**.

---

## Comandos

| Comando | O que faz |
|---|---|
| `/profile` | Mostra o perfil do jogador |
| `/recent` | Últimas plays, incluindo as que falharam |
| `/topplays` | Melhores plays, 5 por página |
| `/compare` | Compara as estatísticas de dois jogadores |
| `/whatif <pp>` | Quanto PP você ganharia com uma nova play de X pp |
| `/pp <alvo>` | Quanto PP uma única play precisa valer para você chegar a um total |
| `/simulate <mapa>` | Quanto PP daria uma play específica num mapa (mods, 100s, misses, combo) |
| `/link` | Vincula sua conta do osu! ao Discord |
| `/language` | Muda o idioma — Português, English ou Русский |

Alguns detalhes úteis:

- Depois de usar `/link`, você não precisa mais digitar seu nome nos outros comandos.
- Todos os comandos aceitam a opção **servidor** (`Bancho`, `Daycore` ou `Daycore RX`).
- Em `/topplays` e `/recent` dá pra navegar com os botões ◀️ ▶️ (só quem usou o comando; expiram após 2 minutos **sem uso**, e o contador reinicia a cada clique).
- Atalhos: `/wi` para o `/whatif` e `/rs` para o `/recent`.

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

> Daycore e Daycore RX são a mesma conta (muda só o modo de jogo), então vincular em um vale para o outro.

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
| `PYTHON_BIN` | *(opcional)* Caminho do Python usado no cálculo de PP do Daycore RX — veja a seção mais abaixo |
| `BEATMAP_CACHE_MAX` | *(opcional)* Quantos arquivos `.osu` manter em cache; padrão `1500` (~75–150 MB) |

Por fim:

```bash
node index.js
```

Só isso. O bot registra os comandos no Discord sozinho, na primeira vez e sempre que algum comando mudar — ele compara um hash do conjunto com o último registrado, então reinícios normais não gastam chamada de API.

Se precisar forçar um registro manual (raro), ainda dá:

```bash
node deploy-commands.js
```

> A primeira execução também cria o `bot.db` (SQLite) e migra automaticamente qualquer dado de versões antigas.

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

## Cálculo de PP no Daycore RX (opcional)

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
