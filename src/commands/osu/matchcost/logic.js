/**
 * commands/osu/matchcost/logic.js
 * A conta do /matchcost: de onde vem a partida, quais jogos entram, o match
 * cost de cada jogador e quem pode ver uma partida privada. Pura — nada de
 * Discord, de rede nem de banco.
 *
 * ── De onde saiu a fórmula ──────────────────────────────────────────────────
 * Porte do `match_costs.rs` do Bathbot (MaxOhn/Bathbot, licença ISC — crédito
 * no THIRD-PARTY-NOTICES.md). Porte e não reinterpretação: o número que o
 * Bathbot mostra para uma partida é o que a comunidade compara, e um match cost
 * "parecido" é pior que nenhum, porque ninguém sabe em qual confiar.
 *
 * Por isso até a aritmética é a dele. O Bathbot faz a conta em `f32`, e o
 * JavaScript em `f64`: a diferença some na maioria das partidas, mas o
 * arredondamento para duas casas também é feito em `f32` (`round` do
 * bathbot-util), e é exatamente perto do meio-centésimo que as duas precisões
 * discordam — 1.005 em f32 vira 1.01 lá e 1.00 aqui. Cada operação passa pelo
 * `Math.fround`, que é o arredondamento de uma operação `f32` (para soma,
 * produto e divisão entre dois f32 o resultado em f64 arredondado para f32 é
 * o mesmo da operação feita direto em f32).
 *
 * ── O formato de entrada ────────────────────────────────────────────────────
 * Igual para o Bancho e para o Daycore, cada fonte normaliza o seu (ver
 * bancho.js e daycore.js):
 *
 *   { name, finished, games: [{ endedAt, teamType, scores: [
 *       { userId, username, team: 'none'|'blue'|'red', mods: ['HD', ...], score } ] }] }
 *
 * `teamType` usa os nomes da API v2: 'head-to-head', 'tag-coop', 'team-vs',
 * 'tag-team-vs'.
 */

const f = Math.fround;

// ─── As constantes do Bathbot ─────────────────────────────────────────────────
// Nomes e comentários de lá, para quem for conferir linha a linha.

/** Bônus aditivo fixo no performance cost de cada jogador. */
const FLAT_BONUS = f(0.5);

/** Base do expoente: o bônus máximo de participação, para quem jogou tudo. */
const BASE_PARTICIPATION_BONUS = f(1.5);

/**
 * Expoente da curva até o bônus máximo de participação.
 * <0.85: sobe rápido e depois desacelera; >0.85: sobe devagar e depois acelera.
 */
const EXP_PARTICIPATION_BONUS = f(0.6);

/** Bônus multiplicativo por combinação de mods, a partir da terceira. */
const MOD_BONUS = f(0.02);

/** Quem joga o tiebreaker na média ganha este valor fixo. */
const TIEBREAKER_FACTOR = f(0.25);

/** Performance cost de tiebreaker ≥ 2 ganha o mesmo bônus. */
const MAX_TIEBREAKER_BONUS = f(0.5);

/** Padrões das opções — os mesmos do Bathbot. */
const DEFAULTS = { warmups: 0, skipLast: 0, ezMult: 1 };

// ─── De onde vem a partida ────────────────────────────────────────────────────

/**
 * Texto digitado → qual servidor e qual partida.
 *
 *   123456                                       só o id: quem chamou decide o servidor
 *   https://osu.ppy.sh/community/matches/123456  Bancho (o regex do Bathbot)
 *   https://osu.ppy.sh/mp/123456                 Bancho, forma curta
 *   https://<site do servidor>/matches/123456    servidor privado
 *
 * O site do servidor privado vem do registro (servers.js), e não daqui: o mesmo
 * bot atende quem hospeda para outro servidor, e um domínio escrito no código
 * reconheceria o link errado.
 *
 * @param {string} input
 * @param {Array<{key: string, kind: string, webUrl: string}>} lista os servidores
 *   registrados (só os vanilla — as variantes `_rx` são o mesmo site)
 * @returns {{key: string|null, id: number}|null} `key` null quando veio só o id;
 *   null quando não é nem id nem link de partida
 */
