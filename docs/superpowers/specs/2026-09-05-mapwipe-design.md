# Apagar todas as plays de um jogador num mapa (`mapwipe`)

Data: 2026-09-05

## Problema

O `/scorewipe` apaga um score por vez. Quando a moderação precisa tirar tudo o
que um jogador tem num mapa — o caso de uma sessão inteira suja no mesmo mapa —
a única saída hoje é rodar o comando N vezes.

Isso funciona, mas cada volta publica uma mensagem no canal `scorewipe`, e o
`wipe_score` do bancho faz um `post_audit_log` por chamada, que é um embed no
webhook de auditoria do servidor. Dez plays viram dez embeds, e o log de
auditoria — que existe para uma pessoa ler — vira rolagem.

Agrupar isso pelo lado do bot é impossível: o bot não fala com o MySQL do
servidor. Ele publica no Redis e lê a API, e as duas pontas trabalham um score
por vez.

## O que muda

Um canal Redis novo, `mapwipe`, com uma função no bancho que apaga o lote
inteiro e escreve **uma** entrada de auditoria.

O canal `scorewipe` não muda. Ele já roda em produção, e o receptor dele
continua aceitando exatamente o payload de hoje — nenhum caminho existente muda
de comportamento. A alternativa de fazer o `scorewipe` aceitar `ids: [...]` além
de `id` foi descartada por isso: deixaria o receptor com dois formatos e um
publish antigo ambíguo.

### O payload

```json
{ "id": 7, "md5": "c9557c9d...", "mode": 0, "adminId": 3, "reason": "..." }
```

`id` é o jogador (não o score, ao contrário do canal `scorewipe`) e `md5` é a
chave do mapa. É md5 e não o id do beatmap porque é assim que a tabela `scores`
guarda o mapa; resolver id → md5 dentro do receptor seria uma consulta a mais
para chegar no mesmo lugar. As linhas da v1 (`get_player_scores`) já trazem
`map_md5`, então o bot tem o valor em mãos sem chamada extra.

`adminId` e `reason` seguem o formato do `wipe` e do `scorewipe`, inclusive a
assinatura do `signReason`.

## Lado do daycore (`patches/bancho.py-ex.patch`)

### 1. `_rebuild_stats` passa a aceitar uma lista

Hoje a assinatura é `_rebuild_stats(user_id, mode, wiped)`, com **um** score, e
ela subtrai `plays - 1` e os totais daquela play. Passa a receber uma sequência:

- `plays` → `stats["plays"] - len(wiped)`
- `playtime` → subtrai `sum(s["time_elapsed"] // 1000 for s in wiped)`. A
  divisão é **por score**, e não sobre a soma: é assim que a submissão soma, e o
  que se quer aqui é o inverso exato dela. Somar primeiro e dividir depois
  devolveria até um segundo a mais por play.
- `tscore` → subtrai a soma dos `score`
- `total_hits` → subtrai a soma dos hits, com a regra de geki/katu por modo
  aplicada a cada score

O resto do corpo não muda: `rscore`, `max_combo`, os contadores de grade, `pp` e
`acc` já são recalculados a partir do que sobrou no banco, e o lote não altera
essa lógica. As proteções de `max(0, ...)` continuam valendo, pelo mesmo motivo
de sempre — as colunas são UNSIGNED.

`wipe_score` passa `[score]`. Uma implementação só, e o caminho de um score
continua coberto pelos testes que já existem.

### 2. `wipe_map_scores(user_id, map_md5, mode, admin_id, reason)`

```
SELECT ... FROM scores WHERE userid = :u AND map_md5 = :m AND mode = :mo
                         AND status >= 0
```

`status >= 0` pega os três estados do `SubmissionStatus` — FAILED (0),
SUBMITTED (1) e BEST (2) — e deixa de fora o que já está em
`WIPED_SCORE_STATUS` (-1). Os failed entram de propósito: eles contam em
`plays`, e deixá-los de pé faria o mapa continuar somando tentativas do jogador
depois de um wipe que se anunciou como total.

Lista vazia devolve `"no scores"`, do mesmo jeito que o `wipe_score` devolve
`"score already wiped"` — não é falha, e dizer isso em vez de seguir é o que
impede uma repetição de subtrair `plays` de novo.

Depois: um `UPDATE scores SET status = -1 WHERE id IN (...)`, um
`_rebuild_stats` com a lista inteira, o `zadd` nos dois sorted sets e o
`stats_from_sql_full` + `enqueue` se o jogador estiver online — tudo igual ao
`wipe_score`, só que uma vez em vez de N.

**Não existe promoção de runner-up aqui.** No `wipe_score` ela existe porque
sobra play do jogador no mapa e o slot de BEST não pode ficar vazio; no lote não
sobra nenhuma, por definição. O embed diz isso, para quem lê não procurar.

### 3. Receptor e estilo do log

- `channel_mapwipe_reciever`, no mesmo formato dos outros, registrado com
  `_supervised(channel_mapwipe_reciever, "mapwipe")`.
- `AUDIT_LOG_STYLE["mapwipe"] = ("Map scores wiped", <cor>)`.
- Um `post_audit_log(action="mapwipe", ...)` com `extra`:
  `Mode`, `Map` (link, como no `scorewipe`), `Scores` com a contagem, e a lista
  dos ids. **A lista é truncada**: o Discord recusa field acima de 1024
  caracteres, e trinta ids passam disso. O corte mostra os primeiros e um
  `… e mais N`; a contagem, que é o número que importa, está no começo.

