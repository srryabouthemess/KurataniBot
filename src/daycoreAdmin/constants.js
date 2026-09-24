/**
 * daycoreAdmin/constants.js
 * Constantes espelhadas do bancho.py-ex: bits de privilégio, status de mapa,
 * canais de pub/sub e modos de jogo. Mudou no fork, muda aqui.
 */

// ─── Constantes espelhadas do bancho.py-ex ────────────────────────────────────
// Fonte: app/constants/privileges.py. Mantenha em sincronia se o fork mudar.
const Privileges = {
  UNRESTRICTED:    1 << 0,   // 1     — não banido
  VERIFIED:        1 << 1,   // 2     — já logou in-game
  WHITELISTED:     1 << 2,   // 4     — bypass de anticheat
  SUPPORTER:       1 << 4,   // 16
  PREMIUM:         1 << 5,   // 32
  ALUMNI:          1 << 7,   // 128
  TOURNEY_MANAGER: 1 << 10,  // 1024
  NOMINATOR:       1 << 11,  // 2048  — gerencia status de mapas
  MODERATOR:       1 << 12,  // 4096  — gerencia usuários (nível 1)
  ADMINISTRATOR:   1 << 13,  // 8192  — gerencia usuários (nível 2)
  DEVELOPER:       1 << 14,  // 16384 — controle total
};

// Valores aceitos pelo comando !map do bancho, e portanto pelo canal `rank`.
const RankedStatus = {
  UNRANK: 0,
  RANK:   2,
  LOVE:   5,
};

const STATUS_LABELS = {
  [RankedStatus.UNRANK]: 'unranked',
  [RankedStatus.RANK]:   'ranked',
  [RankedStatus.LOVE]:   'loved',
};

const CHANNELS = {
  RANK:       'rank',
  RESTRICT:   'restrict',
  UNRESTRICT: 'unrestrict',
  WIPE:       'wipe',
  SCOREWIPE:  'scorewipe',
  MAPWIPE:    'mapwipe',
  ADDPRIV:    'addpriv',
  REMOVEPRIV: 'removepriv',
};

/**
 * Modos de jogo do bancho.py, com os nomes que ele mesmo usa no log
 * (app/api/utils.py, dicionário `mode_names`). O wipe age sobre UM modo — os
 * scores dos outros continuam intactos.
 */
const GameModes = {
  0: 'vn!std',
  1: 'vn!taiko',
  2: 'vn!catch',
  3: 'vn!mania',
  4: 'rx!std',
  5: 'rx!taiko',
  6: 'rx!catch',
  8: 'ap!std',
};

/**
 * O status em que o score apagado fica.
 *
 * Espelha o `WIPED_SCORE_STATUS` do bancho (app/api/utils.py). Não é 0: 0 é
 * FAILED, e `plays` conta score falhado — em 0 o score apagado ficaria
 * indistinguível de um fail de verdade. -1 está fora do `SubmissionStatus`, e é
 * por isso que toda consulta que seleciona `status = 2` já o descarta.
 */
const WIPED_SCORE_STATUS = -1;

module.exports = {
  Privileges,
  RankedStatus,
  STATUS_LABELS,
  CHANNELS,
  GameModes,
  WIPED_SCORE_STATUS,
};
