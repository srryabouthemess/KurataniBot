# /role — conceder e remover cargos do Daycore pelo Discord

Data: 2026-08-20

## Problema

O bot já muda o Daycore por três caminhos: `/nominate` (status de mapa),
`/moderate` (restringir e desrestringir) e `/wipe` (apagar scores). Falta o
quarto, que hoje só existe dentro do jogo pelos comandos `!addpriv` e
`!removepriv`: distribuir cargos. Dar `nominator` a um mapper novo exige entrar
no osu!, achar a pessoa e digitar o comando no chat.

## O que o servidor oferece

O `bancho.py-ex` assina dez canais de Redis no boot (`app/api/start.py`,
`start_pubsub_recievers`). Dois interessam aqui:

- `addpriv` — payload `{ id, privs, userId }`
- `removepriv` — payload `{ id, privs, userId }`

`privs` é uma lista de strings, resolvida contra o `str_priv_dict` de
`app/api/utils.py`.

### Três detalhes do servidor que moldam o desenho

**1. Existem dois `str_priv_dict`, e eles divergem.** O de `app/commands.py`
chama MODERATOR de `moderator`; o de `app/api/utils.py` chama de `mod`. Quem
atende o pub/sub é o segundo. Publicar `moderator` devolve `Invalid privilege` —
e devolve em silêncio, porque o receptor não responde a quem publicou.

**2. `addpriv` e `removepriv` não conferem privilégio nenhum de quem publica.**
O `restrict` recusa sozinho um não-Developer mexendo em staff; estes aplicam
qualquer publicação. É a mesma situação do `wipe`: o bot é a tranca inteira.

**3. `supporter` e `premium` são recusados pelos dois** (`return "use
givedonor."`). O caminho deles é o canal `givedonator`, que leva duração e não
tem contrapartida para remover.

## Escopo

Oito cargos, um por invocação:

| chave publicada | bit | privilégio exigido |
|---|---|---|
| `verified` | VERIFIED | Administrator |
| `whitelisted` | WHITELISTED | Administrator |
| `alumni` | ALUMNI | Administrator |
| `tournament` | TOURNEY_MANAGER | Administrator |
| `nominator` | NOMINATOR | Administrator |
| `mod` | MODERATOR | Developer |
| `admin` | ADMINISTRATOR | Developer |
| `developer` | DEVELOPER | Developer |

Um cargo por invocação, embora o payload aceite lista: assim o privilégio
exigido, a verificação e a linha do log ficam cada um com um assunto só.

### O que fica de fora, e por quê

`supporter` e `premium`: o servidor recusa.

`normal`: é o bit UNRESTRICTED. Tirá-lo por aqui bane sem passar pelo
`Player.restrict()` — sem registro de restrição, sem sair das leaderboards, e o
alvo continua aparecendo limpo no `/moderate check`. O caminho certo já existe.

### O escalonamento do privilégio exigido

Conceder `developer` dá controle total do servidor. Se bastasse Administrator,
um administrador conseguiria por procuração o que o próprio servidor não lhe dá
— então os três bits de staff exigem Developer.

Os cinco restantes ficam em Administrator porque travá-los em Developer
transformaria o dono em gargalo para uma tarefa de rotina, e nenhum deles
concede poder sobre outras contas.

## Componentes

### `src/daycoreAdmin.js`

- `CHANNELS.ADDPRIV` e `CHANNELS.REMOVEPRIV`
- `ROLES` — a tabela acima, fonte única para o builder, para o privilégio
  exigido e para a verificação. Espelho do `str_priv_dict` de
  `app/api/utils.py`, com a divergência do `mod` anotada no comentário
- `addPrivilege(targetOsuId, roleKey, actor)` e `removePrivilege(...)` —
  publicam `{ id, privs: [chave], userId }`
- `verifyPriv(osuId, bit, esperado)` — releitura pela API v2, três tentativas
  espaçadas de 1200 ms. Janela fixa, e não escalonada como a de mapa: o alvo é
  sempre um só e a escrita é direta no banco, sem download pelo meio
- `privNames(priv)` — todos os bits ligados, do mais alto para o mais baixo

### `src/commands/role.js`

```
/role give player:<texto> role:<escolha> reason:<texto>
/role take  player:<texto> role:<escolha> reason:<texto>
```

`GuildInstall` e contexto `Guild`. `prefix: { slashOnly: true }`, porque a
resposta expõe privilégio de terceiro e em texto a flag de efêmero some.

Sem `setDefaultMemberPermissions`: como no `/moderate`, a trava que vale é o
`resolveStaff`, e permissão default do Discord é sobrescrevível nas
configurações do servidor.

