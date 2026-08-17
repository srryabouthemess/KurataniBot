/**
 * topFilter.js
 * Ordenar e filtrar uma lista de top plays antes de exibi-la.
 *
 * ── Por que não é um `.sort()` dentro do comando ──────────────────────────────
 * Porque a lista chega CRUA, e "cru" quer dizer coisas diferentes conforme o
 * servidor. O oficial e o Ripple normalizam dentro do próprio adaptador —
 * acurácia de 0 a 1 em `accuracy`, mods como acrônimos, data em `created_at`. O
 * bancho.py não: ele devolve o que o endpoint mandou (`acc` de 0 a 100, mods em
 * bitmask, data em `play_time`) e só normaliza no `enrichScores`, que o
 * /topplays chama por PÁGINA — cinco das cem.
 *
 * Ordenar depois de enriquecer acabaria com a diferença, e custaria uma
 * requisição por score em servidor privado: cem, para exibir cinco. Então quem
 * ordena precisa saber ler as duas formas — e isso mora aqui, num lugar só e com
 * teste, em vez de virar condicional espalhada pelo comando.
 *
 * ── Nada aqui adivinha ────────────────────────────────────────────────────────
 * Campo ausente vira `null`, e play com `null` vai para o FIM da lista, em
 * qualquer direção. A alternativa seria tratá-lo como zero, e aí um servidor que
 * não manda combo faria a ordenação por combo parecer que funcionou — todas as
 * plays empatadas em 0, na ordem em que já estavam.
 */

const { decodeMods, stripClassic, parseModTokens, modAcronym, modSettings } = require('./mods');

/** Os critérios de ordenação, na ordem em que aparecem para quem escolhe. */
const SORTS = ['pp', 'acc', 'combo', 'date', 'misses'];

// ─── Leitura das duas formas ──────────────────────────────────────────────────

/**
 * Número, ou `null` — e o teste explícito de ausência não é redundante.
 *
 * `Number(null)` é **0**, e `Number('')` também. Sem a primeira linha, um
 * `max_combo: null` (que é o que o bancho.py manda quando não sabe o combo)
 * viraria zero e entraria na ordenação como valor de verdade: a play iria para
 * o fim da lista por ter "combo baixo", em vez de sair da comparação por não ter
 * combo nenhum. É o único jeito de este módulo mentir sem que nada quebre.
 */
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const ppOf = (score) => num(score?.pp);

/**
 * Acurácia sempre de 0 a 100, venha ela de onde vier.
 *
 * `accuracy` (0–1) é a forma normalizada; `acc` (0–100) é a crua do bancho.py.
 * A escala não é detalhe: sem a conversão, uma lista com scores das duas formas
 * ordenaria todos os normalizados abaixo de qualquer play crua.
 */
function accOf(score) {
  const normalizada = num(score?.accuracy);
  if (normalizada !== null) return normalizada * 100;
  return num(score?.acc);
}

const comboOf = (score) => num(score?.max_combo);

/** Miss é o único que pode LEGITIMAMENTE não vir: play sem miss nenhum. */
function missesOf(score) {
  const stats = score?.statistics ?? {};
  return num(stats.count_miss ?? stats.miss ?? score?.nmiss);
}

/**
 * Quando a play foi jogada, em milissegundos.
 *
 * Mesmos três formatos que o `parsePlayTime` do adaptador de bancho.py já
 * trata (ISO, datetime de SQL, epoch em segundos) — com uma diferença de
 * propósito: lá o formato desconhecido vira "agora", porque um Invalid Date
 * estouraria mais adiante; aqui vira `null`. Para ordenar, "não sei quando foi"
 * não pode virar "foi agora", que jogaria a play para o topo da lista.
 */
