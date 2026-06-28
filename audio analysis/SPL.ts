/**
 * Sound pressure level (SPL) measurement from decoded WAV data.
 *
 * @module SPL
 */

import Wav from "./Wav";
import {
    applyWeighting,
    dbFromRatio,
    LevelMode,
    timeWeightedRms,
    TimeWeighting,
    Weighting,
} from "./dsp";

export type MeasureOptions = {
    channel?: number;
    startSample?: number;
    endSample?: number;
    weighting?: Weighting;
    speed?: TimeWeighting;
    mode?: LevelMode;
};

export type MeasureOverTimeOptions = {
    channel?: number;
    weighting?: Weighting;
    speed?: TimeWeighting;
    mode?: LevelMode;
    stepMs?: number;
    /** Pre-weighted channel from {@link buildWeightedChannelCache}. */
    weighted?: Float32Array;
};

class SPL {
    constructor(
        private wav: Wav,
        private calibrationOffsetDb: number = 0
    ) {}

    levelDb(options: MeasureOptions = {}): number {
        const {
            channel = 0,
            startSample = 0,
            endSample = this.wav.channels[channel]?.length ?? 0,
            weighting = "Z",
            speed = "FAST",
        } = options;

        const samples = this.wav.channels[channel];
        if (!samples || endSample <= startSample) {
            throw new Error("Invalid samples");
        }

        const weighted = applyWeighting(
            samples,
            weighting,
            this.wav.sampleRate,
            startSample,
            endSample
        );

        const rmsValue = timeWeightedRms(weighted, this.wav.sampleRate, speed);
        return dbFromRatio(rmsValue);
    }

    measure(options: MeasureOptions = {}): number {
        const { mode = "SPL" } = options;
        const db = this.levelDb(options);
        if (mode === "dBFS") return db;
        return db + this.calibrationOffsetDb;
    }

    measureFromDbfs(dbfs: number, mode: LevelMode = "SPL"): number {
        if (mode === "dBFS") return dbfs;
        return dbfs + this.calibrationOffsetDb;
    }

    calibrate(knownSplDb: number, options: Omit<MeasureOptions, "mode"> = {}): number {
        const db = this.levelDb(options);
        this.calibrationOffsetDb = knownSplDb - db;
        return this.calibrationOffsetDb;
    }

    getCalibrationOffsetDb(): number {
        return this.calibrationOffsetDb;
    }

    setCalibrationOffsetDb(offsetDb: number): void {
        this.calibrationOffsetDb = offsetDb;
    }

    measureOverTime(options: MeasureOverTimeOptions = {}): { timeSec: number; levelDb: number }[] {
        const {
            channel = 0,
            weighting = "Z",
            speed = "FAST",
            mode = "SPL",
            stepMs = 50,
            weighted: weightedInput,
        } = options;

        const samples = this.wav.channels[channel];
        if (!samples) throw new Error("Invalid channel");

        const sampleRate = this.wav.sampleRate;
        const stepSamples = Math.max(1, Math.floor((sampleRate * stepMs) / 1000));
        const offset = mode === "SPL" ? this.calibrationOffsetDb : 0;

        const weighted =
            weightedInput ??
            (weighting === "Z" ? samples : applyWeighting(samples, weighting, sampleRate));

        const results: { timeSec: number; levelDb: number }[] = [];

        if (speed === "INST") {
            let sumSq = 0;
            for (let i = 0; i < samples.length; i++) {
                const sample = weighted[i];
                sumSq += sample * sample;
                const end = i + 1;
                if (end % stepSamples !== 0) continue;
                results.push({
                    timeSec: end / sampleRate,
                    levelDb: dbFromRatio(Math.sqrt(sumSq / end)) + offset,
                });
            }
            return results;
        }

        const tau = speed === "FAST" ? 0.125 : 1.0;
        const decay = Math.exp(-1 / (tau * sampleRate));
        let meanSquare = weighted[0] * weighted[0];

        for (let i = 1; i < samples.length; i++) {
            const squared = weighted[i] * weighted[i];
            meanSquare = decay * meanSquare + (1 - decay) * squared;
            const end = i + 1;
            if (end % stepSamples !== 0) continue;
            results.push({
                timeSec: end / sampleRate,
                levelDb: dbFromRatio(Math.sqrt(meanSquare)) + offset,
            });
        }

        return results;
    }
}

export default SPL;