O `role` vira oito choices, com rótulo legível (`Nominator`) e valor igual à
chave publicada (`nominator`). Nome de cargo não é traduzido — é termo do
servidor, como o `privLabel` já trata.

`reason` é obrigatório, teto de 200 caracteres.

### Fluxo do `execute`

1. O cargo escolhido determina o privilégio exigido; `resolveStaff`
2. `checkRedisOrError`
3. `deferReply` efêmero
4. Alvo não resolvido: `player_not_found`
5. Alvo igual ao autor: recusa
6. Alvo é staff e autor não é Developer: recusa
7. Estado já é o pedido: recusa
8. Publica, verifica, registra em `admin_actions`, responde com embed — verde
   quando confirmado, âmbar quando não

### As três recusas, uma a uma

**Alvo igual ao autor.** O privilégio exigido já barra a auto-promoção a staff,
mas não barraria um Administrator se dando `whitelisted`, que é bypass de
anticheat. Isso é ganho real, então a trava fica.

**Alvo é staff e autor não é Developer.** Espelha a regra que o bancho aplica no
`restrict`. Sem ela, um Administrator tira o `nominator` de um Moderator.

**Estado já é o pedido.** O pub/sub não devolve resultado. Sem conferir antes, o
comando anunciaria sucesso de uma publicação que o servidor ignorou.

## O motivo não chega ao servidor

O receptor de `addpriv` e `removepriv` lê apenas `id`, `privs` e `userId`. Não
há campo de motivo, e o `post_audit_log` do bancho grava `reason=""` para estas
duas ações.

A consequência é que a assinatura `via KurataniBot: @fulano (id)` — que no
`/moderate` faz o log do próprio servidor guardar as duas pontas da autoria, sem
depender de o bot estar íntegro — não tem por onde ir aqui. O rastro do Discord
fica só no `admin_actions`, dentro do bot.

Isso é uma garantia a menos que o `/moderate` tem, e por isso fica escrita no
código. Não é crítica hoje: o vínculo de staff exige prova de posse da conta
desde o `/staff confirm`, e só Developer concede bits de staff. Fecha de vez com
três linhas no `channel_addpriv_reciever` lendo `data.get("reason")`, o que é
mudança no servidor e fica fora deste trabalho.

## Melhoria acoplada: `/moderate check`

Hoje o check mostra o cargo mais alto (`privLabel`) e o inteiro cru do `priv`.
Quem acabou de conceder `whitelisted` a um jogador comum lê "Player" e um
número, ou seja, o comando não serve para conferir o que este trabalho passa a
produzir.

O `privNames` resolve sem tocar em i18n: o parâmetro já existe na
`mod_check_body` e já sai em negrito, então passa a receber a lista completa em
vez do rótulo único. O `privLabel` continua onde o rótulo único é o certo —
`admin_missing_priv` e `mod_target_is_staff`.

## i18n

Reaproveita `admin_*`, `player_not_found`, `mod_cannot_self`,
`mod_target_is_staff`, `mod_confirmed`, `mod_unconfirmed` e `nom_actor`.

Novas nos três idiomas: `help_cmd_role`, `role_give_title`, `role_take_title`,
`role_body(name, id, role, reason)`, `role_already_has(name, role)` e
`role_missing(name, role)`.

## help

`'role'` entra no `ADMIN_GROUP` do `commands/help.js`. O `test/help.test.js` já
cobra descrição nos três idiomas para todo comando citado.

## Testes — `test/role.test.js`

Modelado no `wipe.test.js`, que faz stub do `redis` antes de carregar o
`daycoreAdmin`.

1. `mod`, `admin` e `developer` exigem DEVELOPER; os outros cinco exigem
   ADMINISTRATOR
2. A chave publicada de MODERATOR é `mod`, e não `moderator` — o erro que o
   pub/sub engoliria calado
3. `supporter`, `premium` e `normal` não estão na tabela
4. `addPrivilege` publica em `addpriv` com `{ id, privs: [chave], userId }`, o
   formato exato que o receptor lê
5. As oito choices do builder batem com as chaves da tabela: nenhum cargo
   oferecido no Discord que a publicação não saiba mandar
6. `verifyPriv` devolve false quando o bit não aparece na releitura
7. `prefix.slashOnly` é `true`

## Entrega

O registro dos slash commands é automático: o `index.js` compara o hash do
payload e só chama a API do Discord quando ele muda. Na VPS, `git pull` e
reiniciar o processo bastam.
