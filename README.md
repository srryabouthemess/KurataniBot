# KurataniBot

Bot de Discord para exibir estatísticas do **osu!**, com suporte a **Bancho** (oficial), **Daycore** (vanilla) e **Daycore RX**.

## Funcionalidades

- Perfil, últimas plays, top plays e comparação entre jogadores (veja [Comandos](#comandos))
- Vinculação de contas Discord ↔ osu! (`/link`), com preferências por usuário
- Múltiplos idiomas: Português, English, Русский
- Funciona em servidores **e** em DM/grupos, via User Install ([detalhes](#uso-em-dm--instalação-pessoal-user-install))
- Paginação com botões ◀️/▶️ em `/topplays` (5 por página, até 100) e `/recent` (até 50)
- Judgments (300/100/50/miss) e combo máximo do mapa em `/topplays` e `/recent`
- Cache local de beatmaps (`beatmapCache.js`) para evitar rate limit da API do osu!

### Cálculo de PP

O PP é calculado **localmente** — tanto o "PP se fosse FC" mostrado em `/topplays` e `/recent`, quanto as simulações do `/simulate`:

| Servidor | Biblioteca | Observação |
|---|---|---|
| Bancho | [`rosu-pp-js`](https://github.com/MaxOhn/rosu-pp-js) | Mecânica lazer por padrão; usa stable quando o score tem o mod **CL** (Classic) |
| Daycore vanilla | [`rosu-pp-js`](https://github.com/MaxOhn/rosu-pp-js) | Sempre stable/classic (o servidor não roda lazer) |
| Daycore RX | [`akatsuki-pp-py`](https://github.com/osuAkatsuki/akatsuki-pp-py) via Python | oppai-2019, mesmo sistema que o Daycore usa internamente |

---

## Requisitos

- [Node.js](https://nodejs.org/) **v22.13+** — usa o módulo nativo `node:sqlite`, que antes da v22.13 exigia a flag `--experimental-sqlite`
- Uma aplicação no [Discord Developer Portal](https://discord.com/developers/applications)
- Credenciais da [osu! API v2](https://osu.ppy.sh/home/account/edit#new-oauth-application) — necessárias mesmo para o Daycore, já que os dados de beatmap vêm da API oficial
- [Python](https://www.python.org/) **3.9–3.11** — *apenas se for usar o Daycore RX*. A lib de PP do RX não tem wheel para 3.12+ (veja o passo 3 da instalação)

---

## Dependências

| Pacote | Versão | Uso |
|---|---|---|
| [`discord.js`](https://discord.js.org/) | ^14.26.2 | Cliente da API do Discord |
| [`axios`](https://axios-http.com/) | ^1.14.0 | Requisições HTTP às APIs do osu!/Daycore |
| [`dotenv`](https://github.com/motdotla/dotenv) | ^17.4.0 | Carrega variáveis do `.env` |
| [`rosu-pp-js`](https://github.com/MaxOhn/rosu-pp-js) | ^3.1.0 | Cálculo de PP — FC e `/simulate` (Bancho/Daycore vanilla) |
| [`akatsuki-pp-py`](https://github.com/osuAkatsuki/akatsuki-pp-py) | — | Cálculo de PP — FC e `/simulate` no Daycore RX (via Python, instalado separadamente) |

> `node:sqlite` (persistência) e `child_process` (ponte com o Python) são módulos nativos do Node — não aparecem no `package.json`.

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
```

**3. Instale a dependência Python** — *opcional, só para o Daycore RX*

Sem isso o bot funciona normalmente no Bancho e no Daycore vanilla; apenas os cálculos de PP no **Daycore RX** ficam indisponíveis (`/simulate` retorna erro e o "FC: ~Xpp" não aparece).

```bash
pip install akatsuki-pp-py
```

> ⚠️ **Use Python 3.11 ou anterior para esta lib.** O `akatsuki-pp-py` (1.0.5) só publica wheels prontas até o **cp311**. Em Python 3.12+ o `pip` tenta compilar do zero, e a compilação **falha**: o pacote usa PyO3 0.17, que não suporta interpretadores mais novos. Instalar o Rust não resolve isso.
>
> Se o seu Python padrão for mais novo, instale um 3.11 ao lado (ele não substitui o existente) e aponte o bot para ele:
>
> ```bash
> # Windows (winget) — ou baixe de python.org
> winget install --id Python.Python.3.11 --exact
> py -3.11 -m pip install akatsuki-pp-py
> ```
>
> Depois defina no `.env` o caminho desse interpretador:
>
> ```
> PYTHON_BIN=C:/caminho/para/Python311/python.exe
> ```
>
> Sinais de que é este o problema: `pip` baixando um `.tar.gz` em vez de `.whl`, ou erros como `Cannot import 'maturin'` / `the configured Python interpreter version is newer than PyO3's maximum supported version`.

**4. Configure as variáveis de ambiente**
```bash
cp .env.example .env
```
Edite o `.env` com suas credenciais:

| Variável | Descrição |
|---|---|
| `DISCORD_TOKEN` | Token do bot (Discord Developer Portal → Bot) |
| `CLIENT_ID` | ID do bot (General Information) |
| `OSU_MODE` | Servidor padrão quando o comando não especifica: `official`, `private` ou `private_rx` |
| `OSU_CLIENT_ID` | ID do OAuth da osu! API v2 |
| `OSU_CLIENT_SECRET` | Secret do OAuth da osu! API v2 |
| `PYTHON_BIN` | (Opcional) binário do Python, se não for `python`/`python3` padrão |

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
| `/compare [user1] [user2] [servidor]` | Comparação entre dois jogadores (`user1` usa seu `/link` se omitido) |
| `/whatif [pp] [player] [servidor]` | Simula quanto PP uma nova play de X pp renderia no perfil do jogador |
| `/wi [pp] [player] [servidor]` | Atalho para /whatif |
| `/simulate [map] [mods] [n100] [n50] [miss] [combo] [servidor]` | Simula o PP de uma play hipotética (hits específicos) num mapa específico |
| `/link set [player] [servidor]` | Vincula sua conta Discord a um perfil osu!/Daycore |
| `/link remove` / `/link status` | Remove ou consulta seu link atual |
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
│ ├── simulate.js
│ ├── topplays.js
│ ├── whatif.js
│ └── wi.js
├── osuClient.js
├── beatmapCache.js
├── userLink.js
├── db.js       # SQLite (bot.db) — links osu! + preferências de idioma
├── i18n.js
├── logger.js
├── deploy-commands.js
├── index.js
├── pp_calc.py
├── .env.example
├── CHANGELOG.md
├── LICENSE
└── package.json
```

Arquivos gerados em runtime (não versionados): `bot.db` (dados de usuários) e `beatmap_cache.json` (cache de metadados de mapas).

### Suporte a servidores

Os três servidores suportados são **Bancho**, **Daycore** e **Daycore RX**, selecionáveis pela opção `servidor` de cada comando (ou pelo padrão em `OSU_MODE`).

As URLs do Daycore são fixas no código (`osuClient.js`). A maior parte dos endpoints segue o padrão do [bancho.py](https://github.com/osuAkatsuki/bancho.py) (`get_player_scores`, `/players`, `/scores/{id}`), mas o rank global vem de `get_rank_cache`, que é específico do Daycore — ou seja, apontar o bot para outro servidor privado exige editar `osuClient.js`, não basta trocar uma variável de ambiente.

### Preferências de usuário

Idioma (`/language`) e link de conta (`/link`) ficam guardados em `bot.db` (SQLite), gerenciado por `db.js`. O `i18n.js` cuida só das strings de tradução e da resolução do idioma ativo — a prioridade é **usuário > servidor > Português**.

Após vincular a conta com `/link set`, os comandos que aceitam `player` passam a usá-la automaticamente quando o parâmetro é omitido.

### Uso em DM / instalação pessoal (User Install)

Todos os comandos funcionam fora de servidor — em DM com o próprio bot ou em DM/grupo entre outros usuários. Pra isso funcionar:

1. No [Discord Developer Portal](https://discord.com/developers/applications) → seu app → **Installation**, marque **"User Install"** em *Installation Contexts* (além de "Guild Install").
2. Cada pessoa que quiser usar os comandos em DM precisa clicar em **"Add App"** no perfil do bot (é diferente de "Add to Server" — instala na conta pessoal, não num servidor).

Sem o passo 1 (feito manualmente no portal, não tem como fazer via código), os comandos continuam restritos a servidores mesmo com o app já configurado no código.

---

## Licença

MIT