function parseMatchInput(input, lista) {
  const text = String(input ?? '').trim();

  // O Bathbot aceita qualquer coisa que caiba num u32.
  if (/^\d+$/.test(text)) {
    const id = Number(text);
    return id <= 0xFFFFFFFF ? { key: null, id } : null;
  }

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = h => h.toLowerCase().replace(/^www\./, '');

  for (const server of lista) {
    let site;
    try {
      site = new URL(server.webUrl);
    } catch {
      continue;
    }
    if (host(site.hostname) !== host(url.hostname)) continue;

    const caminho = server.kind === 'official'
      ? /^\/(?:community\/matches|mp)\/(\d+)\/?$/
      : /^\/matches\/(\d+)\/?$/;
    const m = caminho.exec(url.pathname);
    if (!m) return null;

    const id = Number(m[1]);
    return id <= 0xFFFFFFFF ? { key: server.key, id } : null;
  }

  return null;
}

/**
 * Partida privada do Daycore: só quem jogou nela pode ver.
 *
 * É a regra do site, que responde 404 para quem não participou — e a resposta
 * aqui é a MESMA de partida inexistente, para o bot não virar um jeito de
 * descobrir que a partida existe.
 *
 * @param {{private: boolean}} partida
 * @param {boolean} participou a conta vinculada de quem chamou tem um `join`
 */
function podeVerPartida(partida, participou) {
  return !partida.private || participou === true;
}

// ─── Quais jogos entram ───────────────────────────────────────────────────────

/** Um `f32` → `u32` do Rust: trunca, e satura nas pontas em vez de dar a volta. */
function comoU32(x) {
  if (!(x > 0)) return 0;
  return Math.min(Math.trunc(x), 0xFFFFFFFF);
}

/**
 * Os jogos que a conta considera, na ordem do Bathbot:
 *
 *   1. descarta jogo sem hora de fim (abortado, ou ainda em andamento);
 *   2. pula os `warmups` primeiros;
 *   3. tira os scores 0 de cada jogo;
 *   4. multiplica por `ezMult` os scores com EZ;
 *   5. corta os `skipLast` últimos.
 *
 * A ordem muda o resultado: um jogo abortado não conta como warmup, e um score
 * que só vira 0 depois do EZ (multiplicador 0) continua na média.
 *
 * Um jogo que fica sem score nenhum depois do passo 3 CONTINUA na lista, como
 * no Bathbot: ele conta no total de jogos da participação e vira uma "vitória
 * de ninguém" no placar.
 *
 * Única divergência, de propósito: `skipLast` maior que o número de jogos. No
 * Bathbot a subtração de `usize` dá a volta (o build de release não confere
 * overflow), o `truncate` recebe um número enorme e NÃO corta nada — pedir
 * para ignorar 10 mapas de 8 mostraria os 8. Aqui corta tudo, e a resposta é
 * a de "nenhum jogo".
 */
function selecionarJogos(games, { warmups = DEFAULTS.warmups, skipLast = DEFAULTS.skipLast, ezMult = DEFAULTS.ezMult } = {}) {
  const mult = f(ezMult);

  const jogos = games
    .filter(game => game.endedAt != null)
    .slice(warmups)
    .map(game => ({
      ...game,
      scores: game.scores
        .filter(score => score.score > 0)
        .map(score => (mult !== 1 && score.mods.includes('EZ')
          ? { ...score, score: comoU32(f(f(score.score) * mult)) }
          : score)),
    }));

  if (skipLast > 0) jogos.length = Math.max(0, jogos.length - skipLast);
  return jogos;
}

// ─── A conta ──────────────────────────────────────────────────────────────────

/**
 * A combinação de mods de um score, como o Bathbot a compara: conjunto de
 * acrônimos (a ordem não importa), sem o NoFail — jogar com ou sem NF não é
 * variar de mod.
 */
function chaveMods(mods) {
  return [...new Set(mods.filter(mod => mod !== 'NF'))].sort().join('');
}

/**
 * O time que ganhou o jogo: o de mais score somado.
 *
 * Empate: o Bathbot pega o `max_by_key` de um HashMap com hasher identidade, e
 * nessa tabela pequena a ordem de iteração é a do discriminante (none, blue,
 * red); o `max_by_key` devolve o ÚLTIMO dos máximos. Resultado: empate entre
 * azul e vermelho vai para o vermelho. Jogo sem score nenhum é de ninguém.
 */
