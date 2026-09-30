# Investigação: dá para parar de buscar o detalhe de cada score no Daycore?

30/09/2026 · só leitura, nenhuma linha de `src/` ou `test/` alterada.

## Resumo

**Sim, dá, mas só trocando a fonte do top.** Pular o `scoreDetail` quando os
hits já vierem, sozinho, não muda nada no Daycore: a Shiina-Web nunca manda hits.
E o detalhe é só metade da conta. O `enrichScores` também busca `/v2/maps/{id}`
para **toda** play, então um /nc frio de 100 plays gera hoje cerca de **205**
requisições na fila `server:daycore`, e não cerca de 100.

Recomendação: **fazer as duas coisas juntas** (v1 do bancho.py como fonte do top e
do recent, e pular o detalhe quando o score cru já trouxer os hits). Isso leva o /nc
frio para cerca de **105** requisições. Antes, é preciso rodar três `curl` contra
o Daycore (seção "O que ficou incerto").

## Método, e o limite dele

**As requisições reais não saíram.** A política de rede deste container bloqueia
`daycore.org`, `api.daycore.org` e `api.ez-pp.farm` (o proxy de saída responde 403
no CONNECT, também pelo WebFetch). Por isso a pergunta 1 foi respondida pelo
**código-fonte** dos três endpoints, e não por respostas reais:

| Serviço | Repositório lido | HEAD |
|---|---|---|
| Shiina-Web | `osu-NoLimits/shiina-web` | `f5e2fae` (25/07/2026) |
| bancho.py-ex (o que o onl-docker sobe) | `osu-NoLimits/bancho.py-ex` | `8684d0c` (24/07/2026) |
| bancho.py upstream (referência para o EZPP) | `osuAkatsuki/bancho.py` | `f10c03a` (27/09/2026) e `bbeb683` (2025) |

A versão que o Daycore roda em produção **não foi verificada**. Tudo o que depende
dela está marcado como [Provável] abaixo.

## 1. Campo a campo: Shiina-Web × v1 do bancho.py × `/v2/scores/{id}`

Fontes: `GetPlayerScores.java` (Shiina), `app/api/v1/api.py:358-540` e
`app/api/v2/models/scores.py` (bancho.py-ex).

| Campo | Shiina `get_player_scores` | v1 `get_player_scores` (ex) | v2 `/scores/{id}` (ex) |
|---|---|---|---|
| id do score | `score_id` | `id` | `id` |
| pontuação | `max_score` (**int** Java) | `score` | `score` |
| pp | `pp` **int (truncado)** | `pp` float | `pp` float |
| acc | `acc` **int (truncado)** | `acc` float | `acc` float |
| combo da play | — | `max_combo` | `max_combo` |
| mods | `mods` **lista de strings** (`["HD","RX"]`) | `mods` bitmask | `mods` bitmask |
| n300/n100/n50/nmiss | — | sim | sim |
| ngeki/nkatu | — | sim | sim |
| grade | `grade` | `grade` | `grade` |
| status do score | — | `status` | `status` |
| modo | — | `mode` | `mode` |
| data | `play_time` texto SQL (`2026-07-07 11:01:00`) | `play_time` ISO sem fuso | `play_time` ISO sem fuso |
| time_elapsed, perfect | — | sim | sim |
| userid | `user_id` | — (vem em `player.id`, no nível da resposta) | `userid` |
| md5 do mapa | `map_md5` | `beatmap.md5` | `map_md5` |
| mapa | achatado: `map_id`, `map_set_id`, `map_name` (= `filename`) | aninhado em `beatmap`: id, set_id, artist, title, version, creator, status, diff, total_length, bpm, cs/ar/od/hp, plays, passes | **nada** |
| extras | `weight`, `weight_pp`, `hasNextPage` | `player {id,name,clan}` | — |

Os campos do score da v2 são um **subconjunto** dos da v1. As duas leem as mesmas
colunas da tabela `scores`, e a v1 ainda traz o mapa junto.

