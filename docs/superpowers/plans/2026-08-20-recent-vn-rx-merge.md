# Unificar VN e RX no /recent e /rs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/recent` e `/rs` mostram, por padrão, a última play do jogador em servidor privado com par VN/RX — combinando as duas listas — mantendo uma opção pra filtrar só um dos dois modos.

**Architecture:** Toda a lógica de decisão (qual par de chaves buscar, como juntar e cortar as duas listas, e como tolerar uma das duas falhando) fica isolada num módulo novo e puro, `src/recentMerge.js`, testável sem rede nem mock de Discord. `src/commands/recent.js` fica fino: lê a opção nova, chama o módulo, e troca os pontos onde hoje usa um `mode` só de comando por `_mode` por play.

**Tech Stack:** Node.js, `node --test` (runner nativo), discord.js v14.

## Global Constraints

- Só `/recent` e `/rs` mudam de comportamento. `/score`, `/topplays`,
  `/leaderboard`, `/link` continuam exatamente como estão hoje.
- `server:` continua com o significado de hoje em todo comando, incluindo
  `/recent` — ele não muda de forma nem de semântica.
- `modo:` (novo) sempre opera sobre o PAR (raiz + `_rx` do mesmo namespace),
  nunca sobre a chave única que `server:` resolveu.
- `FETCH_LIMIT` continua 50 — o total após juntar as duas listas, não por
  lista.
- Sem cache novo: recentes continuam sempre buscados na hora, nos dois modos.
- Uma das duas buscas falhando não derruba o comando; as duas falhando, sim
  (mesmo erro de hoje).
- `rs.js` não muda — ele herda `data` e `execute` de `recent.js` via
  `recent.data.toJSON()`, então a opção nova aparece lá sozinha.

---

## Task 1: `src/recentMerge.js` — a lógica pura

**Files:**
- Create: `src/recentMerge.js`
- Test: `test/recentMerge.test.js`

**Interfaces:**
- Consumes: `servers.resolveKey(key)`, `servers.has(key)` (já existem em
  `src/servers.js`, sem mudança).
- Produces (usado pelo Task 2):
  - `pairFor(key: string): { vn: string, rx: string|null, resolvedIsRx: boolean }`
  - `keysToFetch(pair, modoOption: 'vn'|'rx'|null): string[]`
  - `mergeRecent(porModo: {mode: string, scores: object[]}[], limit: number): object[]`
    (cada score do retorno ganha um campo `_mode` com a chave de onde veio)
  - `fetchEach(keys: string[], fetchOne: (mode: string) => Promise<object[]>): Promise<{mode: string, scores: object[]}[]>`
    (rejeita só se TODAS as chaves rejeitarem; nesse caso relança o primeiro erro)

O `.env` de desenvolvimento deste repo já define `SERVERS=daycore` com
`SERVER_DAYCORE_RELAX=true` e `OSU_MODE=official` — os testes abaixo usam
`daycore`/`daycore_rx` (par) e `official` (sem par) de propósito, mesmo
padrão que `test/mapContext.test.js` já usa pra essas mesmas chaves.

- [ ] **Step 1: Escrever os testes (falhando, o módulo ainda não existe)**

Criar `test/recentMerge.test.js`:

