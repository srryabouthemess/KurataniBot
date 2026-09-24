/**
 * daycoreAdmin/verify.js
 * A confirmação depois de publicar: relê o estado pelo servidor até ele bater
 * com o esperado ou a janela fechar.
 *
 * Toda chamada ao servidor passa por `osu.<função>`, pelo objeto do módulo, e
 * não por uma cópia desestruturada: os testes trocam essas funções no objeto
 * do osuClient para simular o servidor.
 */

const osu = require('../osuClient');
const { mapLimit } = require('../lib/concurrency');
const { Privileges, WIPED_SCORE_STATUS } = require('./constants');
const { hasPriv } = require('./privileges');

// ─── Verificação pós-publicação ───────────────────────────────────────────────
// Como o pub/sub não devolve resultado, relemos o estado pela API v2 para
// confirmar. O bancho processa em milissegundos, mas damos uma folga porque a
// ação envolve I/O (ele baixa o .osu se não tiver em disco).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Quanto tempo esperar o bancho terminar, em função do tamanho do set.
 *
 * O trabalho dele é proporcional ao número de dificuldades — baixa o .osu de
 * cada uma que não tem em disco —, então a janela fixa que servia para uma
 * dificuldade fechava cedo demais para um set grande. O `Hardtekk Jump
 * Training` (100 diffs) reportou 90/100, e a releitura seguinte mostrou
 * 100/100: nada tinha falhado, a janela é que era curta. O efeito prático era
 * a resposta chamar de "parcial" uma ação que deu certo inteira.
 *
 * O teto existe porque quem espera do outro lado é uma interação do Discord,
 * que expira — melhor reportar pendente do que não conseguir responder.
 */
const VERIFY_BASE_MS    = 4000;
const VERIFY_PER_MAP_MS = 900;
const VERIFY_MAX_MS     = 180000;

function verifyBudget(mapCount) {
  return Math.min(VERIFY_BASE_MS + mapCount * VERIFY_PER_MAP_MS, VERIFY_MAX_MS);
}

/**
 * Quantas releituras ao mesmo tempo.
 *
 * Alinhado ao balde `server:` do rate limiter, que é quem de fato limita a
 * vazão. Em série, cada dificuldade pagava o tempo de ida e volta sozinha, uma
 * depois da outra — num set de 100, isso é 100 viagens enfileiradas antes de a
 * primeira passada terminar.
 */
const VERIFY_CONCURRENCY = 5;

/**
 * Confirma que as dificuldades chegaram no status esperado.
 *
 * Repete até todas confirmarem ou a janela fechar, sempre com pelo menos uma
 * releitura — cada passada custa uma requisição por dificuldade ainda pendente,
 * e a lista encolhe conforme elas confirmam.
 *
 * @returns {Promise<{confirmed: number[], pending: number[]}>}
 */

async function verifyMapStatus(beatmapIds, expectedStatus, { delayMs = 1200, budgetMs } = {}) {
  let pending = [...beatmapIds];
  const confirmed = [];
  const deadline = Date.now() + (budgetMs ?? verifyBudget(pending.length));

  do {
    await sleep(delayMs);

    // O erro é tratado DENTRO do fn de propósito: um mapa que some da API é
    // "ainda não confirmou", não motivo para abandonar a verificação dos outros.
    const confirmou = await mapLimit(pending, VERIFY_CONCURRENCY, async (id) => {
      try {
        const map = await osu.getServerMap(id);
        return Boolean(map) && Number(map.status) === Number(expectedStatus);
      } catch {
        return false;
      }
    });

    const still = [];
    pending.forEach((id, i) => (confirmou[i] ? confirmed.push(id) : still.push(id)));
    pending = still;
  } while (pending.length > 0 && Date.now() < deadline);

  return { confirmed, pending };
}

