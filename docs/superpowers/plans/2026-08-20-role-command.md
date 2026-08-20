# /role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar e tirar cargos do Daycore (Nominator, Moderator, Administrator, ...) por slash command no Discord.

**Architecture:** o bot publica no Redis, nos canais `addpriv` e `removepriv` que o `bancho.py-ex` já escuta, e confirma o efeito relendo o `priv` do jogador pela API v2 — o mesmo par publicar/verificar que o `/moderate` e o `/wipe` usam. A tabela `ROLES` no `daycoreAdmin.js` é a fonte única de quais cargos existem, qual bit cada um liga e qual privilégio o bot exige de quem concede.

**Tech Stack:** Node 22, discord.js 14, `redis` 6, `node:sqlite`, `node:test`.

Spec: [`docs/superpowers/specs/2026-08-20-role-command-design.md`](../specs/2026-08-20-role-command-design.md)

## Global Constraints

- Comentário e documento em português; código, nome de função e chave de i18n como o repositório já faz.
- Toda chave nova de i18n entra nos TRÊS arquivos (`pt`, `en`, `ru`). O `test/i18n.test.js` compara as chaves entre os idiomas e falha se faltar em um.
- Todo comando registrado precisa estar citado no `/help` com descrição nos três idiomas. O `test/help.test.js` confere nos dois sentidos.
- Chave publicada de MODERATOR é `mod` — o `str_priv_dict` de `app/api/utils.py`, que é quem atende o pub/sub. NÃO é `moderator` (esse é o de `app/commands.py`).
- Cargos fora do escopo, e que não podem entrar na tabela: `supporter`, `premium` (o bancho recusa: `return "use givedonor."`) e `normal` (é o bit UNRESTRICTED; tirá-lo por aqui bane sem passar pelo `Player.restrict()`).
- Commits sem trailer de coautoria.
- Rodar `npm test` e `npm run lint` antes de cada commit.

## File Structure

| arquivo | responsabilidade |
|---|---|
| `src/daycoreAdmin.js` (modificar) | tabela `ROLES`, canais, publicação, verificação, rótulos |
| `src/commands/role.js` (criar) | a superfície `/role give` e `/role take` no Discord |
| `src/i18n/{pt,en,ru}.js` (modificar) | seis chaves novas em cada |
| `src/commands/help.js` (modificar) | `'role'` no `ADMIN_GROUP` |
| `src/commands/moderate.js` (modificar) | o `check` passa a listar todos os cargos |
| `test/role.test.js` (criar) | tabela, formato publicado, choices, verificação |

---

### Task 1: camada de publicação no `daycoreAdmin.js`

**Files:**
- Modify: `src/daycoreAdmin.js` (bloco `CHANNELS` em ~84; `privLabel` em ~362; `verifyRestricted` em ~468; `module.exports` em ~512)
- Test: `test/role.test.js` (criar)

**Interfaces:**
- Consumes: `Privileges`, `hasPriv`, `publish`, `sleep`, `osu.getServerPlayerRaw` — tudo já existe no arquivo.
- Produces:
  - `ROLES: Record<string, { bit: number, requires: number }>` — chaves `verified`, `whitelisted`, `alumni`, `tournament`, `nominator`, `mod`, `admin`, `developer`
  - `labelOfBit(bit: number): string`
  - `privNames(priv: number): string[]`
  - `addPrivilege(targetOsuId: number, roleKey: string, actor: { osuId: number }): Promise<void>`
  - `removePrivilege(targetOsuId: number, roleKey: string, actor: { osuId: number }): Promise<void>`
  - `verifyPriv(osuId: number, bit: number, expectPresent: boolean, opts?: { attempts?: number, delayMs?: number }): Promise<boolean>`

- [ ] **Step 1: escrever o teste que falha**

Criar `test/role.test.js`. O stub do `redis` precisa vir ANTES do `require` do `daycoreAdmin`, que desestrutura o `createClient` na carga — é o mesmo arranjo do `test/wipe.test.js`.

