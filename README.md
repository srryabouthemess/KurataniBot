# KurataniBot

Bot de Discord para exibir estatísticas do **osu!**, com suporte a **Bancho** (oficial), **Daycore** (vanilla) e **Daycore RX**.

## Funcionalidades

- `/recent` — Última play de um jogador (pass ou quit), com hits explícitos `{ 300 / 100 / 50 / miss }` e FC PP estimado em chokes
- `/topplays` — Top 10 plays de um jogador, com FC PP em scores chocados
- `/profile` — Perfil resumido do jogador
- `/compare` — Compara dois jogadores

O **FC PP** é calculado localmente:
- Bancho / Daycore vanilla → [`rosu-pp-js`](https://github.com/MaxOhn/rosu-pp-js) (algoritmo oficial osu!lazer)
- Daycore RX → [`akatsuki-pp-py`](https://github.com/osuAkatsuki/akatsuki-pp-py) via Python (oppai-2019, mesmo sistema do Daycore)

---

## Requisitos

- [Node.js](https://nodejs.org/) v18+
- [Python](https://www.python.org/) 3.9+
- [Rust](https://rustup.rs/) (necessário para compilar `rosu-pp-js` e `akatsuki-pp-py`)
- [Git](https://git-scm.com/)
- Uma aplicação no [Discord Developer Portal](https://discord.com/developers/applications)
- Credenciais da [osu! API v2](https://osu.ppy.sh/home/account/edit#new-oauth-application) (para Bancho)

---

## Instalação

**1. Clone o repositório**
```bash
git clone https://github.com/srryabouthemess/KurataniBot.git
cd KurataniBot
```

**2. Instale o Rust** (caso ainda não tenha)

Linux/macOS:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

Windows: baixe e execute o instalador em https://rustup.rs

**3. Instale as dependências Node**
```bash
npm install
```
> ⚠️ O `rosu-pp-js` compila Rust durante o install — pode levar alguns minutos.

**4. Instale a dependência Python** (necessária para FC PP no Daycore RX)
```bash
pip install akatsuki-pp-py
```

> **Windows:** requer o **Visual Studio Build Tools** com o componente "Desenvolvimento para desktop com C++" instalado. Baixe em https://visualstudio.microsoft.com/visual-cpp-build-tools/
>
> **Linux:** instale o gcc e as ferramentas de build antes:
> ```bash
> # Debian/Ubuntu
> sudo apt install build-essential python3-dev
> # Arch
> sudo pacman -S base-devel python
> # Fedora
> sudo dnf install gcc python3-devel
> ```

**5. Configure as variáveis de ambiente**
```bash
cp .env.example .env
```
Edite o `.env` com suas credenciais:

| Variável | Descrição |
|---|---|
| `DISCORD_TOKEN` | Token do bot (Discord Developer Portal → Bot) |
| `CLIENT_ID` | ID do bot (General Information) |
| `GUILD_ID` | ID do servidor para registrar comandos (opcional) |
| `OSU_MODE` | `official`, `private` ou `private_rx` |
| `OSU_CLIENT_ID` | ID do OAuth da osu! API v2 |
| `OSU_CLIENT_SECRET` | Secret do OAuth da osu! API v2 |

**6. Registre os comandos slash**
```bash
node deploy-commands.js
```

**7. Inicie o bot**
```bash
node index.js
```

---

## Comandos

| Comando | Descrição |
|---|---|
| `/recent [player] [servidor]` | Última play do jogador |
| `/topplays [usuario] [servidor]` | Top 10 plays do jogador |
| `/profile [usuario] [servidor]` | Perfil do jogador |
| `/compare [usuario1] [usuario2]` | Comparação entre dois jogadores |

O parâmetro `servidor` aceita: `Bancho`, `Daycore` ou `Daycore RX`.

---

## Estrutura do projeto

```
KurataniBot/
├── commands/
│   ├── recent.js       # Comando /recent
│   ├── topplays.js     # Comando /topplays
│   ├── profile.js      # Comando /profile
│   └── compare.js      # Comando /compare
├── osuClient.js        # Cliente unificado da API osu!
├── pp_calc.py          # Calculador de FC PP para Daycore RX (Python)
├── index.js            # Entry point do bot
├── deploy-commands.js  # Registrador de comandos slash
├── .env.example        # Exemplo de variáveis de ambiente
└── package.json
```

---

## Licença

MIT
