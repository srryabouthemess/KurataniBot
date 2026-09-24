/**
 * commands/osu/topif/logic.js
 * A conta do /topif: o modificador de mods digitado, a troca de mods em cada
 * play, a grade prata/ouro e o top reordenado. Pura — nada de Discord nem de rede.
 */

const { weightedPP } = require('../../../weightedPP');
const { parseModTokens, modAcronym, canonicalMods } = require('../../../mods');

/**
 * Texto digitado → o que fazer com os mods de cada play, no formato do Bathbot:
 *
 *   +HD    insere HD em toda play que não tiver
 *   +HDHR! substitui os mods de toda play por exatamente HD+HR
 *   -HD!   remove HD de quem tiver
 *
 * O "!" do `exclude` não é enfeite: sem ele, "-HD" seria um pedido ambíguo
 * (remover só o HD? qualquer coisa que não seja HD?) que o Bathbot também não
 * aceita. `null` é "não entendi" — igual ao `parseModFilter` do topFilter.js,
 * um mod desconhecido invalida o pedido inteiro em vez de ser ignorado.
 *
 * @returns {{type: 'insert'|'exact'|'exclude', mods: Array<string|object>}|null}
 */
function parseModAction(input) {
  const text = String(input ?? '').trim();
  const match = /^([+-])(.*?)(!)?$/.exec(text);
  if (!match) return null;

  const [, sign, body, bang] = match;
  const { mods, unknown } = parseModTokens(body);
  if (unknown.length > 0 || mods.length === 0) return null;

  if (sign === '+') return { type: bang ? 'exact' : 'insert', mods };
  if (!bang) return null;
  return { type: 'exclude', mods };
}

/**
 * Mods que se cancelam ao entrar juntos — só usado no `insert`, porque `exact`
 * substitui a lista inteira (quem digitou já escolheu a combinação) e
 * `exclude` só tira o que já está lá.
 *
 * Sem isto, `+DT` numa play de HT deixaria os dois mods juntos, que nenhum
 * motor de PP sabe interpretar — o mesmo raciocínio do `stripImpliedDT` em
 * mods.js, para o par que ali é implícito (DT+NC) e aqui é explícito.
 */
const INCOMPATIBLE = {
  EZ: ['HR'], HR: ['EZ'],
  DT: ['HT', 'NC'], NC: ['HT', 'DT'], HT: ['DT', 'NC'],
  SD: ['PF'], PF: ['SD'],
};

/** Aplica o modificador nos mods de UMA play. Pura — o cálculo de PP não mora aqui. */
function applyModAction(mods, action) {
  const list = mods ?? [];

  if (action.type === 'exact') return [...action.mods];

  if (action.type === 'exclude') {
    const alvo = new Set(action.mods.map(modAcronym));
    return list.filter(mod => !alvo.has(modAcronym(mod)));
  }

  // insert
  let result = [...list];
  for (const novo of action.mods) {
    const acr = modAcronym(novo);
    const incompativeis = INCOMPATIBLE[acr] ?? [];
    result = result.filter(mod => modAcronym(mod) !== acr && !incompativeis.includes(modAcronym(mod)));
    result.push(novo);
  }
  return result;
}

/**
 * A grade que a play já tinha, com o par ouro/prata trocado conforme HD/FL
 * passa a existir ou não nos mods novos.
 *
 * Não é um recálculo de grade completo — e não precisa ser. A letra (X, S, A,
 * B, C, D) só depende dos acertos e do combo, nenhum dos dois muda aqui; o
 * ÚNICO efeito que um mod tem sobre a grade é a versão prata de X e S quando
 * HD ou FL está presente. Fora desse par, a grade fica intocada.
 */
const SILVER_UPGRADE   = { X: 'XH', S: 'SH' };
const SILVER_DOWNGRADE = { XH: 'X', SH: 'S' };

function adjustGradeForMods(rank, mods) {
  const silver = (mods ?? []).some(mod => ['HD', 'FL'].includes(modAcronym(mod)));
  return silver ? (SILVER_UPGRADE[rank] ?? rank) : (SILVER_DOWNGRADE[rank] ?? rank);
}

/**
 * Reordena as top plays pelo pp que teriam com os mods modificados.
 *
 * Mesmo truque de offset do `/nochoke` e do `/whatif` — ver weightedPP.js.
 *
 * `changed` é decidido aqui, comparando a forma canônica dos mods, e não por
 * quem chama: uma play cujos mods novos caem no MESMO conjunto (`+HD` numa
 * play que já tem HD, ou só a ordem trocada) não é uma mudança de verdade, e
 * fica no pp real mesmo que `newPPs` traga algum valor para ela.
 *
 * @param {{pp: number, mods: Array}[]} plays        top plays JÁ ORDENADAS por pp (como a API devolve)
 * @param {Array<Array>} newModsList                  paralelo a `plays`: os mods depois do modificador
 * @param {(number|null)[]} newPPs                    paralelo a `plays`: o pp simulado, ou null quando não deu para calcular
 * @param {number} profilePP                          `user.statistics.pp`
 */
function buildTopIf(plays, newModsList, newPPs, profilePP) {
  const entries = plays.map((play, i) => {
    const mods    = newModsList[i];
    const changed = canonicalMods(mods) !== canonicalMods(play.mods);
    const pp      = changed && Number.isFinite(newPPs[i]) ? newPPs[i] : play.pp;
    return { play, mods, pp, changed, origIndex: i + 1 };
  });

  entries.sort((a, b) => b.pp - a.pp);

  const antes  = weightedPP(plays);
  const depois = weightedPP(entries);
  const base   = Number.isFinite(profilePP) ? profilePP : antes;
  const offset = base - antes;

  return {
    entries,
    totalAntes:  base,
    totalDepois: depois + offset,
    ganho:       depois - antes,
    alterados:   entries.filter(e => e.changed).length,
  };
}

module.exports = {
  parseModAction,
  applyModAction,
  adjustGradeForMods,
  buildTopIf,
};