```js
/**
 * /role — dá e tira cargo do Daycore.
 *
 * O `addpriv`/`removepriv` do bancho (app/api/utils.py) só checa se o alvo
 * existe e se o cargo não é DONATOR. Ele NÃO olha quem publicou — ao contrário
 * do `restrict`, que recusa sozinho um não-Developer mexendo em staff. Como no
 * /wipe, o que o bot decidir é o que acontece, e o que estes casos travam é a
 * tranca inteira.
 */
const test = require('node:test');
const assert = require('node:assert');

// Stub do redis antes de carregar o daycoreAdmin, que desestrutura o
// createClient no require.
process.env.REDIS_HOST = '127.0.0.1';
const published = [];
const redis = require('redis');
redis.createClient = () => ({
  isOpen: true,
  on() {},
  async connect() {},
  async publish(channel, payload) { published.push([channel, JSON.parse(payload)]); },
});

const daycore = require('../src/daycoreAdmin');

const ACTOR = { osuId: 3, discordId: '100000000000000002', discordName: 'staff-dois' };

test('conceder bit de staff exige DEVELOPER', () => {
  // Conceder `developer` dá controle total do servidor. Se ADMINISTRATOR
  // bastasse, um administrador obteria por procuração o que o bancho não lhe dá.
  for (const chave of ['mod', 'admin', 'developer']) {
    assert.equal(daycore.ROLES[chave].requires, daycore.Privileges.DEVELOPER, chave);
  }
});

test('os cargos sem poder sobre contas param em ADMINISTRATOR', () => {
  // Travá-los em DEVELOPER faria o dono virar gargalo para dar nominator a um
  // mapper novo, que é tarefa de rotina.
  for (const chave of ['verified', 'whitelisted', 'alumni', 'tournament', 'nominator']) {
    assert.equal(daycore.ROLES[chave].requires, daycore.Privileges.ADMINISTRATOR, chave);
  }
});

test('a chave de MODERATOR é "mod", e não "moderator"', () => {
  // O bancho.py-ex tem dois str_priv_dict e eles divergem. Quem atende o
  // pub/sub é o de app/api/utils.py, onde MODERATOR é "mod". Publicar
  // "moderator" devolve `Invalid privilege` no console do bancho — e pub/sub
  // não responde a quem publica, então o sintoma aqui seria um "não
  // confirmado" seco.
  assert.equal(daycore.ROLES.mod.bit, daycore.Privileges.MODERATOR);
  assert.equal(daycore.ROLES.moderator, undefined);
});

test('supporter, premium e normal ficam de fora da tabela', () => {
  // Os dois primeiros o bancho recusa (`return "use givedonor."`). O terceiro é
  // o bit UNRESTRICTED: tirá-lo por aqui bane sem passar pelo
  // Player.restrict(), ou seja, sem registro de restrição e sem sair das
  // leaderboards.
  for (const chave of ['supporter', 'premium', 'normal']) {
    assert.equal(daycore.ROLES[chave], undefined, chave);
  }
});

test('addPrivilege publica o formato exato que o receptor lê', async () => {
  published.length = 0;
  await daycore.addPrivilege(1234, 'nominator', ACTOR);

  assert.deepEqual(published, [['addpriv', { id: 1234, privs: ['nominator'], userId: 3 }]]);
});

test('removePrivilege publica no canal removepriv', async () => {
  published.length = 0;
  await daycore.removePrivilege(1234, 'nominator', ACTOR);

  assert.deepEqual(published, [['removepriv', { id: 1234, privs: ['nominator'], userId: 3 }]]);
});

test('cargo fora da tabela não chega a ser publicado', async () => {
  // O bancho responderia `Invalid privilege` para o console dele, e não para
  // cá. Recusar antes de publicar é o que transforma isso em erro visível.
  published.length = 0;
  await assert.rejects(() => daycore.addPrivilege(1234, 'moderator', ACTOR), /moderator/);
  assert.equal(published.length, 0);
});

test('privNames lista todos os cargos; o privLabel continua só com o topo', () => {
  const priv = daycore.Privileges.UNRESTRICTED
    | daycore.Privileges.NOMINATOR
    | daycore.Privileges.WHITELISTED;

  assert.equal(daycore.privLabel(priv), 'Nominator');
  assert.deepEqual(daycore.privNames(priv), ['Nominator', 'Whitelisted']);
});

test('privNames devolve Player quando não há cargo nenhum', () => {
  assert.deepEqual(daycore.privNames(daycore.Privileges.UNRESTRICTED), ['Player']);
});

test('verifyPriv confirma pela releitura, e desiste quando o bit não aparece', async () => {
  const osuClient = require('../src/osuClient');
  const original = osuClient.getServerPlayerRaw;
  try {
    osuClient.getServerPlayerRaw = async () => ({
      id: 1234,
      name: 'alvo',
      priv: daycore.Privileges.UNRESTRICTED | daycore.Privileges.NOMINATOR,
    });

    const rapido = { attempts: 2, delayMs: 1 };
    assert.equal(await daycore.verifyPriv(1234, daycore.Privileges.NOMINATOR, true,  rapido), true);
    assert.equal(await daycore.verifyPriv(1234, daycore.Privileges.MODERATOR, true,  rapido), false);
    assert.equal(await daycore.verifyPriv(1234, daycore.Privileges.MODERATOR, false, rapido), true);
  } finally {
    osuClient.getServerPlayerRaw = original;
  }
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `node --test test/role.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'requires')`, porque `daycore.ROLES` não existe.

- [ ] **Step 3: acrescentar os dois canais**

Em `src/daycoreAdmin.js`, no objeto `CHANNELS`:

```js
const CHANNELS = {
  RANK:       'rank',
  RESTRICT:   'restrict',
  UNRESTRICT: 'unrestrict',
  WIPE:       'wipe',
  ADDPRIV:    'addpriv',
  REMOVEPRIV: 'removepriv',
};
```

- [ ] **Step 4: acrescentar `PRIV_LABELS`, `labelOfBit` e `privNames`**

Logo depois do `privLabel` (~362):

```js
/**
 * Rótulo de exibição de cada bit, do mais alto para o mais baixo.
 *
 * Fonte única do nome: é daqui que sai tanto o texto do `/moderate check`
 * quanto o rótulo das choices do `/role`. Dois lugares com o nome do mesmo bit
 * divergiriam no primeiro que alguém renomeasse.
 *
 * UNRESTRICTED fica de fora de propósito: ele não é cargo, é estado de
 * restrição, e o `/moderate check` já o mostra em campo próprio. Listá-lo aqui
 * faria todo jogador comum aparecer com um "cargo" chamado Unrestricted.
 */
