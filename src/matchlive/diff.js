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

const emOrdem = games => [...games].sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.id - b.id));

/**
 * O gameMessages de um track novo, com o histórico como no Bathbot: os últimos
 * `limite` mapas (terminados, abortados e o aberto mais recente) ficam sem
 * chave e o primeiro tick posta cada um; os mais antigos que isso já contam
 * como finalizados (`done:` sem mensagem) e não saem.
 */
function gameMessagesIniciais(games, limite = Infinity) {
  const jogos = emOrdem(games);
  const out = {};
  const corte = Math.max(0, jogos.length - limite);
  for (const game of jogos.slice(0, corte)) out[game.id] = 'done:';
  return out;
}

/**
 * O lastEventId de um track novo para o log do passado trazer só as últimas
 * `maxLinhas` entradas: o id do evento logável logo antes delas, ou 0 se
 * todas cabem.
 */
function inicioDoLog(events, maxLinhas) {
  const logaveis = events.filter(e => LOGAVEIS.has(e.type));
  return logaveis.length > maxLinhas ? logaveis[logaveis.length - maxLinhas - 1].id : 0;
}

function diff(estado, snapshot) {
  const acoes = [];
  let lastEventId = estado.lastEventId;

  for (const evento of snapshot.events) {
    if (evento.id > lastEventId) lastEventId = evento.id;
    if (LOGAVEIS.has(evento.type)) acoes.push({ tipo: 'log', evento });
  }

  const jogos = emOrdem(snapshot.games);
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

module.exports = { diff, finalizado, gameMessagesIniciais, inicioDoLog, LOGAVEIS };
