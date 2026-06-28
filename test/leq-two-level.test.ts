/**
 * Validates known SPL and Leq values on test_two_level.wav (see EXPECTED.md).
 * Run: npm run test:leq:two-level
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "wav-decoder";

import Leq from "../audio analysis/Leq";
import SPL from "../audio analysis/SPL";
import Wav from "../audio analysis/Wav";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TWO_LEVEL_WAV = join(__dirname, "audio files", "test_two_level.wav");

const CALIBRATION_OFFSET_DB = 114;
const TOLERANCE_DB = 0.1;

function formatDb(value: number): string {
    return Number.isFinite(value) ? value.toFixed(2) : "-inf";
}

function assertNear(actual: number, expected: number, label: string): void {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > TOLERANCE_DB) {
        throw new Error(`${label}: expected ${expected.toFixed(2)} dB, got ${formatDb(actual)} dB`);
    }
}

async function loadWav(path: string): Promise<Wav> {
    const buffer = readFileSync(path);
    const decoded = await decode(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );

    return Wav.fromDecodedData(
        decoded.sampleRate,
        decoded.channelData.map((channel) => new Float32Array(channel))
    );
}

async function main(): Promise<void> {
    const wav = await loadWav(TWO_LEVEL_WAV);
    const sampleRate = wav.sampleRate;
    const fiveSeconds = Math.floor(5 * sampleRate);

    const spl = new SPL(wav);
    spl.setCalibrationOffsetDb(CALIBRATION_OFFSET_DB);

    const leq = new Leq(wav);
    leq.setTotalMeasurementTime(Math.ceil(wav.duration));
    leq.setSampleDuration(1);
    leq.setCalibrationOffsetDb(CALIBRATION_OFFSET_DB);

    console.log("=== test_two_level.wav ===\n");

    const splFirstHalf = spl.measure({
        weighting: "Z",
        speed: "INST",
        startSample: 0,
        endSample: fiveSeconds,
    });
    const splSecondHalf = spl.measure({
        weighting: "Z",
        speed: "INST",
        startSample: fiveSeconds,
        endSample: wav.channels[0].length,
    });

    console.log("Segment SPL (Z, INST):");
    console.log(`  0–5 s:  ${formatDb(splFirstHalf)} dB (expected 94.00)`);
    console.log(`  5–10 s: ${formatDb(splSecondHalf)} dB (expected 84.00)`);
    assertNear(splFirstHalf, 94, "First half SPL");
    assertNear(splSecondHalf, 84, "Second half SPL");

    const fullLeq = leq.calculate("Z");
    console.log(`\nFull-file Leq (Z): ${formatDb(fullLeq)} dB (expected 91.42)`);
    assertNear(fullLeq, 91.42, "Full-file Leq");

    const trace = leq.measureOverTime({ weighting: "Z", speed: "INST", stepMs: 100 });
    const at5s = trace.find((point) => Math.abs(point.timeSec - 5) < 0.05);
    const at10s = trace[trace.length - 1];

    console.log(`\nCumulative Leq @ 5 s:  ${formatDb(at5s?.levelDb ?? -Infinity)} dB (expected 94.00)`);
    console.log(`Cumulative Leq @ 10 s: ${formatDb(at10s.levelDb)} dB (expected 91.42)`);
    assertNear(at5s?.levelDb ?? -Infinity, 94, "Cumulative Leq @ 5 s");
    assertNear(at10s.levelDb, 91.42, "Cumulative Leq @ 10 s");

    console.log("\nAll two-level WAV checks passed.");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
