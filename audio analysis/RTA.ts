import Wav from "./Wav";
import FFT from "fft.js";
import { weightingGainLinear, TimeWeighting, Weighting } from "./dsp";
import SPL from "./SPL";
import { nominalCenterForBandwidth } from "./rtaNominals";

export const DEFAULT_MAX_FRAMES = 1500;

const POWER_FLOOR = 10 ** (-140 / 10);

export interface FrequencyBinData {
    frequency: number;
    dbfs: number;
    dbfsA: number;
    dbfsC: number;
    splZ: number;
    splA: number;
    splC: number;
}

export type CalculateOptions = {
    maxFrames?: number;
    onProgress?: (framesDone: number, frameCount: number) => void;
    yieldEvery?: number;
};

interface PreCalculatedBand {
    centerFrequency: number;
    lowerFrequency: number;
    upperFrequency: number;
    kStart: number;
    kEnd: number;
}

class RTA {
    private bandLookupTable: PreCalculatedBand[] = [];
    private totalBins: number = 0;
    private minFrequency: number = 20;
    private maxFrequency: number = 20000;
    private sampleRate: number = 0;
    private spl: SPL;
    private gainA: Float32Array = new Float32Array(0);
    private gainC: Float32Array = new Float32Array(0);
    private hopSamples: number = 2048;
    private averagingDepth: number = 1;

    bandFrequencies: Float32Array = new Float32Array(0);
    private dbfsZFrames: Float32Array[] = [];
    private dbfsAFrames: Float32Array[] = [];
    private dbfsCFrames: Float32Array[] = [];

    constructor(private source: Wav, private bandwidth: number = 1, private N: number = 2048) {
        this.spl = new SPL(source);
        this.sampleRate = this.source.sampleRate;
        this.hopSamples = N;

        if (N <= 0 || (N & (N - 1)) !== 0) {
            throw new Error("Window size N must be a strict power of 2 (e.g., 1024, 2048).");
        }

        this.totalBins = this.N / 2;
        this.precomputeBandwidthBins();
        this.precomputeWeightingGains();
    }

    calibrate(
        knownSplDb: number,
        options: { weighting?: Weighting; speed?: TimeWeighting } = {}
    ): number {
        return this.spl.calibrate(knownSplDb, options);
    }

    getCalibrationOffsetDb(): number {
        return this.spl.getCalibrationOffsetDb();
    }

    setCalibrationOffsetDb(offsetDb: number): void {
        this.spl.setCalibrationOffsetDb(offsetDb);
    }

    getAveragingDepth(): number {
        return this.averagingDepth;
    }

    setAveragingDepth(depth: number): void {
        if (depth <= 0 || (depth & (depth - 1)) !== 0 || depth > 16) {
            throw new Error("Averaging depth must be a strict power of 2 greater than 0 and no more than 16.");
        }
        this.averagingDepth = depth;
    }

    getFftSize(): number {
        return this.N;
    }

    getHopSamples(): number {
        return this.hopSamples;
    }

    getFrameDurationSec(): number {
        return this.hopSamples / this.sampleRate;
    }

    getFrameCount(): number {
        return this.dbfsZFrames.length;
    }

    getLevelDbfs(frameIndex: number, bandIndex: number, weighting: Weighting): number {
        if (!this.dbfsZFrames[frameIndex]) return -120;
        return this.averageBandPower(frameIndex, bandIndex, weighting);
    }

    /** Lazily materializes one frame for the RTA bar chart. */
    getFrame(frameIndex: number): FrequencyBinData[] {
        const offset = this.spl.getCalibrationOffsetDb();
        const numBands = this.bandFrequencies.length;
        const frame: FrequencyBinData[] = new Array(numBands);

        for (let b = 0; b < numBands; b++) {
            const dbfsZ = this.averageBandPower(frameIndex, b, "Z");
            const dbfsA = this.averageBandPower(frameIndex, b, "A");
            const dbfsC = this.averageBandPower(frameIndex, b, "C");
            frame[b] = {
                frequency: this.bandFrequencies[b],
                dbfs: dbfsZ,
                dbfsA,
                dbfsC,
                splZ: dbfsZ + offset,
                splA: dbfsA + offset,
                splC: dbfsC + offset,
            };
        }

        return frame;
    }

    private nominalCenter(fc: number): number {
        return nominalCenterForBandwidth(fc, this.bandwidth);
    }

    private precomputeWeightingGains(): void {
        this.gainA = new Float32Array(this.totalBins);
        this.gainC = new Float32Array(this.totalBins);

        for (let k = 0; k < this.totalBins; k++) {
            const frequencyHz = (k * this.sampleRate) / this.N;
            this.gainA[k] = weightingGainLinear(frequencyHz, "A");
            this.gainC[k] = weightingGainLinear(frequencyHz, "C");
        }
    }