function vencedor(scores) {
  const soma = new Map();
  for (const { team, score } of scores) soma.set(team, (soma.get(team) ?? 0) + score);

  let melhor = 'none';
  let maior = -1;
  for (const team of ['none', 'blue', 'red']) {
    if (!soma.has(team)) continue;
    if (soma.get(team) >= maior) {
      melhor = team;
      maior = soma.get(team);
    }
  }
  return melhor;
}

/** Vitórias por time, com a mesma regra de "diferença" do Bathbot. */
function contarVitorias(vencedores) {
  const vitorias = { none: 0, blue: 0, red: 0 };
  const houve = new Set();
  for (const team of vencedores) {
    vitorias[team]++;
    houve.add(team);
  }
  // Só existe diferença se os DOIS times ganharam ao menos um jogo: no Bathbot
  // a contagem mora num HashMap, e time que não ganhou nada não tem entrada.
  // Um 5 x 0 dá diferença 0, e não 5 — e não há tiebreaker.
  const diferenca = houve.has('blue') && houve.has('red')
    ? Math.abs(vitorias.blue - vitorias.red)
    : 0;
  return { vitorias, diferenca };
}

// ─── A ordem dos jogadores no Bathbot ─────────────────────────────────────────
//
// Em três lugares o Bathbot decide empate pela ordem em que percorre um
// `HashMap<u32, _, IntHasher>` de jogadores: o MVP (o primeiro dos maiores), a
// ordem de quem tem o mesmo match cost e, no head-to-head de dois, quem vai
// para o azul — e é o azul que perde os jogos empatados no placar (ver
// `vencedor`). Empate exato não é teórico: dois SS no mesmo mapa com os mesmos
// mods dão o mesmo score.
//
// Essa ordem não é aleatória. O hasher é a identidade (o hash de um id é o
// próprio id) e a tabela é o hashbrown da biblioteca padrão, cuja disposição
// depende só da ordem de inserção. As duas funções abaixo a reproduzem, e o
// teste de equivalência (test/matchcost.test.js) confere contra a tabela real.
//
// Supõe grupos de 16 bytes de controle, que é o hashbrown em x86_64 (SSE2).

const LARGURA_GRUPO = 16;

/** `capacity_to_buckets` do hashbrown, para elementos maiores que 3 bytes. */
function bucketsPara(capacidade) {
  if (capacidade < 4) return 4;
  if (capacidade < 8) return 8;
  if (capacidade < 15) return 16;
  let buckets = 1;
  while (buckets < Math.floor(capacidade * 8 / 7)) buckets *= 2;
  return buckets;
}

/** `bucket_mask_to_capacity`: quantos cabem antes de crescer. */
const capacidadeDe = buckets => (buckets <= 8 ? buckets - 1 : (buckets / 8) * 7);

/**
 * Onde o próximo id entra: a sondagem por grupos do hashbrown, sem remoções.
 * Tabela menor que um grupo cai na correção de `fix_insert_slot`, que na
 * prática é "o primeiro livre a partir da posição, dando a volta".
 */
function slotLivre(ocupado, id) {
  const buckets = ocupado.length;
  let pos = id % buckets;

  if (buckets < LARGURA_GRUPO) {
    for (let i = pos; i < buckets; i++) if (!ocupado[i]) return i;
    return ocupado.indexOf(false);
  }

  for (let passo = 0; ; ) {
    for (let k = 0; k < LARGURA_GRUPO; k++) {
      const i = (pos + k) % buckets;
      if (!ocupado[i]) return i;
    }
    passo += LARGURA_GRUPO;
    pos = (pos + passo) % buckets;
  }
}

/**
 * A ordem de iteração de um HashMap depois de inserir `ids` nesta ordem.
 *
 * @param {number[]} ids
 * @param {number|null} comCapacidade `with_capacity` (null = `default`, que
 *   começa vazio e cresce a cada vez que enche)
 */
function ordemDoHashMap(ids, comCapacidade = null) {
  let ocupado = [];
  let slots = [];
  let itens = 0;

  const redimensionar = capacidade => {
    const antigos = slots.filter(id => id !== undefined);
    ocupado = new Array(bucketsPara(capacidade)).fill(false);
    slots = new Array(ocupado.length);
    for (const id of antigos) {
      const i = slotLivre(ocupado, id);
      ocupado[i] = true;
      slots[i] = id;
    }
  };

  if (comCapacidade) redimensionar(comCapacidade);

  for (const id of ids) {
    const capacidade = ocupado.length ? capacidadeDe(ocupado.length) : 0;
    if (itens === capacidade) redimensionar(Math.max(itens + 1, capacidade + 1));
    const i = slotLivre(ocupado, id);
    ocupado[i] = true;
    slots[i] = id;
    itens++;
  }

  return slots.filter(id => id !== undefined);
}

