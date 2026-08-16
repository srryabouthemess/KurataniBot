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

/** Acrônimos → bitmask. */
function modsToBits(mods) {
  return (mods ?? []).reduce((acc, mod) => acc | (MOD_BITS[mod] ?? 0), 0);
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
  return (mods ?? []).filter(mod => mod !== 'CL');
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
  return (mods ?? []).filter(mod => !COSMETIC_MODS.has(mod));
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
 * 1,3x e um a 1,5x colidiam na mesma chave, com números diferentes.
 *
 * @returns {string} ex.: 'CL,DT,HD'; string vazia quando não há mod nenhum
 */
function canonicalMods(mods) {
  return [...new Set(mods ?? [])].sort().join(',');
}

/**
 * Como os mods vão para a tela: `['DT','CL']` → `+DTCL`, lista vazia → `+NM`.
 *
 * `+NM` (NoMod) é como a comunidade escreve, e vale nos três idiomas — por isso
 * saiu do i18n. Antes cada comando montava esse texto por conta própria e os
 * quatro discordavam no caso vazio: o /recent dizia "No Mods", o /score também
 * (mas por uma chave de i18n), o /simulate dizia "Nenhum" e o /topplays não
 * mostrava nada.
 */
function formatMods(mods) {
  const list = mods ?? [];
  return list.length > 0 ? `+${list.join('')}` : '+NM';
}

module.exports = {
  MOD_BITS, KNOWN_MOD_TOKENS,
  decodeMods, parseModsString, parseModTokens, modsToBits, stripClassic,
  difficultyMods, formatMods, canonicalMods,
};
