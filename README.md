# KurataniBot

Bot de Discord para exibir estatísticas do **osu!**, com suporte a **Bancho** (oficial), **Daycore** (vanilla) e **Daycore RX**.

## Funcionalidades

Perfil de jogadores

Última play (recent)

Top plays

Comparação entre jogadores

Simulação de PP (What If)

Vinculação de contas Discord ↔ osu!

Suporte a múltiplos idiomas (Português, English, Русский)

Suporte a Bancho e servidores privados

Navegação por páginas em `/topplays` (5 plays por página, até 100) e `/recent` (até 50 plays), com botões ◀️/▶️

Judgments (300/100/50/miss) e combo máximo do mapa em `/topplays` e `/recent`

O **PP por FC** é calculado localmente:
- Bancho / Daycore vanilla → [`rosu-pp-js`](https://github.com/MaxOhn/rosu-pp-js) (algoritmo oficial osu!)
- Daycore RX → [`akatsuki-pp-py`](https://github.com/osuAkatsuki/akatsuki-pp-py) via Python (oppai-2019, mesmo sistema do Daycore)

Cache local de beatmaps (`beatmapCache.js`) para evitar rate limit da API do osu!

---

## Requisitos

- [Node.js](https://nodejs.org/) v18+
- [Python](https://www.python.org/) 3.9+
- [Git](https://git-scm.com/)
- Uma aplicação no [Discord Developer Portal](https://discord.com/developers/applications)
- Credenciais da [osu! API v2](https://osu.ppy.sh/home/account/edit#new-oauth-application) (para Bancho)

---

## Dependências

| Pacote | Versão | Uso |
|---|---|---|
| [`discord.js`](https://discord.js.org/) | ^14.26.2 | Cliente da API do Discord |
| [`axios`](https://axios-http.com/) | ^1.14.0 | Requisições HTTP às APIs do osu!/Daycore |
| [`dotenv`](https://github.com/motdotla/dotenv) | ^17.4.0 | Carrega variáveis do `.env` |
| [`rosu-pp-js`](https://github.com/MaxOhn/rosu-pp-js) | ^3.1.0 | Cálculo de PP por FC (Bancho/Daycore vanilla) |
| [`akatsuki-pp-py`](https://github.com/osuAkatsuki/akatsuki-pp-py) | — | Cálculo de PP por FC no Daycore RX (via Python, instalado separadamente) |

---

## Instalação

**1. Clone o repositório**
```bash
git clone https://github.com/srryabouthemess/KurataniBot.git
cd KurataniBot
```

**2. Instale as dependências Node**
```bash
npm install
npm audit fix  # corrige vulnerabilidades conhecidas nas dependências
```

**3. Instale a dependência Python** (necessária para FC PP no Daycore RX)
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

**4. Configure as variáveis de ambiente**
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

**5. Registre os comandos slash**
```bash
node deploy-commands.js
```

**6. Inicie o bot**
```bash
node index.js
```

---

## Comandos

| Comando | Descrição |
|---|---|
| `/recent [player] [servidor]` | Última play do jogador, com judgments e combo máximo do mapa. Navegável (◀️/▶️) entre até 50 plays recentes |
| `/topplays [player] [servidor]` | Top plays do jogador, 5 por página, com judgments e combo máximo do mapa. Navegável (◀️/▶️) entre até 100 plays |
| `/profile [player] [servidor]` | Perfil do jogador |
| `/compare [player1] [player2]` | Comparação entre dois jogadores |
| `/whatif [pp] [player] [servidor]` | Simula alterações de PP em uma score |
| `/wi [pp] [player] [servidor]` | Atalho para /whatif |
| `/link [player] [servidor]` | Vincula uma conta osu!/Servidor privado ao usuário do Discord |
| `/language set/server/status [lang]` | Define ou consulta o idioma do bot — Português, English ou Русский |

O parâmetro `servidor` aceita: `Bancho`, `Daycore` ou `Daycore RX`.

Nos comandos com paginação, só quem executou o comando pode navegar entre as páginas (botões expiram após 2 minutos de inatividade).

---

## Estrutura do projeto

```
KurataniBot/
├── commands/
│ ├── compare.js
│ ├── language.js
│ ├── link.js
│ ├── profile.js
│ ├── recent.js
│ ├── topplays.js
│ ├── whatif.js
│ └── wi.js
├── osuClient.js
├── beatmapCache.js
├── userLink.js
├── db.js
├── i18n.js
├── deploy-commands.js
├── index.js
├── pp_calc.py
├── .env.example
└── package.json
```

### Suporte a servidores

O bot foi desenvolvido para funcionar tanto com o servidor oficial quanto com servidores privados compatíveis. Exemplos:

- Bancho
- Daycore
- Daycore RX
- Outros servidores que exponham endpoints compatíveis

### Configuração de idiomas

O bot possui suporte a múltiplos idiomas (Português, English, Русский) através do sistema localizado em `i18n.js`. As preferências podem ser armazenadas por servidor ou usuário, dependendo da configuração utilizada (`/language set` para o seu idioma pessoal, `/language server` para o padrão do servidor).

### Vinculação de conta

O comando `/link` permite associar uma conta osu! a um usuário do Discord. Após a vinculação, diversos comandos podem utilizar automaticamente a conta associada sem exigir o nome do jogador em todas as consultas.

---

## Licença

MIT
