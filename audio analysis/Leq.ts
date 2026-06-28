/**
 * Equivalent continuous sound level (Leq) from decoded WAV data.
 *
 * @module Leq
 */

import Wav from "./Wav";
import SPL from "./SPL";
import { applyWeighting, dbFromRatio, rms, TimeWeighting, Weighting } from "./dsp";

export type LeqMeasureOverTimeOptions = {
    channel?: number;
    weighting?: Weighting;
    speed?: TimeWeighting;
    stepMs?: number;
    /** Pre-weighted channel from {@link buildWeightedChannelCache}. */
    weighted?: Float32Array;
};

class Leq {
    private spl: SPL;

    public totalMeasurementTime = 600;
    public sample_duration = 1;

    constructor(private wav: Wav) {
        this.spl = new SPL(wav);
    }

    getTotalMeasurementTime(): number {
        return this.totalMeasurementTime;
    }

    setTotalMeasurementTime(time: number): void {
        this.totalMeasurementTime = time;
    }

    getSampleDuration(): number {
        return this.sample_duration;
    }

    setSampleDuration(duration: number): void {
        this.sample_duration = duration;
    }

    calibrate(knownSplDb: number, options: { weighting?: Weighting; speed?: TimeWeighting } = {}): number {
        return this.spl.calibrate(knownSplDb, options);
    }

    setCalibrationOffsetDb(offsetDb: number): void {
        this.spl.setCalibrationOffsetDb(offsetDb);
    }

    private resolveWeighted(
        channel: number,
        weighting: Weighting,
        weightedInput?: Float32Array
    ): Float32Array {
        const samples = this.wav.channels[channel];
        if (!samples) throw new Error("Invalid channel");
        if (weightedInput) return weightedInput;
        if (weighting === "Z") return samples;
        return applyWeighting(samples, weighting, this.wav.sampleRate);
    }

    private windowLinearEnergy(
        weighted: Float32Array,
        start: number,
        end: number,
        calibrationOffsetDb: number
    ): number {
        const duration = (end - start) / this.wav.sampleRate;
        const levelDb = dbFromRatio(rms(weighted, start, end)) + calibrationOffsetDb;
        if (!Number.isFinite(levelDb)) return 0;
        return Math.pow(10, levelDb / 10) * duration;
    }

    private windowLinearEnergyFromSumSq(
        sumSq: number,
        sampleCount: number,
        calibrationOffsetDb: number,
        durationSec: number
    ): number {
        if (sampleCount <= 0 || durationSec <= 0) return 0;
        const levelDb = dbFromRatio(Math.sqrt(sumSq / sampleCount)) + calibrationOffsetDb;
        if (!Number.isFinite(levelDb)) return 0;
        return Math.pow(10, levelDb / 10) * durationSec;
    }

    calculate(weighting: Weighting, speed: TimeWeighting = "INST", channel = 0): number {
        const samples = this.wav.channels[channel];
        if (!samples) throw new Error("Invalid channel");

        const sampleRate = this.wav.sampleRate;
        const windowSamples = Math.max(1, Math.floor(this.sample_duration * sampleRate));
        const maxSamples = Math.min(
            samples.length,
            Math.floor(this.totalMeasurementTime * sampleRate)
        );
        const weighted = this.resolveWeighted(channel, weighting);
        const calibrationOffsetDb = this.spl.getCalibrationOffsetDb();

        let energySum = 0;
        let integratedSeconds = 0;

        for (let start = 0; start + windowSamples <= maxSamples; start += windowSamples) {
            const end = start + windowSamples;
            const linearEnergy = this.windowLinearEnergy(
                weighted,
                start,
                end,
                calibrationOffsetDb
            );
            if (linearEnergy <= 0) continue;
            energySum += linearEnergy;
            integratedSeconds += windowSamples / sampleRate;
        }

        if (integratedSeconds <= 0) return -Infinity;
        return 10 * Math.log10(energySum / integratedSeconds);
    }

    measureOverTime(options: LeqMeasureOverTimeOptions = {}): { timeSec: number; levelDb: number }[] {
        const { channel = 0, weighting = "Z", stepMs = 100, weighted: weightedInput } = options;

        const samples = this.wav.channels[channel];
        if (!samples) throw new Error("Invalid channel");

        const sampleRate = this.wav.sampleRate;
        const stepSamples = Math.max(1, Math.floor((sampleRate * stepMs) / 1000));
        const maxSamples = Math.min(
            samples.length,
            Math.floor(this.totalMeasurementTime * sampleRate)
        );
        const windowSamples = Math.max(1, Math.floor(this.sample_duration * sampleRate));
        const windowDuration = windowSamples / sampleRate;
        const weighted = this.resolveWeighted(channel, weighting, weightedInput);
        const calibrationOffsetDb = this.spl.getCalibrationOffsetDb();

        const fullWindowCount = Math.floor(maxSamples / windowSamples);
        const windowLinearEnergy = new Float64Array(fullWindowCount);
        for (let w = 0; w < fullWindowCount; w++) {
            const start = w * windowSamples;
            windowLinearEnergy[w] = this.windowLinearEnergy(
                weighted,
                start,
                start + windowSamples,
                calibrationOffsetDb
            );
        }

        const results: { timeSec: number; levelDb: number }[] = [];
        let completedWindows = 0;
        let energySum = 0;
        let integratedSeconds = 0;
        let partialBase = 0;
        let partialSumSq = 0;
        let prevEnd = 0;

        for (let end = stepSamples; end <= maxSamples; end += stepSamples) {
            const fullWindowsAtEnd = Math.floor(end / windowSamples);

            while (completedWindows < fullWindowsAtEnd) {
                energySum += windowLinearEnergy[completedWindows];
                integratedSeconds += windowDuration;
                completedWindows++;
            }

            const partialStart = completedWindows * windowSamples;
            if (partialStart !== partialBase) {
                partialBase = partialStart;
                partialSumSq = 0;
                prevEnd = partialStart;
            }

            for (let i = prevEnd; i < end; i++) {
                const sample = weighted[i];
                partialSumSq += sample * sample;
            }
            prevEnd = end;

            let totalEnergy = energySum;
            let totalSeconds = integratedSeconds;

            const remainder = end - partialStart;
            if (remainder > 0) {
                const partialEnergy = this.windowLinearEnergyFromSumSq(
                    partialSumSq,
                    remainder,
                    calibrationOffsetDb,
                    remainder / sampleRate
                );
                if (partialEnergy > 0) {
                    totalEnergy += partialEnergy;
                    totalSeconds += remainder / sampleRate;
                }
            }

            results.push({
                timeSec: end / sampleRate,
                levelDb:
                    totalSeconds > 0 ? 10 * Math.log10(totalEnergy / totalSeconds) : -Infinity,
            });
        }

        return results;
    }
}

export default Leq;