```js
/** Lógica de juntar VN e RX no /recent: par de chaves, quais buscar, merge, falha parcial. */
const test = require('node:test');
const assert = require('node:assert');

const recentMerge = require('../src/recentMerge');

// ─── pairFor ────────────────────────────────────────────────────────────────

test('pairFor', async t => {
  await t.test('chave raiz de servidor com RX', () => {
    const pair = recentMerge.pairFor('daycore');
    assert.deepEqual(pair, { vn: 'daycore', rx: 'daycore_rx', resolvedIsRx: false });
  });

  await t.test('chave _rx do mesmo par', () => {
    const pair = recentMerge.pairFor('daycore_rx');
    assert.deepEqual(pair, { vn: 'daycore', rx: 'daycore_rx', resolvedIsRx: true });
  });

  await t.test('servidor sem variante RX', () => {
    const pair = recentMerge.pairFor('official');
    assert.deepEqual(pair, { vn: 'official', rx: null, resolvedIsRx: false });
  });
});

// ─── keysToFetch ────────────────────────────────────────────────────────────

test('keysToFetch', async t => {
  const comPar    = recentMerge.pairFor('daycore');
  const comParRx  = recentMerge.pairFor('daycore_rx');
  const semPar    = recentMerge.pairFor('official');

  await t.test('sem par, ignora modo e busca só a chave', () => {
    assert.deepEqual(recentMerge.keysToFetch(semPar, null), ['official']);
    assert.deepEqual(recentMerge.keysToFetch(semPar, 'rx'), ['official']);
  });

  await t.test('com par, sem modo: e resolvido pela raiz, combina os dois', () => {
    assert.deepEqual(recentMerge.keysToFetch(comPar, null), ['daycore', 'daycore_rx']);
  });

  await t.test('com par, sem modo: mas resolvido pelo _rx, só RX (compat)', () => {
    assert.deepEqual(recentMerge.keysToFetch(comParRx, null), ['daycore_rx']);
  });

  await t.test('modo: vn força só VN mesmo resolvido pelo _rx', () => {
    assert.deepEqual(recentMerge.keysToFetch(comParRx, 'vn'), ['daycore']);
  });

  await t.test('modo: rx força só RX mesmo resolvido pela raiz', () => {
    assert.deepEqual(recentMerge.keysToFetch(comPar, 'rx'), ['daycore_rx']);
  });
});

// ─── mergeRecent ────────────────────────────────────────────────────────────

test('mergeRecent', async t => {
  const vn = [
    { id: 1, created_at: '2026-08-20T10:00:00Z' },
    { id: 2, created_at: '2026-08-20T08:00:00Z' },
  ];
  const rx = [
    { id: 3, created_at: '2026-08-20T09:00:00Z' },
  ];

  await t.test('junta as duas listas por data decrescente', () => {
    const out = recentMerge.mergeRecent(
      [{ mode: 'daycore', scores: vn }, { mode: 'daycore_rx', scores: rx }],
      50,
    );
    assert.deepEqual(out.map(s => s.id), [1, 3, 2]);
  });

  await t.test('cada score ganha o _mode de onde veio', () => {
    const out = recentMerge.mergeRecent(
      [{ mode: 'daycore', scores: vn }, { mode: 'daycore_rx', scores: rx }],
      50,
    );
    assert.equal(out.find(s => s.id === 1)._mode, 'daycore');
    assert.equal(out.find(s => s.id === 3)._mode, 'daycore_rx');
  });

  await t.test('corta no limite depois de juntar', () => {
    const out = recentMerge.mergeRecent(
      [{ mode: 'daycore', scores: vn }, { mode: 'daycore_rx', scores: rx }],
      2,
    );
    assert.deepEqual(out.map(s => s.id), [1, 3]);
  });

  await t.test('uma chave só também marca o _mode', () => {
    const out = recentMerge.mergeRecent([{ mode: 'official', scores: vn }], 50);
    assert.ok(out.every(s => s._mode === 'official'));
  });
});

// ─── fetchEach ──────────────────────────────────────────────────────────────

test('fetchEach', async t => {
  await t.test('todas as chaves respondem', async () => {
    const out = await recentMerge.fetchEach(['daycore', 'daycore_rx'], async mode => [{ mode }]);
    assert.deepEqual(out, [
      { mode: 'daycore', scores: [{ mode: 'daycore' }] },
      { mode: 'daycore_rx', scores: [{ mode: 'daycore_rx' }] },
    ]);
  });

  await t.test('uma falha, a outra ainda responde', async () => {
    const out = await recentMerge.fetchEach(['daycore', 'daycore_rx'], async mode => {
      if (mode === 'daycore_rx') throw new Error('RX fora do ar');
      return [{ mode }];
    });
    assert.deepEqual(out, [{ mode: 'daycore', scores: [{ mode: 'daycore' }] }]);
  });

  await t.test('as duas falham, relança o primeiro erro', async () => {
    await assert.rejects(
      recentMerge.fetchEach(['daycore', 'daycore_rx'], async () => { throw new Error('fora do ar'); }),
      /fora do ar/,
    );
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham (módulo não existe)**

Run: `npm test`
Expected: falha em `test/recentMerge.test.js` com `Cannot find module '../src/recentMerge'`

- [ ] **Step 3: Criar `src/recentMerge.js`**

```js
/**
 * recentMerge.js
 * A lógica de juntar VN e RX no /recent e /rs — só ela, sem tocar em rede
 * nem em Discord, pra dar pra testar sem os dois.
 *
 * "Par" é a chave raiz de um servidor (ex: `daycore`) e a variante `_rx` dela
 * (ex: `daycore_rx`) — a mesma conta, dois leaderboards (ver servers.js). Um
 * servidor sem RX configurado (`RELAX` ausente no `.env`, ou o Bancho oficial)
 * não tem par: o `rx` do pairFor vem `null`, e tudo aqui se comporta como o
 * /recent de sempre, uma busca só.
 */

