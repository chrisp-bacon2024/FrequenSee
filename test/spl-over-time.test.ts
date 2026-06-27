/**
 * Prints SPL over time for every weighting × speed combination on test_1kHz.wav.
 * Run: npm run test:spl
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "wav-decoder";

import SPL from "../audio analysis/SPL";
import { TimeWeighting, Weighting } from "../audio analysis/dsp";
import Wav from "../audio analysis/Wav";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_WAV = join(__dirname, "audio files", "test_1kHz.wav");

const WEIGHTINGS: Weighting[] = ["Z", "A", "C"];
const SPEEDS: TimeWeighting[] = ["FAST", "SLOW", "INST"];
const STEP_MS = 100;

function formatDb(value: number): string {
    return Number.isFinite(value) ? value.toFixed(2) : "-inf";
}

async function main(): Promise<void> {
    const buffer = readFileSync(TEST_WAV);
    const decoded = await decode(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

    const wav = Wav.fromDecodedData(
        decoded.sampleRate,
        decoded.channelData.map((channel) => new Float32Array(channel))
    );

    const spl = new SPL(wav);
    spl.calibrate(94, { weighting: "Z", speed: "INST" });

    console.log(`File: ${TEST_WAV}`);
    console.log(
        `Duration: ${wav.duration.toFixed(3)} s | Sample rate: ${wav.sampleRate} Hz | Channels: ${wav.channelCount}`
    );
    console.log(`Step: ${STEP_MS} ms`);
    console.log(
        `Calibration offset (Z/INST → 94 dB SPL): ${spl.getCalibrationOffsetDb().toFixed(2)} dB\n`
    );

    for (const weighting of WEIGHTINGS) {
        for (const speed of SPEEDS) {
            const trace = spl.measureOverTime({
                weighting,
                speed,
                mode: "SPL",
                stepMs: STEP_MS,
            });

            console.log(`=== Weighting: ${weighting} | Speed: ${speed} (SPL) ===`);
            console.log("Time (s) | SPL (dB)");
            console.log("---------|----------");

            for (const point of trace) {
                console.log(
                    `${point.timeSec.toFixed(2).padStart(8)} | ${formatDb(point.levelDb).padStart(9)}`
                );
            }

            console.log();
        }
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
