/**
 * embeds/play.js
 * Como uma play aparece na tela — em qualquer comando.
 *
 * O /recent, o /score e o /topplays exibem o MESMO objeto (um score), e cada um
 * tinha o seu desenho. O /recent montava campos de embed com rótulo traduzido
 * ("Status", "Estatísticas"), que ocupam três linhas de altura para dizer o que
 * cabe em meia; os outros dois já usavam linhas de descrição, mas não
 * concordavam entre si — pp entre crases num, em negrito no outro; acurácia
 * entre parênteses num, depois de um ponto no outro; combo entre colchetes só
 * num deles. Eram três lugares para mudar a cada ajuste de leitura, e três
 * resultados diferentes para a mesma play.
 *
 * Aqui mora a FORMA, e só ela: quem chama traz o score já enriquecido e diz em
 * que moldura ele vai — play única (o embed inteiro) ou item de lista. O
 * formato segue o do BathBot, que é o que a comunidade de osu! já lê sem
 * pensar: densidade alta, sem rótulo escrito, cada número sempre no mesmo lugar.
 *
 * ── Sem rótulo é de propósito ─────────────────────────────────────────────────
 * "121.21pp", "81.48%" e "55x/284x" se explicam pela unidade que carregam, e o
 * que sobrava dos rótulos era ruído traduzido três vezes. O que continua no
 * i18n é o que é frase: rodapé, erro, aviso.
 *
 * ── O que pode faltar ─────────────────────────────────────────────────────────
 * Quase tudo. Servidor privado não manda status do mapa, nome do mapper nem
 * score total; mapa exclusivo de servidor privado não existe na API oficial e
 * pode não ter .osu para calcular atributos; a pasta de emojis é opcional. Cada
 * pedaço some sozinho quando o dado não existe, em vez de imprimir "?" ou zero —
 * é a mesma escolha que o rodapé do /recent já fazia com o status do mapa.
 */

const osu = require('../osuClient');
const emojis = require('../emojis');
const { md } = require('../markdown');
const { formatMods } = require('../mods');
const { localScorePP } = require('../scorePP');

/** Rosa do bot para play concluída; vermelho para a que parou no meio. */
const COLOR      = 0xff66aa;
const COLOR_FAIL = 0xee4444;

// Título de embed estoura em 256 caracteres, e "artista - título [dificuldade]"
// de mapa de maratona chega perto. O corte evita que o comando falhe ao
// responder depois de já ter buscado tudo.
const TITLE_MAX = 240;

// ─── Peças ────────────────────────────────────────────────────────────────────

/** Junta o que sobrou, sem separador solto onde um pedaço não existe. */
const join = (parts) => parts.filter(Boolean).join(' • ');

const truncate = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** 9.4 e não 9.40; 4 e não 4.0 — como o osu! escreve. */
const dec = (value) => Number(Number(value).toFixed(2)).toString();

/**
 * Um valor de pp como a pessoa lê: separador de milhar do idioma dela, duas
 * casas sempre. Os cinco dígitos de quem está no topo ("32138.70") não se leem
 * de relance.
 *
 * Exportado porque a linha do autor não é o único lugar que mostra pp: o
 * /whatif projeta um total no mesmo embed, e dois formatos lado a lado fazem o
 * leitor conferir se são a mesma coisa.
 */
