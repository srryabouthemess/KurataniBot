# /compare entre servidores diferentes

Data: 2026-08-21

## Problema

O `/compare` resolve **um** servidor e usa ele nas duas chamadas de perfil:

```js
const mode = resolveServer(interaction);
const [u1, u2] = await Promise.all([osu.getUser(u1Name, mode), osu.getUser(u2Name, mode)]);
```

Então "kuratani no Bancho contra ckz no Akatsuki" não tem como ser escrito: a
opção `server:` vale para os dois lados. Quem quer a comparação hoje roda o
comando duas vezes e compara os dois embeds a olho.

O bot já sabe falar com todos esses servidores ao mesmo tempo — o registro do
`servers.js` é global e o `osuClient` escolhe o adaptador por chave. O que falta
é só o comando saber perguntar duas vezes.

## O que muda

Duas opções novas no `/compare`: `server2` e `modo2`, que valem para o
`user2`. Vazias, herdam do primeiro lado — o comando continua se comportando
exatamente como hoje para quem não usa nenhuma delas.

```
/compare user1:kuratani user2:ckz server:bancho server2:akatsuki
k!compare kuratani ckz -bancho -akatsuki
```

## Resolução do segundo servidor

```
mode1 = resolveServer(interaction, 'server', 'modo')      // inalterado
base2 = server2 ?? servers.rootKey(mode1)
mode2 = modo.apply(base2, modo2 ?? modo ?? preferência salva do usuário)
```

O ponto que importa: com `server2` vazio a base é o **`mode1`**, e não o
servidor preferido do usuário. Passar por `resolveServer` daria a prioridade
errada (`escolhido || preferido || padrão`), e aí `/compare user1:a user2:b
server:akatsuki` mandaria o `b` para o Bancho de quem tem o Bancho como
preferido — dois jogadores do mesmo servidor viram uma comparação cruzada sem
ninguém ter pedido.

Vive em `userLink.js` como `resolveSecondServer(interaction, mode1)`, ao lado do
`resolveServer`: a prioridade "opção do comando ganha da preferência salva" já
mora lá, e é a leitura de `getPreferredModo` que não deve vazar para dentro de
um comando.

## Jogadores

| lado | de onde vem |
|---|---|
| `u1` | opção `user1`, senão o link do autor em `mode1` (inalterado) |
| `u2` | opção `user2`, senão — **só quando `mode2 !== mode1`** — o link do autor em `mode2` |

O fallback do `u2` é o que faz `k!compare -bancho -akatsuki` comparar a pessoa
com ela mesma nos dois servidores, que é o caso de uso mais direto de um comando
cruzado e não exige digitar nick nenhum.

Ele só existe quando os servidores diferem porque no mesmo servidor ele não teria
sentido: compararia o autor com o autor. Aí continua valendo o
`compare_need_user2` de hoje.

Sem link no `mode2`, a mensagem é o `no_link_for_server(label2)` que já existe —
ela nomeia o servidor e manda usar `/link set`, que é o que a pessoa precisa
fazer. O `compare_need_user2` genérico pediria um nick que a pessoa não quis
digitar.

## Embed

`diferente = mode1 !== mode2` decide tudo o que aparece:

```
iguais       **kuratani**  ·  **ckz**
             Solicitado por lucas • Bancho

diferentes   **kuratani** (Bancho)  ·  **ckz** (Akatsuki RX)
             Solicitado por lucas • Bancho vs Akatsuki RX
```

O rodapé passa `"Bancho vs Akatsuki RX"` pelo `compare_footer` já existente, no
lugar onde hoje vai o rótulo único: nenhuma string de i18n nova, e o formato do
rodapé continua traduzido nos três idiomas.

A **tabela não muda**. O orçamento de 26 colunas do bloco monoespaçado (ver o
comentário no topo do `compare.js`) existe porque o Discord mobile não rola na
horizontal, e não tem folga para um rótulo de servidor em cada coluna. O nome do
servidor vai na linha de fora, junto do nome completo, que é texto normal e
quebra linha sem estragar alinhamento.

## Modo texto

`resolveFlag` devolve a **primeira** def cuja lista de choices casa com a
palavra. Com `server` e `server2` tendo as mesmas choices, `-akatsuki` cairia
sempre no `server`, e `-bancho -akatsuki` acabaria como um `server:akatsuki`
solitário — o primeiro valor sobrescrito em silêncio.

O comando declara para onde a repetição transborda:

```js
prefix: { flagOverflow: { server: 'server2', modo: 'modo2' } }
```

`parseArgs` passa para o `resolveFlag` o que já foi preenchido. Se **qualquer**
def do grupo que a flag resolveu já tem valor, o grupo **inteiro** migra para o
overflow.

O grupo inteiro, e não def por def, por causa da flag composta: em
`k!compare a b -bancho -akatsukirx`, o `-akatsukirx` resolve para
`{server: akatsuki} + {modo: rx}`. Com o `server` já preenchido e o `modo` não,
uma migração individual gravaria `server2:akatsuki` e `modo:rx` — o RX no lado
errado da comparação.

Uma flag sem overflow declarado, ou com a def de destino também já preenchida,
continua sobrescrevendo como hoje. É o que mantém `k!rs fulano -bancho -akatsuki`
(um comando de um jogador só) se comportando como sempre se comportou.

`listFlags` passa a deduplicar: `server` e `server2` oferecem as mesmas choices,
e sem isso a mensagem de flag desconhecida listaria `-bancho`, `-akatsuki` e
companhia duas vezes cada.

## Testes

`test/prefix.test.js`
- flag repetida cai no overflow (`-bancho -akatsuki` → `server` + `server2`)
- flag única não usa o overflow (`-akatsuki` → só `server`)
- composta migra inteira (`-bancho -akatsukirx` → `server2` + `modo2`)
- comando sem `flagOverflow` continua sobrescrevendo
- `listFlags` não repete choice

`test/compare.test.js` (novo)
- `mode2` herda de `mode1` quando `server2` e `modo2` estão vazios
- `server2` vazio não puxa a preferência do usuário
- `user2` vazio cai no link do `mode2` quando os servidores diferem
- `user2` vazio com servidores iguais continua reclamando
- rótulo de servidor só entra no embed quando os servidores diferem

## Fora de escopo

Comparar **três ou mais** jogadores, e transbordo genérico para N slots: o
`flagOverflow` é um mapa de uma etapa só, de propósito. Uma cadeia de slots
resolveria um comando que ninguém pediu e a tabela não caberia na tela mesmo.
