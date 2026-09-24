/**
 * osu/banchoPyApi/scores.js
 * As plays: a lista crua de um jogador, o enriquecimento de uma página (detalhe
 * do score + mapa), os scores de um jogador num mapa e o top do servidor.
 */

const servers = require('../../servers');
const metrics = require('../../lib/metrics');
const { idSegment } = require('../../lib/urlSafe');
const { dedupe } = require('../../lib/inflight');
const { TtlCache } = require('../../lib/ttlCache');
const { PRIVATE_MODE, temShiina, webApiGet, banchoV1Get, banchoV2Get } = require('./http');
const { normalizeScorePrivate, mergeServerMap, nativeScore } = require('./normalize');
const { getServerMap } = require('./server');

// Busca detalhes completos de cada score via v2
/**
 * Detalhe de um score, guardado porque ele quase não muda.
 *
 * Este endpoint é o mais caro do bot em servidor privado: é UMA requisição POR
 * SCORE, cinco por página do /topplays e uma por play do /recent, e nada disso
 * era reaproveitado. Medido numa página de cinco: 294ms numa rodada, 843ms na
 * seguinte — de 25% a 75% do tempo total do comando.
 *
 * E o dado é quase imutável: acertos, combo, mods e data de um score que já
 * aconteceu não mudam mais. O TTL existe pelo que PODE mudar — o pp, quando
 * quem hospeda roda um recálculo em massa. Uma hora é o prazo de um número
 * ficar velho na tela; guardar para sempre não é possível por causa disso.
 *
 * Só o payload da v2 entra aqui, e não o score já normalizado: o lado v1 da
 * mescla muda conforme quem chama (o beatmapScores monta um sintético a partir
 * do mapa), então guardar o resultado pronto serviria a mescla de um no outro.
 */
const DETALHE_TTL_MS = 60 * 60_000;
const DETALHE_MAX    = 2000;
const _detalhes = new TtlCache({ ttlMs: DETALHE_TTL_MS, max: DETALHE_MAX });

async function scoreDetail(scoreId, mode) {
  const chave = `${mode}:${scoreId}`;

  const guardado = _detalhes.get(chave);
  metrics.cache('scoreDetalhe', guardado !== undefined);
  // `!== undefined` e não um truthy: a resposta vazia é um resultado legítimo
  // ("o servidor não sabe o detalhe deste score") e também merece ser guardada,
  // senão ela é repedida a cada exibição.
  if (guardado !== undefined) return guardado;

  // O dedupe cobre a corrida que o prefetch da paginação criou: quem clica em ▶️
  // antes de a próxima página terminar de ser aquecida pede os mesmos scores de
  // novo, e sem isto os dois pedidos saem (ver inflight.js).
  return dedupe(`bpscore:${chave}`, async () => {
    const res = await banchoV2Get(mode, `/scores/${idSegment(scoreId)}`);
    const detalhe = res?.data ?? null;
    _detalhes.set(chave, detalhe);
    return detalhe;
  });
}

/**
 * O mapa de um score, pelo id, com cache curto.
 *
 * Curto de propósito, e mais curto que o `getServerMapByMd5`: o `status` entra
 * aqui, e ele muda quando a staff rankeia um mapa. Meia hora de cache faria o
 * rodapé de um mapa recém-rankeado continuar dizendo "Loved".
 */
const MAPA_ID_TTL_MS = 10 * 60_000;
const MAPA_ID_MAX    = 500;
const _mapasPorId = new TtlCache({ ttlMs: MAPA_ID_TTL_MS, max: MAPA_ID_MAX });

async function mapaDoScore(mapId, mode) {
  if (!mapId) return null;
  const chave = `${mode}:${mapId}`;

  const guardado = _mapasPorId.get(chave);
  metrics.cache('mapaPorId', guardado !== undefined);
  if (guardado !== undefined) return guardado;

  return dedupe(`bpmapid:${chave}`, async () => {
    try {
      const mapa = await getServerMap(mapId, mode);
      _mapasPorId.set(chave, mapa);
      return mapa;
    } catch {
      // Falha não entra no cache: uma queda de rede deixaria o mapa "sem dados"
      // por dez minutos, mesmo cuidado do scoreDetail.
      return null;
    }
  });
}

/** Se ainda falta ao score algo que só o mapa responde. */
function precisaDoMapa(score) {
  return !score.beatmap?.max_combo
      || !score.beatmap?.difficulty_rating
      || !score.beatmap?.status;
}

async function enrichScores(v1Scores, mode = PRIVATE_MODE) {
  const coverBase = servers.get(mode).covers ?? null;

  return Promise.all(
    v1Scores.map(async (s) => {
      // Sem id não há o que buscar nem o que guardar — e uma chave
      // `${mode}:undefined` faria scores diferentes dividirem a mesma entrada.
      let score;
      if (s.score_id === undefined || s.score_id === null) {
        score = normalizeScorePrivate(s, null);
      } else {
        try {
          score = normalizeScorePrivate(s, await scoreDetail(s.score_id, mode));
        } catch {
          // Falha não entra no cache: uma queda de rede viraria "sem detalhe" por
          // uma hora, que é o mesmo cuidado que o rememberFCpp já toma no pp.js.
          score = normalizeScorePrivate(s, null);
        }
      }

      // O detalhe do score não traz nada do mapa. Buscá-lo aqui, e não deixar
      // para o enriquecimento pela API oficial, é o que faz um mapa custom
      // aparecer completo — lá ele é um 404.
      if (!precisaDoMapa(score)) return score;
      return mergeServerMap(score, await mapaDoScore(score.beatmap?.id, mode), coverBase);
    })
  );
}

