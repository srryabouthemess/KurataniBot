/**
 * mods.js
 * Tradução entre as três formas em que os mods aparecem.
 *
 *   bitmask   64            o que as APIs guardam
 *   acrônimos ['DT']        o que os comandos exibem e recebem
 *   texto     "dt hr"       o que a pessoa digita
 *
 * Vive fora do osuClient porque não tem nada de cliente HTTP: é usado tanto na
 * normalização de scores quanto no cálculo de PP, e os dois passaram a importar
 * daqui em vez de um do outro.
 */

// Bitmask do osu! stable. Serve para decodificar score e para alimentar as
// libs de cálculo, que usam o mesmo formato.
//
// O TD e o AP faltavam, e o efeito era mudo: bit que não está aqui some na
// decodificação, então um score de touch aparecia como `+NM` — o mod que mais
// explica um pp baixo era justamente o invisível. Nenhum dos dois quebra o
// motor: medido no lazer-calculator com um mapa sintético, ele aceita os dois
// acrônimos (e ignora em silêncio o que não conhece).
//
// O SV2 (536870912) ficou DE FORA, e não por esquecimento: o
// `parseModsString` corta dígitos e lê de dois em dois caracteres, então
// "SV2" é intocável por quem digita, e não há evidência de que os servidores
// que o bot consulta liguem esse bit. Entra no dia em que aparecer num score
// de verdade, junto do teste que o comprove.
const MOD_BITS = {
  NF: 1, EZ: 2, TD: 4, HD: 8, HR: 16, SD: 32,
  DT: 64, RX: 128, HT: 256, NC: 512, FL: 1024,
  SO: 4096, AP: 8192, PF: 16384,
};

const MOD_MAP = Object.fromEntries(
  Object.entries(MOD_BITS).map(([name, bit]) => [bit, name]),
);

// CL (Classic) não tem bit legado — é um mod só-lazer que sinaliza que o score
// foi jogado com a mecânica antiga (stable) de sliders. Não entra no bitmask,
// mas precisa ser reconhecido como token válido.
const KNOWN_MOD_TOKENS = new Set([...Object.keys(MOD_BITS), 'CL']);

// ─── A quarta forma: o mod com AJUSTE ─────────────────────────────────────────
//
// O acrônimo deixou de descrever a play. No lazer o DT carrega um
// `speed_change` que quem joga escolhe (1,05x a 2,00x, de 0,05 em 0,05), e a
// API oficial manda esse ajuste junto — `{acronym:'DT', settings:{speed_change:
// 1.4}}`. Um DT a 1,4x e um DT a 1,5x são o mesmo acrônimo e plays diferentes:
// medido no mapa sintético dos testes, 1.9129★ contra 2.0619★, e o pp de um FC
// vai de 83.15 a 94.87 — 12,4% de diferença cobrada em cima do acrônimo só.
//
// Por isso um "mod" aqui é `string` OU `{acronym, settings}`, e todas as funções
// deste arquivo leem as duas formas. A string continua sendo o caso comum: ela é
// o que sai do bitmask (bancho.py, Ripple) e do que a pessoa digita, e nenhum
// dos dois tem onde guardar ajuste.

/**
 * Os mods que mexem na velocidade, e o rate de cada um sem ajuste nenhum.
 *
 * O DC (Daycore) está aqui mesmo sem bit legado, pelo mesmo motivo do CL: ele
 * chega em score da API oficial, e fora desta tabela uma play desacelerada
 * mostraria o BPM e o AR do mapa em velocidade normal.
 */
const RATE_MODS = { DT: 1.5, NC: 1.5, HT: 0.75, DC: 0.75 };

/** O acrônimo, venha o mod como string ou como objeto com ajustes. */
const modAcronym = (mod) => (typeof mod === 'string' ? mod : mod?.acronym ?? '');

/**
 * Os ajustes que MUDAM alguma coisa, ou null quando não há nenhum.
 *
 * Um `speed_change` igual ao padrão do mod é jogado fora de propósito. A API não
 * manda o valor default, mas se um dia mandar — ou se alguém montar o mod na
 * mão — `DT` e `DT a 1,5x` são a mesma play, e precisam cair na mesma linha de
 * cache e imprimir o mesmo texto. Sem este corte, o mesmo cálculo ocuparia duas
 * entradas e a tela diria "+DT (1.5x)", que é ruído.
 */
