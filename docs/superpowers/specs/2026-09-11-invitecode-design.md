# `/invitecode` — spec

Data: 11/09/2026

## Contexto

O Daycore (fork do osu-NoLimits) passou a exigir código de convite para
registro. O código é gerado e validado inteiramente pelo **Shiina** (site
Java), não pelo bancho.py-ex. Achados, lidos direto do código-fonte real no
VPS (`ssh kuratani-vps`, `/home/onl-docker/shiina/src/main/java/dev/osunolimits/`)
— nem o patch local nem `shiina-extra/` do repo `daycore` continham esses
arquivos, então nenhuma suposição foi feita sobre o formato:

- **Geração** (`routes/ap/post/CreateInvite.java`): `SecureRandom`, alfabeto
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (33 caracteres — sem `I/O/0/1`), 10
  caracteres, sem retry em colisão. `INSERT INTO invite_codes (code,
  created_by, max_uses, expires_at, note, creation_time) VALUES (...)`.
  Exige `PermissionHelper.hasPrivileges(user.priv, ADMINISTRATOR)` na sessão
  do site (`ADMINISTRATOR = 1 << 13`).
- **Schema** (`SHOW CREATE TABLE invite_codes` no MySQL `bancho`):
  `id INT PK AUTO_INCREMENT, code VARCHAR(32) UNIQUE, created_by INT NOT
  NULL FK→users.id, max_uses INT DEFAULT 1, uses INT DEFAULT 0, expires_at
  BIGINT NULL, note VARCHAR(255) NULL, revoked TINYINT DEFAULT 0,
  creation_time BIGINT NOT NULL`.
- **Consumo** (`register.java`): rejeita se `revoked=1`, se `uses >=
  max_uses`, ou se `expires_at` não nulo e no passado. Sucesso faz `uses =
  uses + 1` — multi-uso até o teto, não é uso único por padrão.
- **Sem rota HTTP nem canal Redis para criar convite** — diferente de
  restrict/wipe/addpriv (que passam pelo pub/sub do bancho.py-ex), a escrita
  é só `INSERT` via JDBC. `RevokeInvite.java` faz `UPDATE revoked = 1`;
  fora de escopo aqui (ver "Fora de escopo").

## Decisão de integração

**INSERT direto na mesma tabela `invite_codes`**, replicando exatamente o
algoritmo e o schema do `CreateInvite.java` — não uma rota HTTP nova, e não
um sistema paralelo.

Por quê, na ordem de prioridade pedida:

1. **Compatibilidade** — o efeito é idêntico ao clique no painel: mesma
   tabela, mesmas colunas, mesmo alfabeto/tamanho de código.
2. **Segurança** — usuário MySQL novo, dedicado, com `GRANT INSERT, SELECT
   ON bancho.invite_codes` apenas (não as credenciais amplas do Shiina).
3. **Consistência** — nenhum formato de código novo; o `register.java` do
   site não muda, então o código gerado pelo bot é indistinguível de um
   gerado pelo painel.
4. **Sem duplicar lógica em outro serviço** — não há HTTP/Redis para
   convites reutilizar; a única lógica que existe é o `INSERT`, e é essa que
   se replica.
5. **Integridade do banco** — a constraint `UNIQUE(code)` já existe; o bot
   adiciona só uma tentativa extra em colisão (o `CreateInvite.java` original
   não tem, mas colisão em 33^10 é praticamente impossível — a robustez extra
   não muda o formato nem o comportamento observável).
6. **Manutenção** — nenhuma mudança no repositório do amigo. Se ele alterar
   o algoritmo depois, só este módulo do bot precisa atualizar.
7. **Arquitetura existente** — reaproveita o padrão já usado por
   `/scorewipe`, `/role`, `/moderate`: `resolveStaff` para identidade e
   privilégio, `registrarAcao` para auditoria, `t(interaction)` para i18n.

## Permissão

`resolveStaff(interaction, daycore.Privileges.ADMINISTRATOR, s)` — o mesmo
mecanismo dos outros comandos administrativos (vínculo Discord→conta osu
verificado em `/staff confirm`, privilégio lido do Daycore a cada chamada,
falha fechado). O bit exigido (`ADMINISTRATOR`) é o mesmo que
`PermissionHelper.java` do Shiina exige no formulário do site — não um
valor inventado.

## Implementação

- **`src/daycoreInvites.js`** (novo): pool `mysql2/promise` lazy — mesmo
  padrão de configuração opcional do Redis em `daycoreAdmin.js` (falha
  fechada e clara se `DAYCORE_MYSQL_HOST` não estiver definido, sem derrubar
  o boot do bot). Exporta `createInviteCode({ maxUses, expiresDays, note,
  createdByOsuId })`, que gera o código (mesmo alfabeto/tamanho) e faz o
  `INSERT`, com até 3 tentativas só em erro de chave duplicada
  (`ER_DUP_ENTRY`).
- **`src/commands/invitecode.js`** (novo): opções `max_uses` (inteiro,
  padrão 1, mínimo 1), `expires_days` (inteiro, opcional), `note` (string,
  opcional, até 255 caracteres — mesmo teto da coluna). Resposta efêmera com
  o código em bloco de código monoespaçado, para copiar e colar direto na
  DM ao jogador. Audita via `registrarAcao('invitecode', ...)`.
- **`.env.example`**: `DAYCORE_MYSQL_HOST`, `DAYCORE_MYSQL_PORT` (padrão
  3306), `DAYCORE_MYSQL_USER`, `DAYCORE_MYSQL_PASS`, `DAYCORE_MYSQL_DATABASE`
  (padrão `bancho`) — documentado como opcional, mesmo padrão do bloco Redis:
  vazio desliga o comando sem derrubar o bot.
- **SQL de setup** (documentado no `.env.example` e no README do comando,
  não executado por mim): `CREATE USER` + `GRANT INSERT, SELECT ON
  bancho.invite_codes TO ...` — roda no VPS, por você ou pelo dono do
  Daycore.
- **i18n**: chaves novas `invitecode_*` em `pt.js`/`en.js`/`ru.js` (o teste
  `i18n.test.js` já barra chave faltando num idioma).
- **`package.json`**: dependência nova `mysql2`.
- **Teste**: `test/invitecode.test.js`, seguindo o padrão de
  `test/role.test.js` (stub do `mysql2` antes do `require`, sem tocar em
  banco de verdade).

## Fora de escopo

- `/invitecode revoke` e listagem — o painel (`/ap/invites`) já cobre os
  dois; sem pedido para replicar aqui.
- Qualquer mudança no repositório `daycore` ou no código do Shiina/bancho no
  VPS — a integração é só leitura de schema/algoritmo real, nenhuma escrita
  de código no servidor do amigo.

## Incerteza registrada

Nenhuma suposição ficou de pé: os quatro arquivos-fonte do sistema de
convite (`Invites.java`, `CreateInvite.java`, `RevokeInvite.java`,
`InviteCode.java`) e o schema da tabela foram lidos direto do VPS por SSH,
porque não estavam capturados no repositório `daycore` local (gap que
também afeta outros arquivos novos do Shiina — achado incidental, fora do
escopo deste trabalho).
