/**
 * Validates band-based RTA on a steady 1 kHz tone (test_1kHz.wav).
 * Run: npm run test:rta
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "wav-decoder";

import RTA, { DEFAULT_MAX_FRAMES } from "../audio analysis/RTA";
import Wav from "../audio analysis/Wav";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_WAV = join(__dirname, "audio files", "test_1kHz.wav");

const BANDWIDTH = 1 / 3;
const FFT_SIZE = 2048;
const WINDOW = "hann" as const;

/** test_1kHz.wav is a steady 1 kHz sine at ~−20 dBFS RMS → ~94 dB SPL after calibration. */
const TONE_CENTER_HZ = 1000;
const EXPECTED_SPL_DB = 94;
const SPL_TOLERANCE_DB = 15;
const MIN_BAND_SEPARATION_DB = 40;

function formatDb(value: number): string {
    return Number.isFinite(value) ? value.toFixed(2) : "-inf";
}

function assert(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

function assertNear(actual: number, expected: number, label: string, toleranceDb: number): void {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > toleranceDb) {
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

    const rta = new RTA(wav, BANDWIDTH, FFT_SIZE);
    rta.calibrate(EXPECTED_SPL_DB, { weighting: "Z", speed: "INST" });
    const frameCount = await rta.calculate(0, WINDOW);

    console.log(`File: ${TEST_WAV}`);
    console.log(
        `Duration: ${wav.duration.toFixed(3)} s | Sample rate: ${wav.sampleRate} Hz | Channels: ${wav.channelCount}`
    );
    console.log(
        `RTA: ${BANDWIDTH}/octave | N=${FFT_SIZE} | hop=${rta.getHopSamples()} | ${WINDOW} window | Frames: ${frameCount}`
    );
    console.log(`Calibration offset: ${rta.getCalibrationOffsetDb().toFixed(2)} dB\n`);

    assert(frameCount > 0, "Expected at least one RTA frame");
    assert(rta.getHopSamples() === FFT_SIZE, "Short file should use hop equal to FFT size");

    const frame = rta.getFrame(0);

    console.log("=== Frame 0 — bands (Z dBFS / SPL) ===");
    console.log("Center (Hz) | dBFS (Z) | SPLZ | SPLA | SPLC");
    console.log("------------|----------|------|------|-----");
    for (const band of frame) {
        console.log(
            `${String(band.frequency).padStart(11)} | ${formatDb(band.dbfs).padStart(8)} | ${formatDb(band.splZ).padStart(4)} | ${formatDb(band.splA).padStart(4)} | ${formatDb(band.splC).padStart(4)}`
        );
    }

    const peak = frame.reduce((best, band) => (band.splZ > best.splZ ? band : best), frame[0]);
    const band500 = frame.find((band) => band.frequency === 500);
    const band1000 = frame.find((band) => band.frequency === 1000);
    const band2000 = frame.find((band) => band.frequency === 2000);

    console.log(`\nPeak band: ${peak.frequency} Hz @ SPLZ ${formatDb(peak.splZ)} dB`);

    assert(
        peak.frequency === TONE_CENTER_HZ,
        `Peak band should be ${TONE_CENTER_HZ} Hz, got ${peak.frequency} Hz`
    );

    assert(band1000 !== undefined, "Expected a 1000 Hz center band in the lookup table");
    assert(band500 !== undefined, "Expected a 500 Hz center band for separation check");
    assert(band2000 !== undefined, "Expected a 2000 Hz center band for separation check");

    assertNear(band1000!.splZ, EXPECTED_SPL_DB, "1 kHz SPLZ", SPL_TOLERANCE_DB);
    assertNear(band1000!.splA, EXPECTED_SPL_DB, "1 kHz SPLA", SPL_TOLERANCE_DB);
    assertNear(band1000!.splC, EXPECTED_SPL_DB, "1 kHz SPLC", SPL_TOLERANCE_DB);

    const separationLow = band1000!.splZ - band500!.splZ;
    const separationHigh = band1000!.splZ - band2000!.splZ;

    console.log(`Separation vs 500 Hz band:  ${formatDb(separationLow)} dB`);
    console.log(`Separation vs 2000 Hz band: ${formatDb(separationHigh)} dB`);

    assert(
        separationLow >= MIN_BAND_SEPARATION_DB,
        `1 kHz band should be ≥${MIN_BAND_SEPARATION_DB} dB above 500 Hz band, got ${formatDb(separationLow)} dB`
    );
    assert(
        separationHigh >= MIN_BAND_SEPARATION_DB,
        `1 kHz band should be ≥${MIN_BAND_SEPARATION_DB} dB above 2000 Hz band, got ${formatDb(separationHigh)} dB`
    );

    // Long file: adaptive hop should cap frame count.
    const longDurationSec = 600;
    const longSamples = new Float32Array(decoded.sampleRate * longDurationSec);
    const longWav = Wav.fromDecodedData(decoded.sampleRate, [longSamples]);
    const longRta = new RTA(longWav, BANDWIDTH, FFT_SIZE);
    const longFrames = await longRta.calculate(0, WINDOW);

    console.log(
        `\nLong file (${longDurationSec} s): ${longFrames} frames, hop=${longRta.getHopSamples()} samples`
    );
    assert(
        longFrames <= DEFAULT_MAX_FRAMES,
        `Expected ≤${DEFAULT_MAX_FRAMES} frames for long file, got ${longFrames}`
    );
    assert(longRta.getHopSamples() > FFT_SIZE, "Long file should increase hop beyond FFT size");

    console.log("\nAll RTA checks passed.");
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
