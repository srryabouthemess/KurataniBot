# Performance, escalabilidade e operação — avaliação e plano

> **For agentic workers:** cada fase abaixo é executável task a task. Steps usam checkbox (`- [ ]`). Nenhuma fase depende de uma decisão que não esteja escrita aqui; as que dependem de dado medido dizem qual dado e qual limiar.

**Objetivo:** tirar o KurataniBot do "funciona na minha máquina" para um serviço com testes reproduzíveis, deploy repetível, latência medida e um caminho de escala com gatilhos objetivos — sem reescrever o que já está bom e sem infraestrutura que um mantenedor sozinho não consiga operar.

**Escopo da análise:** o código deste repositório no commit `160dcb6`. O repo `daycore` (bancho.py-ex) só aparece onde o bot depende dele.

**Legenda de confiança** (vale para o documento inteiro):
**[Certo]** conferido no código ou reproduzido nesta análise · **[Provável]** inferência forte a partir do código ou de documentação conhecida · **[Chutando]** estimativa para preencher lacuna, a ser medida.

> Limitação: os arquivos de `src/lib/` (logger, metrics, retry, ttlCache, concurrency, inflight) não foram lidos nesta análise. O que se diz deles vem dos pontos de chamada.

---

## 0. Leia isto primeiro

1. **O gargalo não é escala, é visibilidade e reprodutibilidade.** [Certo] **31 dos 921 testes falham num clone limpo**: eles só passam quando o `.env` de quem roda declara `SERVERS=daycore`. Não existe CI (`.github/` não existe), não existe Dockerfile, e as métricas são contadores em memória que zeram a cada restart e não medem latência. Antes de otimizar qualquer coisa, não há como provar que ficou mais rápido — nem que não quebrou.

2. **Kubernetes, serverless, sharding de banco e fila de mensagens não resolvem o limite real.** [Certo] O teto de vazão do bot é definido por **rate limit de terceiros**: 8 req/s na API do osu!, 4 req/s em download de `.osu`, 10 req/s por servidor privado (`src/rateLimiter.js`). Mais réplicas não aumentam esse teto. [Certo] Com limitadores em memória, N réplicas **multiplicam por N** a taxa contra o osu! — o caminho mais curto para tomar 429 ou perder a chave OAuth.

3. **Bot de gateway do Discord não escala por réplica atrás de load balancer; escala por shard.** [Certo] Cada shard recebe os eventos de um subconjunto de guilds (`shard_id = (guild_id >> 22) % num_shards`). O Discord exige sharding a partir de 2.500 guilds. [Certo] O discord.js faz isso **dentro de um processo só** com `shards: 'auto'` — uma linha, zero refatoração. A troca de arquitetura só vem quando um processo não der conta de CPU, e isso tem gatilho medido na Fase 4.

4. **O que mais pesa na latência hoje é o fan-out frio dos comandos de 100 plays** (`/nochoke`, `/topif`, `/topplays`), e a maior parte desse custo é **uma requisição por mapa onde a API aceita 50 por requisição**. [Provável] Corrigir isso é a otimização de maior retorno do plano.

---

## 1. Estado atual

### 1.1 O que o código mostra

| Área | Situação | Evidência | Conf. |
|---|---|---|---|
| Runtime | Node 22.13+, discord.js 14, **um processo, uma conexão de gateway, sem sharding** | `src/index.js` | [Certo] |
| Persistência | SQLite via `node:sqlite` (`DatabaseSync`, **síncrono na thread principal**), WAL, `bot.db` + `cache.db` anexado | `src/db/connection.js` | [Certo] |
| Cache quente | `TtlCache` em memória: usuário (500, 60s), top plays (300, 60s), ranking (60, 5min), mapa ausente (500, 10min) | `src/osuClient.js` | [Certo] |
| Cache frio | `.osu` (teto 1.500 por LRU, TTL 30d), metadados (TTL 30d), dificuldade (sem TTL), FC pp (teto 20.000) | `src/db/mapCache.js` | [Certo] |
| Vazão externa | Leaky bucket em memória por recurso; FIFO por corrente de promises | `src/rateLimiter.js` | [Certo] |
| Fan-out | `mapLimit(…, 5)` por chamada em enriquecimento, FC e simulação | `osuClient.js`, `commands/osu/nochoke`, `topif` | [Certo] |
| CPU | PP em Wasm, **uma worker thread por build de motor** (até 4 builds), cache de mapa parseado por thread | `src/pp/wasmWorker.js` | [Certo] |
| Estado de UI | Paginação e botão 🔄 por `createMessageComponentCollector` com `idle` — **morre no restart** | `src/pagination.js`, `src/refreshButton.js` | [Certo] |
| Dependências opcionais | Redis (pub/sub administrativo do Daycore), MySQL (pool de 3) | `daycoreAdmin/redis.js`, `daycoreMysql.js` | [Certo] |
| Observabilidade | Contadores e hit rate de cache no `/diag` (efêmero, admin); `logError`/`logErrorOnce` | `commands/admin/diag.js` | [Provável] |
| Testes | 921 testes `node:test` em ~11s; teste de arquitetura que trava a direção das dependências | `test/`, `test/architecture.test.js` | [Certo] |
| CI/CD | Nenhum. Deploy = `npm start`; registro de slash commands por hash no boot | `src/index.js` | [Certo] |
| Rollback de schema | Código antigo abre banco de schema **mais novo** sem reclamar (`if (versao >= VERSAO_ATUAL) return versao`) | `src/db/migrations.js:323` | [Certo] |
| Equipe | 1 mantenedor (53 de 62 commits) + commits de agente | `git log` | [Certo] |
| Hospedagem | Daycore em VPS com Docker Compose; onde o bot roda não está no repo | `docs/superpowers/plans/2026-09-05-mapwipe.md` | [Provável] |

### 1.2 O que já está bom — não mexer