/**
 * No bancho.py a busca é pelo HASH do mapa, não pelo id — a tabela de scores
 * guarda `map_md5`. Por isso o id vira hash antes (via /maps/{id}).
 */
async function privateBeatmapScores(userId, beatmapId, mode) {
  let map = null;
  try {
    map = await getServerMap(beatmapId, mode);
  } catch (error) {
    // 404 = mapa nunca foi submetido lá. Qualquer outra falha (rede, 5xx) sobe:
    // devolver "sem scores" nesse caso esconderia o erro de quem chamou.
    if (error?.response?.status !== 404) throw error;
  }
  if (!map?.md5) return [];

  const res = await banchoV2Get(mode, '/scores', {
    map_md5:   map.md5,
    user_id:   userId,
    mode:      servers.get(mode).gameMode,
    page_size: 100,
  });

  const raw = Array.isArray(res?.data) ? res.data : [];

  // status 0 é quit (o bancho.py guarda tentativa falha também). O endpoint
  // oficial só devolve play completa, então filtramos para os dois servidores
  // mostrarem a mesma coisa.
  return raw
    .filter(v2 => (v2.status ?? 0) > 0)
    .map(v2 => normalizeScorePrivate(
      { map_id: map.id, map_set_id: map.set_id, map_name: map.filename },
      v2
    ));
}

// ─── Melhores scores do servidor ─────────────────────────────────────────────

const TOP_PAGE_SIZE = 100;

/**
 * Teto da varredura, em páginas. Trinta são 3000 scores e 30 requisições no
 * pior caso — o Daycore inteiro cabe em 4.
 */
const TOP_MAX_PAGES = 30;

/**
 * As melhores plays do servidor inteiro, do maior pp para o menor.
 *
 * ── Por que é uma varredura, e não uma consulta ordenada ─────────────────────
 * O endpoint devolve a tabela na ordem de INSERÇÃO e não aceita ordenação:
 * `sort=pp` e `sort=pp_desc` foram testados e são silenciosamente ignorados —
 * o mesmo comportamento do FastAPI que já mordeu o `resolvePlayerId` com o
 * parâmetro `name`. A ordenação é nossa, e para ordenar é preciso ter tudo.
 *
 * `status=2` é o que torna isso viável: no bancho.py o 2 é "melhor score
 * daquele jogador naquele mapa" (0 falhou, 1 enviado sem ser o melhor). É
 * exatamente o conjunto que "melhores plays" quer dizer, e ele encolhe a
 * varredura de 20+ páginas para 4 no Daycore.
 *
 * ── Por que o teto RECUSA em vez de truncar ──────────────────────────────────
 * Sem ordenação do lado do servidor, uma varredura parcial não devolve uma
 * resposta incompleta: devolve uma resposta ERRADA. As primeiras 3000 linhas
 * por ordem de inserção não têm relação nenhuma com as 50 maiores por pp.
 *
 * Daí o `completo` voltar junto: num servidor grande demais o comando diz que
 * não sabe, em vez de exibir um pódio que não é o pódio. É a mesma escolha do
 * cache negativo do osuClient — falha visível é melhor que número errado com
 * cara de certo.
 *
 * Os scores voltam CRUS, como os do `bestScores`: quem exibe enriquece só a
 * página que vai mostrar.
 *
 * ── E voltam TODOS, sem corte ────────────────────────────────────────────────
 * Cortar aqui impediria quem chama de filtrar: tirar as plays de contas
 * marcadas (ver os grupos, abaixo) depois de um corte em 50 deixaria buracos no
 * pódio — 50 menos as escondidas, e não as 50 melhores que sobraram. A lista
 * inteira já está na memória de qualquer jeito, porque foi preciso lê-la toda
 * para ordenar.
 *
 * @returns {Promise<{scores: Array, completo: boolean}>}
 */
async function topScores(mode) {
  const modeNum = servers.get(mode).gameMode;
  const todos = [];
  let completo = false;

  for (let pagina = 1; pagina <= TOP_MAX_PAGES; pagina++) {
    const res = await banchoV2Get(mode, '/scores', {
      mode:      modeNum,
      status:    2,
      page_size: TOP_PAGE_SIZE,
      page:      pagina,
    });

    const lote = Array.isArray(res?.data) ? res.data : [];
    todos.push(...lote);

    // Página incompleta é o fim da tabela — inclusive a vazia.
    if (lote.length < TOP_PAGE_SIZE) { completo = true; break; }
  }

  if (!completo) return { scores: [], completo: false };

  return {
    scores: todos.sort((a, b) => Number(b.pp ?? 0) - Number(a.pp ?? 0)),
    completo: true,
  };
}

/**
 * As plays daquele jogador, do front-end quando existe e do bancho.py quando
 * não — os dois endpoints se chamam `get_player_scores` e aceitam os mesmos
 * parâmetros, mudando só o host e o formato da resposta (ver nativeScore).
 *
 * Cru de propósito: enriquecer as N buscadas de uma vez seria uma rajada de
 * requisições. Quem chama enriquece só a página que vai exibir.
 */
async function playerScores(userId, limit, scope, mode) {
  const params = { id: userId, mode: servers.get(mode).gameMode, scope, limit };

  if (!temShiina(mode)) {
    const res = await banchoV1Get(mode, 'get_player_scores', params);
    return (res?.scores ?? []).map(nativeScore);
  }

  const res = await webApiGet(mode, 'get_player_scores', params);
  return res.scores ?? [];
}

const bestScores   = (userId, limit, mode) => playerScores(userId, limit, 'best', mode);
const recentScores = (userId, limit, mode) => playerScores(userId, limit, 'recent', mode);

module.exports = {
  enrichScores,
  privateBeatmapScores,
  topScores,
  bestScores,
  recentScores,
};
