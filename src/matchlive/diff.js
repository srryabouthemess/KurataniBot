/**
 * matchlive/diff.js
 * O que mudou numa partida desde o último tick, como lista de ações.
 *
 * Puro de propósito: o poller só executa o que sai daqui, e toda a regra de
 * "o que postar, editar ou dar por abortado" fica testável sem Discord nem
 * banco. O estado vem do SQLite (Track), então a mesma conta serve para o
 * primeiro tick depois de um restart.
 *
 * Abortado não tem marca no banco: é jogo sem `ended_at` que foi superado por
 * um mais novo, ou que ficou aberto quando a partida fechou (ver o cabeçalho
 * de commands/osu/matchcost/daycore.js).
 */

const LOGAVEIS = new Set(['join', 'leave', 'host']);

const finalizado = msg => typeof msg === 'string' && msg.startsWith('done:');

function diff(estado, snapshot) {
  const acoes = [];
  let lastEventId = estado.lastEventId;

  for (const evento of snapshot.events) {
    if (evento.id > lastEventId) lastEventId = evento.id;
    if (LOGAVEIS.has(evento.type)) acoes.push({ tipo: 'log', evento });
  }

  const jogos = [...snapshot.games].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.id - b.id));
  const fechada = snapshot.match.endedAt != null;

  jogos.forEach((game, i) => {
    const msg = estado.gameMessages[game.id];
    if (finalizado(msg)) return;
    if (msg === undefined) acoes.push({ tipo: 'gameStart', game });
    if (game.endedAt != null) acoes.push({ tipo: 'gameEnd', game });
    else if (i < jogos.length - 1 || fechada) acoes.push({ tipo: 'gameAbort', game });
  });

  if (fechada) acoes.push({ tipo: 'matchEnd', match: snapshot.match });
  return { acoes, lastEventId };
}

module.exports = { diff, finalizado };
