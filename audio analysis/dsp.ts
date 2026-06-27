/**
 * Digital signal processing helpers for audio level measurement.
 *
 * This module operates on normalized sample arrays (−1…+1). It provides RMS,
 * decibel conversion, IEC-style frequency weighting (Z/A/C), and exponential
 * time weighting (Fast/Slow) used by {@link SPL} and {@link Leq}.
 *
 * @module dsp
 */

export type Weighting = "Z" | "A" | "C";
export type TimeWeighting = "FAST" | "SLOW" | "INST";
export type LevelMode = "SPL" | "dBFS";

export type BiquadSection = {
    b0: number;
    b1: number;
    b2: number;
    a1: number;
    a2: number;
};

const weightingCache = new Map<string, BiquadSection[]>();

/** Root mean square of samples in `[start, end)`. Returns 0 if the range is empty. */
export function rms(samples: Float32Array, start = 0, end = samples.length): number {
    const length = end - start;
    if (length <= 0) return 0;

    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / length);
}

/** Converts a linear amplitude ratio to decibels: `20 * log10(ratio)`. */
export function dbFromRatio(ratio: number): number {
    return ratio > 0 ? 20 * Math.log10(ratio) : -Infinity;
}

/**
 * Applies Z, A, or C frequency weighting to a slice of audio.
 * Z returns the input unchanged; A uses an FFT-domain IEC curve; C uses IIR biquads.
 */
export function applyWeighting(
    samples: Float32Array,
    weighting: Weighting,
    sampleRate: number,
    start = 0,
    end = samples.length
): Float32Array {
    const slice = samples.subarray(start, end);
    if (weighting === "Z") return slice;

    if (weighting === "A") {
        return applyFrequencyWeighting(slice, sampleRate, "A");
    }

    const sos = getWeightingSOS("C", sampleRate);
    return applySOS(slice, sos);
}

/**
 * Exponential time weighting (IEC-style) on mean square, then square root.
 * FAST = 125 ms, SLOW = 1 s, INST = plain RMS over the buffer.
 */
export function timeWeightedRms(
    samples: Float32Array,
    sampleRate: number,
    speed: TimeWeighting
): number {
    if (samples.length === 0) return 0;

    if (speed === "INST") {
        return rms(samples);
    }

    const tau = speed === "FAST" ? 0.125 : 1.0;
    const decay = Math.exp(-1 / (tau * sampleRate));

    let meanSquare = samples[0] * samples[0];
    for (let i = 1; i < samples.length; i++) {
        const squared = samples[i] * samples[i];
        meanSquare = decay * meanSquare + (1 - decay) * squared;
    }

    return Math.sqrt(meanSquare);
}

function applyBiquad(input: Float32Array, section: BiquadSection): Float32Array {
    const output = new Float32Array(input.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let i = 0; i < input.length; i++) {
        const x0 = input[i];
        const y0 =
            section.b0 * x0 +
            section.b1 * x1 +
            section.b2 * x2 -
            section.a1 * y1 -
            section.a2 * y2;

        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
        output[i] = y0;
    }

    return output;
}

function applySOS(input: Float32Array, sos: BiquadSection[]): Float32Array {
    let output = input;
    for (const section of sos) {
        output = applyBiquad(output, section);
    }
    return output;
}

function getWeightingSOS(weighting: "C", sampleRate: number): BiquadSection[] {
    const key = `${weighting}@${sampleRate}`;
    const cached = weightingCache.get(key);
    if (cached) return cached;

    const sos = designCWeightingSOS(sampleRate);

    weightingCache.set(key, sos);
    return sos;
}

export function weightingGainLinear(frequencyHz: number, weighting: "A" | "C"): number {
    if (frequencyHz <= 0) return 0;

    const f2 = frequencyHz * frequencyHz;
    const f1 = 12194.217;
    const fLow = 20.598997;

    if (weighting === "C") {
        const fHigh = f1;
        return (1.007 * fHigh * fHigh * f2) / ((f2 + fLow * fLow) * (f2 + fHigh * fHigh));
    }

    const f2n = 107.65265;
    const f3 = 737.86223;
    const numerator = f1 * f1 * f2 * f2;
    const denominator =
        (f2 + fLow * fLow) *
        Math.sqrt((f2 + f2n * f2n) * (f2 + f3 * f3)) *
        (f2 + f1 * f1);

    return (1.2588966111 * numerator) / denominator;
}

function nextPow2(value: number): number {
    return 1 << Math.ceil(Math.log2(value));
}

function applyFrequencyWeighting(
    samples: Float32Array,
    sampleRate: number,
    weighting: "A" | "C"
): Float32Array {
    const fftSize = nextPow2(samples.length);
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);

    real.set(samples);
    fft(real, imag);

    for (let bin = 0; bin <= fftSize / 2; bin++) {
        const frequencyHz = (bin * sampleRate) / fftSize;
        const gain = weightingGainLinear(frequencyHz, weighting);
        real[bin] *= gain;
        imag[bin] *= gain;

        if (bin > 0 && bin < fftSize / 2) {
            const mirror = fftSize - bin;
            real[mirror] *= gain;
            imag[mirror] *= gain;
        }
    }

    ifft(real, imag);

    const output = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        output[i] = real[i];
    }

    return output;
}