const ppLegivel = (valor, locale) =>
  Number(valor ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Timestamp relativo do Discord ("há 4 horas"), que cada pessoa lê no fuso e no
 * idioma dela — e que o rodapé antes escrevia numa data fixa em pt-BR.
 */
function timeAgo(dateString) {
  const ms = new Date(dateString).getTime();
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : null;
}

/** Os quatro acertos como o osu! os escreve. Miss ausente é zero, não "-". */
function hits(play) {
  const h = play.statistics ?? {};
  const n = (a, b) => a ?? b ?? '-';
  return `{ ${n(h.count_300, h.great)} / ${n(h.count_100, h.ok)} / ` +
         `${n(h.count_50, h.meh)} / ${h.count_miss ?? h.miss ?? 0} }`;
}

function missCount(play) {
  const h = play.statistics ?? {};
  const misses = h.count_miss ?? h.miss ?? 0;
  return typeof misses === 'number' ? misses : 0;
}

/** `81.48%`. Score sem acurácia é raro, mas "NaN%" é pior do que nada. */
function accuracy(play) {
  const value = Number(play.accuracy) * 100;
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : null;
}

/** `55x/284x`, com `?x` quando o combo do mapa não veio. */
function combo(play) {
  const mapCombo = play.beatmap?.max_combo ?? null;
  return `${play.max_combo ?? 0}x/${mapCombo !== null ? `${mapCombo}x` : '?x'}`;
}

/**
 * `❌ 23`, e nada quando a play não teve miss.
 *
 * O número já está no `{ 300 / 100 / 50 / miss }` logo abaixo, mas ali ele é o
 * quarto de quatro; aqui é o que responde "por que este pp não é o do FC ao
 * lado?" sem precisar contar posições.
 */
const misses = (play) => (missCount(play) > 0 ? `❌ ${missCount(play)}` : null);

/**
 * `121.21/457.95pp` (o primeiro em negrito) — o que a play pagou e, quando ela
 * foi choke, o que um FC teria pago.
 *
 * ── O til saiu ────────────────────────────────────────────────────────────────
 * O `~` marcava "este número foi calculado aqui, não veio pontuado pelo
 * servidor" — uma ressalva de PRECISÃO, de quando o motor local era o rosu-pp e
 * ficava reworks atrás do osu!. Ela deixou de descrever a realidade: o
 * lazer-calculator compila o C# do próprio osu!, e medido contra a API oficial
 * em 12 top plays reais o erro é de 0,00%. No Relax quem calcula é o
 * akatsuki-pp, que é o mesmo motor dos servidores de RX — ou seja, a mesma
 * conta que pontuou o score.
 *
 * O que continua sendo verdade é que o número do FC é HIPOTÉTICO, e isso a
 * fração já diz sozinha: dois valores separados por barra, com o real em
 * negrito. O til não acrescentava nada a isso, e sugeria uma imprecisão que não
 * existe mais.
 *
 * O `getFCpp` devolve null para play que já é FC, então o segundo número
 * aparecer é, por si só, o sinal de que houve choke.
 */
async function ppText(play, mode) {
  const doServidor = Number.isFinite(play.pp);

  const [proprio, fc] = await Promise.all([
    // `partial` só quando se sabe que a play parou no meio: sem ele a conta
    // assume o mapa inteiro e devolve quase o valor de um FC (ver scorePP.js).
    doServidor ? play.pp : localScorePP(play, mode, { partial: play.passed === false }),
    osu.getFCpp(play, mode),
  ]);

  const valor = Number.isFinite(proprio) ? proprio.toFixed(2) : '?';

  // O número do FC só entra quando é MAIOR do que o que a play pagou. "Se
  // tivesse sido FC, teria dado menos" não é informação, é ruído — e agora que
  // o motor bate exato com o oficial, ver isso acontecer no vanilla é sinal de
  // que alguma coisa está errada, não de desatualização. A guarda fica pelo
  // Relax, onde o motor é outro e a divergência de casas decimais é possível
  // num choke de um combo só.
  const mostraFC = Number.isFinite(fc) && (!Number.isFinite(proprio) || fc > proprio);

  return `**${valor}**${mostraFC ? `/${fc.toFixed(2)}` : ''}pp`;
}

/**
 * As estrelas que a play teve, com os mods dela.
 *
 * Sem mod de dificuldade o valor vem da API (é o mesmo que o site mostra e é
 * mais exato que o nosso); com mods é cálculo local. Quem decide é o
 * getAdjustedStars — aqui só cai no `difficulty_rating` quando ele não soube.
 */
async function stars(play, mode) {
  const ajustadas = await osu.getAdjustedStars(play.beatmap?.id, play.mods, mode);
  const bruto = parseFloat(ajustadas ?? play.beatmap?.difficulty_rating);
  return Number.isFinite(bruto) && bruto > 0 ? bruto.toFixed(2) : null;
}

/** `Artista - Título [Dificuldade]`, no tamanho que cabe num título de embed. */
function mapTitle(play, { stars: estrelas = null } = {}) {
  const artista = play.beatmapset?.artist ? `${play.beatmapset.artist} - ` : '';
  const sufixo  = estrelas ? ` [${estrelas}★]` : '';

  const nome = `${artista}${play.beatmapset?.title ?? '???'} [${play.beatmap?.version ?? '?'}]`;
  return truncate(nome, TITLE_MAX - sufixo.length) + sufixo;
}

/**
 * O que o rodapé conta sobre o MAPA, mais a duração que a linha de atributos
 * usa: status (ranked, loved, graveyard...), quem mapeou e o comprimento.
 *
 * Uma consulta só para os três. A API oficial manda tudo junto do score; os
 * servidores privados não mandam nada, e aí os valores vêm dos metadados do
 * mapa — que o enriquecimento do score costuma ter deixado em cache (ver
 * enrichBeatmapData). Mapa exclusivo de servidor privado não existe na API
 * oficial: os três voltam nulos e cada pedaço some da tela.
 */
async function mapMeta(play) {
  let status  = play.beatmap?.status ?? play.beatmapset?.status ?? null;
  let creator = play.beatmapset?.creator ?? null;
  let length  = play.beatmap?.total_length ?? null;

  if (!status || !creator || length === null) {
    const bm = await osu.getBeatmap(play.beatmap?.id);
    status  ??= bm?.status ?? null;
    creator ??= bm?.beatmapset?.creator ?? null;
    length  ??= Number.isFinite(bm?.total_length) ? bm.total_length : null;
  }

  // A API oficial manda o status em minúsculas ("graveyard"); no rodapé ele
  // abre a frase.
  return {
    status: status ? status.charAt(0).toUpperCase() + status.slice(1) : null,
    creator,
    length,
  };
}

/**
 * `02:00 • CS 4 AR 9.4 OD 9.6 HP 5 • 128 BPM` — o mapa como ele foi jogado.
 *
 * Tudo já ajustado pelos mods: com DT a duração encolhe, o BPM sobe e o AR/OD
 * mudam por uma conta que não é multiplicação (ver rosuWorkerThread.js). Os
 * atributos vêm do .osu; a duração, da API. Sem o arquivo do mapa a linha
 * inteira some — é ela que depende de mais coisas ao mesmo tempo.
 *
 * @param {object} play  score (ou mapa embrulhado como um) já enriquecido
 * @param {number|null} length duração em segundos, sem mods
 */
async function mapLine(play, { length = null } = {}) {
  const attrs = await osu.getMapAttrs(play.beatmap?.id, play.mods ?? []);
  if (!attrs) return null;

  // Minuto com dois dígitos ("02:00"), como o osu! escreve a duração — assim a
  // largura da linha não dança entre uma play e a seguinte.
  const segundos = length !== null ? Math.round(length / attrs.clockRate) : null;
  const duracao  = segundos === null
    ? null
    : `\`${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}\``;

  return join([
    duracao,
    `\`CS ${dec(attrs.cs)} AR ${dec(attrs.ar)} OD ${dec(attrs.od)} HP ${dec(attrs.hp)}\``,
    `\`${Math.round(attrs.bpm)} BPM\``,
  ]);
}

/**
 * `@47%` — até onde a play foi, quando ela não foi até o fim.
 *
 * Só aparece em play interrompida, e só quando dá para saber: o denominador é a
 * contagem de objetos do .osu e o numerador são os acertos reais. Faltando um
 * dos dois a marca some, em vez de virar um "@0%" que parece nota.
 */
function progress(play, objects) {
  if (play.passed !== false || !objects) return null;

  const h = play.statistics ?? {};
  const jogados = (h.count_300 ?? h.great ?? 0) + (h.count_100 ?? h.ok ?? 0)
                + (h.count_50 ?? h.meh ?? 0) + (h.count_miss ?? h.miss ?? 0);

  return jogados > 0 ? `@${Math.round((jogados / objects) * 100)}%` : null;
}

// ─── Molduras ─────────────────────────────────────────────────────────────────

/**
 * `pudim2: 4,821.30pp (#12 BR#3)` — quem jogou, em uma linha.
 *
 * Já era assim no /score e no /topplays, em duas cópias que discordavam no
 * separador de milhar (uma passava o idioma para o toLocaleString, a outra
 * não). O /recent dizia "Play recente de pudim2" e não mostrava pp nem rank
 * nenhum — a informação que o resto do embed toma como referência.
 */
function author(user, mode, s) {
  const stats = user.statistics ?? {};
  const pais  = user.country_code ?? null;

  const rank = stats.global_rank
    ? `#${stats.global_rank.toLocaleString(s.locale)}`
    : s.profile_unranked;

  // O rank regional é privado em conta restrita; o país sozinho continua valendo.
  const regional = (!user._private && stats.country_rank && pais)
    ? ` ${pais}#${stats.country_rank.toLocaleString(s.locale)}`
    : (pais ? ` ${pais}` : '');

  const pp = ppLegivel(stats.pp, s.locale);

  return {
    name:    `${user.username}: ${pp}pp (${rank}${regional})`,
    iconURL: pais ? `https://flagcdn.com/w20/${pais.toLowerCase()}.png` : undefined,
    url:     osu.getUserUrl(user.id, mode),
  };
}

/**
 * A play que ocupa o embed inteiro (/recent): o mapa está no título, então as
 * linhas falam só do que aconteceu nele.
 *
 *   {grade} @47% +NM • 1,234,567 • 81.48% • há 2 horas
 *   121.21/457.95pp • 55x/284x • ❌ 23
 *   { 148 / 18 / 0 / 23 }
 *   `02:00` • `CS 4 AR 9.4 OD 9.6 HP 5` • `128 BPM`
 *
 * @returns {Promise<{title: string, url: string, description: string,
 *                    color: number, thumbnail: string|undefined,
 *                    status: string|null, creator: string|null}>}
 *   o `status` e o `creator` saem junto porque quem monta o rodapé é o comando
 *   — a frase dele é traduzida, e o mapa é quem tem os dados.
 */
async function single(play, { mode, s }) {
  const [pp, estrelas, meta, attrs] = await Promise.all([
    ppText(play, mode),
    stars(play, mode),
    mapMeta(play),
    osu.getMapAttrs(play.beatmap?.id, play.mods ?? []),
  ]);

  const total = Number.isFinite(play.score) && play.score > 0
    ? play.score.toLocaleString(s.locale)
    : null;

  // Grade, progresso e mods andam juntos, sem o " • " entre eles: são o que a
  // play FOI, e o resto da linha são os números que ela rendeu.
  const identidade = [
    emojis.rankLabel(play.rank),
    progress(play, attrs?.objects),
    `**${formatMods(play.mods)}**`,
  ].filter(Boolean).join(' ');

  const linhas = [
    join([identidade, total, accuracy(play), timeAgo(play.created_at)]),
    join([pp, combo(play), misses(play)]),
    hits(play),
    await mapLine(play, { length: meta.length }),
  ];

  return {
    title:       mapTitle(play, { stars: estrelas }),
    url:         osu.getMapUrl(play.beatmap.id, play.beatmapset?.id, mode),
    description: linhas.filter(Boolean).join('\n'),
    color:       play.passed === false ? COLOR_FAIL : COLOR,
    // null e não undefined: o setThumbnail do discord.js aceita "sem imagem"
    // escrito assim, e recusa o valor ausente.
    thumbnail:   play.beatmapset?.covers?.list ?? null,
    status:      meta.status,
    creator:     meta.creator,
  };
}

/**
 * Uma play como item de lista (/topplays, /score).
 *
 *   **#1** [Artista - Título [Dif]](url) **+HDDT** [8.31★]
 *   {grade} • 727.27/800.00pp • 98.44% • 1234x/1500x • ❌ 1 • há 2 dias
 *   { 1000 / 20 / 0 / 1 }
 *
 * Sem `mapUrl` (o /score, onde as cinco linhas são do mesmo mapa) o título sai
 * da primeira linha e a grade toma o lugar dele, sem mudar nada nas outras
 * duas: o que muda entre os dois comandos é só o que identifica a play.
 *
 * O `autor` abre a linha dos números quando cada item é de uma PESSOA diferente
 * (o /topscores, que lista o servidor inteiro). No /topplays e no /score ele não
 * existe: lá as plays são todas do mesmo jogador, e repetir o nick dez vezes
 * seria ruído. Ele entra na linha dos números, e não no cabeçalho, para o mapa
 * continuar sendo a primeira coisa que se lê.
 *
 * @param {object} play
 * @param {object} opts
 * @param {string} opts.mode
 * @param {number} opts.index   posição na lista, começando em 1
 * @param {string} [opts.mapUrl] link do mapa, quando o título dele vai no bloco
 * @param {string} [opts.autor]  quem jogou, já em markdown pronto
 * @returns {Promise<string>}
 */
async function listItem(play, { mode, index, mapUrl = null, autor = null }) {
  const [pp, estrelas] = await Promise.all([ppText(play, mode), stars(play, mode)]);

  const grade    = emojis.rankLabel(play.rank);
  const modsTexto = `**${formatMods(play.mods)}**`;
  const sufixo   = estrelas ? ` [${estrelas}★]` : '';

  // O título é escapado AQUI, e não no mapTitle: o mesmo texto vai para o
  // setTitle() da play única, que é texto puro — escapar lá imprimiria as
  // contrabarras na tela sem proteger de nada (ver markdown.js).
  const cabecalho = mapUrl
    ? `**#${index}** [${md(mapTitle(play))}](${mapUrl}) ${modsTexto}${sufixo}`
    : `**#${index}** ${grade} ${modsTexto}${sufixo}`;

  const numeros = join([
    autor,
    mapUrl ? grade : null,
    pp,
    accuracy(play),
    combo(play),
    misses(play),
    timeAgo(play.created_at),
  ]);

  return `${cabecalho}\n${numeros}\n${hits(play)}`;
}

module.exports = {
  COLOR, COLOR_FAIL,
  author, single, listItem,
  mapTitle, mapLine, mapMeta,
  ppLegivel,
};