const PRIV_LABELS = [
  [Privileges.DEVELOPER,       'Developer'],
  [Privileges.ADMINISTRATOR,   'Administrator'],
  [Privileges.MODERATOR,       'Moderator'],
  [Privileges.NOMINATOR,       'Nominator'],
  [Privileges.TOURNEY_MANAGER, 'Tourney Manager'],
  [Privileges.ALUMNI,          'Alumni'],
  [Privileges.PREMIUM,         'Premium'],
  [Privileges.SUPPORTER,       'Supporter'],
  [Privileges.WHITELISTED,     'Whitelisted'],
  [Privileges.VERIFIED,        'Verified'],
];

/** O nome de exibição de um bit isolado. */
function labelOfBit(bit) {
  return PRIV_LABELS.find(([b]) => b === bit)?.[1] ?? String(bit);
}

/**
 * TODOS os cargos ligados, do mais alto para o mais baixo.
 *
 * O `privLabel` devolve só o topo, e para conferir uma concessão isso não
 * serve: quem acabou de receber `whitelisted` sem ter mais nada aparecia no
 * `/moderate check` como "Player", ou seja, o comando não mostrava o que tinha
 * acabado de mudar.
 */
function privNames(priv) {
  const nomes = PRIV_LABELS.filter(([bit]) => hasPriv(priv, bit)).map(([, label]) => label);
  return nomes.length > 0 ? nomes : ['Player'];
}
```

- [ ] **Step 5: acrescentar a tabela `ROLES`**

Logo depois de `privNames`:

```js
/**
 * Os cargos que o /role distribui: o bit que cada chave liga, e o privilégio
 * que o BOT exige de quem concede.
 *
 * ── A chave sai do str_priv_dict de app/api/utils.py, e isso importa ─────────
 * O bancho.py-ex tem DOIS dicionários com esse nome, e eles divergem: o de
 * app/commands.py chama MODERATOR de "moderator", o de app/api/utils.py chama
 * de "mod". Quem atende o pub/sub é o segundo — os receptores de `addpriv` e
 * `removepriv` importam dali. Publicar "moderator" devolve
 * `Invalid privilege: moderator`, e devolve para o console do bancho: pub/sub
 * não responde a quem publica, então daqui o sintoma seria um "não confirmado"
 * seco, sem pista do motivo.
 *
 * ── Por que o privilégio exigido não é o mesmo para todos ─────────────────────
 * Conceder `developer` dá controle total do servidor. Se ADMINISTRATOR
 * bastasse, um administrador obteria por procuração exatamente o que o bancho
 * não lhe dá — então os três bits de staff exigem DEVELOPER. Os outros cinco
 * param em ADMINISTRATOR porque nenhum deles concede poder sobre outras contas,
 * e travá-los no privilégio mais alto faria o dono virar gargalo para dar
 * nominator a um mapper novo.
 *
 * ── O que NÃO está aqui ───────────────────────────────────────────────────────
 *   supporter, premium — o addpriv recusa os dois (`return "use givedonor."`),
 *     porque o caminho deles é o canal `givedonator`, que leva duração e não
 *     tem contrapartida para remover.
 *   normal — é o bit UNRESTRICTED. Tirá-lo por aqui bane sem passar pelo
 *     Player.restrict(): sem registro de restrição, sem sair das leaderboards,
 *     e o alvo continua aparecendo limpo no /moderate check. Quem bane é o
 *     /moderate restrict.
 */
