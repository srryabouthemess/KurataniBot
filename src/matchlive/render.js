/**
 * matchlive/render.js
 * Os embeds do /matchlive. Só montagem: quem decide QUANDO cada um sai é o
 * diff.js, e quem posta é o poller.js.
 *
 * Devolve objetos APIEmbed puros em vez de EmbedBuilder: o discord.js só pode
 * ser importado dentro de commands/ (architecture.test), e ele aceita objetos
 * simples em `embeds`. Campos ausentes ficam de fora do objeto.
 *
 * O match cost do rodapé é o mesmo cálculo do /matchcost (multiplayer/logic.js),
 * sobre os jogos terminados até aqui — dá a parcial da partida a cada mapa.
 */

const { calcularMatchCost } = require('../multiplayer/logic');

const COR_ANDAMENTO = 0xf1c40f;
const COR_FIM = 0x2ecc71;
const COR_ABORTADO = 0x95a5a6;
const COR_LOG = 0x5865f2;

const nome = (u, id) => u ?? String(id);
const mapaUrl = id => `https://osu.ppy.sh/b/${id}`;
const fmt = n => Number(n).toLocaleString('en-US');
const modsTxt = m => (m.length ? `+${m.join('')}` : 'NM');

function acuracia({ n300, n100, n50, nmiss }) {
  const total = n300 + n100 + n50 + nmiss;
  if (!total) return 0;
  return Math.round(((300 * n300 + 100 * n100 + 50 * n50) / (300 * total)) * 10000) / 100;
}

function linhaDeLog(evento, s) {
  const u = nome(evento.username, evento.userId);
  if (evento.type === 'join') return s.matchlive_ev_join(u);
  if (evento.type === 'leave') return s.matchlive_ev_leave(u);
  return s.matchlive_ev_host(u);
}

function embedLog(linhas, partida, s) {
  return { color: COR_LOG, title: s.matchlive_log_title(partida.name), description: linhas.join('\n') };
}

function cabecalho(game, partida, cor, description) {
  return {
    color: cor,
    author: { name: partida.name },
    title: game.mapName,
    url: mapaUrl(game.mapId),
    description,
  };
}

function infoDoJogo(game, s) {
  const mods = game.freemods ? `${s.matchlive_game_freemod}${game.mods.length ? ` ${modsTxt(game.mods)}` : ''}` : modsTxt(game.mods);
  return `**${s.matchlive_game_mods}:** ${mods} · **${s.matchlive_game_team_type}:** ${game.teamType}`;
}

function embedJogoInicio(game, partida, s) {
  return cabecalho(game, partida, COR_ANDAMENTO, `${s.matchlive_game_playing}\n${infoDoJogo(game, s)}`);
}

function embedJogoAbortado(game, partida, s) {
  return cabecalho(game, partida, COR_ABORTADO, `${s.matchlive_game_aborted}\n${infoDoJogo(game, s)}`);
}

function linhaDoScore(sc, i) {
  return `**${i + 1}.** ${nome(sc.username, sc.userId)} ${modsTxt(sc.mods)} — **${fmt(sc.score)}** · ` +
    `${acuracia(sc).toFixed(2)}% · ${sc.maxCombo}x · ${sc.nmiss}❌${sc.passed ? '' : ' (F)'}`;
}

function placarDeTimes(game, s) {
  if (game.teamType !== 'team-vs' && game.teamType !== 'tag-team-vs') return null;
  const soma = time => game.scores.filter(x => x.team === time).reduce((a, x) => a + x.score, 0);
  const azul = soma('blue');
  const vermelho = soma('red');
  if (azul === vermelho) return null;
  return azul > vermelho
    ? s.matchlive_team_wins(s.matchlive_team_blue, fmt(azul), fmt(vermelho))
    : s.matchlive_team_wins(s.matchlive_team_red, fmt(vermelho), fmt(azul));
}

/** Os jogadores do resultado do calcularMatchCost, qualquer que seja o `tipo`. */
function jogadoresDoCusto(resultado) {
  if (resultado.tipo === 'times') return [...resultado.azul.jogadores, ...resultado.vermelho.jogadores];
  if (resultado.tipo === 'todos') return resultado.jogadores;
  return [];
}

function rodapeDeCusto(partida, jogosTerminados, s) {
  const formatoComum = {
    name: partida.name,
    finished: false,
    games: jogosTerminados.map(g => ({
      endedAt: g.endedAt,
      teamType: g.teamType,
      scores: g.scores.map(x => ({ userId: x.userId, username: x.username, team: x.team, mods: x.mods, score: x.score })),
    })),
  };
  const top = jogadoresDoCusto(calcularMatchCost(formatoComum, {}))
    .sort((a, b) => b.matchCost - a.matchCost)
    .slice(0, 3);
  if (!top.length) return null;
  return s.matchlive_cost_footer(top.map(j => `${j.username ?? j.userId} ${j.matchCost.toFixed(2)}`).join(' · '));
}

function embedJogoFim(game, partida, jogosTerminados, s) {
  const ordenados = [...game.scores].sort((a, b) => b.score - a.score);
  const linhas = [infoDoJogo(game, s), '', ...ordenados.map(linhaDoScore)];
  const times = placarDeTimes(game, s);
  if (times) linhas.push('', times);
  const e = cabecalho(game, partida, COR_FIM, linhas.join('\n'));
  const rodape = rodapeDeCusto(partida, jogosTerminados, s);
  if (rodape) e.footer = { text: rodape };
  return e;
}

function embedFim(partida, siteUrl, s) {
  const e = { color: COR_FIM, title: partida.name, description: s.matchlive_match_ended };
  if (siteUrl) e.url = siteUrl;
  return e;
}

module.exports = { acuracia, linhaDeLog, embedLog, embedJogoInicio, embedJogoAbortado, embedJogoFim, embedFim };