const servers = require('./servers');

/**
 * O par VN/RX do mesmo namespace que uma chave pertence.
 *
 * @param {string} key chave já resolvida (o que `resolvePlayer` devolveu)
 * @returns {{vn: string, rx: string|null, resolvedIsRx: boolean}}
 */
function pairFor(key) {
  const resolved = servers.resolveKey(key) ?? key;
  const resolvedIsRx = resolved.endsWith('_rx');
  const root = resolvedIsRx ? resolved.slice(0, -3) : resolved;

  return {
    vn: servers.has(root) ? root : null,
    rx: servers.has(`${root}_rx`) ? `${root}_rx` : null,
    resolvedIsRx,
  };
}

/**
 * Quais chaves buscar, dado o par do servidor e a opção `modo:` do comando.
 *
 * Sem par, `modo:` não tem o que filtrar — busca só a chave que existe. Com
 * par e sem `modo:` explícito, o default depende de COMO o servidor foi
 * resolvido: pela raiz vira combinado (o comportamento novo), pelo `_rx`
 * continua só RX — quem já apontava pra lá (`server: daycore_rx`, ou
 * `/link default` configurado assim) não é surpreendido com uma lista
 * mesclada do nada.
 *
 * @param {{vn: string, rx: string|null, resolvedIsRx: boolean}} pair
 * @param {'vn'|'rx'|null} modoOption
 * @returns {string[]}
 */
function keysToFetch(pair, modoOption) {
  if (!pair.rx) return [pair.vn];
  if (modoOption === 'vn') return [pair.vn];
  if (modoOption === 'rx') return [pair.rx];
  return pair.resolvedIsRx ? [pair.rx] : [pair.vn, pair.rx];
}

/**
 * Junta scores de uma ou mais chaves, do mais recente pro mais antigo, cortado
 * no limite. Cada score ganha um `_mode` com a chave de onde veio — inclusive
 * quando só há uma chave, pra quem consome não precisar de um caso especial.
 *
 * @param {{mode: string, scores: object[]}[]} porModo
 * @param {number} limit
 * @returns {object[]}
 */
function mergeRecent(porModo, limit) {
  const marcados = porModo.flatMap(({ mode, scores }) =>
    scores.map(score => ({ ...score, _mode: mode })));

  marcados.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return marcados.slice(0, limit);
}

/**
 * Busca cada chave em paralelo; uma rejeitar não derruba as outras — só
 * quando TODAS rejeitam é que a falha sobe (o primeiro erro, mesmo padrão de
 * `fetchPlayer` em userLink.js pra separar "sem esse jogador" de "erro de
 * rede").
 *
 * @param {string[]} keys
 * @param {(mode: string) => Promise<object[]>} fetchOne
 * @returns {Promise<{mode: string, scores: object[]}[]>}
 */
async function fetchEach(keys, fetchOne) {
  const settled = await Promise.allSettled(keys.map(fetchOne));

  const ok = keys
    .map((mode, i) => ({ mode, result: settled[i] }))
    .filter(({ result }) => result.status === 'fulfilled')
    .map(({ mode, result }) => ({ mode, scores: result.value }));

  if (ok.length === 0) throw settled[0].reason;
  return ok;
}

module.exports = { pairFor, keysToFetch, mergeRecent, fetchEach };
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npm test`
Expected: PASS em todos os `test/recentMerge.test.js` (e no resto da suíte, sem regressão)

- [ ] **Step 5: Commit**

```bash
git add src/recentMerge.js test/recentMerge.test.js
git commit -m "feat: logica de par VN/RX pro /recent (recentMerge.js)"
```

---

## Task 2: `src/commands/recent.js` — a opção nova e o `_mode` por play

**Files:**
- Modify: `src/commands/recent.js`
- Modify: `test/smokeCommands.js` (dois casos novos, fora do `npm test` — ver Global Constraints)

**Interfaces:**
- Consumes: `pairFor`, `keysToFetch`, `mergeRecent`, `fetchEach` do Task 1
  (`../recentMerge`, caminho relativo de `src/commands/`).
- Produces: nada — é o comando final. `rs.js` não muda; herda tudo daqui.

- [ ] **Step 1: Adicionar a opção `modo` ao builder**

Em `src/commands/recent.js:29-36`, depois do `.addStringOption` de `server`:

```js
    .addStringOption(option =>
      option
        .setName('server')
        .setDescription('Which server to use? (default: your linked server)')
        .setDescriptionLocalizations({ 'pt-BR': 'Qual servidor usar? (padrão: o do seu link)' })
        .setRequired(false)
        .addChoices(...servers.choices())
    )
    .addStringOption(option =>
      option
        .setName('modo')
        .setDescription('Filter VN/RX when the server has both (default: combined)')
        .setDescriptionLocalizations({ 'pt-BR': 'Filtra VN/RX quando o servidor tem os dois (padrão: combinado)' })
        .setRequired(false)
        .addChoices(
          { name: 'VN only', value: 'vn', nameLocalizations: { 'pt-BR': 'Só VN' } },
          { name: 'RX only', value: 'rx', nameLocalizations: { 'pt-BR': 'Só RX' } },
        )
    ),