function modSettings(mod) {
  if (typeof mod === 'string' || !mod?.settings) return null;

  const padrao = RATE_MODS[modAcronym(mod)];
  const entradas = Object.entries(mod.settings).filter(([chave, valor]) => {
    if (valor === null || valor === undefined) return false;
    if (chave === 'speed_change' && padrao !== undefined) return Number(valor) !== padrao;
    return true;
  });

  return entradas.length > 0 ? Object.fromEntries(entradas) : null;
}

/**
 * O rate que a play realmente teve, ou null quando nenhum mod mexe na
 * velocidade.
 *
 * Devolve o rate mesmo quando ele é o padrão do mod: quem pergunta é o rosu-pp
 * (ver getMapAttrs), que lê a velocidade do BITMASK e portanto não enxerga nem
 * o ajuste do DT nem o DC inteiro, que não tem bit.
 *
 * O primeiro mod de rate vence. No lazer só existe um por play; no bitmask do
 * stable o NC arrasta o DT junto, e os dois valem 1,5 — então a ordem não muda
 * resposta nenhuma.
 */
function clockRate(mods) {
  for (const mod of mods ?? []) {
    const padrao = RATE_MODS[modAcronym(mod)];
    if (padrao === undefined) continue;

    const ajuste = Number(mod?.settings?.speed_change);
    return Number.isFinite(ajuste) ? ajuste : padrao;
  }
  return null;
}

/** O rate só quando ele foge do padrão do mod — é o que a tela precisa dizer. */
function customRate(mods) {
  const rate = clockRate(mods);
  if (rate === null) return null;

  const mod = (mods ?? []).find(m => RATE_MODS[modAcronym(m)] !== undefined);
  return rate === RATE_MODS[modAcronym(mod)] ? null : rate;
}

/** Bitmask → acrônimos. */
function decodeMods(bits) {
  return Object.entries(MOD_MAP)
    .filter(([bit]) => Number(bits) & Number(bit))
    .map(([, name]) => name);
}

/**
 * Texto digitado → os mods reconhecidos E os que não foram.
 *
 * A lista de descartados existe porque "ignorar em silêncio" é a resposta certa
 * para UM dos dois usos e a errada para o outro. Ao ler um score, um token
 * estranho não pode fazer a play inteira falhar. Ao FILTRAR, ele muda o que a
 * pessoa pediu: `mods:XYHD` casava só o HD e devolvia uma lista que parecia
 * responder à pergunta feita (ver parseModFilter em topFilter.js).
 *
 * @returns {{mods: string[], unknown: string[]}}
 */