**Um bug no bancho.py-ex:** o `SELECT` busca `t.max_combo` (da play) e
`b.max_combo as map_max_combo` (do mapa), mas o dicionário de saída monta
`"beatmap": {"max_combo": row.get("max_combo")}`. Resultado: **`beatmap.max_combo`
da v1 é o combo da PLAY, não o do mapa**. O bug entrou no commit `70fdd9d`
(05/05/2025, "optimize api_get_player_scores") e continua no HEAD. Hoje ele não
causa estrago, porque o `nativeScore` não repassa esse campo. Mas ele proíbe usar o
mapa aninhado para pular o `/v2/maps/{id}` sem cuidado (ver pergunta 6).

## 2. O que o `normalizeScorePrivate` lê do detalhe, e onde está na v1

| Lido do `v2` (detalhe) | Na v1 nativa (via `nativeScore`) | Na Shiina |
|---|---|---|
| `pp` | `pp` ✅ float | int truncado ⚠️ |
| `acc` | `acc` ✅ float | int truncado ⚠️ |
| `max_combo` | `max_combo` ✅ (já repassado) | falta ❌ |
| `grade` | `grade` ✅ | ✅ |
| `mods` (bitmask) | `mods` ✅ bitmask. O RX aparece como bit 128 e `decodeMods` trata igual | strings (o normalizador aceita lista) |
| `play_time` | ✅ mesmo formato ISO da v2 | formato SQL |
| `score` | `score` ✅ | falta (o campo lá é `max_score`, nunca lido) ❌ |
| `n300/n100/n50/nmiss` | ✅ (já repassados) | faltam ❌ |
| `ngeki/nkatu` | existem na resposta. O normalizador **não** os lê, e o `nativeScore` também não repassa | faltam |
| `perfect`, `status` | existem. O normalizador não lê nenhum dos dois (`passed` sai de `grade !== 'F'`) | faltam |

**Conclusão [Certo, pelo código]:** tudo o que o normalizador tira do detalhe já
está no score nativo da v1. Pular o detalhe quando o score vem da v1 **não perde
campo nenhum**.

**O mapa aninhado (custom maps, id ≥ 100.000.000):** no bancho.py-ex a v1 faz
`INNER JOIN maps` direto, sem passar pelo `Beatmap.from_md5`, então o mapa custom
vem igual a um oficial: id, set_id, artist, title, version, creator, status, diff e
total_length (fora o `max_combo` quebrado acima). O `nativeScore` remonta
`map_name` a partir de artist/title/creator/version, então título e dificuldade
continuam saindo pela mesma regex. Na Shiina, `map_name` é o `filename` da tabela.

**Datas:** o caminho com detalhe já usa o `play_time` da v2, que tem o mesmo
formato da v1. Trocar a fonte não muda como a data é interpretada.

## 3. Ordem, conteúdo, limit, status, Relax

| | Shiina | v1 bancho.py-ex |
|---|---|---|
| filtro `best` | `s.status = 2 AND m.status = 2` | `t.status = 2 AND b.status IN (2, 3)` (+5 com `include_loved`) |
| ordem `best` | `ORDER BY s.pp DESC` | `ORDER BY t.pp DESC` |
| filtro `recent` | nenhum (inclui falhas) | nenhum com o `include_failed=true` padrão (inclui falhas) |
| ordem `recent` | `play_time DESC` | `play_time DESC` |
| `limit` | sem teto (padrão 5) | `1..100`: **acima de 100 responde 422** (padrão 25) |
| Relax | `s.mode = ?`, o bot manda 4 | `mode` de 0 a 11, o bot manda 4 (`RELAX_OSU`) |
| jogador restrito | não filtra | não filtra (só 404 se não existir) |

- **Existe uma diferença de conteúdo, e ela favorece a v1.** A Shiina esconde plays
  em mapas **Approved (3)**. Só que o próprio bancho.py-ex soma o pp do perfil com
  `m.status IN (2, 3)` (`app/api/domains/osu.py:992` e `:1600`), e o
  `awards_ranked_pp` é `Ranked or Approved`. Então a v1 bate com o total do perfil
  e a Shiina não. Hoje, num jogador com play em mapa Approved, o /topplays e o /nc
  do Daycore omitem uma play que conta no pp dele. Loved fica de fora nas duas.