Dedupe de requisição em voo, cache negativo só para 404, renovação de token OAuth em voo única, balde por namespace (VN e RX dividem o limite), motores isolados em threads com backoff, validação do `.env` no boot, shutdown em etapas independentes, e o `architecture.test.js`. [Certo] Refatorar isso "para escalar" é custo sem retorno.

### 1.3 Entradas que faltam, e como a Fase 1 as coleta

| Entrada | Por que muda o plano | Como coletar |
|---|---|---|
| Nº de guilds e crescimento | Decide quando o sharding vira obrigatório (2.500) | `client.guilds.cache.size` como gauge |
| Comandos/dia e pico de concorrência | Decide se as faixas de prioridade (4.3) valem o código | Histograma por comando (6.1) |
| p50/p95/p99 por comando, frio e quente | Hoje ninguém sabe; é a linha de base de todo KPI | Histograma com fases (6.1) |
| Taxa de 429 e 5xx por host | Calibra os baldes | `kb_upstream_seconds{status}` |
| Hit rate dos caches frios | Decide o teto do cache de `.osu` | **Já existe no `/diag`** — dá para olhar hoje |
| RSS/heap ao longo de dias | Diz se os caches em memória cabem | `collectDefaultMetrics()` |
| Máquina, custo mensal, restarts/semana | Decide se Prometheus+Grafana cabem na mesma VPS | Manual, uma vez |

---

## 2. Análise de gargalos

### 2.1 Hipóteses, em ordem de impacto esperado

**H1 — Fan-out frio limitado pela aritmética dos baldes.** [Provável] Um `/nochoke` frio no Daycore faz até 100 detalhes de score (10/s ≈ 10s), depois até 100 metadados de mapa na API oficial (8/s ≈ 12,5s), depois o `.osu` de cada play não-FC (4/s). A concorrência 5 não ajuda: o teto é o balde, não o paralelismo. **Estimativa de pior caso frio: 10–35s** [Chutando — depende do hit rate, que a Fase 1 mede]. O trecho dos metadados cai para ~0,3s com requisição em lote (4.1).

**H2 — Disputa entre comandos pesados e leves no mesmo FIFO.** [Provável] Cada comando pesado deixa até 5 pedidos na fila de cada balde (`mapLimit` 5). Com *k* pesados simultâneos, um `/rs` espera atrás de ~5*k* pedidos: com 3 pesados no balde de 8/s, ~2s. Pior do que parece só com concorrência real, e é por isso que a correção (4.3) é **condicionada a medição**.

**H3 — Uma thread de cálculo por motor.** [Provável] 100 cálculos a 5–30ms cada são 0,5–3s numa thread só; dois `/nochoke` simultâneos no mesmo motor se somam. Relevante só sob concorrência.

**H4 — Memória dos caches em memória.** [Chutando] O `_bestCache` guarda até 300 listas de até 100 scores com os objetos crus da API. A 2–5KB por score, o pior caso é 60–150MB de heap. Medir antes de mexer.

**H5 — SQLite síncrono na thread principal.** [Provável] **Não é gargalo** neste volume: leitura por chave primária num banco de KB, e um cache de dezenas de MB com índice. Só vira item se o `nodejs_eventloop_lag_p99_seconds` passar de 50ms e o CPU profile apontar para `node:sqlite`.

### 2.2 Metodologia

1. **Sempre ligado (Fase 1):** histograma de latência por comando, **quebrado em fases** — espera no balde, tempo de rede por host, tempo de cálculo por motor, montagem do embed. Latência total sem as fases não diz onde está o problema.
2. **Sob demanda, em staging:**
   - CPU: `node --cpu-prof src/index.js` → abrir o `.cpuprofile` no Chrome DevTools; ou `npx 0x src/index.js` para flamegraph.
   - Memória: `node --heapsnapshot-signal=SIGUSR2 src/index.js`, depois `kill -USR2 <pid>` antes e depois de 1h de uso; comparar retentores no DevTools.
   - Event loop: já coberto pelo `collectDefaultMetrics()` (p50/p90/p99).
   - I/O e rede: as fases do histograma; `kb_upstream_seconds` por host e status.
3. **Carga sintética (Fase 2):** o `scripts/smokeCommands.js` já chama o `execute` com interação simulada. A versão de carga troca os adaptadores (`osu/*`) por falsos com latência realista e **mantém o `rateLimiter` de verdade** — o que se quer medir é a fila, e nada de carga vai contra a API real.

---

## 3. Arquitetura e escalabilidade

**Eu discordo** de partir para Kubernetes, serverless ou banco distribuído agora **porque** o teto de vazão é externo, o volume atual não foi medido e há um mantenedor só. **O que eu faria no lugar:** um container com restart automático, estado de UI persistido, requisições em lote e sharding interno quando o número de guilds pedir. **O risco da abordagem enterprise** é gastar semanas e um custo mensal maior que o bot inteiro custa hoje para, no fim, ter N processos multiplicando a taxa contra o osu!.

### 3.1 Estágios, com gatilho objetivo

| Estágio | Forma | Gatilho para entrar | O que muda no código |
|---|---|---|---|
| **A** (agora) | 1 processo, Docker, `restart: unless-stopped`, `EXIT_ON_UNCAUGHT=true`, volume em `data/` | — | Nada além da Fase 0 |
| **B** | 1 processo, **sharding interno** (`shards: 'auto'`) | ≥ 1.500 guilds (margem antes dos 2.500) | 1 linha no `new Client` |
| **C** | N processos numa máquina (`ShardingManager`), limitador e caches quentes no **Redis** | CPU do processo > 70% sustentado **ou** event loop p99 > 100ms por 1h, depois de H1–H3 resolvidas | Limitador distribuído (3.3), tarefas singleton (3.2) |
| **D** | Múltiplas máquinas | Uma máquina não comporta C | SQLite → Postgres, `view_state` → Redis |

