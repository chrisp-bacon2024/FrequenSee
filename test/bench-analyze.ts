/**
 * Benchmark full analyze pipeline (RTA + level traces).
 * Run: npx tsx test/bench-analyze.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "wav-decoder";

import Leq from "../audio analysis/Leq";
import Spectrogram from "../audio analysis/Spectrogram";
import SPL from "../audio analysis/SPL";
import { buildWeightedChannelCache, traceStepMs } from "../audio analysis/dsp";
import Wav from "../audio analysis/Wav";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_WAV = join(__dirname, "audio files", "test_1kHz.wav");

async function bench(label: string, wav: Wav, allTraces: boolean): Promise<void> {
    const stepMs = traceStepMs(wav.duration, 100);
    const t0 = performance.now();

    const rtaStart = performance.now();
    const spec = new Spectrogram(wav, 1 / 3, 2048);
    spec.calibrate(94, { weighting: "Z", speed: "INST" });
    await spec.calculate(0, "hann");
    const rtaMs = performance.now() - rtaStart;

    const spl = new SPL(wav);
    spl.calibrate(94, { weighting: "Z", speed: "INST" });
    const leq = new Leq(wav);
    leq.setTotalMeasurementTime(Math.ceil(wav.duration));
    leq.calibrate(94, { weighting: "Z", speed: "INST" });

    const tracesStart = performance.now();
    const samples = wav.channels[0]!;

    if (allTraces) {
        const cache = buildWeightedChannelCache(samples, wav.sampleRate, ["Z", "A", "C"]);
        for (const weighting of ["Z", "A", "C"] as const) {
            spl.measureOverTime({
                weighting,
                speed: "FAST",
                mode: "SPL",
                stepMs,
                weighted: cache[weighting],
            });
            leq.measureOverTime({
                weighting,
                speed: "INST",
                stepMs,
                weighted: cache[weighting],
            });
        }
    } else {
        const cache = buildWeightedChannelCache(samples, wav.sampleRate, ["Z"]);
        spl.measureOverTime({
            weighting: "Z",
            speed: "FAST",
            mode: "SPL",
            stepMs,
            weighted: cache.Z,
        });
    }

    const tracesMs = performance.now() - tracesStart;
    const totalMs = performance.now() - t0;

    console.log(label);
    console.log(`  duration: ${wav.duration.toFixed(1)} s | step: ${stepMs} ms`);
    console.log(
        `  RTA: ${Math.round(rtaMs)} ms | traces: ${Math.round(tracesMs)} ms | total: ${Math.round(totalMs)} ms`
    );
    console.log();
}

async function main(): Promise<void> {
    const buffer = readFileSync(TEST_WAV);
    const decoded = await decode(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );
    const shortWav = Wav.fromDecodedData(
        decoded.sampleRate,
        decoded.channelData.map((channel) => new Float32Array(channel))
    );

    const longSamples = new Float32Array(decoded.sampleRate * 180);
    const longWav = Wav.fromDecodedData(decoded.sampleRate, [longSamples]);

    await bench("10 s test file (SPLZ only)", shortWav, false);
    await bench("180 s synthetic (SPLZ only)", longWav, false);
    await bench("180 s synthetic (all 6 traces)", longWav, true);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});
