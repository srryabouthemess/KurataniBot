/**
 * commands/osu/topif/embed.js
 * Como cada play aparece no embed do /topif.
 */

const osu = require('../../../osuClient');
const playEmbed = require('../../../embeds/play');
const { formatMods } = require('../../../mods');
const { md } = require('../../../markdown');
const emojis = require('../../../emojis');
const { hitCounts } = require('../../../hits');
const { adjustGradeForMods } = require('./logic');

/** Uma play no embed — no estilo do /nochoke, com o antes/depois só quando mudou. */
async function linhaPlay(entry, mode) {
  const { play, mods: newMods, pp: novoPP, changed, origIndex } = entry;

  const starsAntesRaw = await osu.getAdjustedStars(play.beatmap?.id, play.mods, mode);
  const starsAntes    = parseFloat(starsAntesRaw ?? play.beatmap?.difficulty_rating);
  const temStarsAntes = Number.isFinite(starsAntes) && starsAntes > 0;

  const grade  = emojis.rankLabel(changed ? adjustGradeForMods(play.rank, newMods) : play.rank);
  const titulo = md(playEmbed.mapTitle(play));
  const url    = osu.getMapUrl(play.beatmap?.id, play.beatmapset?.id, mode);

  let modsLabel  = `**${formatMods(play.mods)}**`;
  let starsLabel = temStarsAntes ? ` [${starsAntes.toFixed(2)}★]` : '';

  if (changed) {
    modsLabel = `**${formatMods(play.mods)} → ${formatMods(newMods)}**`;

    const starsDepoisRaw = await osu.getAdjustedStars(play.beatmap?.id, newMods, mode);
    const starsDepois    = parseFloat(starsDepoisRaw ?? starsAntesRaw ?? play.beatmap?.difficulty_rating);
    if (Number.isFinite(starsDepois) && starsDepois > 0) {
      starsLabel = temStarsAntes
        ? ` [${starsAntes.toFixed(2)}★ → ${starsDepois.toFixed(2)}★]`
        : ` [${starsDepois.toFixed(2)}★]`;
    }
  }

  const cabec = url
    ? `**#${origIndex}** [${titulo}](${url}) ${modsLabel}${starsLabel}`
    : `**#${origIndex}** ${grade} ${modsLabel}${starsLabel}`;

  const { n300, n100, n50, nmiss } = hitCounts(play);
  const objetos   = n300 + n100 + n50 + nmiss;
  const accValue  = objetos > 0 ? (300 * n300 + 100 * n100 + 50 * n50) / (3 * objetos) : Number(play?.accuracy) * 100;
  const comboReal = play.max_combo ?? 0;
  const mapCombo  = play.beatmap?.max_combo ?? null;

  const realPP = Number.isFinite(play.pp) ? play.pp.toFixed(2) : '?';
  const accTxt = Number.isFinite(accValue) ? `${accValue.toFixed(2)}%` : '';

  const ms     = new Date(play.created_at).getTime();
  const quando = Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:R>` : '';

  let linhaPP;
  if (changed) {
    linhaPP = `${grade} \`${realPP}pp → ${novoPP.toFixed(2)}pp\`${accTxt ? ` • \`${accTxt}\`` : ''}`;
  } else {
    linhaPP = `${grade} \`${realPP}pp\`${accTxt ? ` • \`${accTxt}\`` : ''}`;
  }

  let linhaCombo = `\`[ ${comboReal}x/${mapCombo ?? '?'}x ]\``;
  if (nmiss > 0) linhaCombo += ` · ❌ ${nmiss}`;
  if (quando) linhaCombo += ` · ${quando}`;

  return `${cabec}\n${linhaPP}\n${linhaCombo}`;
}

module.exports = { linhaPlay };