[Certo] O WAL do SQLite aceita vários processos na **mesma máquina** (leitores simultâneos, um escritor por vez), então C não exige trocar de banco. [Certo] Várias máquinas exigem, porque SQLite em disco de rede não é confiável.

**Por que não o endpoint HTTP de interações (stateless atrás de LB):** [Certo] o modo texto (`k!rs`) e o `mapContext` dependem de `messageCreate`, que só chega pelo gateway. Trocar para HTTP perderia as duas features.

### 3.2 O que quebra ao passar para o estágio C — conferir antes

- [ ] `syncCommandsIfChanged()` só no shard 0 — senão N registros concorrentes.
- [ ] `daycoreEvents.listen()` **só no shard dono de `DAYCORE_GUILD_ID`** — senão cada anúncio sai N vezes.
- [ ] `emojis.sync()` só uma vez.
- [ ] Limitador no Redis (3.3) — senão N× a taxa contra cada API.
- [ ] Caches quentes: aceitar N cópias (60s de TTL, custo baixo) ou mover para o Redis. Começar aceitando.

```js
// scripts/shard.js — só no estágio C
const { ShardingManager } = require('discord.js');
const config = require('../src/config');

const manager = new ShardingManager(require.resolve('../src/index.js'), {
  token: config.discord.token,
  totalShards: 'auto',
  respawn: true,
});
manager.on('shardCreate', shard => console.log(`[shard] ${shard.id} iniciado`));
manager.spawn();
```

### 3.3 Limitador distribuído (estágio C)

Reserva de token no Redis, com o relógio do próprio Redis: quem chama recebe quanto esperar e segue depois disso, sem tentar de novo — o que evita manada.

```lua
-- KEYS[1] = balde · ARGV[1] = taxa por segundo · ARGV[2] = capacidade
local taxa, cap = tonumber(ARGV[1]), tonumber(ARGV[2])
local t = redis.call('TIME')
local agora = t[1] * 1000 + math.floor(t[2] / 1000)
local s = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(s[1]) or cap
local ts = tonumber(s[2]) or agora
tokens = math.min(cap, tokens + (agora - ts) * taxa / 1000) - 1
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', agora)
redis.call('PEXPIRE', KEYS[1], 60000)
if tokens >= 0 then return 0 end
return math.ceil(-tokens * 1000 / taxa)  -- ms de espera
```

A interface `rateLimiter.acquire(site)` não muda: quem chama continua sem saber onde o balde mora.

---

## 4. Otimizações de performance

### 4.1 Metadados de mapa em lote — maior retorno do plano

[Certo] Hoje `fetchBeatmap` faz um `GET /beatmaps/{id}` por mapa. [Provável] A API v2 tem `GET /beatmaps?ids[]=…` com até 50 ids por requisição e o mesmo `BeatmapExtended` (com `beatmapset` e `max_combo`). Num `/nochoke` frio, **100 requisições viram 2**.

- [ ] **Step 1 — conferir o contrato, antes de qualquer código.** Pedir o mesmo mapa pelos dois endpoints e comparar os campos que o bot lê (`max_combo`, `difficulty_rating`, `version`, `beatmapset.{title,artist,covers}`, `beatmapset_id`). Se algum faltar no lote, parar aqui.
- [ ] **Step 2 — um agrupador no estilo DataLoader em `src/lib/batch.js`**, para `fetchBeatmap(id)` continuar com a mesma assinatura e todos os chamadores ganharem de graça:

```js
/**
 * lib/batch.js
 * Junta pedidos por chave feitos na mesma janela curta numa busca só.
 *
 * Quem chama continua pedindo um item por vez; é aqui que N pedidos viram
 * ceil(N / max) requisições.
 */
function criarLote({ max, janelaMs = 5, buscar }) {
  let pendentes = new Map(); // chave → [{ resolve, reject }]
  let timer = null;

  async function disparar() {
    const atual = pendentes;
    pendentes = new Map();
    timer = null;

    const chaves = [...atual.keys()];
    for (let i = 0; i < chaves.length; i += max) {
      const fatia = chaves.slice(i, i + max);
      try {
        const achados = await buscar(fatia); // Map chave → valor
        for (const chave of fatia) atual.get(chave).forEach(w => w.resolve(achados.get(chave) ?? null));
      } catch (error) {
        for (const chave of fatia) atual.get(chave).forEach(w => w.reject(error));
      }
    }
  }

  return function carregar(chave) {
    return new Promise((resolve, reject) => {
      if (!pendentes.has(chave)) pendentes.set(chave, []);
      pendentes.get(chave).push({ resolve, reject });
      timer ??= setTimeout(disparar, janelaMs);
    });
  };
}

module.exports = { criarLote };
```

- [ ] **Step 3 — ligar no `osuClient.js`:**

```js
const carregarMeta = criarLote({
  max: 50,
  buscar: async ids => {
    // O axios serializa array como `ids[]=1&ids[]=2` — conferir a URL no teste.
    const { beatmaps = [] } = await officialApi.officialGet('/beatmaps', { params: { ids } });
    return new Map(beatmaps.map(bm => [bm.id, bm]));
  },
});

async function fetchBeatmap(id) {
  const cached = beatmapCache.get(id);
  if (cached) return cached;
  if (_missingBeatmaps.has(id)) {
    metrics.count('cacheNegativo.beatmap.evitou');
    return null;
  }

  return dedupe(`meta:${id}`, async () => {
    try {
      const data = await carregarMeta(Number(id));
      // O lote não devolve 404: mapa que não veio é o mapa que não existe, e
      // vira cache negativo pelo mesmo motivo que o 404 virava.
      if (data) beatmapCache.set(id, data);
      else _missingBeatmaps.set(id, true);
      return data;
    } catch (error) {
      logErrorOnce('osuClient:beatmap', error);
      return null;
    }
  });
}
```

