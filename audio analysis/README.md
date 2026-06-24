# Audio analysis library

TypeScript modules that turn decoded WAV samples into **SPL** and **Leq** readings. Used by the web app and by Node tests.

## Data flow

```
WAV file / upload
    → Wav.load() or Wav.fromDecodedData()
    → Float32Array per channel
    → applyWeighting (Z / A / C)
    → timeWeightedRms (FAST / SLOW / INST)  [SPL only]
    → dBFS → + calibration offset → SPL or Leq
```

## Modules

### `wav.ts` — `Wav`

Loads audio and exposes sample data.

| Member | Description |
|--------|-------------|
| `constructor(source: File \| string)` | Browser `File` from upload, or URL string for `fetch`. |
| `load(ctx: AudioContext)` | Decode via Web Audio API; fills `channels`, `sampleRate`, `duration`. |
| `static fromDecodedData(...)` | Build from raw PCM (Node tests without `AudioContext`). |
| `channels` | `Float32Array[]` — one array per channel, values typically −1…+1. |

### `dsp.ts` — Digital signal processing

Shared math and filters. No calibration; works in **dBFS** space.

| Export | Description |
|--------|-------------|
| `rms(samples, start?, end?)` | Root mean square of a sample slice. |
| `dbFromRatio(ratio)` | \(20 \log_{10}(\text{ratio})\); returns −∞ if ratio ≤ 0. |
| `applyWeighting(samples, weighting, sampleRate, ...)` | Returns filtered copy: Z unchanged, A via FFT curve, C via IIR. |
| `timeWeightedRms(samples, sampleRate, speed)` | FAST (125 ms), SLOW (1 s), or INST (plain RMS). |
| `Weighting` | `"Z" \| "A" \| "C"` |
| `TimeWeighting` | `"FAST" \| "SLOW" \| "INST"` |
| `LevelMode` | `"SPL" \| "dBFS"` |

### `SPL.ts` — `SPL`

Short-term **sound pressure level** with optional calibration.

| Method | Description |
|--------|-------------|
| `measure(options?)` | Main entry. Returns dBFS or SPL per `mode`. |
| `levelDb(options?)` | Uncalibrated level (dBFS) after weighting + time weighting. |
| `calibrate(knownSplDb, options?)` | Sets offset so current window reads `knownSplDb`. |
| `measureOverTime(options?)` | Array of `{ timeSec, levelDb }` from file start to each step (meter-style buildup). |
| `get/setCalibrationOffsetDb` | Read or manually set offset. |

**`MeasureOptions`:** `channel`, `startSample`, `endSample`, `weighting`, `speed`, `mode`.

### `Leq.ts` — `Leq`

**Equivalent continuous level** over an integration period.

| Property / method | Description |
|-------------------|-------------|
| `totalMeasurementTime` | Max seconds to integrate (default 600). |
| `sample_duration` | Sub-interval length in seconds for energy sum (default 1). |
| `calculate(weighting, speed?, channel?)` | Single Leq value over the integrated range. |
| `measureOverTime(options?)` | **Cumulative** Leq from t = 0 to each time step. |
| `calibrate` / `setCalibrationOffsetDb` | Same offset model as `SPL`. |

Leq uses **linear energy averaging** of sub-interval SPL values, not Fast/Slow exponential smoothing.

## Example (browser)

```typescript
const wav = new Wav(file);
await wav.load(new AudioContext());

const spl = new SPL(wav);
spl.calibrate(94, { weighting: "Z", speed: "INST" });

console.log(spl.measure({ weighting: "A", speed: "FAST" })); // dBA-style short-term

const leq = new Leq(wav);
leq.setTotalMeasurementTime(Math.ceil(wav.duration));
leq.calibrate(94, { weighting: "Z", speed: "INST" });
console.log(leq.calculate("A")); // LAeq over file
```

## Example (Node test)

```typescript
const wav = Wav.fromDecodedData(44100, [float32Channel]);
const spl = new SPL(wav);
spl.setCalibrationOffsetDb(114);
```