const ROLES = {
  verified:    { bit: Privileges.VERIFIED,        requires: Privileges.ADMINISTRATOR },
  whitelisted: { bit: Privileges.WHITELISTED,     requires: Privileges.ADMINISTRATOR },
  alumni:      { bit: Privileges.ALUMNI,          requires: Privileges.ADMINISTRATOR },
  tournament:  { bit: Privileges.TOURNEY_MANAGER, requires: Privileges.ADMINISTRATOR },
  nominator:   { bit: Privileges.NOMINATOR,       requires: Privileges.ADMINISTRATOR },
  mod:         { bit: Privileges.MODERATOR,       requires: Privileges.DEVELOPER },
  admin:       { bit: Privileges.ADMINISTRATOR,   requires: Privileges.DEVELOPER },
  developer:   { bit: Privileges.DEVELOPER,       requires: Privileges.DEVELOPER },
};
```

- [ ] **Step 6: acrescentar a publicação**

Depois de `wipePlayer` (~340), antes da seção de permissões:

```js
/**
 * Concede ou tira um cargo.
 *
 * ── O motivo não vai junto, e isso é uma garantia a menos ─────────────────────
 * O receptor lê só `id`, `privs` e `userId` (app/api/start.py,
 * channel_addpriv_reciever), e o post_audit_log do bancho grava `reason=""`
 * para estas duas ações. Não existe onde pendurar a assinatura que o restrict
 * usa para fazer o log do SERVIDOR guardar também a conta do Discord (ver
 * signReason). Aqui o rastro do Discord fica só no `admin_actions` — dentro do
 * bot, que é justamente o componente que a assinatura existe para não precisar
 * supor íntegro.
 *
 * Não é crítico hoje: o vínculo de staff exige prova de posse da conta desde o
 * /staff confirm, e só DEVELOPER concede bit de staff. Fecha de vez com três
 * linhas no channel_addpriv_reciever lendo `data.get("reason")`, que é mudança
 * no servidor.
 *
 * @param {{osuId: number}} actor quem concede; o bancho grava como `admin`
 */
function publishPriv(channel, targetOsuId, roleKey, actor) {
  // Recusa aqui, e não só no comando: um chamador com chave inventada receberia
  // do bancho um `Invalid privilege` que nunca volta para cá.
  if (!Object.hasOwn(ROLES, roleKey)) {
    throw new Error(`cargo desconhecido: "${roleKey}"`);
  }
  return publish(channel, {
    id:     Number(targetOsuId),
    privs:  [roleKey],
    userId: Number(actor.osuId),
  });
}

async function addPrivilege(targetOsuId, roleKey, actor) {
  await publishPriv(CHANNELS.ADDPRIV, targetOsuId, roleKey, actor);
}

async function removePrivilege(targetOsuId, roleKey, actor) {
  await publishPriv(CHANNELS.REMOVEPRIV, targetOsuId, roleKey, actor);
}
```

- [ ] **Step 7: acrescentar a verificação**

Depois de `verifyRestricted` (~487):

```js
/**
 * Confirma que o bit ficou (ou deixou de estar) ligado.
 *
 * Janela fixa, como a do verifyRestricted e ao contrário da de mapa: o alvo é
 * sempre um só, e o `add_privs` do bancho é um UPDATE na tabela `users` — não
 * há download pelo meio para fazer o tempo depender do tamanho de nada.
 */
