/**
 * commands/admin/scorewipe/format.js
 * O score nas duas formas em que chega (lista da v1, id pela v2), traduzido
 * para uma só, e a linha legível dele. Puro.
 */

const { decodeMods, formatMods } = require('../../../mods');

/** O texto do mapa, montado dos campos separados que as duas fontes trazem. */
function nomeDoMapa(map) {
  if (!map) return null;
  const artista = map.artist ? `${map.artist} - ` : '';
  return `${artista}${map.title ?? '???'} [${map.version ?? '?'}]`;
}

/**
 * A data como o servidor a guardou, sem conversão de fuso.
 *
 * O `play_time` chega como datetime do MySQL, sem fuso declarado. Interpretá-lo
 * como local ou como UTC seria escolher no escuro; o que a confirmação precisa é
 * bater com o que está no banco, para quem confere ver o mesmo valor dos dois
 * lados.
 */
function quando(playTime) {
  return String(playTime ?? '').replace('T', ' ').slice(0, 16) || '?';
}

/**
 * A forma comum das duas entradas.
 *
 * A lista vem da v1 (`get_player_scores`), que traz o mapa aninhado mas não o
 * `userid` — ele é sabido, porque a consulta foi por jogador. O id digitado vem
 * da v2 (`/scores/{id}`), que traz o `userid` mas só o md5 do mapa, resolvido à
 * parte. Daí as duas normalizações, e um formato só depois delas.
 */
function daLista(row, ownerId) {
  return {
    id:       Number(row.id),
    userId:   Number(ownerId),
    mode:     Number(row.mode),
    status:   Number(row.status),
    pp:       Number(row.pp ?? 0),
    acc:      Number(row.acc ?? 0),
    grade:    row.grade ?? '?',
    mods:     Number(row.mods ?? 0),
    playTime: row.play_time,
    mapId:    row.beatmap?.id ?? null,
    mapLabel: nomeDoMapa(row.beatmap),
    // O `get_player_scores` da v1 traz `t.map_md5` no SELECT, mas o handler
    // remonta o dicionário campo a campo e o md5 sai só ANINHADO, junto do
    // resto do mapa (`beatmap.md5`). Ler só o topo devolvia null em todo o
    // caminho da lista — e, sem md5, o botão do lote nunca era montado, calado.
    // O topo fica primeiro para o dia em que o upstream passar a mandá-lo.
    md5:      row.map_md5 ?? row.beatmap?.md5 ?? null,
  };
}

function porId(score, map) {
  return {
    id:       Number(score.id),
    userId:   Number(score.userid),
    mode:     Number(score.mode),
    status:   Number(score.status),
    pp:       Number(score.pp ?? 0),
    acc:      Number(score.acc ?? 0),
    grade:    score.grade ?? '?',
    mods:     Number(score.mods ?? 0),
    playTime: score.play_time,
    mapId:    map?.id ?? null,
    mapLabel: nomeDoMapa(map),
    md5:      score.map_md5 ?? null,
  };
}

/** Uma linha legível do score — a mesma na lista, na confirmação e no log. */
function descrever(item, s) {
  return s.scorewipe_score_line(
    item.mapLabel ?? s.scorewipe_map_unknown,
    item.pp.toFixed(2),
    item.acc.toFixed(2),
    formatMods(decodeMods(item.mods)),
    item.grade,
    quando(item.playTime),
  );
}

module.exports = {
  nomeDoMapa,
  quando,
  // Exportada para teste. O `md5` da normalização da v1 é o fio de que todo o
  // lote pende — sem ele o botão some da tela sem quebrar nada, e um teste que
  // só olha o texto do arquivo não percebe a mudança de formato do endpoint.
  daLista,
  porId,
  descrever,
};