/**
 * A ordem em que o Bathbot percorre os match costs: o mapa de performance
 * costs (`default`) recebe cada jogador na primeira vez que ele aparece, e o
 * de match costs (`with_capacity`) é preenchido percorrendo o primeiro.
 */
function ordemDosJogadores(porAparicao) {
  const primeira = ordemDoHashMap(porAparicao);
  return ordemDoHashMap(primeira, primeira.length);
}

/** O match cost do jogador, a partir das peças. */
const somarMatchCost = e =>
  f(f(f(e.performanceCost * e.participationBonus) * e.modsBonus) + e.tiebreakerBonus);

/**
 * O match cost de cada jogador, a partir dos jogos já selecionados.
 *
 * Por jogo: `performance cost = score / média dos scores daquele jogo`.
 * Por jogador:
 *
 *   performance   = média dos performance costs + 0.5
 *   participação  = 1.5 ^ (exp ^ 0.6), exp = (jogos dele - 1) / (jogos - 1)
 *   mods          = 1 + 0.02 * (combinações - 2), a partir de 3 combinações
 *   tiebreaker    = min(0.5, 0.25 * performance cost no último jogo)
 *   match cost    = performance * participação * mods + tiebreaker
 *
 * O tiebreaker só existe com a partida encerrada, mais de 4 jogos e diferença
 * de EXATAMENTE 1 vitória entre azul e vermelho — e só para quem jogou o último.
 *
 * @param {Array} jogos o que `selecionarJogos` devolveu (não vazio)
 * @param {boolean} finished a partida terminou
 * @returns {{ jogadores: Map<number, object>, vitorias: object, diferenca: number, times: Map<number, string> }}
 */
function calcularJogadores(jogos, finished) {
  const custos = new Map();   // userId → [{ score, performanceCost }]
  const mods   = new Map();   // userId → Set de combinações
  const times  = new Map();   // userId → time do primeiro jogo em que apareceu
  const nomes  = new Map();
  const vencedores = [];

  for (const jogo of jogos) {
    const soma = jogo.scores.reduce((acc, s) => acc + s.score, 0);
    const media = f(f(soma) / f(jogo.scores.length));

    for (const s of jogo.scores) {
      if (!mods.has(s.userId)) mods.set(s.userId, new Set());
      mods.get(s.userId).add(chaveMods(s.mods));

      if (!custos.has(s.userId)) custos.set(s.userId, []);
      custos.get(s.userId).push({ score: s.score, performanceCost: f(f(s.score) / media) });

      if (!times.has(s.userId)) times.set(s.userId, s.team);
      if (!nomes.get(s.userId) && s.username) nomes.set(s.userId, s.username);
    }

    vencedores.push(vencedor(jogo.scores));
  }

  const { vitorias, diferenca } = contarVitorias(vencedores);
  const ultimo = jogos[jogos.length - 1];
  const tiebreaker = finished && jogos.length > 4 && diferenca === 1 ? ultimo : null;
  const total = jogos.length;

  const jogadores = new Map();
  for (const userId of ordemDosJogadores([...custos.keys()])) {
    const entradas = custos.get(userId);
    const qtd = f(entradas.length);
    const somaCustos = entradas.reduce((acc, e) => f(acc + e.performanceCost), 0);
    const performanceCost = f(f(somaCustos / qtd) + FLAT_BONUS);

    let tiebreakerBonus = 0;
    if (tiebreaker && tiebreaker.scores.some(s => s.userId === userId)) {
      const noUltimo = entradas[entradas.length - 1].performanceCost;
      tiebreakerBonus = Math.min(MAX_TIEBREAKER_BONUS, f(TIEBREAKER_FACTOR * noUltimo));
    }

    const exp = total <= 1 ? 0 : f(f(qtd - 1) / f(total - 1));
    const participationBonus = f(Math.pow(BASE_PARTICIPATION_BONUS, f(Math.pow(exp, EXP_PARTICIPATION_BONUS))));

    const combinacoes = mods.get(userId)?.size ?? 0;
    const modsBonus = combinacoes > 2 ? f(1 + f(MOD_BONUS * (combinacoes - 2))) : 1;

    const entrada = {
      userId,
      username: nomes.get(userId) ?? null,
      performanceCost,
      participationBonus,
      modsBonus,
      tiebreakerBonus,
    };
    entrada.matchCost = somarMatchCost(entrada);
    jogadores.set(userId, entrada);
  }

  return { jogadores, vitorias, diferenca, times };
}