async function verifyPriv(osuId, bit, expectPresent, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const player = await osu.getServerPlayerRaw(osuId);
      if (player && hasPriv(player.priv, bit) === expectPresent) return true;
    } catch {
      // tenta de novo
    }
  }
  return false;
}
```

- [ ] **Step 8: exportar**

No `module.exports`, junto dos vizinhos temáticos:

```js
  ROLES,
  addPrivilege,
  removePrivilege,
  verifyPriv,
  labelOfBit,
  privNames,
```

- [ ] **Step 9: rodar o teste**

Run: `node --test test/role.test.js`
Expected: PASS em todos os casos deste arquivo. (O caso "as choices do comando batem com a tabela" ainda não existe — ele entra na Task 2.)

- [ ] **Step 10: rodar a suíte inteira e o lint**

Run: `npm test`
Expected: PASS

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 11: commit**

```bash
git add src/daycoreAdmin.js test/role.test.js
```

```bash
git commit -m "feat: daycoreAdmin sabe publicar addpriv e removepriv"
```

---

### Task 2: o comando `/role`

**Files:**
- Create: `src/commands/role.js`
- Modify: `src/i18n/pt.js`, `src/i18n/en.js`, `src/i18n/ru.js`
- Modify: `src/commands/help.js:33`
- Test: `test/role.test.js` (acrescentar dois casos)

**Interfaces:**
- Consumes: `daycore.ROLES`, `daycore.labelOfBit`, `daycore.addPrivilege`, `daycore.removePrivilege`, `daycore.verifyPriv` (Task 1); `resolveStaff(interaction, requiredPriv, s)` e `checkRedisOrError(s)` de `src/staffGuard.js`; `db.logAdminAction({ action, target, detail, actorDiscordId, actorOsuId, actorOsuName })`; `exigirSubcomando(command, interaction)` de `src/subcommands.js`.
- Produces: `module.exports.data` (SlashCommandBuilder chamado `role`), `module.exports.execute`, `module.exports.prefix = { slashOnly: true }`.

- [ ] **Step 1: escrever os casos que falham**

No topo de `test/role.test.js`, logo depois do `require` do `daycoreAdmin`, acrescentar:

```js
const role = require('../src/commands/role');
```

E ao fim do arquivo:

```js
test('as choices do comando batem com a tabela', () => {
  // Cargo oferecido no Discord que o publish não sabe mandar viraria um
  // `Invalid privilege` silencioso; cargo na tabela que o Discord não oferece é
  // função morta.
  const json  = role.data.toJSON();
  const give  = json.options.find(o => o.name === 'give');
  const opcao = give.options.find(o => o.name === 'role');

  assert.deepEqual(
    opcao.choices.map(c => c.value).sort(),
    Object.keys(daycore.ROLES).sort(),
  );
  assert.equal(opcao.required, true);
});

