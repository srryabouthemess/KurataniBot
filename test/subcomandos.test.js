/**
 * Subcomando sem tratamento não pode virar silêncio nem escrita.
 *
 * Comando com subcomando costuma ser escrito como uma escada de `if (sub === …)`,
 * e o último ramo acaba virando o "tudo que sobrou". Enquanto o código e o
 * builder concordam isso é invisível; no dia em que divergem, o comando faz
 * OUTRA COISA em silêncio. O que cada um fazia antes:
 *
 *   /link      caía no `set`, que escreve — criava vínculo sem ninguém pedir;
 *   /nominate  caía no `add`, que registra nomeação e pode aplicar no servidor;
 *   /moderate  caía no `else` do restrict, que publica um UNRESTRICT no Redis;
 *   /staff     caía no `register`, emitindo código de vínculo administrativo;
 *   /language  não caía em lugar nenhum — o execute terminava sem responder, a
 *              interação expirava e quem usou via "O aplicativo não respondeu".
 *
 * Foi assim que apareceu: o smoke dos comandos chutou `subcommand: 'show'`, que
 * não existe, e o /link gravou um vínculo para um usuário osu! chamado "null".
 *
 * ── As duas divergências ──────────────────────────────────────────────────────
 * Os dois testes abaixo cobrem casos DIFERENTES, e é a distinção que importa:
 *
 *   não declarado  o builder não tem aquele subcomando. Só chega aqui por um
 *                  chamador que não é o Discord nem o parser de texto.
 *   declarado sem ramo  o mais provável: alguém acrescenta o `addSubcommand` e
 *                  esquece o `if`. A guarda do topo NÃO pega este — para ela o
 *                  subcomando é conhecido —, quem pega é a do ramo de queda.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * UM banco descartável para o arquivo inteiro, montado antes de qualquer
 * require de `src/` — vários destes ramos ESCREVEM, então isto não pode correr
 * o risco de tocar o banco de verdade.
 *
 * Por que não um banco por caso: trocar o módulo do banco entre casos deixa
 * quem já o importou (i18n, userLink, osuClient) apontando para a conexão
 * anterior, que o caso anterior fechou.
 */
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sub-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;

const db = require('../src/db');

const COMANDOS = {
  language: require('../src/commands/language'),
  link:     require('../src/commands/link'),
  nominate: require('../src/commands/nominate'),
  moderate: require('../src/commands/moderate'),
  staff:    require('../src/commands/staff'),
};

test.after(() => {
  db.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

/** Interação mínima, com o subcomando que se quer testar. */
function fakeInteraction(subcommand) {
  const enviado = [];
  const nulo = () => null;

  return {
    enviado,
    interaction: {
      user: { id: '900000000000000002', username: 'teste' },
      guildId: process.env.DAYCORE_GUILD_ID ?? '111',
      channelId: '222',
      deferred: false,
      replied: false,
      memberPermissions: { has: () => true },
      client: { users: { fetch: async (id) => ({ id }) } },
      options: {
        getString: nulo, getInteger: nulo, getNumber: nulo,
        getBoolean: nulo, getUser: nulo,
        getSubcommand: () => subcommand,
      },
      async deferReply() { this.deferred = true; },
      async reply(p)     { this.replied = true; enviado.push(p); },
      async editReply(p) { enviado.push(p); },
    },
  };
}

/** Os subcomandos que o builder daquele comando declara. */
const declaradosDe = (comando) =>
  (comando.data.toJSON().options ?? []).filter(o => o.type === 1).map(o => o.name);

// ── Camada 1: subcomando que o builder não declara ────────────────────────────

for (const [nome, comando] of Object.entries(COMANDOS)) {
  test(`/${nome} recusa subcomando não declarado`, async () => {
    const { interaction, enviado } = fakeInteraction('nao-existe-no-builder');

    await assert.rejects(
      () => comando.execute(interaction),
      /subcomando sem tratamento/,
      'deveria lançar, para o catch do index.js logar e responder',
    );

    // Lançar é o que faz a divergência chegar ao log com o nome do subcomando;
    // o silêncio anterior não deixava rastro nenhum.
    assert.equal(enviado.length, 0, 'não deveria ter respondido nada por conta própria');
  });
}

// ── Camada 2: declarado no builder, mas sem ramo no execute ───────────────────

for (const [nome, comando] of Object.entries(COMANDOS)) {
  test(`/${nome} tem ramo para todo subcomando que declara`, async () => {
    // Se algum declarado caísse no ramo de queda, a mensagem denunciaria — e
    // sem a guarda o comando faria a ação do fallback em silêncio.
    for (const sub of declaradosDe(comando)) {
      const { interaction } = fakeInteraction(sub);

      try {
        await comando.execute(interaction);
      } catch (erro) {
        assert.doesNotMatch(
          erro.message, /sem tratamento/,
          `/${nome} ${sub} está declarado no builder e cai no ramo de queda`,
        );
        // Qualquer outra falha é do caminho normal do comando (sem link, sem
        // permissão, sem rede) e não interessa aqui.
      }
    }
  });
}

// ── O estrago que a guarda evita ──────────────────────────────────────────────

test('/link não cria vínculo ao receber subcomando desconhecido', async () => {
  // O ramo do `set` era o destino de qualquer subcomando não reconhecido, e ele
  // escreve. Este caso é o que separa "ficou feio" de "gravou o que não devia".
  const { interaction } = fakeInteraction('set-de-mentira');
  await assert.rejects(() => COMANDOS.link.execute(interaction));

  assert.deepEqual(
    db.getAllLinks('900000000000000002'), [],
    'um subcomando desconhecido criou vínculo',
  );
});
