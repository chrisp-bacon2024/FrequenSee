# Tests and test audio

Automated checks run in **Node.js** (not the browser). They use `wav-decoder` to read WAV files and the same `audio analysis/` library as the web app.

## Commands

| Script | What it does |
|--------|----------------|
| `npm run generate:test-wavs` | Create or refresh synthetic WAV files in `audio files/`. |
| `npm run test:spl` | Print SPL every 100 ms for all weighting × speed on `test_1kHz.wav`. |
| `npm run test:leq` | Print cumulative Leq; assert ~94 dB on steady 1 kHz tone. |
| `npm run test:leq:two-level` | Assert known SPL/Leq on `test_two_level.wav`. |

## Test files (`audio files/`)

Detailed expected values: **[EXPECTED.md](audio%20files/EXPECTED.md)**.

| File | Purpose |
|------|---------|
| `test_1kHz.wav` | Steady 1 kHz, ~−20 dBFS. All weightings → ~94 dB SPL after calibration. |
| `test_two_level.wav` | 5 s @ −20 dBFS, then 5 s @ −30 dBFS. **Use for Leq math checks.** |
| `test_low_high.wav` | 100 Hz then 1 kHz, same level. Z flat; A much lower at 100 Hz. |
| `test_pink.wav` | 10 s pink noise @ −20 dBFS. A-weighted < Z-weighted. |
| `test_log_sweep.wav` | 100 Hz–10 kHz sweep. Visual check for weighting curves. |

## Calibration used in tests

Most tests assume:

```
calibration offset = 114 dB
```

So that **−20 dBFS → 94 dB SPL** (because 94 − (−20) = 114).

`test:leq:two-level` sets offset **114** explicitly and checks:

- First 5 s SPL: **94 dB**
- Second 5 s SPL: **84 dB**
- Full-file Leq: **91.42 dB**

## Source files

| File | Role |
|------|------|
| `generate-test-wavs.ts` | Writes 16-bit mono PCM WAVs at 44.1 kHz. |
| `spl-over-time.test.ts` | Human-readable SPL tables for all 9 SPL combinations. |
| `leq.test.ts` | Leq tables + assertions on 1 kHz tone. |
| `leq-two-level.test.ts` | Strict numeric assertions on two-level file. |
| `wav-decoder.d.ts` | TypeScript types for `wav-decoder` in Node. |

## Regenerating test audio

```bash
npm run generate:test-wavs
```

Pink noise uses `Math.random()` and is **not seeded** — RMS is normalized to −20 dBFS each run, but sample values differ between runs. Sine-based files are deterministic.
