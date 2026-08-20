# Unificar VN e RX no /recent e /rs

**Data:** 2026-08-20
**Status:** aprovado, aguardando plano de implementação

## Problema

Em servidor privado com par VN/RX (Daycore, EZPP, Akatsuki), `/recent` e `/rs`
mostram só um dos dois — o `mode` resolvido em `resolvePlayer` aponta pra uma
chave só (`daycore` OU `daycore_rx`), nunca as duas. Quem joga os dois modos
não vê "a última play que eu fiz", vê "a última play que eu fiz NAQUELE modo
específico" — e pode nem lembrar qual modo jogou por último.

## Escopo

Só `/recent` e `/rs` (que é alias — herda o `execute` de `recent.js`, então
muda automaticamente). `/score`, `/topplays`, `/leaderboard`, `/link` e todo o
resto continuam exatamente como estão: `server:` neles ainda escolhe uma
chave só, com o significado de hoje.

## Comportamento

**Servidor com par RX** (tem entrada `<chave>_rx` no registro — Daycore, EZPP,
Akatsuki hoje): busca as recentes de VN e de RX em paralelo, junta as duas
listas por `created_at` decrescente, corta no `FETCH_LIMIT` (50) — mesmo
tamanho de página de hoje, só que agora pode vir das duas fontes.

**Servidor sem par RX** (Bancho oficial, ou privado sem `RELAX=true` no
`.env`): comportamento idêntico ao atual — uma busca só, sem overhead.

## A opção de preferência

Novo parâmetro opcional em `/recent`, que o `/rs` herda por já reaproveitar
`recent.data.toJSON()`:

```
modo: "Só VN" | "Só RX"     (omitido = combinado, quando há par RX)
```

`server:` continua com o significado de hoje — escolhe QUAL servidor
(Daycore, EZPP, Bancho...). As duas opções são independentes: `server:` diz
a conta, `modo:` diz o filtro dentro dela.

`modo:` sempre opera sobre o PAR (a chave raiz e a `_rx`, tiradas do mesmo
namespace), não sobre a chave única que `server:` resolveu — por isso
`server: daycore_rx` com `modo: VN` funciona (busca a VN do mesmo par, não a
RX que a chave resolvida sugeriria sozinha).

**Compatibilidade com quem já aponta pro `_rx` direto** (uso manual de
`server: daycore_rx`, ou `/link default` já configurado assim): se o `server`
resolvido (por parâmetro, preferência salva, ou padrão) for a chave `_rx`, o
default de `modo` vira "Só RX" em vez de combinado — quem já tinha esse hábito
não é surpreendido com uma lista mesclada do nada. `modo:` passado explicitamente
sempre vence sobre esse default.

| `server` resolvido | `modo:` não passado | `modo: VN` | `modo: RX` |
|---|---|---|---|
| `daycore` (raiz) | combinado | só VN | só RX |
| `daycore_rx` | só RX | só VN | só RX |
| `official` (sem par) | só oficial (como hoje) | só oficial | só oficial |

## Por página, não por comando

Hoje `buildEmbed`/`prefetch` em `recent.js` usam um `mode` só, do comando
inteiro. Com a lista combinada cada play carrega o modo de onde ela veio
(VN ou RX), e tudo que hoje lê `mode` do comando passa a ler o `mode` DA PLAY:

- `osu.enrichScores`, `ppText`/`stars` (em `embeds/play.js`) — os motores de
  pp são diferentes entre VN (lazer-calculator) e RX (akatsuki-pp); usar o
  modo errado dá número errado, não só rótulo errado.
- `osu.getMapUrl` — URL do mapa no site do servidor.
- `mapContext.remember` — pro `/score` sem argumento saber em qual
  leaderboard procurar a play depois.
- Rótulo do rodapé (`osu.getModeLabel`) — hoje é um só pra página inteira;
  cada página passa a mostrar o modo da SUA play ("Daycore" numa página,
  "Daycore RX" na seguinte).

`playEmbed.author()` (a linha do topo com nick/pp/rank) continua usando o
`mode` resolvido do COMANDO, não da play — é o link de perfil do jogador, e a
URL é a mesma em VN e RX nos dois adaptadores (`banchoPyApi.userUrl` e
`rippleApi.userUrl` não fazem essa distinção).

## Falha parcial

Se uma das duas buscas falhar (ex: endpoint de RX fora do ar) o comando não
cai inteiro — mostra a lista da que funcionou, mesmo padrão de
`Promise.allSettled` que `fetchPlayer` (`userLink.js`) já usa pra separar
"perfil não existe" de "erro de rede".

## Fora de escopo

- Qualquer outro comando além de `/recent`/`/rs`.
- Mudar o que `server:` significa nos outros comandos.
- Cache de recentes — continua sem cache, nos dois modos, pelo mesmo motivo
  de hoje (resposta tem que ser a mais nova).

## Testes

- Servidor com par RX, sem `modo:` → lista intercalada VN/RX por data,
  rótulo do rodapé batendo com cada play.
- `modo: VN` / `modo: RX` num servidor com par → filtra pra um só, igual ao
  comportamento de hoje.
- `server: daycore_rx` sem `modo:` → só RX (compat).
- Servidor sem par RX (oficial, ou privado com `RELAX` ausente) → uma busca
  só, sem chamada extra.
- Uma das duas buscas rejeitando → comando responde com a outra lista, não
  quebra.
- `/score` sem argumento depois de um `/recent` combinado → acha o mapa no
  leaderboard certo (modo da play exibida, não do comando).
