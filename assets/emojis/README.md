# Emojis do bot

Cada imagem aqui vira um **application emoji** — emoji do próprio aplicativo,
que o bot usa em **qualquer servidor e em DM**, sem precisar estar num "servidor
de emojis" nem de permissão de emoji externo no canal.

O envio é automático no boot: arquivo que ainda não existe no aplicativo é
enviado uma vez, e nos boots seguintes é só reaproveitado. Nada é apagado do
aplicativo por aqui.

## Como adicionar

1. Ponha o arquivo nesta pasta.
2. **O nome do arquivo é o nome do emoji** (sem a extensão). O Discord só
   aceita letras, números e `_`, então o resto é normalizado — `ranking-A.png`
   vira `ranking_a`. O que sobrar precisa ter de 2 a 32 caracteres.
3. Reinicie o bot.

Regras do Discord: **PNG, GIF, JPEG ou WebP**, até **256KB** por arquivo, e no
máximo 2000 emojis por aplicativo. O tamanho que renderiza bem é 128×128.

Arquivo com nome inválido ou grande demais é ignorado com um aviso no log — o
bot sobe do mesmo jeito.

## Nomes que os comandos procuram

Grades das plays (`/recent`, `/topplays`, `/score`, `/profile`). Cada linha
aceita qualquer um dos nomes, então o pacote de ícones oficial do osu! serve
como veio:

| Grade no osu! | Nomes aceitos |
|---|---|
| `XH` — SS prateado (com Hidden/Flashlight) | `ranking-XH`, `rank_ssh`, `ssh` |
| `X` — SS | `ranking-X`, `rank_ss`, `ss` |
| `SH` — S prateado | `ranking-SH`, `rank_sh`, `sh` |
| `S` | `ranking-S`, `rank_s` |
| `A` | `ranking-A`, `rank_a` |
| `B` | `ranking-B`, `rank_b` |
| `C` | `ranking-C`, `rank_c` |
| `D` | `ranking-D`, `rank_d` |
| `F` — play não completada | `ranking-F`, `rank_f` |

(`X` e `XH` é como a API do osu! chama o SS e o SS prateado; `ss`/`ssh` é como
as pessoas falam. Tanto faz qual você usar.)

Falta algum? Aquela grade sai como texto (`**A**`), como era antes — a pasta é
opcional e nada quebra sem ela. Os ícones oficiais não incluem um `F`, então a
play não completada continua em texto até você pôr um.

> Se você usa um aplicativo separado para testes, os emojis são **por
> aplicativo**: o bot de teste envia para o app dele e o de produção para o
> dele, cada um no primeiro boot.

## De onde vêm estes arquivos

Os oito PNGs aqui são da **skin oficial do osu!**, de ppy Pty Ltd. O código do
osu! é MIT, mas os **recursos do jogo não são**: eles saem sob
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), que pede
atribuição e **proíbe uso comercial**. A atribuição está no
[THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md), e é lá que ela precisa
continuar se você trocar estes arquivos por outros.

Isso limita o bot enquanto eles estiverem aqui — bot pago não pode usá-los. A
pasta é opcional de propósito: sem os arquivos a grade volta a ser texto, e nada
mais muda.
