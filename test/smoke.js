/**
 * Teste de fumaça: bate na API de verdade, em cada servidor configurado.
 *
 * Fica FORA do `npm test` de propósito — depende de rede, de credencial e de os
 * servidores estarem no ar, então uma falha aqui não quer dizer que o código
 * regrediu. Rode com `npm run smoke` depois de mexer no osuClient ou no
 * registro de servidores.
 */
const servers = require('../servers');
const osu = require('../osuClient');

// Um jogador conhecido por servidor; ajuste se algum sumir.
const PLAYERS = { official: 'kuratani', default: 'pudim2' };

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
