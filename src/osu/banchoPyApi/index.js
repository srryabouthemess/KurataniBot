/**
 * osu/banchoPyApi/index.js
 * Adaptador para servidores bancho.py.
 *
 * Implementa o mesmo contrato do osu/officialApi.js — `fetchUser`,
 * `bestScores`, `recentScores`, `beatmapScores`, `userUrl`, `mapUrl` — para o
 * osuClient poder escolher um ou outro sem saber a diferença.
 *
 * ATENÇÃO: "bancho.py" aqui quer dizer a stack completa. As top plays vêm de
 * `get_player_scores`, que é da Shiina-Web (o front-end) e não do bancho.py —
 * por isso `webApi` e `banchoV1/V2` são endereços separados no registro: um
 * servidor com outro front responde o resto e falha nessa.
 *
 * O rank global também saía de lá, do `get_rank_cache`, e deixou de sair: ele
 * não existe fora da Shiina-Web e não traz o rank do país. As duas posições vêm
 * da v1 do bancho.py-ex, que todo servidor desses tem (ver fetchUser).
 *
 * ── Como está dividido ────────────────────────────────────────────────────────
 *   http.js       as três portas de rede (Shiina-Web, v1, v2)
 *   normalize.js  resposta do servidor → formato da API oficial (puro)
 *   server.js     leituras cruas, sem cache, para os comandos administrativos
 *   lookups.js    id por nome, mapa por md5, nick por id (com cache)
 *   scores.js     plays do jogador, enriquecimento, scores num mapa, top
 *   groups.js     os selos de grupo da Shiina-Web
 *   players.js    perfil e ranking
 *
 * O contrato é o mesmo de antes: tudo sai daqui, com os mesmos nomes.
 */

const servers = require('../../servers');
const { temShiina } = require('./http');
const normalize = require('./normalize');
const server = require('./server');
const lookups = require('./lookups');
const scores = require('./scores');
const groups = require('./groups');
const players = require('./players');

const { fetchUser, leaderboard } = players;
const { bestScores, recentScores, privateBeatmapScores, topScores, enrichScores } = scores;
const { getServerPlayerGroups, parseGroups } = groups;
const { parsePlayTime, normalizeRankingEntry, nativeScore, mergeServerMap, normalizeServerScore } = normalize;
const { resolvePlayerId, getServerMapByMd5, getServerPlayerName } = lookups;
const {
  getServerPlayerRaw, getServerPlayerStats, getServerScore, getServerPlayerScores,
  getServerPlayerMapScores, getServerProfilePage, getServerMap, getServerMapsBySet,
} = server;

const userUrl = (userId, mode) => `${servers.get(mode).webUrl}/u/${userId}`;
const mapUrl  = (mapId, _setId, mode) => `${servers.get(mode).webUrl}/b/${mapId}`;

module.exports = {
  fetchUser,
  bestScores,
  recentScores,
  beatmapScores: privateBeatmapScores,
  leaderboard,
  // Parte do contrato só neste adaptador: o osu! oficial não tem endpoint de
  // "melhores scores do servidor", e o Ripple exige um mapa (`md5|b`). O
  // osuClient trata o método ausente como "este servidor não sabe responder".
  topScores,
  // Idem: grupo é coisa do front-end Shiina-Web, e nem todo servidor tem.
  playerGroups: getServerPlayerGroups,
  // Diferente dos outros dois, esta capacidade não se decide pelo TIPO do
  // servidor: entre os bancho.py, uns têm Shiina-Web e outros não. Por isso o
  // adaptador expõe o método e, junto, quem responde por servidor.
  hasPlayerGroups: temShiina,
  userUrl,
  mapUrl,

  // Exportado para o teste: é a normalização que já derrubou uma página
  // inteira por causa do formato de um campo.
  parsePlayTime,
  // Idem para a linha do ranking, que troca o nome de todos os campos.
  normalizeRankingEntry,
  // E para o recorte dos grupos, que sai de HTML indentado — o tipo de coisa
  // que passa a devolver zero sem ninguém perceber.
  parseGroups,
  // E para a tradução do score nativo, cujo estrago seria mudo: os campos que
  // ela erra não estouram, só chegam vazios no embed.
  nativeScore,

  // Específicos deste tipo de servidor, usados pelos comandos administrativos.
  enrichScores,
  mergeServerMap,
  resolvePlayerId,
  getServerMapByMd5,
  getServerPlayerName,
  normalizeServerScore,
  getServerPlayerRaw,
  getServerPlayerStats,
  getServerScore,
  getServerPlayerScores,
  getServerPlayerMapScores,
  getServerProfilePage,
  getServerMap,
  getServerMapsBySet,
};