```

- [ ] **Step 2: Importar o `recentMerge`**

Em `src/commands/recent.js:1-11`, junto dos outros requires:

```js
const osu = require('../osuClient');
const servers = require('../servers');
const recentMerge = require('../recentMerge');
const { resolvePlayer, fetchPlayer } = require('../userLink');
```

- [ ] **Step 3: Trocar a busca de recentes pela versão com par**

Em `src/commands/recent.js`, o trecho hoje é:

```js
    const { mode } = resolved;
    await interaction.deferReply();

    try {
      // Perfil e plays na mesma viagem quando o link já deu o id (ver userLink).
      const { user, scores: recents } = await fetchPlayer(
        resolved,
        id => osu.getRecentScores(id, FETCH_LIMIT, mode),
      );
```

Vira:

```js
    const { mode } = resolved;
    const modoOption = interaction.options.getString('modo'); // 'vn' | 'rx' | null
    const pair = recentMerge.pairFor(mode);
    const keys = recentMerge.keysToFetch(pair, modoOption);
    await interaction.deferReply();

    try {
      // Perfil e plays na mesma viagem quando o link já deu o id (ver userLink).
      // Com par VN/RX, "as plays" pode vir de mais de uma chave — fetchEach
      // busca as duas em paralelo e tolera uma falhando; mergeRecent junta e
      // corta no FETCH_LIMIT, marcando cada play com o `_mode` de onde veio.
      const { user, scores: recents } = await fetchPlayer(
        resolved,
        async id => {
          const porModo = await recentMerge.fetchEach(
            keys,
            key => osu.getRecentScores(id, FETCH_LIMIT, key),
          );
          return recentMerge.mergeRecent(porModo, FETCH_LIMIT);
        },
      );
```

- [ ] **Step 4: Trocar `mode` por `rawPlay._mode` dentro de `buildEmbed`**

O `buildEmbed` hoje é:

```js
      async function buildEmbed(page) {
        // Enriquece só a play exibida agora, não as 50 buscadas de uma vez —
        // evita rajada de requisições/rate limit na API do osu!
        const rawPlay      = recents[page];
        const [scoredPlay] = await osu.enrichScores([rawPlay], mode);
        const [recent]     = await osu.enrichBeatmapData([scoredPlay]);

        pageMapId.set(page, recent.beatmap.id);

        // Todo o desenho da play mora no embeds/play.js — é o mesmo em todo
        // comando. O que sobra aqui é a moldura: quem jogou, e onde a play
        // está na lista de páginas.
        const bloco = await playEmbed.single(recent, { mode, s });

        return new EmbedBuilder()
          .setAuthor(playEmbed.author(user, mode, s))
          .setTitle(bloco.title)
          .setURL(bloco.url)
          .setColor(bloco.color)
          .setThumbnail(bloco.thumbnail)
          .setDescription(bloco.description)
          .setFooter({
            // Status do mapa (ranked, loved, graveyard...) e mapper só existem
            // pela API oficial; no bancho.py o rodapé sai sem eles, em vez de
            // afirmar o que não dá para saber.
            text: s.recent_footer(
              page + 1,
              totalPages,
              osu.getModeLabel(mode),
              bloco.status,
              bloco.creator,
            ),
          });
      }
```

Vira (só o que muda: `playMode` a partir de `rawPlay._mode`, usado em tudo
que descreve a PLAY; `mode` do comando continua só na linha do autor, que é
o link de perfil do jogador, igual nos dois modos):

```js
      async function buildEmbed(page) {
        // Enriquece só a play exibida agora, não as 50 buscadas de uma vez —
        // evita rajada de requisições/rate limit na API do osu!
        const rawPlay      = recents[page];
        const playMode     = rawPlay._mode; // de qual chave (VN ou RX) essa play veio
        const [scoredPlay] = await osu.enrichScores([rawPlay], playMode);
        const [recent]     = await osu.enrichBeatmapData([scoredPlay]);

        pageMapId.set(page, recent.beatmap.id);

        // Todo o desenho da play mora no embeds/play.js — é o mesmo em todo
        // comando. O que sobra aqui é a moldura: quem jogou, e onde a play
        // está na lista de páginas.
        const bloco = await playEmbed.single(recent, { mode: playMode, s });

        return new EmbedBuilder()
          // Link de perfil: mesmo em VN e RX (ver banchoPyApi/rippleApi
          // userUrl), então continua no modo do COMANDO, não da play.
          .setAuthor(playEmbed.author(user, mode, s))
          .setTitle(bloco.title)
          .setURL(bloco.url)
          .setColor(bloco.color)
          .setThumbnail(bloco.thumbnail)
          .setDescription(bloco.description)
          .setFooter({
            // Status do mapa (ranked, loved, graveyard...) e mapper só existem
            // pela API oficial; no bancho.py o rodapé sai sem eles, em vez de
            // afirmar o que não dá para saber. O rótulo agora é o da PLAY: com
            // as duas listas juntas, uma página pode ser Daycore e a seguinte
            // Daycore RX.
            text: s.recent_footer(
              page + 1,
              totalPages,
              osu.getModeLabel(playMode),
              bloco.status,
              bloco.creator,
            ),
          });
      }
```

- [ ] **Step 5: Trocar `mode` por `_mode` em `onPage` e `prefetch`**

O `paginate(...)` hoje termina em:

```js
      await paginate(interaction, {
        id: 'recent',
        totalPages,
        buildEmbed,
        strings: s,
        // O contexto do canal acompanha a página em que os botões pararam.
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), mode),
        // Mesma ordem do /topplays: primeiro o enriquecimento (uma requisição
        // por play em servidor privado), depois o arquivo do mapa.
        prefetch: async (page) => {
          const proxima = recents[page];
          if (!proxima) return;

          const [scored] = await osu.enrichScores([proxima], mode);
          const [cheia]  = await osu.enrichBeatmapData([scored]);
          if (cheia?.beatmap?.id) await osu.getBeatmapFile(cheia.beatmap.id);
        },
      });
