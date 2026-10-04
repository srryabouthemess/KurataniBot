# Termos de uso da API do osu! — conformidade (2026-10-04)

Conferência do bot contra os [Terms of Use da API v2](https://osu.ppy.sh/docs/#terms-of-use). Status: itens 1 e 2 de "O que mudar" implementados na branch `rate-limiter-rajada`, com os números de hoje mantidos (8/s e 4/s); o `/diag` passa a mostrar o pico por minuto de cada balde. **Falta escolher o teto** com esse pico medido em produção, e o item 3.

## Já de acordo

- **Sem polling:** nada roda em segundo plano contra a API; tudo é sob demanda.
- **Cache:** `.osu` e metadados de mapa por 30 dias (`cache.db`), usuário e best por 60s, ranking por 5 min, 404 de mapa por 10 min (`src/osuClient.js`).
- **Não usa a API como banco:** metadados em lote de até 50 IDs em `/beatmaps`, com dedupe de pedidos em voo.
- **Backoff exponencial** com jitter em 429, 5xx e erro de rede (`src/lib/retry.js`).
- **Sem coleta em massa;** cooldown por usuário (`src/cooldowns.js`).

## Fora do limite

Os termos pedem **no máximo 60 requisições/min** (≈1/s), com alguma rajada tolerada. Em `src/rateLimiter.js`:

```js
osuApi:     8,  // 480/min de teto
osuMapFile: 4,  // 240/min, mesmo host osu.ppy.sh
```

No uso real o volume fica bem abaixo, mas o código **permite** até 720/min contra o `osu.ppy.sh` com vários usuários ao mesmo tempo, e passar disso pode revogar o token.

## O que mudar

1. **`LeakyBucket` com rajada e taxa separadas.** Hoje `capacity === perSecond`. Pôr `osuApi` + `osuMapFile` num balde só, com taxa de **1/s** e rajada de ~10: o primeiro comando continua rápido, e o teto contínuo fica em 60/min. Atualizar o teste `beatmapEspelhos.test.js`, que lê `BUCKETS`.
2. **Respeitar `Retry-After`** no `withRetry` quando vier 429.
3. **Cache de partida terminada no `/matchcost`** (`src/commands/osu/matchcost/bancho.js`): hoje pode buscar até 100 páginas e não guarda nada.

**Custo:** uma página fria de `/topplays` faz ~10 requisições; com duas pessoas ao mesmo tempo, as respostas passam a levar alguns segundos a mais. Vale medir com `limiter.osuApi.waitMs` (já existe em `src/lib/metrics.js`) depois da mudança.

## Comparação com o Bathbot

Conferido no clone local `dev/Bathbot` (commit `74637e9`, 2026-09-29).

**O Bathbot também passa dos 60/min.** Em `bathbot/src/core/context/mod.rs:185` o cliente da API é criado com `.ratelimit(10)`, ou seja, 600/min, acima dos nossos 8/s. O download de `.osu` tem balde próprio de 2/s (`bathbot-client/src/site.rs`), contra 4/s aqui. Os baldes são iguais aos nossos: rajada igual à taxa, reposição de 1 token por vez.

Com milhares de servidores, ele deve usar esse teto de fato. Provavelmente tem permissão da equipe do osu! (o max é autor do `rosu-v2` e próximo do pessoal), mas **nada no código confirma isso**.

### Por que ele é rápido

A rapidez vem de quase nunca precisar chamar a API, não de um truque com o limite:

| Técnica | Bathbot | KurataniBot |
|---|---|---|
| Cache de usuário | Redis, 10 min (`manager/redis/osu.rs:147`) | Memória, 60s |
| Ranking de pp | Redis, 30 min | Memória, 5 min |
| Arquivo `.osu` | Postgres, sem prazo (`manager/osu_map.rs:349`) | SQLite, 30 dias, teto de 1500 |
| Scores que passam | Grava todo score, com mapa e mapset, no Postgres (`manager/osu_scores.rs:109`); o próximo comando que precisar do mapa nem chama a API | Só metadados de mapa |
| Tracking | Serviço à parte, o [scores-ws](https://github.com/MaxOhn/scores-ws), lê o fluxo global de scores numa conexão só e repassa por websocket (`tracking/scores_ws.rs`); não consulta cada usuário | Não tem |
| Linguagem | Rust + tokio, cache serializado em rkyv (leitura sem cópia) | Node |

O tracking por fluxo global é o que permite rastrear milhares de jogadores sem cair no "polling a cada minuto por usuário" que os termos proíbem.

### O que isso muda no plano

Baixar o teto para 1/s deixaria o KurataniBot mais restrito que o maior bot de osu! que existe. Dois caminhos:

- **Perguntar à equipe do osu!**, como os termos sugerem, informando o volume real. Dá para medir com `limiter.osuApi.calls`, que já existe nas métricas.
- **Reduzir o volume antes de mexer no teto:** cache mais longo de usuário e ranking, `.osu` sem prazo, e gravar os scores que passam (item 1 de [IDEIAS-BATHBOT.md](../IDEIAS-BATHBOT.md)). Isso deixa o bot mais rápido e mais longe do limite ao mesmo tempo.