function parseModTokens(input) {
  const clean = String(input ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  const mods = [];
  const unknown = [];

  for (let i = 0; i < clean.length; i += 2) {
    const token = clean.slice(i, i + 2);
    if (!KNOWN_MOD_TOKENS.has(token)) unknown.push(token);
    else if (!mods.includes(token)) mods.push(token);
  }

  return { mods, unknown };
}

/**
 * Texto digitado → acrônimos válidos. Aceita "DT HR", "dthr", "hd,dt".
 * Token desconhecido é ignorado em silêncio: o comando não deve falhar porque
 * alguém escreveu um mod que não existe junto de outros que existem. Quem
 * precisa saber dos descartados chama o `parseModTokens`.
 */
function parseModsString(input) {
  return parseModTokens(input).mods;
}

/**
 * Acrônimos → bitmask.
 *
 * O ajuste de rate não cabe aqui, e não há como fazê-lo caber: um bit é um bit.
 * Quem precisa do rate junto do bitmask pede o `clockRate` separado — é o que o
 * caminho do rosu-pp faz (ver getMapAttrs em pp.js).
 */
function modsToBits(mods) {
  return (mods ?? []).reduce((acc, mod) => acc | (MOD_BITS[modAcronym(mod)] ?? 0), 0);
}

/**
 * A lista sem o CL, para decisões em que ele não deve pesar.
 *
 * O CL é exibido normalmente nos scores: ele é o que separa play de mecânica
 * clássica (stable, ou lazer com Classic) de play de lazer de verdade, e é essa
 * mesma distinção que o bot usa para escolher o algoritmo de PP.
 *
 * Mas ele não é mod de DIFICULDADE — não tem bit legado e não muda o mapa. Onde
 * a pergunta é "tem mod que altera a dificuldade?", ele precisa sair da conta:
 *
 *   - getAdjustedStars: com o CL contando, um score sem mod nenhum deixava de
 *     ser "sem mods" e o bot passava a calcular estrelas localmente em vez de
 *     usar o valor da API — 7.08★ no lugar dos 7.13★ que o site mostra.
 *   - /simulate: a simulação já é sempre stable, então digitar CL não muda
 *     nada, e ecoá-lo daria a entender que mudou.
 *
 * @returns {string[]} pode ser vazio, e aí quem chama decide o que fazer
 */
function stripClassic(mods) {
  return (mods ?? []).filter(mod => modAcronym(mod) !== 'CL');
}

/**
 * A lista sem o DT que o NC arrasta junto.
 *
 * No bitmask do stable o Nightcore NÃO substitui o Double Time: ele o
 * acompanha, então um score de NC chega com os dois bits (64|512 = 576) e o
 * `decodeMods` devolve `['DT','NC']` — fiel ao que o servidor gravou.
 *
 * Só que "fiel ao bitmask" e "o que o motor espera" deixaram de ser a mesma
 * coisa, e os dois motores querem coisas OPOSTAS. Medido sobre o mesmo mapa:
 *
 *   mods          lazer      akatsuki-pp
 *   DT            2.0619★    2.1217★
 *   NC            2.0619★    1.4613★   ← ignora o NC sozinho
 *   DT + NC       3.6362★    2.1217★   ← o lazer acelera DUAS vezes
 *
 * No lazer cada mod carrega o próprio ajuste de rate, então mandar os dois é
 * pedir dois aumentos. O akatsuki-pp é bitmask e lê a velocidade do bit do DT,
 * então tirar o DT ali apagaria o mod inteiro. Por isso o corte NÃO mora no
 * `decodeMods`: ele é aplicado na borda do motor que precisa dele (ver
 * `lazerMods` em pp.js), e o caminho do Relax continua recebendo os dois bits.
 *
 * O `formatMods` usa a mesma peça pelo motivo mais simples: `+DTNC` não é como
 * ninguém escreve nightcore.
 */
function stripImpliedDT(mods) {
  const list = mods ?? [];
  return list.some(mod => modAcronym(mod) === 'NC')
    ? list.filter(mod => modAcronym(mod) !== 'DT')
    : [...list];
}

/**
 * Mods que não mexem na dificuldade do mapa.
 *
 * A distinção importa por causa de quem pergunta: o `getAdjustedStars` usa a
 * estrela publicada pela API quando não há mod de dificuldade, porque ali ela é
 * o mesmo número — e sai de graça, sem baixar o .osu nem calcular nada.
 *
 * ── O HD saiu desta lista ─────────────────────────────────────────────────────
 * Ele estava aqui porque não mudava estrela nenhuma, e isso deixou de ser
 * verdade: o rework de 03/07/2026 trocou os bônus de AR e HD por uma skill de
 * READING, e agora o HD mexe no número. Medido no lazer-calculator, que bate
 * exato com o site: 7.806★ sem mods contra 8.239★ com HD no mesmo mapa, +5,5%.
 * Com ele aqui, todo `+HD` — que é das combinações mais comuns que existem —
 * exibiria a estrela SEM mods, que é o único valor que a API publica.
 *
 * O CL fica pelo motivo do `stripClassic`: ele diz a mecânica da play, e foi
 * conferido que não move a estrela (7.8058★ com e sem). Fora daqui ficam EZ, HR,
 * DT, NC, HT e FL, que mexem no mapa de verdade — e o RX, que muda o motor de
 * cálculo inteiro.
 *
 * O TD entra aqui, e o AP não: medido no lazer-calculator sobre o mesmo mapa,
 * TD dá 1.3952★ (idêntico a sem mods) e AP dá 0.9866★. O TD penaliza o pp sem
 * tocar na dificuldade; o AP tira uma dimensão do jogo inteira, como o RX.
 * Errar o lado é barato numa direção e caro na outra: um cosmético de fora só
 * gasta um cálculo para chegar ao mesmo número, mas um mod de dificuldade aqui
 * dentro faz o bot exibir a estrela SEM mods como se fosse a da play.
 */
const COSMETIC_MODS = new Set(['NF', 'SO', 'SD', 'PF', 'CL', 'TD']);

/**
 * Só os mods que alteram a dificuldade. Pode ser vazio, e aí quem chama decide
 * o que fazer — normalmente confiar no número que a API já publicou.
 */
function difficultyMods(mods) {
  return (mods ?? []).filter(mod => !COSMETIC_MODS.has(modAcronym(mod)));
}

/**
 * A forma canônica dos mods para servir de CHAVE de cache.
 *
 * Ordenada e sem repetição, porque `['DT','HD']` e `['HD','DT']` são o mesmo
 * conjunto e precisam cair na mesma linha do cache — a ordem em que os mods
 * chegam da API não é garantida, e sem isto o mesmo cálculo ocuparia duas
 * entradas e nenhuma das duas acertaria de forma confiável.
 *
 * Substituiu o bitmask nesse papel quando o cálculo passou para o
 * lazer-calculator. O bitmask não servia mais por duas razões: o CL não tem bit
 * (era uma coluna `lazer` à parte, ao lado da coluna de mods, para guardar um
 * mod que já é um mod), e nenhum bit tem onde guardar AJUSTE de mod — um DT a
 * 1,4x e um a 1,5x colidiam na mesma chave, com números diferentes.
 *
 * O ajuste entra na chave por causa dessa segunda razão, e é ele que faz a
 * promessa acima valer de verdade: `DT(speed_change=1.4)` e `DT` são duas
 * dificuldades e dois pp, e a `map_difficulty` não tem TTL — colidir ali é
 * gravar o número errado para sempre.
 *
 * As linhas antigas continuam certas e continuam sendo usadas: antes do ajuste
 * chegar aqui, um score de 1,4x era CALCULADO como 1,5x e gravado sob `DT`, que
 * é exatamente o valor do DT sem ajuste. O que muda é que o 1,4x deixa de
 * encontrar essa linha.
 *
 * @returns {string} ex.: 'CL,DT(speed_change=1.4),HD'; vazia quando não há mod
 */
function canonicalMods(mods) {
  const chaves = (mods ?? []).map((mod) => {
    const settings = modSettings(mod);
    if (!settings) return modAcronym(mod);

    // Ordenado para o mesmo conjunto de ajustes dar sempre a mesma chave: o
    // JSON da API não garante ordem de propriedade mais do que garante a de mod.
    const ajustes = Object.entries(settings)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([chave, valor]) => `${chave}=${valor}`)
      .join(';');

    return `${modAcronym(mod)}(${ajustes})`;
  });

  return [...new Set(chaves)].sort().join(',');
}

