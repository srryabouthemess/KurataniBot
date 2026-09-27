/* tslint:disable */
/* eslint-disable */

export class Beatmap {
    free(): void;
    [Symbol.dispose](): void;
    constructor(bytes: Uint8Array);
    /**
     * Objetos do mapa: o denominador da accuracy quando o n300 nao veio.
     */
    readonly nObjects: number;
}

/**
 * `[pp, stars, maxCombo]`. Hit ausente e deduzido pelo motor; combo ausente e
 * o maximo do mapa.
 *
 * `acc` (0-100) e como o score-service do Akatsuki pede o PP na submissao:
 * accuracy + misses, sem os hits. Com ela, n300/n100/n50 sao ignorados, como
 * o performance-service exige (um OU outro).
 */
export function performance(map: Beatmap, mods: number, n300: number | null | undefined, n100: number | null | undefined, n50: number | null | undefined, misses: number, combo?: number | null, acc?: number | null): Float64Array;
