/**
 * akatsukiWorkerThread.js
 * O corpo do worker thread que calcula PP e estrelas pelo akatsuki-pp.
 * **Não importe este arquivo do processo principal** — ele só faz sentido dentro
 * de um Worker.
 *
 * ── Qual akatsuki-pp ──────────────────────────────────────────────────────────
 * O build vem no `workerData.pacote` (ver engines.js). Os dois são o binding de
 * `vendor/akatsuki-pp-js` compilado contra o osuAkatsuki/akatsuki-pp-rs, cada um
 * no commit que o servidor roda (ver docs/OPCIONAIS.md para refazer):
 *
 *   akatsuki-pp-akatsuki → o do performance-service do Akatsuki, vanilla e Relax
 *   akatsuki-pp-daycore  → o do akatsuki-rx-py do bancho.py do Daycore, Relax
 *
 * O binding reproduz a escolha do servidor: Relax no osu!std sai do
 * `osu_2019::OsuPP`, o resto do cálculo genérico com `lazer(false)`.
 *
 * ── Hits ou accuracy ──────────────────────────────────────────────────────────
 * Os dois servidores rodam o mesmo motor mas o alimentam diferente, e o número
 * muda com isso. O score-service do Akatsuki pede o PP com accuracy + misses,
 * sem os hits: o motor redistribui 100s e 50s pela própria conta, e é ESSE o pp
 * que vai para o perfil. Medido em 200 top plays de RX e 150 de vanilla, com os
 * hits dá até 29pp de diferença; com a accuracy, todas batem no centésimo. O
 * bancho.py do Daycore passa os hits, e com eles 255 de 256 batem.
 * Quem escolhe é o motor (`viaAcc`, ver engines.js).
 */

const { servir } = require('./wasmThread');

// Preenchido pelo servir() com o build do workerData.pacote.
let akatsuki = null;

const DT = 1 << 6;
const NC = 1 << 9;

/**
 * O akatsuki-pp lê a velocidade só do bit do DT: um NC sozinho sai na velocidade
 * normal (medido: 463.96pp contra 1441.93pp com o DT junto). O stable sempre
 * manda os dois, e o bancho.py do Daycore acrescenta o DT de todo jeito; aqui
 * vale o mesmo, para o NC digitado no /simulate não calcular outro mapa.
 */
const comDT = (mods) => ((mods & NC) ? mods | DT : mods);

/** Accuracy (0–100) do osu!std, a mesma conta do score-service do Akatsuki. */
function accuracy(n300, n100, n50, misses) {
  const total = n300 + n100 + n50 + misses;
  if (total === 0) return 0;
  return (100 * (n300 * 300 + n100 * 100 + n50 * 50)) / (total * 300);
}

/**
 * Chama o motor e devolve só números — o resultado não atravessa a thread de
 * outro jeito.
 *
 * Sem `n300`, o motor deduz: tudo que não foi 100, 50 ou miss é 300. Pela
 * accuracy a dedução tem de ser feita aqui, porque ela precisa do total.
 */
function performance(beatmap, { mods, n300, n100, n50, misses, combo, viaAcc }) {
  const n100v = n100 ?? 0;
  const n50v = n50 ?? 0;
  const missesv = misses ?? 0;
  const comboV = combo != null && combo >= 0 ? combo : undefined;

  let resultado;
  if (viaAcc) {
    const n300v = n300 ?? Math.max(0, beatmap.nObjects - n100v - n50v - missesv);
    resultado = akatsuki.performance(
      beatmap, comDT(mods), undefined, undefined, undefined, missesv, comboV,
      accuracy(n300v, n100v, n50v, missesv),
    );
  } else {
    resultado = akatsuki.performance(
      beatmap, comDT(mods), n300 ?? undefined, n100 ?? undefined, n50 ?? undefined,
      missesv, comboV, undefined,
    );
  }

  const [pp, stars, maxCombo] = resultado;
  return { pp, stars, maxCombo };
}

// ─── Operações ────────────────────────────────────────────────────────────────

/** Estrela e combo máximo: não dependem da play, então vão sem hit nenhum. */
function difficulty(beatmap, { mods }) {
  const { stars, maxCombo } = performance(beatmap, { mods, viaAcc: false });
  return { stars, maxCombo };
}

/** PP de um FC hipotético: os misses viram 300 e o combo é o máximo do mapa. */
function fc(beatmap, { mods, n300, n100, n50, misses, viaAcc }) {
  const { pp } = performance(beatmap, {
    mods,
    n300: n300 == null ? null : n300 + (misses ?? 0),
    n100, n50,
    misses: 0,
    viaAcc,
  });
  return { pp };
}

/** PP de um score hipotético ou já jogado. Combo negativo é "não sei": FC. */
function simulate(beatmap, args) {
  return performance(beatmap, args);
}

servir((lib) => {
  akatsuki = lib;
  return { difficulty, fc, simulate };
});