- [ ] **Step 4 —** no `enrichBeatmapData`, trocar `mapLimit(idsNeeded, BEATMAP_CONCURRENCY, fetchBeatmap)` por `Promise.all(idsNeeded.map(fetchBeatmap))`. Com o `mapLimit` 5, cada lote sairia com 5 ids e o ganho sumiria. A vazão continua controlada: são 2 requisições, e elas passam pelo balde.
- [ ] **Step 5 — teste:** 100 ids frios → exatamente 2 chamadas a `officialGet`; id ausente no retorno → cache negativo; erro na requisição → nenhum cache negativo (paridade com o comportamento de hoje para 5xx).

**Ganho esperado:** −98 requisições por comando frio; ~12s → ~0,3s no trecho de metadados. [Provável]

### 4.2 Detalhe de score do Daycore em lote

[Provável] O mesmo padrão vale para os até 100 detalhes de score do `enrichScores` no Daycore (~10s frio). O servidor é de vocês (patch do bancho.py-ex): um endpoint `get_scores?ids=` de leitura resolve do lado de lá, e o adaptador usa o mesmo `criarLote`. Mesma ordem de deploy do mapwipe: servidor antes do bot.

### 4.3 Faixas de prioridade no limitador — condicional

**Só implementar se** a Fase 1 mostrar `kb_limiter_wait_seconds{lane="interactive"}` p95 > 500ms. Sem esse número, é código sem problema medido.

O desenho: duas filas por balde. A interativa passa na frente; o lote nunca passa fome (recebe no mínimo 1 a cada 4 tokens quando as duas têm gente). A faixa vem do contexto da requisição, sem mudar a assinatura de nenhuma função no meio do caminho:

```js
// src/lib/requestContext.js
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

/** @typedef {{ command: string, lane: 'interactive'|'bulk', interactionId: string }} Contexto */

const run = (ctx, fn) => als.run(ctx, fn);
const current = () => als.getStore() ?? null;

module.exports = { run, current };
```

```js
// src/rateLimiter.js — o LeakyBucket com duas filas
class LeakyBucket {
  constructor(name, perSecond, { bulkShare = 0.25 } = {}) {
    this.name       = name;
    this.capacity   = perSecond;
    this.tokens     = perSecond;
    this.intervalMs = 1000 / perSecond;
    this.lastRefill = Date.now();
    this.filas      = { interactive: [], bulk: [] };
    this.cadaNBulk  = Math.round(1 / bulkShare);
    this.desdeBulk  = 0;
    this.drenando   = false;
  }

  acquire() {
    const lane = requestContext.current()?.lane ?? 'interactive';
    return new Promise(resolve => {
      this.filas[lane].push({ resolve, lane, desde: Date.now() });
      // Mesmo princípio da corrente de hoje: a falha de uma volta não trava o
      // balde — o próximo acquire recomeça a drenagem.
      this._drenar().catch(error => logErrorOnce(`rateLimiter:${this.name}`, error));
    });
  }

  _proximo() {
    const { interactive, bulk } = this.filas;
    const vezDoBulk = bulk.length > 0 &&
      (interactive.length === 0 || this.desdeBulk >= this.cadaNBulk - 1);
    if (vezDoBulk) {
      this.desdeBulk = 0;
      return bulk.shift();
    }
    this.desdeBulk++;
    return interactive.shift();
  }

  async _drenar() {
    if (this.drenando) return;
    this.drenando = true;
    try {
      while (this.filas.interactive.length || this.filas.bulk.length) {
        this._refill();
        if (this.tokens < 1) {
          await sleep(Math.ceil((1 - this.tokens) * this.intervalMs));
          continue;
        }
        this.tokens -= 1;
        const waiter = this._proximo();
        obs.limiterWait.observe({ bucket: this.name, lane: waiter.lane }, (Date.now() - waiter.desde) / 1000);
        waiter.resolve();
      }
    } finally {
      this.drenando = false;
    }
  }
}
```

A faixa sai do bucket de cooldown que o comando já tem (exportar um `bucketDe(nome)` do `cooldowns.js`): `default` → `interactive`; `heavy` e `compute` → `bulk`. O `requestContext.run` entra nos **dois** pontos de entrada: `interactionCreate` no `index.js` e o `prefixCommands.js`.

### 4.4 Cálculo de PP

- [ ] **Só se** `kb_pp_calc_seconds` somado por comando passar de 1s no p95: pool de 2 threads por motor, **com afinidade por `mapId % 2`**. Sem afinidade, o cache de mapa parseado por thread (`wasmThread.js`) se divide e o `needBytes` volta a cada troca de thread.

### 4.5 Cache de `.osu`

- [ ] Olhar o hit rate de `beatmapFile` no `/diag` depois de uma semana. [Chutando] Um `/nochoke` de jogador novo toca até 100 mapas, então 15 jogadores diferentes podem girar o teto inteiro de 1.500. Se o hit rate ficar abaixo de 80%, subir `BEATMAP_CACHE_MAX` para 5.000 (~300MB de disco, que é barato). O teto existe para impedir que alguém encha o disco de propósito, não para economizar.

### 4.6 Alvos de latência

| Classe | Comandos | Alvo p95 quente | Alvo p95 frio |
|---|---|---|---|
| Reconhecimento (reply/defer) | todos | < 1,5s (o Discord corta em 3s) [Certo] | < 1,5s |
| Leve | `/rs`, `/profile`, `/score`, `/link`, `/help` | < 2s | < 4s |
| Pesado paginado | `/topplays`, `/leaderboard`, `/compare` | < 3s | < 6s |
| Fan-out de 100 plays | `/nochoke`, `/topif`, `/whatif`, `/pp` | < 4s | **< 10s** (baseline estimada 10–35s) |

---

## 5. Organização do código e testes

