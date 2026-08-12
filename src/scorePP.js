/**
 * scorePP.js
 * PP de um score calculado aqui, para quando o servidor não informa o valor.
 *
 * A API devolve `pp` nulo em alguns scores completos de mapa ranqueado — o caso
 * conhecido é play de lazer com CL, que ela não pontua. Exibir 0 nesses casos é
 * errado, e o valor dá para calcular a partir dos hits reais, pelo mesmo
 * caminho do /simulate.
 *
 * Vive fora dos comandos porque o /score e o /recent precisam do mesmo número —
 * e as duas cópias já tinham divergido no pior sentido possível: uma calculava,
 * a outra imprimia zero.
 *
 * Play INTERROMPIDA exige `partial: true`. Sem isso a conta assume que a pessoa
 * jogou o mapa inteiro: a lib inventa um 300 para cada objeto que ela nunca
 * chegou a ver, e avalia tudo contra a dificuldade do mapa completo — o que
 * torna o `combo` irrelevante e devolve praticamente o valor de um FC.
 *
 * Com `partial`, os 300s vão explícitos e o `passedObjects` diz até onde a play
 * foi, então a dificuldade passa a ser a do trecho jogado. Medido numa
 * desistência aos 120 de 1833 objetos: 332.6pp sem, 101.3pp com.
 */

const osu = require('./osuClient');

/**
 * O mapa paga pp? Só `ranked` e `approved` pagam — graveyard, wip, pending,
 * qualified e loved não.
 *
 * Mora aqui, e não dentro de um comando, porque o /recent e o /score exibem a
 * mesma informação e já tinham divergido uma vez: o /recent avisava que o valor
 * não conta para o perfil, o /score mostrava o número pelado.
 *
 * O status só vem da API oficial. No bancho.py o campo não existe, e aí
 * `undefined` é tratado como "paga": afirmar "não ranqueado" sem saber seria
 * pior do que não afirmar nada.
 */
const PAGA_PP = new Set(['ranked', 'approved']);
const mapAwardsPP = status => status == null || PAGA_PP.has(status);

/**
 * @param {object} score   score normalizado, com `beatmap.id` preenchido
 * @param {string} mode    chave do servidor (ver servers.js)
 * @param {object} [opts]
 * @param {boolean} [opts.partial=false] a play não foi até o fim
 * @returns {Promise<number|null>} null quando não dá para calcular
 */
async function localScorePP(score, mode, { partial = false } = {}) {
  const beatmapId = score?.beatmap?.id;
  if (!beatmapId) return null;

  const hits   = score.statistics ?? {};
  const n300   = hits.count_300  ?? hits.great ?? null;
  const n100   = hits.count_100  ?? hits.ok    ?? 0;
  const n50    = hits.count_50   ?? hits.meh   ?? 0;
  const misses = hits.count_miss ?? hits.miss  ?? 0;

  // Sem os 300s reais não dá para saber até onde a play foi, e aí o cálculo
  // parcial é impossível. Recusar é melhor do que devolver o valor cheio.
  if (partial && n300 === null) return null;

  const parcial = partial
    ? { n300, passedObjects: n300 + n100 + n50 + misses }
    : {};

  const result = await osu.simulatePP(
    beatmapId,
    score.mods ?? [],
    { ...parcial, n100, n50, misses, combo: score.max_combo ?? undefined },
    mode,
  );

  return result?.pp ?? null;
}

module.exports = { localScorePP, mapAwardsPP };
