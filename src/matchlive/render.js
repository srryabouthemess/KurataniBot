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

const capa = setId => `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg`;
const minSeg = seg => `${Math.floor(seg / 60)}:${String(Math.floor(seg % 60)).padStart(2, '0')}`;
const gradeEmTexto = g => `**${g}**`;

/**
 * `mapa` é o que o poller resolveu pelo `infoDoMapa` injetado ({setId, segundos}
 * ou null): a capa do mapset vira a imagem do embed, como no Bathbot.
 */
function cabecalho(game, partida, cor, description, mapa) {
  const e = {
    color: cor,
    author: { name: partida.name },
    title: game.mapName,
    url: mapaUrl(game.mapId),
    description,
  };
  if (mapa?.setId) e.image = { url: capa(mapa.setId) };
  return e;
}

function infoDoJogo(game, s) {
  const mods = game.freemods ? `${s.matchlive_game_freemod}${game.mods.length ? ` ${modsTxt(game.mods)}` : ''}` : modsTxt(game.mods);
  return `**${s.matchlive_game_mods}:** ${mods} · **${s.matchlive_game_team_type}:** ${game.teamType}`;
}

function embedJogoInicio(game, partida, s, { mapa = null } = {}) {
  const linhas = [s.matchlive_game_playing, infoDoJogo(game, s)];
  if (Number.isFinite(mapa?.segundos)) linhas.push(`**${s.matchlive_game_length}:** \`${minSeg(mapa.segundos)}\``);
  return cabecalho(game, partida, COR_ANDAMENTO, linhas.join('\n'), mapa);
}

function embedJogoAbortado(game, partida, s, { mapa = null } = {}) {
  return cabecalho(game, partida, COR_ABORTADO, `${s.matchlive_game_aborted}\n${infoDoJogo(game, s)}`, mapa);
}

/**
 * A grade legada do osu! std a partir dos hits (a regra clássica do stable).
 * Não passou = F; outros modos ficam sem grade (null), porque cada um tem a
 * sua regra e a linha anda bem sem ela.
 */
function grade({ n300, n100, n50, nmiss, passed }, mods = [], mode = 0) {
  if (mode !== 0) return null;
  if (!passed) return 'F';
  const total = n300 + n100 + n50 + nmiss;
  if (!total) return 'D';
  const prata = mods.includes('HD') || mods.includes('FL');
  const r300 = n300 / total;
  const r50 = n50 / total;
  if (n300 === total) return prata ? 'XH' : 'X';
  if (r300 > 0.9 && r50 <= 0.01 && nmiss === 0) return prata ? 'SH' : 'S';
  if ((r300 > 0.8 && nmiss === 0) || r300 > 0.9) return 'A';
  if ((r300 > 0.7 && nmiss === 0) || r300 > 0.8) return 'B';
  if (r300 > 0.6) return 'C';
  return 'D';
}

const TIMES_VS = new Set(['team-vs', 'tag-team-vs']);

/**
 * As linhas dos jogadores como as do Bathbot (embeds/osu/match_live.rs):
 * colunas de nome, mods, combo e score com a largura do maior valor (o
 * ColumnSizes de lá), acc em 5 posições e miss só quando há (MissFormat).
 */
function linhasDosScores(scores, game, rotuloDaGrade) {
  const itens = scores.map(sc => ({
    sc,
    nome: String(nome(sc.username, sc.userId)),
    mods: sc.mods.length ? sc.mods.join('') : 'NM',
    combo: fmt(sc.maxCombo),
    score: fmt(sc.score),
  }));
  const larg = campo => Math.max(0, ...itens.map(x => x[campo].length));
  const w = { nome: larg('nome'), mods: larg('mods'), combo: larg('combo'), score: larg('score') };

  const linhas = new Map();
  for (const x of itens) {
    const g = grade(x.sc, [...new Set([...x.sc.mods, ...game.mods])], game.mode);
    const acc = String(Math.round(acuracia(x.sc) * 100) / 100).padStart(5);
    const miss = x.sc.nmiss > 0 ? ` ${x.sc.nmiss}❌` : '';
    linhas.set(x.sc, `${g ? `${rotuloDaGrade(g)} ` : ''}\`${x.nome.padEnd(w.nome)}\` \`+${x.mods.padEnd(w.mods)}\` ` +
      `\`${acc}%\` \`${x.combo.padStart(w.combo)}x\` \`${x.score.padStart(w.score)}\`${miss}`);
  }
  return linhas;
}

/**
 * O corpo do resultado. Team-vs agrupa como o `team!` do Bathbot: o time de
 * maior soma primeiro, cada um com cabeçalho e total; H2H é só a lista por
 * score. Devolve também a frase do vencedor, que vai para o rodapé.
 */
function corpoDoResultado(game, s, rotuloDaGrade) {
  const ordenados = [...game.scores].sort((a, b) => b.score - a.score);
  const linhas = linhasDosScores(ordenados, game, rotuloDaGrade);
  if (!TIMES_VS.has(game.teamType)) return { corpo: ordenados.map(x => linhas.get(x)), vencedor: null };

  const soma = time => game.scores.filter(x => x.team === time).reduce((a, x) => a + x.score, 0);
  const times = [
    { time: 'blue', total: soma('blue'), emoji: ':blue_circle:', rotulo: s.matchlive_team_blue },
    { time: 'red', total: soma('red'), emoji: ':red_circle:', rotulo: s.matchlive_team_red },
  ].sort((a, b) => b.total - a.total);

  const corpo = [];
  for (const t of times) {
    const doTime = ordenados.filter(x => x.team === t.time);
    if (!doTime.length) continue;
    if (corpo.length) corpo.push('');
    corpo.push(`${t.emoji} **${t.rotulo}** ${t.emoji} | ${fmt(t.total)}`, ...doTime.map(x => linhas.get(x)));
  }
  const semTime = ordenados.filter(x => x.team !== 'blue' && x.team !== 'red');
  if (semTime.length) corpo.push('', ...semTime.map(x => linhas.get(x)));

  if (!game.scores.length) return { corpo, vencedor: null };
  const [a, b] = times;
  const vencedor = a.total === b.total ? s.matchlive_team_tied : s.matchlive_team_wins_by(a.rotulo, fmt(a.total - b.total));
  return { corpo, vencedor };
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

function embedJogoFim(game, partida, jogosTerminados, s, { mapa = null, rotuloDaGrade = gradeEmTexto } = {}) {
  const { corpo, vencedor } = corpoDoResultado(game, s, rotuloDaGrade);
  const e = cabecalho(game, partida, COR_FIM, [infoDoJogo(game, s), '', ...corpo].join('\n'), mapa);
  // Vencedor e match cost dividem o rodapé, um depois do outro.
  const rodape = [vencedor, rodapeDeCusto(partida, jogosTerminados, s)].filter(Boolean).join(' • ');
  if (rodape) e.footer = { text: rodape };
  return e;
}

function embedFim(partida, siteUrl, s) {
  const e = { color: COR_FIM, title: partida.name, description: s.matchlive_match_ended };
  if (siteUrl) e.url = siteUrl;
  return e;
}

module.exports = { acuracia, grade, linhaDeLog, embedLog, embedJogoInicio, embedJogoAbortado, embedJogoFim, embedFim };
