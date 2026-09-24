/**
 * osu/banchoPyApi/server.js
 * Leituras cruas do servidor, sem normalização e sem cache: o formato que a
 * tabela guarda é justamente o que os comandos administrativos precisam ver.
 */

const axios = require('axios');
const servers = require('../../servers');
const rateLimiter = require('../../rateLimiter');
const { idSegment } = require('../../lib/urlSafe');
const { PRIVATE_MODE, banchoV1Get, banchoV2Get } = require('./http');

// ─── bancho.py: leitura para ações administrativas ────────────────────────────
// A API v2 do bancho.py-ex é somente leitura, então ela serve para *consultar*
// o estado (privilégios de quem mandou o comando, status atual de um mapa) —
// as escritas vão por outro caminho, via Redis pub/sub (ver daycoreAdmin.js).

/**
 * Dados crus do jogador no servidor, incluindo o bitfield `priv` — é ele que
 * diz se a pessoa é NOMINATOR/ADMINISTRATOR lá, e não no Discord.
 */
async function getServerPlayerRaw(playerId, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, `/players/${idSegment(playerId)}`);
  return res?.data ?? null;
}

/**
 * A página pública de perfil, em HTML.
 *
 * Existe porque o `userpage_content` da API v2 **não** é onde o texto do perfil
 * acaba parando. O bancho declara e seleciona a coluna (`READ_PARAMS` em
 * app/repositories/users.py), mas quem grava o userpage é o front-end
 * Shiina-Web, e ele guarda em outro lugar da mesma base — medido: perfil com
 * texto salvo e visível no site, e a API devolvendo `null` para o mesmo jogador.
 *
 * A página renderizada é a fonte que reflete o que a pessoa realmente salvou.
 * Procurar uma string de alta entropia dentro dela é robusto: não depende de
 * classe de CSS nem de estrutura, só de o texto estar lá.
 */
async function getServerProfilePage(playerId, mode = PRIVATE_MODE) {
  const server = servers.get(mode);
  await rateLimiter.acquire(`server:${server.namespace}`);

  const res = await axios.get(`${server.webUrl}/u/${idSegment(playerId)}`, {
    timeout: 12000,
    // Sem isto o axios tenta interpretar a resposta, e o que se quer é o texto.
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  return typeof res.data === 'string' ? res.data : String(res.data ?? '');
}

/**
 * Estatísticas cruas de um jogador NUM modo: pp, plays, acc, tscore, combo.
 *
 * Existe para o /wipe: é o que permite mostrar o tamanho do estrago antes de
 * causá-lo, e registrar no log o que foi destruído. Depois do wipe esses
 * números não existem mais em lugar nenhum — o log do bot vira o único
 * registro de que existiram.
 */
async function getServerPlayerStats(playerId, modeNum, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, `/players/${idSegment(playerId)}/stats/${idSegment(modeNum)}`);
  return res?.data ?? null;
}

/**
 * UM score pelo id, cru como a tabela guarda — inclusive o `status`.
 *
 * Existe para o /scorewipe, e o campo que importa é o `status`: é por ele que o
 * comando confere que o score existe e é do jogador que o staff digitou, e é
 * ele que a confirmação relê depois para dizer se o wipe pegou (o `wipe_score`
 * do bancho estaciona o score apagado em -1, em vez de apagar a linha).
 *
 * Levanta em 404, como o `getServerMap` — score que não existe é resposta, e
 * quem chama trata.
 */
async function getServerScore(scoreId, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, `/scores/${idSegment(scoreId)}`);
  return res?.data ?? null;
}

/**
 * Os scores de um jogador num modo, COM o id de cada um.
 *
 * Existe porque o id do score não sobrevive à normalização que o resto do bot
 * usa (ver `normalizeScorePrivate`): os embeds nunca precisaram dele. O
 * /scorewipe precisa — é o que ele publica —, então aqui a linha vem crua.
 *
 * Vai pela v1 e não pela v2 por causa da ORDENAÇÃO: o `/v2/scores` devolve na
 * ordem da tabela e obrigaria a puxar tudo do jogador para achar as dez
 * maiores; o `get_player_scores` ordena no banco (pp para `best`, data para
 * `recent`) e corta no `limit`.
 *
 * Cada linha já traz o mapa aninhado em `beatmap`, então listar não custa uma
 * requisição por score.
 */
async function getServerPlayerScores(playerId, modeNum, scope = 'best', limit = 10, mode = PRIVATE_MODE) {
  const res = await banchoV1Get(mode, 'get_player_scores', {
    id:    playerId,
    mode:  modeNum,
    scope,
    limit,
  });

  return Array.isArray(res?.scores) ? res.scores : [];
}

/**
 * Todas as plays de um jogador num mapa, apagadas incluídas.
 *
 * O `getServerPlayerScores` é por modo e não alcança "as deste mapa"; a
 * leaderboard do mapa traz um score por jogador. Nenhum dos dois responde a
 * pergunta que o wipe de mapa faz.
 *
 * Sem cache de propósito: é leitura de confirmação de ação destrutiva, e um
 * valor de meio minuto atrás responderia a pergunta errada.
 *
 * Devolve `null`, e não `[]`, quando não houve leitura: o `banchoV1Get` trata
 * 404 e 422 como respostas normais e devolve `null` sem lançar (restart do
 * servidor, 404 transitório de proxy, md5 que não tem os 32 caracteres que o
 * endpoint valida). Achatar isso em lista vazia faria "não consegui ler" e
 * "não há play nenhuma" chegarem iguais em quem chama — e o
 * `verifyMapScoresWiped` daria verde por vacuidade, confirmando um lote que
 * ninguém conferiu. Cada chamador decide: a tela que só OFERECE o botão
 * trata `null` como zero plays; a verificação trata como "não confirmei".
 */
async function getServerPlayerMapScores(playerId, md5, modeNum, mode = PRIVATE_MODE) {
  const res = await banchoV1Get(mode, 'get_player_map_scores', {
    id:   playerId,
    md5,
    mode: modeNum,
  });

  return Array.isArray(res?.scores) ? res.scores : null;
}

/** Um beatmap (dificuldade única) pelo ID. */
async function getServerMap(mapId, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, `/maps/${idSegment(mapId)}`);
  return res?.data ?? null;
}

/**
 * Todas as dificuldades de um beatmapset.
 * Necessário porque o canal `rank` do bancho age sobre UMA dificuldade por
 * mensagem — para rankear o set inteiro é preciso publicar uma vez por diff.
 */
async function getServerMapsBySet(setId, mode = PRIVATE_MODE) {
  const res = await banchoV2Get(mode, '/maps', { set_id: setId, page_size: 100 });
  const data = res?.data;
  return Array.isArray(data) ? data : [];
}

module.exports = {
  getServerPlayerRaw,
  getServerProfilePage,
  getServerPlayerStats,
  getServerScore,
  getServerPlayerScores,
  getServerPlayerMapScores,
  getServerMap,
  getServerMapsBySet,
};