O código já é modular, com adaptadores por tipo de servidor, config centralizada e um teste que trava a direção das dependências. [Certo] **O plano não inclui refatoração ampla** — só os módulos que as fases precisam, cada um sob as regras do `architecture.test.js`:

| Módulo novo | Fase | Para quê |
|---|---|---|
| `test/setup.js` (registro fixo) | 0 | Testes herméticos |
| `src/observability.js` | 1 | Registro de métricas, `/metrics`, `/healthz` |
| `src/lib/batch.js` | 2 | Requisição em lote (4.1) |
| `src/lib/requestContext.js` | 2 | Faixa, comando e id de rastreio sem mudar assinaturas |
| `src/bot/components.js` + tabela `cache.view_state` | 3 | Botões sem coletor, que sobrevivem ao restart |

O `lib/metrics` atual vira **fachada** do registro novo, pelo mesmo motivo do `db/index.js`: os ~30 pontos que chamam `metrics.cache(...)` e `metrics.count(...)` não precisam saber que o destino mudou.

### 5.1 Testes herméticos — Fase 0, primeiro item

[Certo] Correção conferida nesta análise (921/921 passando num ambiente sem `.env`, depois revertida):

```js
// test/setup.js, antes de qualquer outra coisa
//
// Registro de servidores fixo para a suíte. Sem isto, 31 testes dependem do
// `.env` de quem roda (SERVERS=daycore) e falham num clone limpo e no CI. O
// dotenv não sobrescreve o que já está no ambiente, então o que for posto aqui
// vence o `.env` local.
const REGISTRO_DE_TESTE = {
  SERVERS: 'daycore',
  SERVER_DAYCORE_URL: 'https://daycore.org',
  SERVER_DAYCORE_RELAX: 'true',
};
for (const [chave, valor] of Object.entries(REGISTRO_DE_TESTE)) process.env[chave] ??= valor;
```

Isso resolve os 31, mas outras variáveis do `.env` local continuam vazando para a suíte. A garantia de verdade é o CI, que roda sem `.env` nenhum. A correção de longo prazo é cada teste declarar o servidor de que precisa, como o `servers.test.js` já faz.

### 5.2 Camadas de teste

| Camada | O que tem | O que falta |
|---|---|---|
| Unidade | 921 testes, ~11s [Certo] | — |
| Integração com fixture | `test/fixtures/` [Certo] | Fixture do `GET /beatmaps?ids[]` (4.1) |
| Contrato | `npm run smoke`, manual [Certo] | Job **noturno** no CI com 3–5 chamadas reais, para pegar mudança de formato da API antes do usuário |
| Carga | — | `scripts/load.js` sobre o `smokeCommands.js`: adaptadores falsos com latência, limitador real, 20 comandos pesados + 50 leves em paralelo; mede p95 por faixa |

### 5.3 Dependências

- [ ] Dependabot semanal para `npm` e `github-actions`, com agrupamento de minor/patch.
- [ ] No CI, `npm run notices` + `git diff --exit-code THIRD-PARTY-NOTICES.md` — hoje "regerar quando mudar dependência" depende de alguém lembrar. [Chutando] Conferir antes que o gerador é determinístico.
- [ ] `vendor/`: registrar o commit de origem e o SHA-256 de cada `.wasm` num `vendor/CHECKSUMS`, conferido no CI. Binário versionado sem procedência é o ponto mais fraco da cadeia de suprimento deste repo.

---

## 6. Observabilidade e operação

### 6.1 Métricas

`prom-client` (MIT) [Certo], exposto só na rede interna:

```js
// src/observability.js
const http = require('node:http');
const client = require('prom-client');
const config = require('./config');

client.collectDefaultMetrics(); // heap, RSS, GC e lag do event loop (p50/p90/p99)

const commandDuration = new client.Histogram({
  name: 'kb_command_duration_seconds',
  help: 'Do recebimento da interação à resposta final',
  labelNames: ['command', 'outcome', 'via'], // via: slash | prefix
  buckets: [0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 13, 21, 34],
});
const ackDuration = new client.Histogram({
  name: 'kb_interaction_ack_seconds',
  help: 'Do recebimento ao reply/defer — o Discord corta em 3s',
  labelNames: ['command'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3],
});
const limiterWait = new client.Histogram({
  name: 'kb_limiter_wait_seconds',
  help: 'Tempo parado na fila de um balde',
  labelNames: ['bucket', 'lane'],
  buckets: [0, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20],
});
const upstream = new client.Histogram({
  name: 'kb_upstream_seconds',
  help: 'Requisição a uma API externa',
  labelNames: ['host', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});
const ppCalc = new client.Histogram({
  name: 'kb_pp_calc_seconds',
  help: 'Cálculo numa thread de motor',
  labelNames: ['engine', 'op'],
  buckets: [0.001, 0.005, 0.01, 0.03, 0.1, 0.3, 1],
});

let discord = null;
new client.Gauge({ name: 'kb_guilds', help: 'Guilds', collect() { this.set(discord?.guilds.cache.size ?? 0); } });
new client.Gauge({ name: 'kb_gateway_ping_ms', help: 'Ping do gateway', collect() { this.set(discord?.ws.ping ?? -1); } });

function serve(discordClient) {
  discord = discordClient;
  const { port, host } = config.metrics; // METRICS_PORT / METRICS_HOST, validados no config.js
  if (!port) return null;

  return http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', client.register.contentType);
      return res.end(await client.register.metrics());
    }
    if (req.url === '/healthz') {
      const ok = discord?.isReady() === true;
      res.statusCode = ok ? 200 : 503;
      return res.end(ok ? 'ok' : 'not ready');
    }
    res.statusCode = 404;
    res.end();
  }).listen(port, host ?? '127.0.0.1');
}

module.exports = { serve, commandDuration, ackDuration, limiterWait, upstream, ppCalc };
```

