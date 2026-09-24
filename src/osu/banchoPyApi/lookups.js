/**
 * osu/banchoPyApi/lookups.js
 * As três perguntas pequenas que o resto faz o tempo todo: o id de um nome, o
 * mapa de um md5 e o nick de um id. Cada uma com o cache do tamanho do quanto
 * a resposta muda.
 */

const metrics = require('../../lib/metrics');
const { idSegment } = require('../../lib/urlSafe');
const { dedupe } = require('../../lib/inflight');
const { TtlCache } = require('../../lib/ttlCache');
const { PRIVATE_MODE, banchoV1Get, banchoV2Get } = require('./http');

// ─── Busca ID do jogador pelo nome (via api v2) ──────────────────────────────
async function resolvePlayerId(username, mode = PRIVATE_MODE) {
  // Pode chegar como número (ID vindo do link salvo) ou string (nome digitado
  // no comando). Normalizamos antes de qualquer operação de string — sem isso
  // um ID numérico estourava em `username.trim()`.
  const raw = String(username).trim();

  // /^\d+$/ em vez de !isNaN(): isNaN('   ') é false (Number('   ') === 0),
  // então uma string só de espaços virava silenciosamente o ID 0.
  if (/^\d+$/.test(raw)) return Number(raw);

  // Busca exata pelo nome. Usa a v1 do bancho porque o endpoint /players da
  // v2 NÃO aceita filtro por nome — os parâmetros dele são priv, country,
  // clan_id, clan_priv, preferred_mode, play_style e paginação. Passar `name`
  // ali é silenciosamente ignorado pelo FastAPI: a chamada devolvia a primeira
  // página de TODOS os jogadores, e o código caía no primeiro resultado
  // (`?? results[0]`) quando não achava correspondência.
  //
  // Isso funcionava por acidente enquanto o servidor coubesse numa página de
  // 50: qualquer nome inexistente resolvia para o primeiro usuário da tabela
  // (o BanchoBot, id 1), e a partir de 51 contas qualquer jogador fora da
  // primeira página resolveria para ele também — linkando ou consultando a
  // conta errada sem nenhum aviso.
  const res = await banchoV1Get(mode, 'get_player_info', { name: raw, scope: 'info' });
  return res?.player?.info?.id ?? null;
}

/**
 * Um beatmap pelo HASH, que é como a tabela de scores o referencia.
 *
 * Vai pela v1 (`get_map_info`) porque o `/v2/maps?md5=` **ignora o filtro**:
 * pedido um md5, ele devolveu a primeira página de 50 mapas, com outro hash no
 * primeiro item. É a armadilha do FastAPI outra vez — e aqui ela seria pior que
 * no `resolvePlayerId`, porque cada score sairia exibindo o mapa de outro.
 *
 * O cache é longo porque o que interessa aqui (artista, título, dificuldade,
 * estrelas, combo máximo) não muda depois de o mapa existir.
 */
const MAPA_TTL_MS = 6 * 60 * 60_000;
const MAPA_MAX    = 1000;
const _mapasPorMd5 = new TtlCache({ ttlMs: MAPA_TTL_MS, max: MAPA_MAX });

async function getServerMapByMd5(md5, mode = PRIVATE_MODE) {
  const chave = `${mode}:${md5}`;

  const guardado = _mapasPorMd5.get(chave);
  metrics.cache('mapaPorMd5', guardado !== undefined);
  if (guardado !== undefined) return guardado;

  return dedupe(`bpmap:${chave}`, async () => {
    const res = await banchoV1Get(mode, 'get_map_info', { md5 });
    const mapa = res?.map ?? null;
    _mapasPorMd5.set(chave, mapa);
    return mapa;
  });
}

/**
 * O nick de um jogador pelo id.
 *
 * Numa lista do servidor inteiro cada linha é de uma pessoa diferente, e o
 * score só traz o `userid`. Vai pelo `/players/{id}` (uma requisição) em vez do
 * `getUser` do osuClient, que faria três — perfil, stats e rank — para usar
 * um campo só.
 */
const NOME_TTL_MS = 30 * 60_000;
const NOME_MAX    = 500;
const _nomes = new TtlCache({ ttlMs: NOME_TTL_MS, max: NOME_MAX });

async function getServerPlayerName(playerId, mode = PRIVATE_MODE) {
  const chave = `${mode}:${playerId}`;

  const guardado = _nomes.get(chave);
  metrics.cache('nomeJogador', guardado !== undefined);
  if (guardado !== undefined) return guardado;

  return dedupe(`bpname:${chave}`, async () => {
    const res = await banchoV2Get(mode, `/players/${idSegment(playerId)}`);
    const nome = res?.data?.name ?? null;
    _nomes.set(chave, nome);
    return nome;
  });
}

module.exports = {
  resolvePlayerId,
  getServerMapByMd5,
  getServerPlayerName,
};
