/**
 * commands/osu/nochoke/embed.js
 * Como cada play aparece no embed do /nochoke.
 */

const osu = require('../../../osuClient');
const playEmbed = require('../../../embeds/play');
const { formatMods } = require('../../../mods');
const { mdLink } = require('../../../markdown');
const emojis = require('../../../emojis');
const { hitCounts } = require('../../../hits');
const { accPair, fcGrade } = require('./logic');

/** Uma play no embed — três linhas no estilo do Bathbot. */
async function linhaPlay(entry, mode, s) {
  const { play, pp: fcPP, unchoked, origIndex } = entry;

  const aj    = await osu.getAdjustedStars(play.beatmap?.id, play.mods, mode);
  const st    = parseFloat(aj ?? play.beatmap?.difficulty_rating);
  const stars = Number.isFinite(st) && st > 0 ? ` [${st.toFixed(2)}★]` : '';

  // Choke desfeito mostra a grade do score HIPOTÉTICO (FC); o resto, a real.
  const grade  = emojis.rankLabel(unchoked ? fcGrade(play) : play.rank);
  const mods   = `**${formatMods(play.mods)}**`;
  const titulo = mdLink(playEmbed.mapTitle(play));
  const url    = osu.getMapUrl(play.beatmap?.id, play.beatmapset?.id, mode);
  const cabec  = url
    ? `**#${origIndex}** [${titulo}](${url}) ${mods}${stars}`
    : `**#${origIndex}** ${grade} ${mods}${stars}`;

  const realPP    = Number.isFinite(play.pp) ? play.pp.toFixed(2) : '?';
  const { real: accReal, fc: accFC } = accPair(play);
  const comboReal = play.max_combo ?? 0;
  const mapCombo  = play.beatmap?.max_combo ?? null;

  const ms     = new Date(play.created_at).getTime();
  const quando = Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : '';

  let linhaPP;
  let linhaCombo;
  if (unchoked) {
    linhaPP = `${grade} \`${realPP} → ${fcPP.toFixed(2)}pp\` • \`${accReal.toFixed(2)}% → ${accFC.toFixed(2)}%\``;
    const alvo = mapCombo ?? comboReal;
    linhaCombo = `\`[ ${comboReal}x → ${alvo}x/${alvo}x ]\` · ${s.nochoke_removed} ${hitCounts(play).nmiss} ❌`;
  } else {
    linhaPP = `${grade} \`${realPP}pp\` • \`${accReal.toFixed(2)}%\``;
    linhaCombo = `\`[ ${comboReal}x/${mapCombo ?? '?'}x ]\``;
  }
  if (quando) linhaCombo += ` · ${quando}`;

  return `${cabec}\n${linhaPP}\n${linhaCombo}`;
}

module.exports = { linhaPlay };