```

Vira:

```js
      await paginate(interaction, {
        id: 'recent',
        totalPages,
        buildEmbed,
        strings: s,
        // O contexto do canal acompanha a página em que os botões pararam —
        // no modo da PLAY, pro /score sem argumento procurar no leaderboard
        // certo (ver mapContext.js).
        onPage: page => mapContext.remember(interaction, pageMapId.get(page), recents[page]?._mode ?? mode),
        // Mesma ordem do /topplays: primeiro o enriquecimento (uma requisição
        // por play em servidor privado), depois o arquivo do mapa.
        prefetch: async (page) => {
          const proxima = recents[page];
          if (!proxima) return;

          const [scored] = await osu.enrichScores([proxima], proxima._mode);
          const [cheia]  = await osu.enrichBeatmapData([scored]);
          if (cheia?.beatmap?.id) await osu.getBeatmapFile(cheia.beatmap.id);
        },
      });
```

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — inclui os testes do Task 1 e o resto da suíte sem regressão
(nenhum teste existente cobre `recent.js` diretamente hoje; a garantia de
regressão de comando é o smoke, Step 7).

- [ ] **Step 7: Dois casos novos no smoke de comandos**

`test/smokeCommands.js` já roda `/recent` por servidor configurado
(`servers.all()`, linha ~135). Depende de rede e não entra no `npm test` (ver
cabeçalho do arquivo) — mas é o que exercita `modo:` contra um servidor de
verdade. Adicionar logo depois da linha do `/recent` dentro do loop:

```js
  caso(`/recent   ${server.label}`, 'recent.js', { player, server: server.key });
  // Só quando o servidor tem par RX: exercita o `modo:` explícito nos dois
  // sentidos, além do combinado que o caso de cima já cobre.
  if (servers.has(`${server.key}_rx`)) {
    caso(`/recent VN  ${server.label}`, 'recent.js', { player, server: server.key, modo: 'vn' });
    caso(`/recent RX  ${server.label}`, 'recent.js', { player, server: server.key, modo: 'rx' });
  }
```

Run: `npm run smoke:commands`
Expected: linhas `ok` para os dois casos novos, quando os servidores
configurados no `.env` local estiverem no ar (mesma ressalva de rede que o
resto do arquivo já tem — não é gate de CI).

- [ ] **Step 8: Commit**

```bash
git add src/commands/recent.js test/smokeCommands.js
git commit -m "feat: /recent e /rs combinam VN e RX por padrao, com modo: pra filtrar"
```