### 4. Endpoint de leitura `get_player_map_scores`

Na API v1, ao lado do `get_player_scores`. Parâmetros `id` (jogador), `md5` e
`mode`; devolve todos os status, com `id`, `status`, `pp`, `acc`, `grade`,
`mods` e `play_time`.

Existe porque o bot precisa do número nas duas pontas: **antes**, para a
confirmação dizer quantas plays vão embora, e **depois**, para conferir que não
sobrou nenhuma acima de -1. A v1 `get_player_scores` é por modo e não por mapa,
e a `get_map_scores` é leaderboard, sem filtro por jogador — nenhuma das duas
responde a pergunta.

Faz o bot manter o padrão que ele já usa em toda ação administrativa: publica no
Redis, confere lendo a API. A alternativa — o receptor responder num canal de
volta — exigiria id de correlação e timeout no bot, mecanismo novo só para isto.

## Lado do bot

### `src/daycoreAdmin.js`

- `CHANNELS.MAPWIPE = 'mapwipe'`
- `wipeMapScores(targetOsuId, mapMd5, modeNum, actor, reason)` — publica o
  payload acima, com `signReason` como as demais
- `verifyMapScoresWiped(playerId, md5, modeNum)` — mesma forma do
  `verifyScoreWiped` (3 tentativas, 1200 ms), verdadeiro quando nenhum score
  volta com `status >= 0`

### `src/osu/banchoPyApi.js`

`getServerPlayerMapScores(playerId, md5, modeNum, mode = PRIVATE_MODE)`, pela
v1, sem cache — é leitura de confirmação de ação destrutiva, e um valor de meio
minuto atrás responderia a pergunta errada.

### `src/commands/scorewipe.js`

O fluxo até a tela de confirmação de um score fica **idêntico**. O que muda é
essa tela:

1. Depois de escolher o score, o comando busca as plays do jogador naquele mapa
   e modo. Se vier mais de uma, a tela ganha um terceiro botão, Danger:
   *"Apagar as N plays deste mapa"*. Com uma play só, o botão não aparece — o
   `/scorewipe` normal já faz exatamente isso.
2. Clicar nele **não publica nada**. Troca a tela por uma segunda confirmação,
   com as N plays listadas (a mesma linha do `descrever`), o aviso de que o
   failed entra junto, e os botões de confirmar e cancelar. A ação é maior que a
   de um score, então tem confirmação própria em vez de herdar a do score.
3. Confirmado: `wipeMapScores`, depois `verifyMapScoresWiped`, depois
   `registrarAcao('mapwipe', ...)` com a contagem e os ids no `detail`.

Se a busca do passo 1 falhar, o botão não aparece e o `/scorewipe` segue como
hoje — a falha de um extra não pode derrubar o caminho que já funciona.

As janelas de 60 s (`PICK_MS`, `CONFIRM_MS`) valem também para a segunda
confirmação, pelo mesmo motivo de sempre.

### O resto

- `src/i18n/{pt,en,ru}.js`: bloco `mapwipe_*` — botão, título e corpo das duas
  telas, linha de lista, aviso de reversibilidade, resultado, confirmado /
  não confirmado, e o caso de "não achei outras plays". O
  `help_cmd_scorewipe` passa a mencionar o mapa inteiro.
- `src/cooldowns.js`: nada. Não é comando novo; herda o `heavy` do `scorewipe`.
- `src/commands/help.js`: nada, mesma razão.
- `docs/OPCIONAIS.md` e `CHANGELOG.md`.

## Erros e casos de borda

| Situação | O que acontece |
|---|---|
| Só uma play no mapa | Botão não aparece |
| Endpoint novo indisponível | Botão não aparece; `/scorewipe` intacto |
| Nenhuma play sobrou entre a contagem e o clique | Servidor devolve `"no scores"`; o bot mostra não confirmado |
| Score escolhido já em -1 | Trava atual do `scorewipe_already`, antes de qualquer tela |
| Publicado sem receptor no ar | Verificação falha e o embed sai amarelo, não verde |

## Testes

No bot, em `test/scorewipe.test.js`:

- o publish do lote vai para o canal `mapwipe`, com `id` do jogador (e não do
  score), `md5`, `mode`, `adminId` e o motivo assinado
- o botão do mapa não aparece com uma play só
- o clique no botão não publica nada — só a segunda confirmação publica
- a verificação chama o endpoint com o modo certo e só dá verde com zero
  restantes
- a trava de DEVELOPER continua valendo no caminho novo

No daycore não há suíte automatizada: a verificação é aplicar o patch sobre o
commit fixado, subir o docker e apagar as plays de uma conta de teste,
conferindo `plays`, `pp` e o embed único no webhook.

## Ordem de deploy

O daycore primeiro. Canal sem receptor é publish no vazio, e falha em silêncio:
o bot publicaria, a verificação diria "não confirmei", e nada teria acontecido.

1. Patch no `bancho.py-ex`, `scp` para a VPS do amigo, restart do bancho.
2. Conferir nos logs que o `Subscribed to 'mapwipe' channel.` apareceu.
3. Só então o `git pull` do bot na VPS.

Até o passo 3, o botão novo é código morto — ele nem chega ao Discord.
