/**
 * commands/admin/nominate/set.js
 * O set que se nomeia e a aplicação do status nele: de onde sai a lista de
 * dificuldades, e o publish + releitura de cada uma.
 */

const osu = require('../../../osuClient');
const daycore = require('../../../daycoreAdmin');
const { truncate } = require('./messages');

/**
 * `getServerMap` levanta em 404, e aqui isso é resposta, não falha: quer dizer
 * que o servidor não conhece o mapa — justamente o caso que o fallback trata.
 *
 * Qualquer outro erro (rede, 5xx) precisa subir. Tratá-lo como "não conhece"
 * mandaria o fluxo para a API oficial e publicaríamos num servidor que não
 * conseguimos nem reler para confirmar o efeito.
 */
async function serverMap(mapId) {
  try {
    return await osu.getServerMap(mapId);
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

/**
 * Dificuldades de um set, do servidor administrado ou — se ele ainda não
 * conhecer o mapa — da API oficial do osu!.
 *
 * O fallback existe porque o bancho é menos exigente do que o bot era: ao
 * receber um publish no canal `rank` ele chama `Beatmap.from_bid`, que busca na
 * API oficial e cacheia o set inteiro quando não tem o mapa no banco. Recusar
 * aqui negava uma nomeação que o servidor daria conta de aplicar — e esse é o
 * caso comum do mapa novo, que ninguém no servidor jogou ainda.
 *
 * @returns {Promise<{setId: number, diffs: object[], onServer: boolean} | {error: 'not_found'}>}
 */
async function diffsForSet(setId) {
  const onServer = await osu.getServerMapsBySet(setId);
  if (onServer.length > 0) return { setId, diffs: onServer, onServer: true };

  // Falha da API oficial vira "não encontrei" em vez de subir: o efeito é
  // recusar a nomeação, e recusar é o lado seguro — o outro seria publicar sem
  // saber a lista de dificuldades.
  const official = await osu.getOfficialMapsBySet(setId).catch(() => []);
  if (official.length > 0) return { setId, diffs: official, onServer: false };

  return { error: 'not_found' };
}

/**
 * Aceita ID de dificuldade, ID de set, ou link de qualquer um dos dois, e
 * devolve sempre o set inteiro — o status é uma propriedade da dificuldade no
 * bancho, mas ninguém rankeia meia dificuldade: o que se nomeia é o mapa todo.
 *
 * `onServer` diz de onde veio a lista, para a resposta poder avisar que o mapa
 * ainda vai ser buscado na hora de aplicar.
 *
 * @returns {Promise<{setId: number, diffs: object[], onServer: boolean} | {error: 'not_found'|'invalid'}>}
 */
async function resolveSet(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'invalid' };

  // Link de beatmapset (sem #diff) → o ID já é o do set.
  const setLink = raw.match(/beatmapsets?\/(\d+)/) ?? raw.match(/\/s\/(\d+)/);
  if (setLink) return diffsForSet(Number(setLink[1]));

  // Link/ID de dificuldade → sobe para o set dela.
  const mapId = osu.parseBeatmapId(raw);
  if (mapId) {
    const map = await serverMap(mapId);
    if (map?.set_id) {
      const resolved = await diffsForSet(map.set_id);
      // O servidor conhece a dificuldade mas não devolveu o set: fica com a
      // única que temos, em vez de descartar o que já está em mãos.
      return resolved.error ? { setId: map.set_id, diffs: [map], onServer: true } : resolved;
    }

    // O servidor não conhece essa dificuldade; a API oficial diz de qual set
    // ela é, e daí o caminho volta a ser o mesmo.
    const official = await osu.getBeatmap(mapId);
    if (official?.beatmapset_id) return diffsForSet(official.beatmapset_id);

    // Número solto que não é dificuldade: tenta como ID de set antes de
    // desistir — quem copia da página do mapa costuma pegar o do set.
    if (/^\d+$/.test(raw)) return diffsForSet(Number(raw));

    return { error: 'not_found' };
  }

  return { error: 'invalid' };
}

function mapLabel(diffs) {
  const first = diffs[0] ?? {};
  // Metadados vêm do .osu enviado por quem fez o upload — título e artista são
  // texto arbitrário de terceiro, então limitamos antes de compor o embed.
  return truncate(`${first.artist ?? '?'} - ${first.title ?? '?'} (${first.creator ?? '?'})`, 150);
}

/**
 * Publica a mudança de status para todas as dificuldades e confirma o efeito.
 *
 * O canal `rank` do bancho age sobre UMA dificuldade por mensagem, então um
 * set com 7 diffs são 7 publicações. E como pub/sub não devolve resposta,
 * relemos o estado pela API v2 em vez de assumir sucesso.
 */
async function applyStatus(diffs, status) {
  const ids = diffs.map(d => d.id);
  const published = [];
  let failure = null;

  // A falha no meio do laço NÃO vira exceção, e isso é deliberado. O que já foi
  // publicado não tem como ser desfeito: o bancho consome do Redis por conta
  // própria e vai aplicar aquilo independente do que aconteça aqui. Deixar a
  // exceção subir fazia o comando responder "ocorreu um erro" e pular o
  // logAdminAction — ou seja, o servidor mudava e o log do bot não registrava
  // nada. É o oposto do que a auditoria existe para garantir.
  for (const id of ids) {
    try {
      await daycore.rankBeatmap(id, status, true);
      published.push(id);
    } catch (error) {
      failure = error;
      break;
    }
  }

  const { confirmed, pending } = published.length > 0
    ? await daycore.verifyMapStatus(published, status)
    : { confirmed: [], pending: [] };

  // O que nunca chegou a ser publicado entra como pendente: do ponto de vista
  // de quem pediu, aquelas dificuldades não chegaram ao status alvo — e é isso
  // que decide a cor do embed e se a fila de nomeação sobrevive.
  const enviadas = new Set(published);

  return {
    confirmed,
    pending: [...pending, ...ids.filter(id => !enviadas.has(id))],
    published,
    total: ids.length,
    failure,
  };
}

module.exports = {
  // Exportado para teste: decide de qual fonte sai a lista de dificuldades, e
  // errar aí é publicar no mapa errado ou recusar um que daria certo.
  resolveSet,
  mapLabel,

  // Idem: é quem separa "publicado" de "confirmado". Errar aqui é apagar a fila
  // de nomeação de um set que nunca mudou no servidor.
  applyStatus,
};