Instrumentação no `interactionCreate` (e igual no `prefixCommands.js`, com `via: 'prefix'`):

```js
const inicio = process.hrtime.bigint();
const segundos = () => Number(process.hrtime.bigint() - inicio) / 1e9;

// O primeiro reply/defer é o que o Discord cronometra.
let reconheceu = false;
for (const metodo of ['reply', 'deferReply']) {
  const original = interaction[metodo].bind(interaction);
  interaction[metodo] = (...args) => {
    if (!reconheceu) {
      reconheceu = true;
      obs.ackDuration.observe({ command: interaction.commandName }, segundos());
    }
    return original(...args);
  };
}

let outcome = 'ok';
try {
  await command.execute(interaction);
} catch (error) {
  outcome = 'error';
  // … o tratamento que já existe …
} finally {
  obs.commandDuration.observe({ command: interaction.commandName, outcome, via: 'slash' }, segundos());
}
```

**Nada de guild, usuário ou jogador como label**: cardinalidade explode e o `docs/PRIVACY.md` não prevê isso.

### 6.2 Logs

- [ ] `logError` passa a emitir **JSON de uma linha** (`ts`, `level`, `scope`, `command`, `interactionId`, `msg`, `stack`), com `command` e `interactionId` lidos do `requestContext`. Uma queixa no Discord ("deu erro agora") vira busca pelo id.
- [ ] ID do Discord só no nível `debug`. Retenção: 14 dias (`json-file` com `max-size` e `max-file`, 6.6).

### 6.3 Rastreio distribuído

[Provável] OpenTelemetry é excesso para um processo só: as fases do 6.1 mais o `interactionId` nos logs respondem as mesmas perguntas. Revisitar no estágio D.

### 6.4 SLIs e SLOs

| SLI | SLO (30 dias) | Orçamento |
|---|---|---|
| Gateway conectado (`/healthz` 200) | ≥ 99,5% | ~3h36min fora por mês |
| Reconhecimento em < 3s | ≥ 99,9% das interações | 1 em 1.000 vira "O aplicativo não respondeu" |
| Comando sem erro de sistema | ≥ 99% | Erro de usuário (jogador inexistente) não conta |
| Latência por classe | tabela 4.6 | — |

Orçamento estourado congela feature até voltar ao verde.

### 6.5 Alertas

Prometheus + Grafana na mesma máquina, com contact point no Discord [Certo — o Grafana tem o tipo "Discord"]; ou só Uptime Kuma no `/healthz`, se RAM for problema.

```yaml
groups:
  - name: kuratanibot
    rules:
      - alert: BotFora
        expr: up{job="kuratanibot"} == 0
        for: 5m
      - alert: ReconhecimentoPertoDoLimite
        expr: histogram_quantile(0.99, sum by (le) (rate(kb_interaction_ack_seconds_bucket[10m]))) > 2
        for: 10m
      - alert: TaxaDeErro
        # Com volume mínimo: 1 erro em 3 comandos às 4h da manhã não é incidente.
        expr: |
          sum(rate(kb_command_duration_seconds_count{outcome="error"}[15m]))
            / sum(rate(kb_command_duration_seconds_count[15m])) > 0.05
          and sum(rate(kb_command_duration_seconds_count[15m])) > 0.02
        for: 15m
      - alert: RateLimitExterno
        expr: sum by (host) (increase(kb_upstream_seconds_count{status="429"}[10m])) > 0
      - alert: EventLoopTravado
        expr: nodejs_eventloop_lag_p99_seconds > 0.2
        for: 10m
      - alert: DiscoCheio
        expr: node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} < 0.15
        for: 30m
```

### 6.6 Runbooks

| Sintoma | Diagnóstico | Ação |
|---|---|---|
| `BotFora` | `docker compose logs --tail 200 kuratanibot` | Token inválido → gerar outro no Developer Portal. "Disallowed intents" → mensagem do `index.js` diz o que fazer. Loop de crash → rollback (7.4) |
| `RateLimitExterno` (osu.ppy.sh) | `kb_upstream_seconds_count{status="429"}` por host | Baixar o balde correspondente em `rateLimiter.js` (o comentário lá já diz qual primeiro) e reiniciar |
| osu! fora | 5xx em `kb_upstream_seconds` | Nada a fazer: `.osu` cai nos espelhos, metadados faltam no embed. Avisar no canal |
| Redis fora | `logError('daycoreAdmin:redis')` | Comandos admin recusam com mensagem; anúncios in-game param. Sem ação no bot |
| Disco cheio | `du -sh data/*` | `cache.db` é regenerável: com o bot parado, apagar `cache.db*`. **Nunca** o `bot.db` |
| Deploy ruim | Erro ou latência acima dos critérios de 7.4 | Rollback de imagem (7.4) |

---

## 7. CI/CD e release

### 7.1 CI — entra no mesmo PR da correção 5.1

Sem a 5.1, o CI nasce vermelho e ensina todo mundo a ignorá-lo.

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push: { branches: [main] }
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: ['22.13', '22.x', '24.x']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}', cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm test

  supply-chain:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: '22.x', cache: npm }
      - run: npm ci
      - run: npm audit --omit=dev --audit-level=high
      - run: npm run notices && git diff --exit-code THIRD-PARTY-NOTICES.md
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
```

Proteção de branch no `main`: `test` obrigatório desde o primeiro dia; `supply-chain` depois de duas semanas (ver 9.3).

### 7.2 Container

```dockerfile
# Dockerfile
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production KURATANI_DATA_DIR=/data EXIT_ON_UNCAUGHT=true