/**
 * Maior match cost primeiro. Estável, como o `sort_unstable_by` do Rust é na
 * prática até 20 elementos (ordenação por inserção): empate fica na ordem do
 * HashMap. Com mais de 20 jogadores empatados a ordem entre eles pode diferir
 * da do Bathbot — só a ordem, não o valor.
 */
const ordenar = lista => lista.sort((a, b) => b.matchCost - a.matchCost);

/**
 * O resultado do /matchcost, pronto para exibir.
 *
 * Três formas, como o `MatchResult` do Bathbot:
 *
 *   { tipo: 'vazio' }                          nenhum jogo depois do filtro
 *   { tipo: 'times', azul, vermelho, mvp }     Team VS, ou head-to-head de 2
 *   { tipo: 'todos', jogadores, mvp }          head-to-head
 *
 * Em Team VS, quem não tem time (azul ou vermelho) no primeiro jogo em que
 * apareceu fica de fora da lista, como lá.
 *
 * Head-to-head com exatamente dois jogadores vira "times" de um jogador cada,
 * com o placar de mapas entre os dois — também como lá, inclusive em quem vai
 * para o azul (ver `ordemDosJogadores`).
 *
 * @param {object} partida no formato normalizado (ver o cabeçalho)
 * @param {object} [opcoes] `{ warmups, skipLast, ezMult }`
 */
function calcularMatchCost(partida, opcoes = {}) {
  const jogos = selecionarJogos(partida.games, opcoes);
  if (jogos.length === 0) return { tipo: 'vazio', jogos: 0 };

  const { jogadores, vitorias, times } = calcularJogadores(jogos, partida.finished);
  const lista = [...jogadores.values()];

  // O maior estritamente: empate fica com quem vem antes na ordem do HashMap.
  const mvp = lista.reduce((m, e) => (e.matchCost > m.matchCost ? e : m), lista[0])?.userId ?? null;

  if (jogos[0].teamType === 'team-vs') {
    const azul = ordenar(lista.filter(e => times.get(e.userId) === 'blue'));
    const vermelho = ordenar(lista.filter(e => times.get(e.userId) === 'red'));
    return {
      tipo: 'times',
      jogos: jogos.length,
      azul: { vitorias: vitorias.blue, jogadores: azul },
      vermelho: { vitorias: vitorias.red, jogadores: vermelho },
      mvp,
    };
  }

  if (lista.length === 2) {
    const [a, b] = lista;
    const lado = userId => (userId === a.userId ? 'blue' : 'red');
    const placar = contarVitorias(jogos.map(jogo =>
      vencedor(jogo.scores.map(s => ({ team: lado(s.userId), score: s.score })))));

    return {
      tipo: 'times',
      jogos: jogos.length,
      azul: { vitorias: placar.vitorias.blue, jogadores: [a] },
      vermelho: { vitorias: placar.vitorias.red, jogadores: [b] },
      mvp,
    };
  }

  return { tipo: 'todos', jogos: jogos.length, jogadores: ordenar(lista), mvp };
}

/**
 * Duas casas decimais, arredondadas como o `round` do bathbot-util:
 * `(100 * n).round() / 100`, em f32 e com empate para longe do zero.
 */
function arredondar(n) {
  const cem = f(100 * f(n));
  const inteiro = cem < 0 ? -Math.round(-cem) : Math.round(cem);
  return (inteiro / 100).toFixed(2);
}

module.exports = {
  parseMatchInput,
  podeVerPartida,
  selecionarJogos,
  calcularMatchCost,
  arredondar,
  chaveMods,
  DEFAULTS,

  // Expostos para teste.
  vencedor,
  contarVitorias,
  ordemDoHashMap,
};