- **Ordem:** o mesmo `ORDER BY pp DESC`. Empates de pp podem sair em ordem diferente
  (o MySQL não garante a ordem entre linhas empatadas), sem consequência prática.
- **`limit`:** todos os chamadores de hoje pedem no máximo 100 (`nochoke`, `topif`,
  `topplays`, `pp`, `whatif` pedem 100; `recent` pede 50). Um pedido acima de 100
  na v1 vira 422, o `banchoV1Get` devolve `null` e a lista sai **vazia e calada**. A
  troca deveria vir com um clamp em 100, igual ao que o `players.js` já faz para o
  `get_leaderboard`.
- **Relax:** separado do mesmo jeito nas duas, pelo `mode=4`. Os scores RX trazem o
  bit 128 nos mods, tanto na v1 quanto na v2.

## 4. Por que o Daycore usa a Shiina-Web para o top

**Não houve um motivo técnico. Foi uma premissa errada que nunca foi revista.**

- `341865d` (commit inicial, 06/06/2026): `DAYCORE_V1 = 'https://daycore.org/api/v1'`,
  ou seja, a Shiina ganhou o nome de "a v1" e o top saiu dela desde o primeiro dia.
- `d7b2a9c` (11/08): a premissa aparece escrita no código: "`get_rank_cache` e
  `get_player_scores` **existem aqui e não lá**". Isso vale para o `get_rank_cache`,
  mas é falso para o `get_player_scores`, que existe no bancho.py desde 2021
  (`0b5237f`, "re-add api/get_player_scores", no bancho.py-ex).
- `f28c97f` (14/08): o custo do detalhe foi medido ("o endpoint mais caro do bot") e
  a resposta foi um **cache**, sem questionar a fonte.
- `458a28c` (15/08): o EZPP passa a usar o `get_player_scores` **do bancho.py**, o
  que prova que ele existe. Mas ele foi tratado como plano B só para servidor sem
  Shiina.
- `d4596ae` (21/08): o rank sai da Shiina ("na mesma requisição"), e a mensagem
  repete a premissa: "O temShiina continua valendo para o que **só o front-end
  tem** (get_player_scores)".
- `f95b447` (24/09): só divide o arquivo e não mexe na decisão.

Existe **um** motivo real, que ninguém registrou: com a Shiina, o detalhe é
**obrigatório**, porque sem ele pp e acc sairiam inteiros e faltariam hits, combo e
pontuação. Esse motivo desaparece quando a fonte é a v1.

## 5. EZPP (sem Shiina): o detalhe é desperdício?

**[Provável] Sim, 100%.** O EZPP já passa pelo `nativeScore`, e o detalhe devolve as
mesmas colunas da tabela `scores` que o score nativo já trouxe. As únicas diferenças
são `userid` e `map_md5` no topo, que o normalizador não lê. O detalhe ainda
**piora** um dado: ele fica 1h no cache, enquanto a lista (`topPlays`) fica pouco
tempo. Assim, depois de um recálculo em massa, o pp da lista está fresco e o do
detalhe está velho, e o normalizador prefere o do detalhe (`v2?.pp ?? v1.pp`).

O "provável" é só porque a versão do bancho.py do EZPP não foi conferida. A
fixture `SCORE_NATIVO` em `test/banchoPyNativo.test.js` já traz
hits/combo/ngeki/nkatu, e o upstream atual (`format_player_score_with_beatmap`)
também traz.

## 6. Quantas requisições num /nc frio de 100 plays

Hoje (Daycore, jogador pelo nome, cache frio), tudo na fila `server:daycore` a
10 req/s:

| Etapa | Requisições |
|---|---|
| `resolvePlayerId` (v1 `get_player_info`) | 1 |
| perfil: v2 player + v2 stats + v1 `get_player_info` stats | 3 |
| lista (Shiina `get_player_scores`) | 1 |
| `scoreDetail`, um por play | 100 |
| `mapaDoScore` → `/v2/maps/{id}`: **sempre roda**, porque o normalizador devolve `beatmap.max_combo: null`, `difficulty_rating: 0` e nenhum `status`, então o `precisaDoMapa` é sempre verdadeiro | ~100 (o `best` tem um mapa por play) |
| **total** | **~205, com piso de ~20s só de balde** |