    private precomputeBandwidthBins(): void {
        const minFreq = this.minFrequency;
        const maxFreq = this.maxFrequency;
        const baseRef = 1000;
        const binWidth = this.sampleRate / this.N;
        const edgeFactor = 10 ** (3 * this.bandwidth / 20);

        const centerFreqs: number[] = [];
        let n = 0;
        let fc = baseRef;

        do {
            fc = baseRef * 10 ** ((3 * this.bandwidth / 10) * n);
            if (fc >= minFreq) centerFreqs.push(fc);
            n--;
        } while (fc >= minFreq);
        centerFreqs.reverse();

        n = 1;
        do {
            fc = baseRef * 10 ** ((3 * this.bandwidth / 10) * n);
            if (fc <= maxFreq) centerFreqs.push(fc);
            n++;
        } while (fc <= maxFreq);

        for (const fcExact of centerFreqs) {
            const fLower = fcExact / edgeFactor;
            const fUpper = fcExact * edgeFactor;

            const kStart = Math.max(0, Math.round(fLower / binWidth));
            const kEnd = Math.min(this.totalBins - 1, Math.round(fUpper / binWidth));

            this.bandLookupTable.push({
                centerFrequency: this.nominalCenter(fcExact),
                lowerFrequency: fLower,
                upperFrequency: fUpper,
                kStart: kStart,
                kEnd: kEnd,
            });
        }

        this.bandFrequencies = Float32Array.from(
            this.bandLookupTable.map((band) => band.centerFrequency)
        );
    }

    private computeHopSamples(totalSamples: number, maxFrames: number): number {
        if (totalSamples <= this.N) return this.N;
        return Math.max(this.N, Math.floor((totalSamples - this.N) / (maxFrames - 1)));
    }

    private estimateFrameCount(totalSamples: number, hopSamples: number): number {
        if (totalSamples < this.N) return 0;
        return Math.floor((totalSamples - this.N) / hopSamples) + 1;
    }

    private averageBandPower(frameIndex: number, bandIndex: number, weighting: Weighting): number {
        const frameData = 
            weighting === "A"
                ? this.dbfsAFrames
                : weighting === "C"
                  ? this.dbfsCFrames
                  : this.dbfsZFrames;
        const avgDepth = this.averagingDepth;
        const start = Math.max(0, frameIndex - avgDepth + 1);
        let sumPower = 0;
        let count = 0;
        for (let f = start; f <= frameIndex; f++) {
            const dB = frameData[f][bandIndex];
            if (dB <= -119) continue;
            sumPower += 10 ** (dB / 10);
            count++;
        }
        const avgPower = count > 0 ? sumPower / count : 0;
        const avgDb = avgPower > 0 ? 10 * Math.log10(avgPower) : -120;
        return avgDb;
    }

    async calculate(
        channel: number,
        windowType: "hann" | "hamming" = "hann",
        options: CalculateOptions = {}
    ): Promise<number> {
        const samples = this.source.channels[channel];
        if (!samples) throw new Error("Invalid channel");

        const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
        const yieldEvery = options.yieldEvery ?? 32;
        const N = this.N;
        const totalSamples = samples.length;
        const numBands = this.bandLookupTable.length;

        this.hopSamples = this.computeHopSamples(totalSamples, maxFrames);
        const estimatedFrames = this.estimateFrameCount(totalSamples, this.hopSamples);

        this.dbfsZFrames = [];
        this.dbfsAFrames = [];
        this.dbfsCFrames = [];

        const fftInstance = new FFT(N);
        const inputSignal = new Float32Array(N);
        const outputComplex = fftInstance.createComplexArray();
        const windowCoefficents = new Float64Array(N);
        const normDivisor = N / 4;

        if (windowType === "hann") {
            for (let n = 0; n < N; n++) {
                const angle = (2 * Math.PI * n) / (N - 1);
                windowCoefficents[n] = 0.5 * (1 - Math.cos(angle));
            }
        } else if (windowType === "hamming") {
            for (let n = 0; n < N; n++) {
                const angle = (2 * Math.PI * n) / (N - 1);
                windowCoefficents[n] = 0.54 - 0.46 * Math.cos(angle);
            }
        } else {
            throw new Error("Invalid window type");
        }

        let framesDone = 0;

        for (let i = 0; i <= totalSamples - N; i += this.hopSamples) {
            for (let n = 0; n < N; n++) {
                inputSignal[n] = samples[i + n] * windowCoefficents[n];
            }

            fftInstance.realTransform(outputComplex, inputSignal);

            const bandDbfsZ = new Float32Array(numBands);
            const bandDbfsA = new Float32Array(numBands);
            const bandDbfsC = new Float32Array(numBands);
            bandDbfsZ.fill(-120);
            bandDbfsA.fill(-120);
            bandDbfsC.fill(-120);

            for (let b = 0; b < numBands; b++) {
                const band = this.bandLookupTable[b];

                let sumZ = 0;
                let sumA = 0;
                let sumC = 0;

                for (let k = band.kStart; k <= band.kEnd; k++) {
                    const real = outputComplex[2 * k];
                    const imaginary = outputComplex[2 * k + 1];
                    const normalizedMag =
                        Math.sqrt(real * real + imaginary * imaginary) / normDivisor;
                    const power = normalizedMag * normalizedMag;

                    if (power > POWER_FLOOR) {
                        const gainA = this.gainA[k];
                        const gainC = this.gainC[k];
                        sumZ += power;
                        sumA += power * gainA * gainA;
                        sumC += power * gainC * gainC;
                    }
                }

                if (sumZ > 0) {
                    bandDbfsZ[b] = 10 * Math.log10(sumZ);
                    bandDbfsA[b] = 10 * Math.log10(sumA);
                    bandDbfsC[b] = 10 * Math.log10(sumC);
                }
            }

            this.dbfsZFrames.push(bandDbfsZ);
            this.dbfsAFrames.push(bandDbfsA);
            this.dbfsCFrames.push(bandDbfsC);

            framesDone++;
            options.onProgress?.(framesDone, estimatedFrames);

            if (framesDone % yieldEvery === 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        }

        return framesDone;
    }
}

export default RTA;
