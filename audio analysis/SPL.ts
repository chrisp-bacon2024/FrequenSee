/**
 * Sound pressure level (SPL) measurement from decoded WAV data.
 *
 * Pipeline: frequency weighting → time weighting → RMS → dBFS → optional
 * calibration offset → SPL in dB.
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

/** Options for {@link SPL.measure} and {@link SPL.levelDb}. */
export type MeasureOptions = {
    /** Audio channel index (default 0). */
    channel?: number;
    /** First sample index (inclusive). */
    startSample?: number;
    /** Last sample index (exclusive). */
    endSample?: number;
    /** Z (flat), A, or C frequency weighting. */
    weighting?: Weighting;
    /** FAST, SLOW, or INST time weighting. */
    speed?: TimeWeighting;
    /** `SPL` adds calibration; `dBFS` returns digital level only. */
    mode?: LevelMode;
};

class SPL {
    /**
     * @param wav - Loaded audio to measure.
     * @param calibrationOffsetDb - Added to dBFS to produce SPL (default 0).
     */
    constructor(
        private wav: Wav,
        private calibrationOffsetDb: number = 0
    ) {}

    /** Uncalibrated level in dBFS after weighting and time weighting. */
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

    /**
     * Returns SPL or dBFS for the selected window and weighting.
     * Default mode is `SPL` (includes calibration offset).
     */
    measure(options: MeasureOptions = {}): number {
        const { mode = "SPL" } = options;
        const db = this.levelDb(options);

        if (mode === "dBFS") {
            return db;
        }

        return db + this.calibrationOffsetDb;
    }

    /** Applies calibration offset to an already-computed dBFS value (no re-measurement). */
    measureFromDbfs(dbfs: number, mode: LevelMode = "SPL"): number {
        if (mode === "dBFS") {
            return dbfs;
        }
        return dbfs + this.calibrationOffsetDb;
    }

    /**
     * Sets calibration so the current window reads `knownSplDb`.
     * Use the same weighting and speed as subsequent measurements.
     */
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

    /**
     * Level at increasing time points from the start of the file.
     * FAST/SLOW produce meter-style exponential buildup from t = 0.
     */
    measureOverTime(
        options: {
            channel?: number;
            weighting?: Weighting;
            speed?: TimeWeighting;
            mode?: LevelMode;
            stepMs?: number;
        } = {}
    ): { timeSec: number; levelDb: number }[] {
        const {
            channel = 0,
            weighting = "Z",
            speed = "FAST",
            mode = "SPL",
            stepMs = 50,
        } = options;

        const samples = this.wav.channels[channel];
        if (!samples) throw new Error("Invalid channel");

        const stepSamples = Math.max(
            1,
            Math.floor((this.wav.sampleRate * stepMs) / 1000)
        );

        const results: { timeSec: number; levelDb: number }[] = [];

        for (let end = stepSamples; end <= samples.length; end += stepSamples) {
            results.push({
                timeSec: end / this.wav.sampleRate,
                levelDb: this.measure({
                    channel,
                    startSample: 0,
                    endSample: end,
                    weighting,
                    speed,
                    mode,
                }),
            });
        }

        return results;
    }
}

export default SPL;
