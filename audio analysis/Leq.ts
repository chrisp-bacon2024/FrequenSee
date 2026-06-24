/**
 * Equivalent continuous sound level (Leq) from decoded WAV data.
 *
 * Leq averages **energy** over time (not decibels directly). Use
 * {@link calculate} for one value over the integration period, or
 * {@link measureOverTime} for cumulative Leq from the start of the file.
 *
 * Leq does not use Fast/Slow time weighting; sub-intervals typically use INST RMS.
 *
 * @module Leq
 */

import Wav from "./wav";
import SPL from "./SPL";
import { TimeWeighting, Weighting } from "./dsp";

class Leq {
    private spl: SPL;

    /** Maximum integration length in seconds (default 600 = 10 minutes). */
    public totalMeasurementTime = 600;

    /** Length of each sub-interval summed into Leq, in seconds (default 1). */
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

    /** Delegates to internal {@link SPL.calibrate}. */
    calibrate(knownSplDb: number, options: { weighting?: Weighting; speed?: TimeWeighting } = {}): number {
        return this.spl.calibrate(knownSplDb, options);
    }

    /** Sets the same calibration offset used by SPL measurements. */
    setCalibrationOffsetDb(offsetDb: number): void {
        this.spl.setCalibrationOffsetDb(offsetDb);
    }

    /**
     * Single Leq value over integrated sub-intervals up to
     * {@link totalMeasurementTime} or file length, whichever is shorter.
     */
    calculate(
        weighting: Weighting,
        speed: TimeWeighting = "INST",
        channel = 0
    ): number {
        const samples = this.wav.channels[channel];
        if (!samples) throw new Error("Invalid channel");

        const sampleRate = this.wav.sampleRate;
        const windowSamples = Math.max(1, Math.floor(this.sample_duration * sampleRate));
        const maxSamples = Math.min(
            samples.length,
            Math.floor(this.totalMeasurementTime * sampleRate)
        );

        let energySum = 0;
        let integratedSeconds = 0;

        for (let start = 0; start + windowSamples <= maxSamples; start += windowSamples) {
            const end = start + windowSamples;
            const actualDuration = (end - start) / sampleRate;
            const levelDb = this.spl.measure({
                channel,
                startSample: start,
                endSample: end,
                weighting,
                speed,
                mode: "SPL",
            });

            if (!Number.isFinite(levelDb)) continue;

            energySum += Math.pow(10, levelDb / 10) * actualDuration;
            integratedSeconds += actualDuration;
        }

        if (integratedSeconds <= 0) return -Infinity;

        return 10 * Math.log10(energySum / integratedSeconds);
    }

    /**
     * Cumulative Leq from t = 0 to each time step (for graphing).
     * Partial final sub-intervals are included at each step.
     */
    measureOverTime(
        options: {
            channel?: number;
            weighting?: Weighting;
            speed?: TimeWeighting;
            stepMs?: number;
        } = {}
    ): { timeSec: number; levelDb: number }[] {
        const {
            channel = 0,
            weighting = "Z",
            speed = "INST",
            stepMs = 100,
        } = options;

        const samples = this.wav.channels[channel];
        if (!samples) throw new Error("Invalid channel");

        const sampleRate = this.wav.sampleRate;
        const stepSamples = Math.max(1, Math.floor((sampleRate * stepMs) / 1000));
        const maxSamples = Math.min(
            samples.length,
            Math.floor(this.totalMeasurementTime * sampleRate)
        );

        const results: { timeSec: number; levelDb: number }[] = [];

        for (let end = stepSamples; end <= maxSamples; end += stepSamples) {
            results.push({
                timeSec: end / sampleRate,
                levelDb: this.cumulativeLeqUpTo(end, channel, weighting, speed),
            });
        }

        return results;
    }

    private cumulativeLeqUpTo(
        endSample: number,
        channel: number,
        weighting: Weighting,
        speed: TimeWeighting
    ): number {
        const sampleRate = this.wav.sampleRate;
        const windowSamples = Math.max(1, Math.floor(this.sample_duration * sampleRate));

        let energySum = 0;
        let integratedSeconds = 0;

        const fullWindows = Math.floor(endSample / windowSamples);

        for (let i = 0; i < fullWindows; i++) {
            const start = i * windowSamples;
            const end = start + windowSamples;
            const duration = windowSamples / sampleRate;
            const levelDb = this.spl.measure({
                channel,
                startSample: start,
                endSample: end,
                weighting,
                speed,
                mode: "SPL",
            });

            if (!Number.isFinite(levelDb)) continue;

            energySum += Math.pow(10, levelDb / 10) * duration;
            integratedSeconds += duration;
        }

        const remainder = endSample - fullWindows * windowSamples;
        if (remainder > 0) {
            const start = fullWindows * windowSamples;
            const duration = remainder / sampleRate;
            const levelDb = this.spl.measure({
                channel,
                startSample: start,
                endSample: endSample,
                weighting,
                speed,
                mode: "SPL",
            });

            if (Number.isFinite(levelDb)) {
                energySum += Math.pow(10, levelDb / 10) * duration;
                integratedSeconds += duration;
            }
        }

        if (integratedSeconds <= 0) return -Infinity;

        return 10 * Math.log10(energySum / integratedSeconds);
    }
}

export default Leq;