test('fica fora do modo texto', () => {
  // A resposta expõe o privilégio de terceiro; em texto a flag de efêmero some
  // e isso vira mensagem no canal (ver prefix/spec.js).
  assert.equal(role.prefix?.slashOnly, true);
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `node --test test/role.test.js`
Expected: FAIL — `Cannot find module '../src/commands/role'`

- [ ] **Step 3: criar `src/commands/role.js`**

```js
/**
 * /role — dá e tira cargo do Daycore (Nominator, Moderator, Administrator, ...).
 *
 * ── O servidor não filtra nada aqui ───────────────────────────────────────────
 * O `addpriv`/`removepriv` do bancho (app/api/utils.py) só checa se o alvo
 * existe e se o cargo pedido não é DONATOR. Ele NÃO olha quem publicou — ao
 * contrário do `restrict`, que recusa sozinho um não-Developer mexendo em
 * staff. É a mesma situação do /wipe: o que este arquivo decidir é o que
 * acontece.
 *
 * ── Por que o privilégio exigido varia por cargo ──────────────────────────────
 * Está na tabela ROLES do daycoreAdmin, junto do porquê. Em resumo: conceder
 * `mod`, `admin` ou `developer` é conceder poder sobre outras contas, e exige
 * DEVELOPER; os outros cinco param em ADMINISTRATOR para dar cargo a um mapper
 * novo não depender de o dono estar por perto.
 *
 * ── O motivo não chega ao servidor ────────────────────────────────────────────
 * Estes dois canais não têm campo de motivo, então o `reason` daqui vive só no
 * `admin_actions` do bot. O comentário de `addPrivilege` explica o que isso
 * custa e como fechar.
 */

const {
  SlashCommandBuilder, EmbedBuilder, ApplicationIntegrationType,
  InteractionContextType, MessageFlags,
} = require('discord.js');

const osu = require('../osuClient');
const daycore = require('../daycoreAdmin');
const { resolveStaff, checkRedisOrError } = require('../staffGuard');
const db = require('../db');
const { t } = require('../i18n');
const { exigirSubcomando } = require('../subcommands');
const { logError } = require('../logger');

// Mesmo teto do /moderate e do /wipe. Aqui o texto não vai para o log do
// servidor, mas vai para o embed e para o admin_actions.
const REASON_MAX_LENGTH = 200;

/** As choices saem da tabela, como o /wipe faz com os GameModes. */
const ROLE_CHOICES = Object.entries(daycore.ROLES)
  .map(([value, { bit }]) => ({ name: daycore.labelOfBit(bit), value }));

/** Os dois subcomandos pedem exatamente as mesmas três opções. */
function opcoes(sub, descricao, descricaoPt) {
  return sub
    .setDescription(descricao)
    .setDescriptionLocalizations({ 'pt-BR': descricaoPt })
    .addStringOption(o => o.setName('player')
      .setDescription('Player name or ID')
      .setDescriptionLocalizations({ 'pt-BR': 'Nome ou ID do jogador' })
      .setRequired(true)
      .setMaxLength(32))
    .addStringOption(o => o.setName('role')
      .setDescription('Which role')
      .setDescriptionLocalizations({ 'pt-BR': 'Qual cargo' })
      .setRequired(true)
      .addChoices(...ROLE_CHOICES))
    .addStringOption(o => o.setName('reason')
      .setDescription('Reason (recorded by the bot)')
      .setDescriptionLocalizations({ 'pt-BR': 'Motivo (registrado pelo bot)' })
      .setRequired(true)
      .setMaxLength(REASON_MAX_LENGTH));
}

module.exports = {
  // Como o /moderate e o /staff: a resposta traz privilégio de terceiro, e em
  // texto a flag de efêmero some — ver o comentário em prefix/spec.js.
  prefix: { slashOnly: true },

  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Grant and remove Daycore server roles (staff only)')
    .setDescriptionLocalizations({ 'pt-BR': 'Dá e tira cargos do Daycore (apenas staff)' })
    .setIntegrationTypes([ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild])
    .addSubcommand(sub => opcoes(sub.setName('give'), 'Grant a role', 'Concede um cargo'))
    .addSubcommand(sub => opcoes(sub.setName('take'), 'Remove a role', 'Remove um cargo')),

  async execute(interaction) {
    const s   = t(interaction);
    // Lança se o subcomando não estiver declarado no builder — ver
    // subcommands.js.
    const sub = exigirSubcomando(module.exports, interaction);

    // A guarda do caso inverso: subcomando DECLARADO e sem ramo aqui. Sem ela,
    // um `addSubcommand` novo cairia no ramo do `take` e tiraria cargo de
    // alguém sozinho.
    if (sub !== 'give' && sub !== 'take') {
      throw new Error(`/role: subcomando declarado mas sem tratamento: "${sub}"`);
    }

    const roleKey = interaction.options.getString('role');
    const role    = daycore.ROLES[roleKey];
    // O Discord só envia choice declarada, e o modo texto nem chega aqui
    // (slashOnly). Sobra o chamador que não é nenhum dos dois.
    if (!role) throw new Error(`/role: cargo fora da tabela: "${roleKey}"`);

    // O cargo escolhido é que decide o privilégio exigido — ver ROLES.
    const staff = await resolveStaff(interaction, role.requires, s);
    if (staff.error) {
      return interaction.reply({ content: staff.error, flags: MessageFlags.Ephemeral });
    }

    const redisError = await checkRedisOrError(s);
    if (redisError) {
      return interaction.reply({ content: redisError, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const reason   = interaction.options.getString('reason');
      const roleName = daycore.labelOfBit(role.bit);

      const targetId = await osu.resolvePlayerId(String(interaction.options.getString('player')).trim());
      if (!targetId) return interaction.editReply(s.player_not_found);

      const target = await daycore.getPlayerPrivileges(targetId);
      if (!target) return interaction.editReply(s.player_not_found);

      // O privilégio exigido já barra a auto-promoção a staff, mas não barraria
      // um Administrator se dando `whitelisted` — que é bypass de anticheat.
      // Isso é ganho real, então a trava do /moderate vale aqui também.
      if (target.id === staff.osuId) return interaction.editReply(s.mod_cannot_self);

      // Espelha a regra que o bancho aplica no restrict e que ele NÃO aplica
      // aqui. Sem ela, um Administrator tira o `nominator` de um Moderator.
      if (daycore.isStaff(target.priv) && !daycore.hasPriv(staff.priv, daycore.Privileges.DEVELOPER)) {
        return interaction.editReply(
          s.mod_target_is_staff(target.name, daycore.privLabel(target.priv)),
        );
      }

      // Pub/sub não devolve resultado: sem conferir antes, o comando anunciaria
      // sucesso de uma publicação que não muda nada.
      const jaTem = daycore.hasPriv(target.priv, role.bit);
      if (sub === 'give' && jaTem)  return interaction.editReply(s.role_already_has(target.name, roleName));
      if (sub === 'take' && !jaTem) return interaction.editReply(s.role_missing(target.name, roleName));

      const actor = {
        osuId:       staff.osuId,
        discordId:   interaction.user.id,
        discordName: interaction.user.username,
      };

      if (sub === 'give') {
        await daycore.addPrivilege(target.id, roleKey, actor);
      } else {
        await daycore.removePrivilege(target.id, roleKey, actor);
      }

      const confirmado = await daycore.verifyPriv(target.id, role.bit, sub === 'give');

      // O único lugar onde a conta do Discord fica amarrada a esta ação: o log
      // do servidor não tem campo de motivo nestes dois canais.
      db.logAdminAction({
        action: sub === 'give' ? 'addpriv' : 'removepriv',
        target: target.id,
        detail: `${target.name} | ${roleKey} | ${reason} | ${confirmado ? 'confirmado' : 'NAO confirmado'}`,
        actorDiscordId: interaction.user.id,
        actorOsuId: staff.osuId,
        actorOsuName: staff.osuName,
      });

      const embed = new EmbedBuilder()
        .setColor(confirmado ? 0x99ff99 : 0xffcc66)
        .setTitle(sub === 'give' ? s.role_give_title(roleName) : s.role_take_title(roleName))
        .setDescription(
          s.role_body(target.name, target.id, roleName, reason) + '\n\n' +
          (confirmado ? s.mod_confirmed : s.mod_unconfirmed),
        )
        .setFooter({ text: s.nom_actor(staff.osuName) });
      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logError('role', error);
      return interaction.editReply(s.admin_action_failed);
    }
  },
};
```

- [ ] **Step 4: acrescentar as chaves em `src/i18n/pt.js`**

Depois de `mod_target_is_staff` (~297):

```js
  role_give_title:         (role) => `Cargo concedido: ${role}`,
  role_take_title:         (role) => `Cargo removido: ${role}`,
  role_body:               (name, id, role, reason) =>
    `**${name}** (\`${id}\`)\nCargo: **${role}**\nMotivo: ${reason}`,
  role_already_has:        (name, role) => `❌ **${name}** já tem **${role}**.`,
  role_missing:            (name, role) => `❌ **${name}** não tem **${role}**.`,
```

E junto dos outros `help_cmd_`, depois da linha 69:

```js
  help_cmd_role:           'Dá e tira cargos do servidor.',
```

- [ ] **Step 5: acrescentar as mesmas chaves em `src/i18n/en.js`**

Depois de `mod_target_is_staff` (~281):

```js
  role_give_title:         (role) => `Role granted: ${role}`,
  role_take_title:         (role) => `Role removed: ${role}`,
  role_body:               (name, id, role, reason) =>
    `**${name}** (\`${id}\`)\nRole: **${role}**\nReason: ${reason}`,
  role_already_has:        (name, role) => `❌ **${name}** already has **${role}**.`,
  role_missing:            (name, role) => `❌ **${name}** does not have **${role}**.`,
```

E depois da linha 65:

```js
  help_cmd_role:           'Grant and remove server roles.',
```

- [ ] **Step 6: acrescentar as mesmas chaves em `src/i18n/ru.js`**

Depois de `mod_target_is_staff` (~281):

```js
  role_give_title:         (role) => `Роль выдана: ${role}`,
  role_take_title:         (role) => `Роль снята: ${role}`,
  role_body:               (name, id, role, reason) =>
    `**${name}** (\`${id}\`)\nРоль: **${role}**\nПричина: ${reason}`,
  role_already_has:        (name, role) => `❌ У **${name}** уже есть **${role}**.`,
  role_missing:            (name, role) => `❌ У **${name}** нет **${role}**.`,
```

E depois da linha 65:

```js
  help_cmd_role:           'Выдача и снятие ролей сервера.',
```

- [ ] **Step 7: citar o comando no `/help`**

Em `src/commands/help.js:33`:

```js
const ADMIN_GROUP = { key: 'admin', commands: ['nominate', 'moderate', 'role', 'wipe', 'staff'] };
```

- [ ] **Step 8: rodar os testes**

Run: `node --test test/role.test.js`
Expected: PASS

Run: `npm test`
Expected: PASS — em especial `test/help.test.js` (que exige o comando citado e descrito nos três idiomas) e `test/i18n.test.js` (que exige paridade de chaves).

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 9: conferir o payload dos slash commands**

Run: `npm run smoke:commands`
Expected: sem erro; o `/role` aparece com os dois subcomandos.

- [ ] **Step 10: commit**

```bash
git add src/commands/role.js src/commands/help.js src/i18n/pt.js src/i18n/en.js src/i18n/ru.js test/role.test.js
```

```bash
git commit -m "feat: /role da e tira cargo do Daycore pelo Discord"
```

---

### Task 3: o `/moderate check` passa a listar todos os cargos

**Files:**
- Modify: `src/commands/moderate.js:141`
- Test: `test/role.test.js` (um caso a mais)

**Interfaces:**
- Consumes: `daycore.privNames(priv)` (Task 1).
- Produces: nada novo.

- [ ] **Step 1: escrever o caso que falha**

Acrescentar ao fim de `test/role.test.js`:

```js
test('o /moderate check lista todos os cargos, não só o topo', () => {
  // Quem acabou de receber `whitelisted` sem ter mais nada aparecia como
  // "Player": o comando que serve para conferir a concessão não mostrava a
  // concessão.
  const fonte = require('fs').readFileSync(require.resolve('../src/commands/moderate'), 'utf8');
  assert.match(fonte, /privNames\(target\.priv\)/);
});
```

- [ ] **Step 2: rodar e ver falhar**

Run: `node --test test/role.test.js`
Expected: FAIL — a fonte do `moderate.js` ainda chama `privLabel` ali.

- [ ] **Step 3: trocar a chamada**

Em `src/commands/moderate.js`, dentro do ramo `sub === 'check'`, trocar a linha 141:

```js
              daycore.privLabel(target.priv),
```

por:

```js
              // Todos os cargos, e não só o topo: sem isso quem acabou de
              // receber `whitelisted` aparece aqui como "Player", e o comando
              // que serve para conferir a concessão não a mostra. O
              // `mod_target_is_staff` logo abaixo continua no privLabel — ali o
              // que a frase precisa é do rótulo único.
              daycore.privNames(target.priv).join(', '),
```

- [ ] **Step 4: rodar os testes**

Run: `npm test`
Expected: PASS

Run: `npm run lint`
Expected: sem erro

- [ ] **Step 5: commit**

```bash
git add src/commands/moderate.js test/role.test.js
```

```bash
git commit -m "fix: o /moderate check mostrava so o cargo mais alto"
```

---

## Entrega

- [ ] `git push`
- [ ] Na VPS: `ssh kuratani-vps`, `cd ~/KurataniBot`, `git pull`, reiniciar o processo do bot.
- [ ] O registro dos slash commands é automático: o `index.js` compara o hash do payload com o `commands_hash` guardado no `bot.db` e só chama a API do Discord quando ele muda. Não precisa rodar `npm run deploy`.
- [ ] Teste manual no Discord do Daycore, com uma conta de teste: `/role give` de `nominator`, `/moderate check` para ver o cargo aparecer na lista, `/role take` do mesmo cargo, `/moderate log` para ver as duas linhas.