# vendor/ antes do npm ci: os motores são dependências `file:`.
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY assets ./assets
COPY scripts ./scripts

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
CMD ["node", "src/index.js"]
```

```gitignore
# .dockerignore
.env
.env.*
data/
node_modules/
.git/
test/
docs/
vendor/akatsuki-pp-js/
```

```yaml
# docker-compose.yml
services:
  kuratanibot:
    image: ghcr.io/srryabouthemess/kuratanibot:${TAG:-latest}
    build: .
    restart: unless-stopped
    env_file: .env
    environment:
      METRICS_HOST: 0.0.0.0   # só na rede do compose; sem `ports:`
      METRICS_PORT: "9464"
    volumes:
      - ./data:/data
    stop_grace_period: 20s     # cobre as cinco etapas do shutdown()
    mem_limit: 768m
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
```

[Certo] `EXIT_ON_UNCAUGHT=true` só é seguro com supervisor — o comentário no `index.js` explica a troca. Com `restart: unless-stopped`, o supervisor existe.

### 7.3 Estratégia de release

**Blue-green e canário não funcionam do jeito tradicional num bot de gateway.** [Provável] Dois processos com o mesmo token recebem os mesmos eventos: no slash, o segundo falha ao responder; no `k!`, os dois respondem. Então:

- **Staging = outra aplicação no Discord** (outro token), num servidor de testes, com o mesmo `.env` de resto. Toda imagem passa por lá antes (`npm run smoke:commands` contra ela).
- **Produção = restart rápido**: `docker compose pull && docker compose up -d`. Indisponibilidade esperada: 5–15s. [Chutando] Medir no primeiro deploy.
- **Imagem por commit:** `ghcr.io/…:<sha>` publicada no merge em `main`; `latest` só aponta.
- **Slash commands:** o registro por hash no boot já cobre. Só uma regra: **remover** ou **renomear** uma opção é mudança incompatível — cliente com cache antigo do Discord manda a opção velha por alguns minutos. O comando precisa aceitar as duas formas por um deploy.

### 7.4 Rollback

- [ ] **Antes de tudo, a trava de schema.** Hoje código antigo abre banco novo sem reclamar [Certo]. Em `migrations.js`:

```js
if (versao > VERSAO_ATUAL) {
  throw new Error(
    `O bot.db está na versão ${versao} do schema, e este código só conhece até a ${VERSAO_ATUAL}.\n` +
    '  Voltar o código depois de uma migração precisa do backup de antes dela (data/backups/).',
  );
}
```

- [ ] **Backup antes de migrar e todo dia**, só do `bot.db` (o `cache.db` é regenerável por desenho). [Certo] `VACUUM INTO` é seguro com o bot rodando em WAL:

```js
// scripts/backup.js — cron diário e antes de todo deploy com migração
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { BOT_DB, DATA_DIR } = require('../src/paths');

