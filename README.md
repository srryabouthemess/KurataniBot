# KurataniBot

Bot de Discord para estatísticas do **osu!** — perfil, plays recentes, top plays, comparações e simulações de PP.

Funciona no Bancho, no Akatsuki, no EZPP Farm, no Gatari e em servidores bancho.py.

---

## Funcionalidades e comandos

Todos os comandos abaixo estão disponíveis como slash commands. Os comandos de
consulta usam a conta vinculada com `/link` quando o jogador não é informado.

### Perfil, scores e rankings

| Comando | O que faz |
|---|---|
| `/help` | Lista comandos e atalhos disponíveis |
| `/profile` | Mostra perfil, estatísticas, rank e melhor play |
| `/recent` | Mostra as últimas plays, inclusive falhas, com paginação e refresh |
| `/topplays` | Mostra as melhores plays, cinco por página |
| `/map` | Mostra informações de um beatmap e seus atributos com mods |
| `/score` | Mostra os scores de um jogador em um mapa |
| `/compare` | Compara dois jogadores, inclusive em servidores diferentes |
| `/leaderboard` | Mostra o ranking de PP do servidor |
| `/topscores` | Mostra as melhores plays do servidor inteiro (bancho.py) |

### Cálculo e simulação de PP

| Comando | O que faz |
|---|---|
| `/simulate` | Calcula estrelas e PP de uma play específica em um mapa |
| `/nochoke` | Recalcula top plays como se cada choke tivesse sido FC |
| `/topif` | Simula as top plays com outros mods |
| `/whatif` | Estima quanto PP uma nova play acrescentaria |
| `/pp` | Calcula o que falta para alcançar um total de PP |
| `/matchcost` | Calcula o desempenho dos jogadores de uma partida pela fórmula do Bathbot |

Os cálculos usam os motores PP em WebAssembly disponíveis em `vendor/`, com
suporte a mods, mapas oficiais e mapas de servidores privados.

### Preferências e integração do usuário

| Comando | O que faz |
|---|---|
| `/link` | Vincula a conta do osu!, escolhe servidor e modo preferidos |
| `/builder` | Escolhe os campos exibidos nos embeds de `/recent`, com prévia |
| `/language` | Escolhe Português, English ou Русский |

### Acompanhamento de partidas

| Comando | O que faz |
|---|---|
| `/matchlive track` | Acompanha uma partida pública ao vivo no canal |
| `/matchlive untrack` | Para um acompanhamento existente |
| `/matchlive list` | Lista os acompanhamentos do canal |

`/matchlive` exige `Manage Channels` em todos os subcomandos. No modelo atual,
partidas privadas não são acompanhadas porque o poller publica atualizações em
um canal compartilhado; isso evita expor eventos e resultados a pessoas que não
participaram da partida.

### Administração do servidor

Disponíveis quando a integração com Daycore, Redis e/ou MySQL está configurada:

| Comando | O que faz |
|---|---|
| `/nominate` | Gerencia nomeações de mapas e seus registros |
| `/moderate` | Restringe, remove restrição e consulta ações de moderação |
| `/role` | Adiciona ou remove privilégios de usuários |
| `/wipe` | Apaga irreversivelmente scores de um jogador em um modo |
| `/scorewipe` | Executa operações administrativas de limpeza de scores |
| `/staff` | Registra staff e valida provas de posse de conta |
| `/group` | Consulta e administra grupos do servidor |
| `/invitecode` | Cria códigos de convite no servidor |
| `/diag` | Consulta métricas, caches, filas e estado do bot |

Os comandos administrativos têm verificações adicionais de servidor, cargo,
Redis/MySQL e, quando aplicável, confirmação explícita e log de auditoria.

### Atalhos e modo texto

Atalhos equivalentes incluem `/osu`, `/rs`, `/top`, `/nc`, `/wi`, `/c`,
`/choke`, `/lb` e `/mc`.

Quando `COMMAND_PREFIX` está configurado, os mesmos comandos também podem ser
usados por texto, por exemplo `k!rs mrekk`. O modo texto é desligado por padrão
porque requer o intent privilegiado `MESSAGE_CONTENT`.

Atalhos: `/osu`, `/rs`, `/top`, `/nc`, `/wi`, `/c`, `/choke`, `/lb` e `/mc`.

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

Se quiser conferir antes de subir, `npm run config:check` aponta o que estiver faltando ou malformado. O bot faz a mesma conferência no boot e não sobe com erro.

E suba:

```bash
npm start
```

Pronto. O bot registra os comandos sozinho quando o conjunto de comandos muda.

## Arquitetura

O fluxo principal é:

```text
Discord interaction
  -> dispatcher, cooldown e defer
  -> comando
  -> osuClient e adaptador do servidor
  -> cache SQLite / API / arquivo .osu
  -> cálculo PP em worker Wasm
  -> embed paginado e localizado
```

O bot usa SQLite para links, preferências, scores, caches, nomeações e estado
de partidas. As APIs são separadas por adaptadores para o osu! oficial,
bancho.py, Ripple e Gatari. O sistema suporta variantes Relax e configurações
de servidores privados pelo `.env`.

O rate limiter global evita rajadas contra as APIs, enquanto caches de mapas,
scores, perfis e atributos de dificuldade reduzem chamadas repetidas. Falhas
de um comando são registradas sem impedir o bot inteiro de continuar atendendo.

---

## Quer mais?

Nada disto é necessário — o bot já funciona no Bancho com o que está acima.

- **Servidores privados** (Akatsuki, EZPP Farm e Gatari já vêm prontos; bancho.py se configura em duas linhas)
- **Emojis de rank** nas plays e embeds
- **Usar em DM** nos comandos que não dependem de contexto de servidor
- **Acompanhamento de partidas públicas** com `/matchlive`
- **Administração de servidor** — nomear mapas, moderar contas, grupos, staff e scores
- **Redis e MySQL opcionais** para integração administrativa e partidas

Como ligar cada um: **[docs/OPCIONAIS.md](docs/OPCIONAIS.md)**.

---

Testes: `npm test`; lint: `npm run lint`. Desenvolvimento e detalhes internos:
[docs/OPCIONAIS.md](docs/OPCIONAIS.md), [CHANGELOG.md](CHANGELOG.md) e
[PR-REPORT.md](PR-REPORT.md).

MIT — veja [LICENSE](LICENSE). As dependências são de outras pessoas e têm as
licenças delas: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), gerado por
`npm run notices` e que precisa ser regerado quando alguma dependência mudar.