function fft(real: Float64Array, imag: Float64Array): void {
    const n = real.length;
    if (n <= 1) return;

    bitReversePermute(real, imag);

    for (let size = 2; size <= n; size <<= 1) {
        const halfSize = size >> 1;
        const angle = (-2 * Math.PI) / size;
        const stepRe = Math.cos(angle);
        const stepIm = Math.sin(angle);

        for (let i = 0; i < n; i += size) {
            let wRe = 1;
            let wIm = 0;

            for (let j = 0; j < halfSize; j++) {
                const evenIndex = i + j;
                const oddIndex = i + j + halfSize;

                const oddRe = real[oddIndex] * wRe - imag[oddIndex] * wIm;
                const oddIm = real[oddIndex] * wIm + imag[oddIndex] * wRe;

                real[oddIndex] = real[evenIndex] - oddRe;
                imag[oddIndex] = imag[evenIndex] - oddIm;
                real[evenIndex] += oddRe;
                imag[evenIndex] += oddIm;

                const nextWRe = wRe * stepRe - wIm * stepIm;
                wIm = wRe * stepIm + wIm * stepRe;
                wRe = nextWRe;
            }
        }
    }
}

function ifft(real: Float64Array, imag: Float64Array): void {
    for (let i = 0; i < imag.length; i++) {
        imag[i] = -imag[i];
    }

    fft(real, imag);

    const n = real.length;
    for (let i = 0; i < n; i++) {
        real[i] /= n;
        imag[i] = -imag[i] / n;
    }
}

function bitReversePermute(real: Float64Array, imag: Float64Array): void {
    const n = real.length;
    let j = 0;

    for (let i = 1; i < n; i++) {
        let bit = n >> 1;

        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }

        j ^= bit;

        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
    }
}

function bilinearTransformCoeffs(
    b: [number, number, number],
    a: [number, number, number],
    sampleRate: number
): BiquadSection {
    const k = 2 * sampleRate;
    const k2 = k * k;

    const bb0 = b[0] + b[1] * k + b[2] * k2;
    const bb1 = 2 * b[0] - 2 * b[2] * k2;
    const bb2 = b[0] - b[1] * k + b[2] * k2;

    const aa0 = a[0] + a[1] * k + a[2] * k2;
    const aa1 = 2 * a[0] - 2 * a[2] * k2;
    const aa2 = a[0] - a[1] * k + a[2] * k2;

    return {
        b0: bb0 / aa0,
        b1: bb1 / aa0,
        b2: bb2 / aa0,
        a1: aa1 / aa0,
        a2: aa2 / aa0,
    };
}

function designCWeightingSOS(sampleRate: number): BiquadSection[] {
    const f1 = 20.598997;
    const f4 = 12194.217;

    const w1 = 2 * Math.PI * f1;
    const w4 = 2 * Math.PI * f4;

    const sos = [bilinearTransformCoeffs([0, w4, 0], [w1 * w4, w1 + w4, 1], sampleRate)];

    normalizeAtFrequency(sos, 1000, sampleRate);
    return sos;
}

function normalizeAtFrequency(
    sos: BiquadSection[],
    frequencyHz: number,
    sampleRate: number
): void {
    const gain = magnitudeAtFrequency(sos, frequencyHz, sampleRate);
    if (gain <= 0) return;

    const scale = 1 / gain;
    for (const section of sos) {
        section.b0 *= scale;
        section.b1 *= scale;
        section.b2 *= scale;
    }
}

function magnitudeAtFrequency(
    sos: BiquadSection[],
    frequencyHz: number,
    sampleRate: number
): number {
    const omega = (2 * Math.PI * frequencyHz) / sampleRate;
    const cosW = Math.cos(omega);
    const sinW = Math.sin(omega);

    let re = 1;
    let im = 0;

    for (const section of sos) {
        const { b0, b1, b2, a1, a2 } = section;

        const numRe = b0 + b1 * cosW + b2 * (cosW * cosW - sinW * sinW);
        const numIm = -b1 * sinW - b2 * 2 * cosW * sinW;

        const denRe = 1 + a1 * cosW + a2 * (cosW * cosW - sinW * sinW);
        const denIm = -a1 * sinW - a2 * 2 * cosW * sinW;

        const outRe = (numRe * denRe + numIm * denIm) / (denRe * denRe + denIm * denIm);
        const outIm = (numIm * denRe - numRe * denIm) / (denRe * denRe + denIm * denIm);

        re = outRe * re - outIm * im;
        im = outRe * im + outIm * re;
    }

    return Math.sqrt(re * re + im * im);
}
