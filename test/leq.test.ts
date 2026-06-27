/**
 * Validates Leq on a steady 1 kHz tone (all weightings ≈ 94 dB SPL after calibration).
 * Run: npm run test:leq
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "wav-decoder";

import Leq from "../audio analysis/Leq";
import { Weighting } from "../audio analysis/dsp";
import Wav from "../audio analysis/Wav";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_WAV = join(__dirname, "audio files", "test_1kHz.wav");

const WEIGHTINGS: Weighting[] = ["Z", "A", "C"];
const STEP_MS = 100;
const TOLERANCE_DB = 0.05;

function formatDb(value: number): string {
    return Number.isFinite(value) ? value.toFixed(2) : "-inf";
}

function assertNear(actual: number, expected: number, label: string): void {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > TOLERANCE_DB) {
        throw new Error(`${label}: expected ~${expected.toFixed(2)} dB, got ${formatDb(actual)} dB`);
    }
}

async function main(): Promise<void> {
    const buffer = readFileSync(TEST_WAV);
    const decoded = await decode(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );

    const wav = Wav.fromDecodedData(
        decoded.sampleRate,
        decoded.channelData.map((channel) => new Float32Array(channel))
    );

    const leq = new Leq(wav);
    leq.setTotalMeasurementTime(Math.ceil(wav.duration));
    leq.setSampleDuration(1);
    leq.calibrate(94, { weighting: "Z", speed: "INST" });

    console.log(`File: ${TEST_WAV}`);
    console.log(
        `Duration: ${wav.duration.toFixed(3)} s | Sample rate: ${wav.sampleRate} Hz | Interval: ${leq.getSampleDuration()} s\n`
    );

    console.log("=== Full-file Leq ===");
    console.log("Weighting | Leq (dB)");
    console.log("----------|--------");

    for (const weighting of WEIGHTINGS) {
        const value = leq.calculate(weighting);
        console.log(`${weighting.padEnd(9)} | ${formatDb(value).padStart(7)}`);
        assertNear(value, 94, `Full-file ${weighting}-weighted Leq`);
    }

    console.log("\n=== Cumulative Leq over time ===");

    for (const weighting of WEIGHTINGS) {
        const trace = leq.measureOverTime({
            weighting,
            speed: "INST",
            stepMs: STEP_MS,
        });

        console.log(`\n--- ${weighting}-weighted ---`);
        console.log("Time (s) | Leq (dB)");
        console.log("---------|--------");

        for (const point of trace) {
            console.log(
                `${point.timeSec.toFixed(2).padStart(8)} | ${formatDb(point.levelDb).padStart(7)}`
            );
        }

        const final = trace[trace.length - 1]?.levelDb ?? -Infinity;
        assertNear(final, 94, `Final cumulative ${weighting}-weighted Leq`);

        for (let i = 1; i < trace.length; i++) {
            if (trace[i].levelDb + 0.01 < trace[i - 1].levelDb) {
                throw new Error(
                    `${weighting} cumulative Leq decreased at t=${trace[i].timeSec.toFixed(2)} s`
                );
            }
        }
    }

    console.log("\nAll Leq checks passed.");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
