# KurataniBot

Bot de Discord para estatísticas do **osu!** — perfil, plays recentes, top plays, comparações e simulações de PP.

Funciona no Bancho, no Akatsuki e em servidores bancho.py.

---

## Comandos

| Comando | O que faz |
|---|---|
| `/help` | Lista os comandos |
| `/profile` | Perfil do jogador |
| `/recent` | Últimas plays, incluindo as que falharam |
| `/topplays` | Melhores plays, 5 por página |
| `/score` | Scores num mapa |
| `/compare` | Compara dois jogadores |
| `/leaderboard` | Ranking de pp do servidor, 10 por página |
| `/whatif <pp>` | Quanto PP você ganharia com uma play nova |
| `/pp <alvo>` | O que falta para chegar a um total de PP |
| `/simulate <mapa>` | Quanto PP daria uma play específica |
| `/link` | Vincula sua conta do osu! ao Discord |
| `/language` | Português, English ou Русский |

Atalhos: `/osu`, `/rs`, `/top`, `/wi`, `/c`, `/choke` e `/lb`.

**Use `/link set <seu nick>` uma vez** e os outros comandos passam a saber quem você é.

---

## Instalação

Precisa de **Node.js 22.13+**, uma [aplicação no Discord](https://discord.com/developers/applications) e credenciais da [osu! API v2](https://osu.ppy.sh/home/account/edit#new-oauth-application).

```bash
git clone https://github.com/srryabouthemess/KurataniBot.git
cd KurataniBot
npm install
cp .env.example .env
```

Preencha quatro variáveis no `.env`:

```bash
DISCORD_TOKEN=      # Developer Portal → Bot
CLIENT_ID=          # Developer Portal → General Information
OSU_CLIENT_ID=      # osu! → Account → OAuth
OSU_CLIENT_SECRET=
```

E suba:

```bash
npm start
```

Pronto. O bot registra os comandos sozinho.

---

## Quer mais?

Nada disto é necessário — o bot já funciona no Bancho com o que está acima.

- **Servidores privados** (Akatsuki já vem pronto; bancho.py se configura em duas linhas)
- **Comandos por texto** — `k!rs mrekk` em vez de `/rs`
- **Emojis de rank** nas plays
- **Usar em DM**
- **PP no Relax**
- **Administração de servidor** — nomear mapas, moderar contas

Como ligar cada um: **[docs/OPCIONAIS.md](docs/OPCIONAIS.md)**.

---

Testes: `npm test`. Desenvolvimento e detalhes internos: [docs/OPCIONAIS.md](docs/OPCIONAIS.md) e [CHANGELOG.md](CHANGELOG.md).

MIT.
