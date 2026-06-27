import Wav from "./Wav";
import FFT from "fft.js";
import { weightingGainLinear, TimeWeighting, Weighting } from "./dsp";
import SPL from "./SPL";
import { nominalCenterForBandwidth } from "./rtaNominals";

export interface FrequencyBinData {
    frequency: number;
    dbfs: number;
    dbfsA: number;
    dbfsC: number;
    splZ: number;
    splA: number;
    splC: number;
}

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

    timelineAnalysis: FrequencyBinData[][] = [];

    constructor(private source: Wav, private bandwidth: number = 1, private N: number = 2048) {
        this.spl = new SPL(source);
        this.sampleRate = this.source.sampleRate;

        if (N <= 0 || (N & (N - 1)) !== 0) {
            throw new Error("Window size N must be a strict power of 2 (e.g., 1024, 2048).");
        }

        this.totalBins = this.N / 2;
        this.precomputeBandwidthBins();
    }

    /** Delegates to internal {@link SPL.calibrate}. */
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

    private nominalCenter(fc: number): number {
        return nominalCenterForBandwidth(fc, this.bandwidth);
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
    }

    calculate(channel: number, windowType: "hann" | "hamming" = "hann"): FrequencyBinData[][] {
        const samples = this.source.channels[channel];
        if (!samples) throw new Error("Invalid channel");

        const N = this.N;
        const totalSamples = samples.length;
        const timelineAnalysis: FrequencyBinData[][] = [];

        const fftInstance = new FFT(N);
        const inputSignal = new Float32Array(N);
        const outputComplex = fftInstance.createComplexArray();
        const windowCoefficents = new Float64Array(N);

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

        const rawBinDbfsValues = new Float32Array(this.totalBins);

        for (let i = 0; i <= totalSamples - N; i += N) {
            for (let n = 0; n < N; n++) {
                inputSignal[n] = samples[i + n] * windowCoefficents[n];
            }

            fftInstance.realTransform(outputComplex, inputSignal);

            for (let k = 0; k < this.totalBins; k++) {
                const real = outputComplex[2 * k];
                const imaginary = outputComplex[2 * k + 1];

                const magnitude = Math.sqrt(real ** 2 + imaginary ** 2);
                const normalizedMagnitude = magnitude / (N / 4);

                rawBinDbfsValues[k] = 20 * Math.log10(normalizedMagnitude + Number.EPSILON);
            }

            const collapsedBandFrame: FrequencyBinData[] = new Array(this.bandLookupTable.length);
            for (let b = 0; b < this.bandLookupTable.length; b++) {
                const band = this.bandLookupTable[b];

                let sumZ = 0;
                let sumA = 0;
                let sumC = 0;
                let binsFound = 0;

                for (let k = band.kStart; k <= band.kEnd; k++) {
                    const dbfsValue = rawBinDbfsValues[k];

                    if (dbfsValue > -140) {
                        const power = 10 ** (dbfsValue / 10);
                        const frequencyHz = (k * this.sampleRate) / N;
                        const gainA = weightingGainLinear(frequencyHz, "A");
                        const gainC = weightingGainLinear(frequencyHz, "C");

                        sumZ += power;
                        sumA += power * gainA * gainA;
                        sumC += power * gainC * gainC;
                        binsFound++;
                    }
                }

                let bandDbfsZ = -120;
                let bandDbfsA = -120;
                let bandDbfsC = -120;

                if (binsFound > 0 && sumZ > 0) {
                    bandDbfsZ = 10 * Math.log10(sumZ);
                    bandDbfsA = 10 * Math.log10(sumA);
                    bandDbfsC = 10 * Math.log10(sumC);
                }

                collapsedBandFrame[b] = {
                    frequency: band.centerFrequency,
                    dbfs: parseFloat(bandDbfsZ.toFixed(2)),
                    dbfsA: parseFloat(bandDbfsA.toFixed(2)),
                    dbfsC: parseFloat(bandDbfsC.toFixed(2)),
                    splZ: parseFloat(this.spl.measureFromDbfs(bandDbfsZ).toFixed(2)),
                    splA: parseFloat(this.spl.measureFromDbfs(bandDbfsA).toFixed(2)),
                    splC: parseFloat(this.spl.measureFromDbfs(bandDbfsC).toFixed(2)),
                };
            }
            timelineAnalysis.push(collapsedBandFrame);
        }
        this.timelineAnalysis = timelineAnalysis;
        return timelineAnalysis;
    }
}

export default RTA;