const destino = path.join(DATA_DIR, 'backups', `bot-${new Date().toISOString().slice(0, 10)}.db`);
fs.mkdirSync(path.dirname(destino), { recursive: true });
new DatabaseSync(BOT_DB, { readOnly: true }).exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
console.log(`backup: ${destino}`);
```

Manter 14 dias e copiar para fora da máquina (rclone para o Google Drive ou B2).

- [ ] **Critérios de rollback automático** (qualquer um, nos 30 min após o deploy): `/healthz` fora por > 2min; taxa de erro > 2× a da semana anterior; p95 de qualquer classe da tabela 4.6 > 1,2× a linha de base; qualquer 429 novo.
- [ ] **Procedimento:** `TAG=<sha anterior> docker compose up -d`. Se o deploy migrou o schema: parar, restaurar o backup de antes da migração, depois subir a tag anterior.

---

## 8. Segurança, custo e compliance

### 8.1 Ameaças, em ordem de dano

| Ameaça | Situação | Ação |
|---|---|---|
| **Credencial do Redis do Daycore** | Quem publica nos canais do Redis faz wipe, restrict e addpriv no servidor de jogo | [ ] Usuário ACL só com os canais de `daycoreAdmin/constants.js` e os `ex:*` que o `daycoreEvents.js` assina: `ACL SETUSER kuratani on >… resetchannels &rank &restrict &unrestrict &wipe &scorewipe &mapwipe &addpriv &removepriv &ex:* -@all +publish +subscribe +ping`. Conferir em staging que o client conecta (o node-redis manda comandos de handshake que o ACL pode barrar). Redis só na rede privada |
| `DISCORD_TOKEN`, `OSU_CLIENT_SECRET` | `.env` fora do git, com `.gitignore` agressivo [Certo] | [ ] `chmod 600 .env`; gitleaks no CI (7.1); plano de rotação no runbook |
| Escalada de staff | Prova de posse por código no perfil, `vouch` que não avaliza [Certo] | Já bem resolvido. Manter os testes de `staffChallenge` obrigatórios no CI |
| Cadeia de suprimento | `.wasm` binários versionados sem checksum | [ ] `vendor/CHECKSUMS` (5.3) |
| Encher disco / cache | Tetos em `beatmap_files` e `fc_pp` [Certo] | Já coberto. Alerta de disco (6.5) |
| Menção em massa | `allowedMentions: { parse: [] }` [Certo] | Já coberto |

### 8.2 Compliance

- **LGPD (e GDPR, se houver usuário na UE).** Dados pessoais: ID do Discord ligado a nick do osu!, idioma, vínculo de staff, log de ação administrativa. `/link remove` apaga os links [Certo]. Falta: [ ] prazo de retenção para `admin_actions` e `staff_link_challenges` expirados, escrito no `docs/PRIVACY.md`, e uma limpeza periódica que o cumpra.
- **Termos da API do osu!.** [Provável] A documentação da v2 pede para falar com a equipe acima de ~60 req/min, e o balde atual permite 480 req/min em pico. O lote do 4.1 derruba o volume real, e vale conferir o texto atual dos termos.
- **Política de desenvolvedor do Discord.** [Provável] Exige atender pedido de exclusão; o `/link remove` cobre os links, e o resto entra com a limpeza acima.

### 8.3 Custo

| Opção | Custo mensal | Conf. |
|---|---|---|
| Estágio A–C numa VPS | O que já se paga hoje; Prometheus + Grafana somam ~300–600MB de RAM | [Provável] |
| Grafana Cloud no plano gratuito, em vez de hospedar | US$ 0 dentro da cota | [Provável] |
| Kubernetes gerenciado (EKS) | ~US$ 73 só do control plane, antes de qualquer nó | [Provável] |

A otimização de custo que importa é **não** subir de estágio antes do gatilho.

---

## 9. Roadmap

Dimensionado para **um mantenedor em tempo parcial**. As datas são semanas a partir do início; o esforço é em dias-pessoa.

| Fase | Semanas | Esforço | Entrega | KPI de saída |
|---|---|---|---|---|
| **0 — Chão firme** | 1 | 2 d | 5.1 + 7.1 + 7.2 + 7.4 (trava de schema e backup) | 921/921 num clone limpo; CI obrigatório no `main`; restart automático comprovado matando o processo |
| **1 — Enxergar** | 2–3 | 3 d + 7 d de coleta | 6.1, 6.2, 6.5, runbooks | p50/p95/p99 por comando e por fase publicados; alerta disparado de propósito em staging |
| **2 — Mais rápido** | 4–6 | 5–7 d | 4.1, 4.2, 4.5; 4.3 e 4.4 só se os números da Fase 1 pedirem; `scripts/load.js` | `/nochoke` frio p95 ≤ 50% da linha de base; −60% de requisições à API oficial por comando pesado; zero 429 por 2 semanas |
| **3 — Resistente** | 7–9 | 4–5 d | Botões sem coletor (`view_state`), app de staging, release por imagem, retenção LGPD | Paginação funciona depois de um restart; deploy com < 15s fora; MTTR < 30min num incidente simulado |
| **4 — Escala** | por gatilho | 2–8 d | Estágio B (1 linha) ou C (3.2 + 3.3) | Gatilhos de 3.1 |

**Total até a Fase 3:** ~15–17 dias-pessoa em ~9 semanas. Custo de infraestrutura adicional: ~zero, se couber na máquina atual. [Provável]

### 9.1 Fase 0 — tasks

- [ ] `test/setup.js` com o registro fixo (5.1). Verificar: `mv .env .env.bak; npm test; mv .env.bak .env` → 921/921.
- [ ] `.github/workflows/ci.yml` (7.1) no mesmo PR. Verificar: PR verde.
- [ ] Trava `versao > VERSAO_ATUAL` em `migrations.js` + teste em `test/dbMigrations.test.js`.
- [ ] `scripts/backup.js` + entrada no cron.
- [ ] `Dockerfile`, `.dockerignore`, `docker-compose.yml`. Verificar: `docker compose up -d`, `docker kill -s KILL <id>`, o container volta sozinho.
- [ ] Proteção de branch no `main`.

### 9.2 Fase 3 — botões sem coletor

O coletor guarda o estado da paginação na memória do processo; um restart mata todos os botões abertos. [Certo] O desenho novo guarda o que a página precisa no `cache.db` e põe só o id no botão:

```sql
CREATE TABLE IF NOT EXISTS cache.view_state (
  id         TEXT    PRIMARY KEY,  -- 10 caracteres base36
  command    TEXT    NOT NULL,
  owner_id   TEXT    NOT NULL,     -- só quem rodou o comando vira a página
  payload    TEXT    NOT NULL,     -- JSON: entradas já calculadas, página atual
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cache.idx_view_state_exp ON view_state (expires_at);
```

```js
// customId: `v:<viewId>:<ação>` — bem abaixo dos 100 caracteres que o Discord aceita [Certo]
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() || !interaction.customId.startsWith('v:')) return;
  const [, viewId, acao] = interaction.customId.split(':');
  await components.handle(interaction, viewId, acao); // lê view_state, confere dono e validade, renderiza
});
```

`/nochoke` e `/topif` guardam as entradas já calculadas no `payload`: sem isso, virar a página depois de o cache quente expirar refaria o fan-out inteiro. `/topplays` e `/leaderboard` podem guardar só os parâmetros e reler do cache. [Provável] Funciona também no estágio C, porque os processos dividem o mesmo SQLite.

### 9.3 Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| `GET /beatmaps` em lote não traz algum campo que o bot lê | Média | Médio | Step 1 do 4.1 confere antes do código; sem paridade, não entra |
| Instrumentação muda comportamento (wrapper do `reply`) | Baixa | Alto | Extrair o wrapper para uma função e testá-la com interação simulada (reply, defer, followUp, erro); staging antes |
| O gerador de notices não é determinístico e o CI fica vermelho à toa | Média | Baixo | Conferir antes de ligar o passo; se não for, só avisar |
| `npm audit` fica vermelho por advisory numa dependência transitiva, sem relação com o PR | Alta | Baixo | `supply-chain` fora da proteção de branch nas 2 primeiras semanas; depois obrigatório, com exceção documentada por advisory |
| Prometheus + Grafana não cabem na VPS | Média | Baixo | Grafana Cloud gratuito ou só Uptime Kuma |
| Mantenedor único indisponível durante incidente | Alta | Alto | Runbooks (6.6) + restart automático + rollback em um comando |
| Subir de estágio antes do gatilho | Média | Alto | Os gatilhos de 3.1 são números; sem número, não sobe |

### 9.4 Métricas de sucesso, consolidadas

- 100% dos PRs com CI verde antes do merge; 921+ testes passando num clone limpo.
- Reconhecimento em < 3s em ≥ 99,9% das interações.
- p95 por classe dentro da tabela 4.6.
- Zero 429 por semana.
- ≥ 99,5% de disponibilidade do gateway por mês.
- MTTR < 30min; deploy com < 15s fora do ar.
- RSS estável: crescimento < 10% em 24h depois do aquecimento.
