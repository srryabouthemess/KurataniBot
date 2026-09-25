/**
 * commands/osu/matchcost/embed.js
 * Como o resultado do /matchcost aparece no Discord.
 *
 * O desenho é o da exibição compacta do Bathbot: placar de mapas em cima (em
 * Team VS), uma lista por time, nome alinhado em bloco de código, o match cost
 * com duas casas e medalha para os três maiores da partida inteira. O MVP vai
 * na miniatura e numa linha própria.
 */

const { EmbedBuilder } = require('discord.js');
const { arredondar } = require('./logic');

const COR = 0xff66aa;

/** Jogadores por página no head-to-head — o mesmo do Bathbot. */
const POR_PAGINA = 20;

/** Limite de descrição de embed do Discord. */
const LIMITE_DESCRICAO = 4096;

const MEDALHAS = [' 🥇', ' 🥈', ' 🥉'];

/** Link da partida no site do servidor. */
function urlDaPartida(server, id) {
  return server.kind === 'official'
    ? `${server.webUrl}/community/matches/${id}`
    : `${server.webUrl}/matches/${id}`;
}

const nomeDe = e => e.username ?? `<user ${e.userId}>`;

/** Largura das colunas, para os nomes alinharem entre as duas listas. */
function larguras(listas) {
  let indice = 0;
  let nome = 0;
  for (const lista of listas) {
    lista.forEach((e, i) => {
      indice = Math.max(indice, `${i + 1}.`.length);
      nome = Math.max(nome, nomeDe(e).length);
    });
  }
  return { indice, nome };
}

/**
 * Uma linha por jogador: `` `1.` [`nome`](perfil) `1.23` 🥇 ``.
 *
 * @param {Array} jogadores
 * @param {object} ctx `{ larguras, medalhas: userId[], urlDoJogador, inicio }`
 */
function linhas(jogadores, { larguras: l, medalhas, urlDoJogador, inicio = 1 }) {
  return jogadores.map((e, i) => {
    const indice = `${inicio + i}.`.padEnd(l.indice);
    const nome = nomeDe(e).padEnd(l.nome);
    const pos = medalhas.indexOf(e.userId);
    const medalha = pos >= 0 ? MEDALHAS[pos] : '';
    return `\`${indice}\` [\`${nome}\`](${urlDoJogador(e.userId)}) \`${arredondar(e.matchCost)}\`${medalha}`;
  }).join('\n');
}

/** Corta linhas do fim até caber, como o `validate_description_len` do Bathbot. */
function caber(texto, s) {
  if (texto.length <= LIMITE_DESCRICAO) return texto;
  const sufixo = '\n...';
  let out = texto;
  while (out.length + sufixo.length > LIMITE_DESCRICAO) {
    const quebra = out.lastIndexOf('\n');
    if (quebra < 0) return s.matchcost_too_many;
    out = out.slice(0, quebra);
  }
  return out + sufixo;
}

function linhaMvp(resultado, todos, s) {
  const mvp = todos.find(e => e.userId === resultado.mvp);
  return mvp ? s.matchcost_mvp(nomeDe(mvp), arredondar(mvp.matchCost)) : null;
}

/**
 * Os embeds, um por página (Team VS e "nenhum jogo" são sempre uma).
 *
 * @param {object} p
 * @param {object} p.partida  o formato normalizado (nome, avatars)
 * @param {object} p.resultado o que `calcularMatchCost` devolveu
 * @param {object} p.server   o servidor da partida (servers.js)
 * @param {number} p.id
 * @param {{warmups: number, ezMult: number}} p.opcoes
 * @param {(userId: number) => string} p.urlDoJogador
 * @param {object} s strings do idioma
 * @returns {EmbedBuilder[]}
 */
function montarEmbeds({ partida, resultado, server, id, opcoes, urlDoJogador }, s) {
  const nota = s.matchcost_note(opcoes.warmups, opcoes.ezMult !== 1 ? opcoes.ezMult.toFixed(2) : null);

  const base = (descricao, rodape) => {
    const embed = new EmbedBuilder()
      .setColor(COR)
      .setTitle((partida.name || `#${id}`).slice(0, 256))
      .setURL(urlDaPartida(server, id))
      .setDescription(caber(nota ? `*${nota}*\n\n${descricao}` : descricao, s))
      .setFooter({ text: rodape });
    const avatar = partida.avatars?.[resultado.mvp];
    if (avatar) embed.setThumbnail(avatar);
    return embed;
  };

  if (resultado.tipo === 'vazio') {
    return [base(s.matchcost_no_games(opcoes.warmups), s.matchcost_footer(1, 1, server.label, 0))];
  }

  if (resultado.tipo === 'times') {
    const { azul, vermelho } = resultado;
    const todos = [...azul.jogadores, ...vermelho.jogadores];
    const l = larguras([azul.jogadores, vermelho.jogadores]);

    // Medalha para os três maiores entre os três primeiros de cada time — é o
    // mesmo recorte do Bathbot, que compara só esses seis.
    const medalhas = [...azul.jogadores.slice(0, 3), ...vermelho.jogadores.slice(0, 3)]
      .sort((a, b) => b.matchCost - a.matchCost)
      .slice(0, 3)
      .map(e => e.userId);

    const ctx = { larguras: l, medalhas, urlDoJogador };
    const descricao = [
      s.matchcost_score(partida.finished, azul.vitorias, vermelho.vitorias),
      linhaMvp(resultado, todos, s),
      '',
      `🔷 **${s.matchcost_blue}**`,
      linhas(azul.jogadores, ctx),
      '',
      `🔺 **${s.matchcost_red}**`,
      linhas(vermelho.jogadores, ctx),
    ].filter(x => x !== null).join('\n');

    return [base(descricao, s.matchcost_footer(1, 1, server.label, resultado.jogos))];
  }

  const { jogadores } = resultado;
  const total = Math.max(1, Math.ceil(jogadores.length / POR_PAGINA));
  const l = larguras([jogadores]);
  const mvp = linhaMvp(resultado, jogadores, s);

  return Array.from({ length: total }, (_, pagina) => {
    const inicio = pagina * POR_PAGINA;
    const fatia = jogadores.slice(inicio, inicio + POR_PAGINA);
    // Como no Bathbot, as medalhas só aparecem na primeira página.
    const medalhas = pagina === 0 ? fatia.slice(0, 3).map(e => e.userId) : [];
    const lista = linhas(fatia, { larguras: l, medalhas, urlDoJogador, inicio: inicio + 1 });
    return base(mvp ? `${mvp}\n\n${lista}` : lista, s.matchcost_footer(pagina + 1, total, server.label, resultado.jogos));
  });
}

module.exports = { montarEmbeds, urlDaPartida, POR_PAGINA };