| Opção | `server:daycore` num /nc frio |
|---|---|
| Nenhuma mudança | ~205 |
| Só pular o detalhe quando os hits vierem | ~205 no Daycore (a Shiina não tem hits), ~105 no EZPP |
| Trocar a fonte para a v1 e pular o detalhe | **~105** (piso de ~10s) |
| O mesmo, e ainda usar o mapa aninhado da v1 (diff/status/título, **nunca** o `max_combo`) e deixar o combo do mapa para o `enrichBeatmapData` oficial | ~5 + um por mapa custom do top; ~100 vão para o balde `osuApi` (8/s), que tem cache persistente em `cache.db` |

Não consegui fechar as contas do /diag: 1119 chamadas em 36 execuções dão cerca de
31 por execução, e ~1400 falhas do `scoreDetalhe` não cabem nesse número. O mais
provável é que os contadores cubram comandos e janelas diferentes, mas vale olhar
antes de usar esses números como linha de base.

## Recomendação

**As duas coisas, no mesmo PR:**

1. `playerScores` passa a usar a v1 `get_player_scores` + `nativeScore` em
   **qualquer** bancho.py. Para o top e o recent, o `temShiina` deixa de decidir a
   fonte (ele continua valendo para os grupos). Junto, um clamp de `limit` em 100.
2. O `enrichScores` pula o `scoreDetail` quando o score cru já tem `n300`, `n100`,
   `n50`, `nmiss` e `max_combo`. Assim, qualquer fonte sem esses campos continua
   caindo no detalhe sozinha.

O passo seguinte (usar o mapa aninhado) é opcional e fica para depois, por causa do
bug do `max_combo`.

Riscos de cada opção:

- **Trocar a fonte:** (a) plays em mapas Approved passam a aparecer no top. Isso é
  mais correto, mas é uma mudança visível. (b) O `limit` acima de 100 vira lista
  vazia calada se o clamp for esquecido. (c) A versão do bancho.py em produção pode
  diferir do HEAD lido, então é preciso conferir antes com os `curl` abaixo. (d) Os
  comentários e testes que descrevem a Shiina como fonte das plays precisam ser
  revistos (`servers.js`, `http.js`, `nochoke/index.js`, `rankDoPais.test.js`,
  `scoreDetailCache.test.js`). (e) O
  `weight`/`weight_pp` da Shiina se perde, mas nenhum código lê esses campos.
- **Pular o detalhe:** o pp passa a vir da lista, que é mais fresca do que o
  detalhe de 1h. O risco real é um servidor cuja v1 mande hits zerados em vez de
  ausentes, e aí o detalhe seria pulado com dado ruim. Isso não aparece no código
  lido.
- **Só pular o detalhe:** ajuda o EZPP e deixa o Daycore exatamente como está.
- **Nenhuma:** o /nc continua com piso de ~20s de fila, fora o resto.

## O que ficou incerto, e como fechar

1. **Se a v1 do Daycore em produção se comporta como o HEAD do bancho.py-ex**
   (campos, filtro 2/3, bug do `max_combo`). Três leituras fecham isso, a partir de
   uma máquina com acesso (troque `ID` por um jogador com play em mapa custom; para
   RX, use `mode=4`):

   ```sh
   curl -s 'https://daycore.org/api/v1/get_player_scores?id=ID&mode=0&scope=best&limit=5'
   curl -s 'https://api.daycore.org/v1/get_player_scores?id=ID&mode=0&scope=best&limit=5'
   curl -s 'https://api.daycore.org/v2/scores/SCORE_ID_DO_PRIMEIRO'
   ```

   O que conferir: os mesmos `score_id`/`id` e a mesma ordem; `pp` inteiro na
   primeira resposta e decimal nas outras duas; `beatmap.max_combo` igual ao
   `max_combo` da play na segunda (isso confirma o bug).
2. Se o Daycore tem mapas **Approved** ou custom com status 3. Se tiver, o top vai
   mudar de conteúdo com a troca.
3. A versão do bancho.py do EZPP (pergunta 5).
4. As contas do /diag (pergunta 6).
