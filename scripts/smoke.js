/**
 * Teste de fumaça: bate na API de verdade, em cada servidor configurado.
 *
 * Fica FORA do `npm test` de propósito — depende de rede, de credencial e de os
 * servidores estarem no ar, então uma falha aqui não quer dizer que o código
 * regrediu. Rode com `npm run smoke` depois de mexer no osuClient ou no
 * registro de servidores.
 */
const servers = require('../src/servers');
const osu = require('../src/osuClient');

/**
 * Um jogador conhecido por servidor; ajuste se algum sumir.
 *
 * Sem entrada própria, um servidor cai no `default` — e foi assim que este
 * teste passou a reprovar sozinho: o Akatsuki entrou de fábrica sem ganhar a
 * sua, então procurava o `pudim2` do Daycore, que não existe lá.
 *
 * O Akatsuki entra por **ID**, e não por nick: nick muda, ID não. É a mesma
 * razão pela qual o link do usuário guarda o `osu_id` (ver db.js) — um teste
 * ancorado em nome reprova sozinho no dia em que alguém se renomear.
 *
 * E o ID escolhido tem números DIFERENTES em vanilla e em RX (medido em
 * 14/08/2026: #4 com 23897pp contra #1 com 62115pp). Isso não é detalhe de
 * escolha: no Ripple o Relax é um eixo separado do modo, lido em
 * `stats[rx].std`, e um jogador com os mesmos números nos dois deixaria uma
 * inversão desse índice passar sem ninguém notar — que é exatamente o tipo de
 * erro que o adaptador precisou acertar quando foi escrito.
 */
/**
 * O `default` é o jogador do Daycore, e ele só serve para os servidores do
 * .env — um embutido novo não tem por que conhecer aquele nick. Enquanto o EZPP
 * ficou de fora desta lista, toda rodada do smoke terminava com dois FALHA que
 * não eram defeito nenhum do bot, e um smoke que sempre reclama é um smoke que
 * ninguém lê.
 *
 * Por ID, e não por nome: nome de conta muda, e aí o smoke volta a acusar uma
 * falha que não existe. É a mesma razão do Akatsuki logo acima.
 */
const PLAYERS = {
  official:    'kuratani',
  akatsuki:    '47379',
  akatsuki_rx: '47379',
  ezpp:        '17854',
  ezpp_rx:     '17854',
  default:     'pudim2',
};

(async () => {
  let failures = 0;

  for (const server of servers.all()) {
    const player = PLAYERS[server.key] ?? PLAYERS.default;

    try {
      const user = await osu.getUser(player, server.key);
      if (!user) throw new Error('jogador não encontrado');

      const best = await osu.getBestScores(user.id, 1, server.key);
      const rank = user.statistics.global_rank ?? '-';

      console.log(
        `ok     ${server.label.padEnd(12)} ${user.username} ` +
        `#${rank} ${user.statistics.pp.toFixed(0)}pp, top plays: ${best.length}`
      );
      console.log(`       ${osu.getUserUrl(user.id, server.key)}`);
    } catch (error) {
      failures++;
      console.log(`FALHA  ${server.label.padEnd(12)} ${error.message}`);
    }
  }

  // O cálculo de PP do Relax passa por um Python separado; se ele não estiver
  // instalado, o valor vem null e o resto do bot continua funcionando.
  const rx = await osu.simulatePP(1103981, ['DT'], { n100: 5 }, 'private_rx');
  console.log(rx
    ? `ok     PP do Relax  ${rx.pp.toFixed(4)}pp / ${rx.stars.toFixed(4)}★`
    : 'aviso  PP do Relax  indisponível (akatsuki-pp-py não instalado)');

  process.exit(failures === 0 ? 0 : 1);
})();