/**
 * Confirma se o jogador ficou (ou deixou de estar) restrito.
 *
 * Aqui a janela continua fixa, e não escalonada como a de mapa: o alvo é sempre
 * um só, e restringir é uma escrita no banco do bancho — não tem download pelo
 * meio para fazer o tempo depender do tamanho de nada.
 */
async function verifyRestricted(osuId, expectRestricted, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const player = await osu.getServerPlayerRaw(osuId);
      if (player) {
        const restricted = !hasPriv(player.priv, Privileges.UNRESTRICTED);
        if (restricted === expectRestricted) return true;
      }
    } catch {
      // tenta de novo
    }
  }
  return false;
}

/**
 * Confirma que o wipe pegou: pp e plays zerados naquele modo.
 *
 * Mesma necessidade das outras verificações — pub/sub não devolve resultado —,
 * mas aqui ela pesa mais: sem confirmação, um comando destrutivo que falhou em
 * silêncio deixaria quem rodou achando que o serviço foi feito.
 */
async function verifyWiped(osuId, modeNum, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const stats = await osu.getServerPlayerStats(osuId, modeNum);
      if (stats && Number(stats.pp) === 0 && Number(stats.plays) === 0) return true;
    } catch {
      // tenta de novo
    }
  }
  return false;
}

/**
 * Confirma que o score saiu: o `status` dele passou a ser o de score apagado.
 *
 * Mesma necessidade das outras verificações — pub/sub não devolve resultado.
 * Aqui a leitura é mais direta que a do `verifyWiped`: o wipe de um score não
 * zera nada visível no perfil (o pp cai, mas para um número que ninguém sabe de
 * antemão), então o que se confere é o estado do próprio score.
 */
async function verifyScoreWiped(scoreId, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const score = await osu.getServerScore(scoreId);
      if (score && Number(score.status) === WIPED_SCORE_STATUS) return true;
    } catch {
      // tenta de novo
    }
  }
  return false;
}

/**
 * Confirma que o lote foi: nenhuma play do jogador naquele mapa e modo sobrou
 * acima do status de apagado.
 *
 * Mesma janela do `verifyScoreWiped` — pub/sub não devolve resultado, e o que
 * se confere é o estado que o servidor deixou. Lista vazia passa: nada acima de
 * -1 é exatamente o que se pediu.
 *
 * Fail-closed como o `verifyScoreWiped`, e é por isso que o `null` importa: o
 * `getServerPlayerMapScores` o devolve quando NÃO houve leitura (404 ou 422 do
 * `banchoV1Get`, que não lança). Enquanto ele virava `[]`, o `.every()` era
 * verdadeiro por vacuidade e o embed saía VERDE — "nenhuma play dele sobrou
 * neste mapa" — sem que uma linha tivesse sido lida.
 */
async function verifyMapScoresWiped(playerId, md5, modeNum, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const linhas = await osu.getServerPlayerMapScores(playerId, md5, modeNum);
      // `null` é "não li", e não "não sobrou nada": tenta de novo, e se a janela
      // acabar assim o resultado é não confirmado.
      if (Array.isArray(linhas) && linhas.every(row => Number(row.status) < 0)) return true;
    } catch {
      // tenta de novo
    }
  }
  return false;
}

/**
 * Confirma que o bit ficou (ou deixou de estar) ligado.
 *
 * Janela fixa, como a do verifyRestricted e ao contrário da de mapa: o alvo é
 * sempre um só, e o `add_privs` do bancho é um UPDATE na tabela `users` — não
 * há download pelo meio para fazer o tempo depender do tamanho de nada.
 */
async function verifyPriv(osuId, bit, expectPresent, { attempts = 3, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const player = await osu.getServerPlayerRaw(osuId);
      if (player && hasPriv(player.priv, bit) === expectPresent) return true;
    } catch {
      // tenta de novo
    }
  }
  return false;
}

module.exports = {
  verifyBudget,
  verifyMapStatus,
  verifyRestricted,
  verifyWiped,
  verifyScoreWiped,
  verifyMapScoresWiped,
  verifyPriv,
};