/**
 * Como os mods vão para a tela: `['DT','CL']` → `+DTCL`, lista vazia → `+NM`.
 *
 * `+NM` (NoMod) é como a comunidade escreve, e vale nos três idiomas — por isso
 * saiu do i18n. Antes cada comando montava esse texto por conta própria e os
 * quatro discordavam no caso vazio: o /recent dizia "No Mods", o /score também
 * (mas por uma chave de i18n), o /simulate dizia "Nenhum" e o /topplays não
 * mostrava nada.
 *
 * O rate ajustado sai FORA do bloco de acrônimos — `+HDDT (1.4x)` —, e não
 * grudado no mod. É como o próprio osu! escreve, e não teria outro jeito legível
 * de escrever: `+HDDT1.4` é lido como um mod chamado DT1. Só aparece quando a
 * velocidade foge do padrão do mod; um DT comum continua sendo `+DT`.
 */
function formatMods(mods) {
  // `+DTNC` é o bitmask do stable vazando para a tela: o NC sempre traz o DT
  // junto, e o osu! escreve isso como `+NC`.
  const list = stripImpliedDT(mods);
  if (list.length === 0) return '+NM';

  const rate = customRate(list);
  // O rate vem da API em passos de 0,05; o arredondamento é contra um
  // 1.4000000000000001 que a ponte com o .NET ou o JSON podem produzir.
  const ajuste = rate === null ? '' : ` (${Math.round(rate * 100) / 100}x)`;

  return `+${list.map(modAcronym).join('')}${ajuste}`;
}

module.exports = {
  MOD_BITS, KNOWN_MOD_TOKENS, RATE_MODS,
  decodeMods, parseModsString, parseModTokens, modsToBits, stripClassic,
  stripImpliedDT, difficultyMods, formatMods, canonicalMods,
  modAcronym, modSettings, clockRate, customRate,
};
