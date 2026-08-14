/**
 * Subcomando sem tratamento não pode virar silêncio nem escrita.
 *
 * Pelo Discord isto não acontece: ele só envia subcomando declarado no builder.
 * O caso real é o CÓDIGO divergir da declaração — alguém acrescenta um
 * `addSubcommand` e esquece o ramo no `execute` —, e as duas formas de isso
 * passar despercebido são exatamente as que existiam:
 *
 *   /language  caía no fim do execute sem responder. A interação expirava e
 *              quem usou via "O aplicativo não respondeu", sem nada no log.
 *   /link      caía no ramo do `set`, que ESCREVE. Um subcomando novo mal
 *              ligado criaria vínculo sem ninguém ter pedido.
 *
 * Foi assim que apareceu: o smoke dos comandos chutou `subcommand: 'show'`, que
 * não existe em nenhum dos dois, e o /link gravou um vínculo para um usuário
 * osu! chamado "null".
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * UM banco descartável para o arquivo inteiro, montado antes de qualquer
 * require de `src/` — o defeito do /link era justamente escrever, então isto
 * não pode correr o risco de tocar o banco de verdade.
 *
 * Por que não o `freshDb(t)` por caso: ele troca o módulo do banco, mas quem já
 * o importou (i18n, userLink, osuClient) segue apontando para a conexão
 * anterior — que o caso anterior fechou. O segundo teste então falha com
 * "database is not open", que é defeito do arranjo e não do código sob teste.
 */
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sub-'));
process.env.KURATANI_DATA_DIR = DATA_DIR;

const db = require('../src/db');
const language = require('../src/commands/language');
const link = require('../src/commands/link');

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
      user: { id: '900000000000000002' },
      guildId: '111',
      deferred: false,
      replied: false,
      memberPermissions: { has: () => true },
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

for (const [nome, comando] of [['/language', language], ['/link', link]]) {
  test(`${nome} recusa subcomando sem tratamento, em vez de ficar calado`, async () => {
    const { interaction, enviado } = fakeInteraction('subcomando-que-nao-existe');

    await assert.rejects(
      () => comando.execute(interaction),
      /subcomando sem tratamento/,
      'deveria lançar, para o catch do index.js logar e responder',
    );

    // Lançar é o que faz o erro chegar ao log com o nome do subcomando; o
    // silêncio anterior não deixava rastro nenhum.
    assert.equal(enviado.length, 0, 'não deveria ter respondido nada por conta própria');
  });
}

test('/link não cria vínculo ao receber subcomando desconhecido', async () => {
  // O ramo do `set` era o destino de qualquer subcomando não reconhecido, e ele
  // escreve. Este caso é o que separa "ficou feio" de "gravou o que não devia".
  const { interaction } = fakeInteraction('set-de-mentira');
  await assert.rejects(() => link.execute(interaction));

  assert.deepEqual(
    db.getAllLinks('900000000000000002'), [],
    'um subcomando desconhecido criou vínculo',
  );
});
