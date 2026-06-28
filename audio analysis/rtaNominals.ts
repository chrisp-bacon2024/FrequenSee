/**
 * IEC 61260 nominal center frequencies for standard RTA bandwidths.
 * Exact band edges/bin mapping use calculated values; these are display labels.
 */

/** R40 preferred numbers (Hz) — used for 1/6-octave labeling. */
export const R40_NOMINALS: readonly number[] = [
    10, 11.2, 12.5, 14, 16, 18, 20, 22.4, 25, 28, 31.5, 35.5, 40, 45, 50, 56, 63, 71, 80, 90,
    100, 112, 125, 140, 160, 180, 200, 224, 250, 280, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900,
    1000, 1120, 1250, 1400, 1600, 1800, 2000, 2240, 2500, 2800, 3150, 3550, 4000, 4500, 5000, 5600, 6300, 7100,
    8000, 9000, 10000, 11200, 12500, 14000, 16000, 18000, 20000,
];

/** IEC Annex E — 1/1-octave nominal centers (Hz). */
export const NOMINAL_1_OCTAVE: readonly number[] = [
    16, 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

/** IEC Annex E — 1/3-octave nominal centers (Hz). */
export const NOMINAL_1_THIRD_OCTAVE: readonly number[] = [
    12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000,
    1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

/** Standard fractional-octave bandwidths exposed in RTA software (fraction of one octave). */
export const STANDARD_BANDWIDTHS = [1, 1 / 3, 1 / 6, 1 / 12, 1 / 24] as const;

/** Simplified IEC preferred rounding for nominal frequency labels. */
export function formatIecNominal(f: number): number {
    if (f < 100) return parseFloat(f.toPrecision(2));
    if (f < 1000) return parseFloat(f.toPrecision(2));
    return parseFloat(f.toPrecision(3));
}

export function snapNearestNominal(fc: number, nominals: readonly number[]): number {
    return nominals.reduce((best, nominal) =>
        Math.abs(Math.log10(nominal / fc)) < Math.abs(Math.log10(best / fc)) ? nominal : best
    );
}

/** Bands per octave (e.g. 1/3 → 3). Returns 0 for non-standard bandwidths. */
export function bandsPerOctave(bandwidth: number): number {
    const inverse = 1 / bandwidth;
    for (const standard of STANDARD_BANDWIDTHS) {
        if (Math.abs(inverse - 1 / standard) < 1e-6) return Math.round(inverse);
    }
    return Math.round(inverse);
}

export function nominalCenterForBandwidth(fc: number, bandwidth: number): number {
    switch (bandsPerOctave(bandwidth)) {
        case 1:
            return snapNearestNominal(fc, NOMINAL_1_OCTAVE);
        case 3:
            return snapNearestNominal(fc, NOMINAL_1_THIRD_OCTAVE);
        case 6:
            return snapNearestNominal(fc, R40_NOMINALS);
        case 12:
            return parseFloat(fc.toPrecision(3));
        case 24:
            return parseFloat(fc.toPrecision(4));
        default:
            return snapNearestNominal(fc, R40_NOMINALS);
    }
}