function dateOf(score) {
  const raw = score?.created_at ?? score?.play_time;
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number' || /^\d+$/.test(String(raw))) return Number(raw) * 1000;

  const text = String(raw);
  const ms = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Os mods da play como acrônimos, venham eles como lista ou como bitmask. */
const modsOf = (score) =>
  (Array.isArray(score?.mods) ? score.mods : decodeMods(score?.mods ?? 0));

const KEYS = { pp: ppOf, acc: accOf, combo: comboOf, date: dateOf, misses: missesOf };

// ─── Filtro de mods ───────────────────────────────────────────────────────────

/**
 * Texto digitado → o filtro, ou `null` quando não dá para entender.
 *
 * O `null` importa. O `parseModsString` ignora token desconhecido de propósito
 * (um score não deve falhar porque alguém escreveu um mod que não existe), e
 * aqui esse silêncio seria o pior resultado possível: `mods:XY` viraria lista
 * vazia, a lista sairia inteira, e quem pediu leria isso como "nenhuma play
 * minha tem XY" — quando o certo é dizer que XY não é mod nenhum.
 *
 * Por isso é o `parseModTokens` que responde aqui, e não o `parseModsString`:
 * a rejeição precisa valer para a mistura também. Com o descarte silencioso,
 * `mods:XYHD` filtrava por HD e devolvia uma lista plausível — a resposta
 * parecia ser da pergunta feita, e nada na tela dizia que metade do que a
 * pessoa digitou tinha sido jogada fora. Um token estranho invalida o pedido
 * inteiro, que é o que "não entendi" quer dizer.
 *
 * @returns {{nomod: true}|{mods: Array<string|object>}|null}
 */
function parseModFilter(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;

  // "sem mods" é um pedido legítimo e não sai do parseModsString, que devolveria
  // lista vazia — a mesma coisa que "não filtre nada".
  if (/^(nm|nomod|no.?mod|none|nenhum)$/i.test(text)) return { nomod: true };

  const { mods, unknown } = parseModTokens(text);
  if (unknown.length > 0 || mods.length === 0) return null;
  return { mods };
}

/**
 * Se o token PARECE um pedido de mods, mesmo que inválido.
 *
 * Existe para a guarda do modo texto, que decide se um posicional é o `mods` ou
 * o nick de alguém. As duas perguntas são diferentes: a guarda quer saber a
 * INTENÇÃO ("isto ia ser um filtro de mods"), e o `parseModFilter` quer saber a
 * validade. Fossem a mesma, um `k!top mrekk XYHD` deixaria de ser reclamado
 * como mod inválido e viraria "argumentos demais" — que é a resposta certa para
 * outra pergunta.
 */
function pareceMods(input) {
  const text = String(input ?? '').trim();
  if (!text) return false;
  if (/^(nm|nomod|no.?mod|none|nenhum)$/i.test(text)) return true;
  return parseModTokens(text).mods.length > 0;
}

/**
 * A play passa pelo filtro?
 *
 * Pedir `HD` traz toda play que TEM o HD, com ou sem outros mods — é o que
 * "filtrar por mods" quer dizer quando alguém procura as próprias plays de DT.
 *
 * O CL sai da conta antes da comparação: ele marca a mecânica da play (stable ou
 * lazer clássico), não o que foi jogado, e vem em quase todo score de stable.
 * Sem tirá-lo, `mods:NM` não devolveria uma única play do Bancho.
 *
 * ── Rate ajustado ─────────────────────────────────────────────────────────────
 * `mods:DT` casa por ACRÔNIMO, e traz também as plays de DT a 1,4x — que chegam
 * como objeto (ver mods.js). Comparando o mod inteiro elas ficariam de fora, e
 * nada na tela diria isso: sai uma lista plausível e incompleta.
 *
 * `mods:DT1.4` é outra pergunta, e o filtro a responde: aí o rate faz parte do
 * pedido, e só as plays naquela velocidade passam. Ignorá-lo seria o descarte
 * silencioso que o parseModFilter existe para evitar, um degrau adiante.
 */
function matchesMods(score, filtro) {
  if (!filtro) return true;

  const doScore = stripClassic(modsOf(score));
  if (filtro.nomod) return doScore.length === 0;

  return filtro.mods.every((pedido) => {
    const acronimo = modAcronym(pedido);
    // O rate normalizado, e não o digitado: `dt1.5` é o mesmo pedido que `dt`,
    // porque 1,5x é o que o DT já é (ver modSettings).
    const rate = modSettings(pedido)?.speed_change;

    return doScore.some(mod => modAcronym(mod) === acronimo
      && (rate === undefined || modSettings(mod)?.speed_change === rate));
  });
}

// ─── Ordenação ────────────────────────────────────────────────────────────────

/** Do maior para o menor. Quem não tem valor não entra nesta comparação. */
const maiorPrimeiro = (a, b) => b - a;

/**
 * A lista pronta para a tela: filtrada, ordenada, e cada play sabendo de onde
 * veio.
 *
 * ── A posição é a do top ORIGINAL ────────────────────────────────────────────
 * `posicao` é o lugar da play na lista que o servidor mandou, e é o número que
 * o embed imprime. Renumerar de 1 a N depois de filtrar faria o `#1` de
 * `mods:HD` parecer a melhor play do jogador; ele é a melhor play COM HD, e
 * pode ser a #37. O número que interessa é sempre o mesmo: a posição no top 100.
 *
 * ── `pp` não reordena nada ────────────────────────────────────────────────────
 * A lista já chega ordenada por pp, e essa ordem é a do próprio servidor — é ela
 * que decide o peso de cada play no total ponderado. Reordenar por um `pp` que
 * pode vir nulo só criaria a chance de discordar da fonte no desempate.
 *
 * @param {Array} scores lista crua, na ordem em que o servidor mandou
 * @param {object} [opts]
 * @param {string} [opts.sort='pp']
 * @param {{nomod: true}|{mods: Array<string|object>}|null} [opts.mods=null]
 * @param {boolean} [opts.reverse=false]
 * @returns {Array<{score: object, posicao: number}>}
 */
function arrange(scores, { sort = 'pp', mods = null, reverse = false } = {}) {
  const comPosicao = (scores ?? []).map((score, i) => ({ score, posicao: i + 1 }));
  const filtrados  = comPosicao.filter(item => matchesMods(item.score, mods));

  const key = KEYS[sort];
  let ordenados = filtrados;
  let semValor  = [];

  if (key && sort !== 'pp') {
    // As sem valor saem da ordenação e voltam no fim, em vez de participarem
    // dela como zero ou como Infinity.
    const comValor = [];
    for (const item of filtrados) {
      const valor = key(item.score);
      if (valor === null) semValor.push(item);
      else comValor.push({ ...item, _key: valor });
    }

    comValor.sort((a, b) => maiorPrimeiro(a._key, b._key));
    ordenados = comValor.map(({ score, posicao }) => ({ score, posicao }));
  }

  if (reverse) ordenados = [...ordenados].reverse();

  // Depois do reverse, e não antes: "sem valor" fica no fim nas duas direções.
  // Invertido junto, o primeiro que a pessoa veria era um punhado de play sem o
  // dado pelo qual ela acabou de pedir para ordenar.
  return [...ordenados, ...semValor];
}

module.exports = {
  SORTS,
  arrange,
  parseModFilter,
  pareceMods,
  // Exportados para o teste: são as leituras que precisam valer para as duas
  // formas de score, e é onde uma diferença de escala passa despercebida.
  accOf, dateOf, modsOf, matchesMods,
};
