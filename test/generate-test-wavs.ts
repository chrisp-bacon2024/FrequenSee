/**
 * Generates synthetic 16-bit mono WAV files for automated and manual testing.
 *
 * Run: npm run generate:test-wavs
 *
 * Output directory: test/audio files/
 * Expected values: test/audio files/EXPECTED.md
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "audio files");
const SAMPLE_RATE = 44100;

function peakForRmsDbFS(rmsDb: number): number {
    const rms = Math.pow(10, rmsDb / 20);
    return rms * Math.sqrt(2);
}

function rmsDbFS(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    return 20 * Math.log10(rms);
}

function writeWavMono(filePath: string, samples: Float32Array, sampleRate = SAMPLE_RATE): void {
    const numSamples = samples.length;
    const bytesPerSample = 2;
    const dataSize = numSamples * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
    buffer.writeUInt16LE(bytesPerSample, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < numSamples; i++) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        const int16 = Math.round(clamped * 32767);
        buffer.writeInt16LE(int16, 44 + i * 2);
    }

    writeFileSync(filePath, buffer);
}

function generateSineSegment(
    frequencyHz: number,
    durationSec: number,
    rmsDbFS: number,
    sampleRate = SAMPLE_RATE
): Float32Array {
    const length = Math.floor(durationSec * sampleRate);
    const samples = new Float32Array(length);
    const peak = peakForRmsDbFS(rmsDbFS);

    for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        samples[i] = peak * Math.sin(2 * Math.PI * frequencyHz * t);
    }

    return samples;
}

function concatSegments(segments: Float32Array[]): Float32Array {
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    const out = new Float32Array(total);
    let offset = 0;

    for (const segment of segments) {
        out.set(segment, offset);
        offset += segment.length;
    }

    return out;
}

/** Paul Kellet-style pink noise filter (single channel). */
function generatePinkNoise(durationSec: number, targetRmsDbFS: number): Float32Array {
    const length = Math.floor(durationSec * SAMPLE_RATE);
    const samples = new Float32Array(length);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        samples[i] = pink;
    }

    const currentRmsDb = rmsDbFS(samples);
    const gain = Math.pow(10, (targetRmsDbFS - currentRmsDb) / 20);

    for (let i = 0; i < length; i++) {
        samples[i] *= gain;
    }

    return samples;
}

function generateLogSweep(
    startHz: number,
    endHz: number,
    durationSec: number,
    rmsDbFS: number
): Float32Array {
    const length = Math.floor(durationSec * SAMPLE_RATE);
    const samples = new Float32Array(length);
    const peak = peakForRmsDbFS(rmsDbFS);
    const k = Math.log(endHz / startHz) / durationSec;

    for (let i = 0; i < length; i++) {
        const t = i / SAMPLE_RATE;
        const instantaneousFreq = startHz * Math.exp(k * t);
        const phase = (2 * Math.PI * startHz * (Math.exp(k * t) - 1)) / k;
        samples[i] = peak * Math.sin(phase);
    }

    return samples;
}

function main(): void {
    mkdirSync(OUT_DIR, { recursive: true });

    const twoLevel = concatSegments([
        generateSineSegment(1000, 5, -20),
        generateSineSegment(1000, 5, -30),
    ]);
    writeWavMono(join(OUT_DIR, "test_two_level.wav"), twoLevel);

    const lowHigh = concatSegments([
        generateSineSegment(100, 5, -20),
        generateSineSegment(1000, 5, -20),
    ]);
    writeWavMono(join(OUT_DIR, "test_low_high.wav"), lowHigh);

    const pink = generatePinkNoise(10, -20);
    writeWavMono(join(OUT_DIR, "test_pink.wav"), pink);

    const sweep = generateLogSweep(100, 10000, 10, -20);
    writeWavMono(join(OUT_DIR, "test_log_sweep.wav"), sweep);

    console.log("Generated test WAV files in:", OUT_DIR);
    console.log();
    console.log("test_two_level.wav");
    console.log("  0–5 s:  1 kHz sine @ -20 dBFS RMS");
    console.log("  5–10 s: 1 kHz sine @ -30 dBFS RMS");
    console.log("  Expected Z INST SPL per segment (offset=114): 94 dB, then 84 dB");
    console.log("  Expected full-file Leq (Z): -22.58 dBFS → 91.42 dB SPL");
    console.log();
    console.log("test_low_high.wav");
    console.log("  0–5 s:  100 Hz @ -20 dBFS RMS");
    console.log("  5–10 s: 1 kHz @ -20 dBFS RMS");
    console.log("  Expected Z: ~94 dB both segments; A: much lower at 100 Hz");
    console.log();
    console.log("test_pink.wav");
    console.log(`  10 s pink noise, measured RMS: ${rmsDbFS(pink).toFixed(2)} dBFS`);
    console.log("  Expected Z ≈ -20 dBFS (+ calibration); A lower than Z");
    console.log();
    console.log("test_log_sweep.wav");
    console.log("  100 Hz → 10 kHz log sweep @ -20 dBFS RMS (approx per instant freq)");
    console.log("  Expected Z varies; useful for visual weighting differences");
}

main();
