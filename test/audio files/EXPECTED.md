# Test audio files — expected measurement values

This document lists **what each synthetic WAV contains** and **what SPL/Leq values you should see** when the analysis library is working correctly.

For how to run tests, see [../README.md](../README.md).

Generate or refresh files with:

```bash
npm run generate:test-wavs
```

## test_two_level.wav (10 s)

| Time | Signal | RMS (dBFS) |
|------|--------|------------|
| 0–5 s | 1 kHz sine | **−20** |
| 5–10 s | 1 kHz sine | **−30** |

Calibrate with `94 dB SPL` on the **first 5 s** (Z, INST) → offset **114 dB**.

| Metric | Expected (Z, INST) |
|--------|---------------------|
| SPL 0–5 s | **94.0 dB** |
| SPL 5–10 s | **84.0 dB** |
| Full-file Leq | **91.42 dB** (= 10·log₁₀((10^9.4×5 + 10^8.4×5)/10)) |
| Cumulative Leq @ 5 s | **94.0 dB** |
| Cumulative Leq @ 10 s | **91.42 dB** |

A/C at 1 kHz match Z (reference frequency).

## test_low_high.wav (10 s)

| Time | Signal | RMS (dBFS) |
|------|--------|------------|
| 0–5 s | 100 Hz sine | **−20** |
| 5–10 s | 1 kHz sine | **−20** |

Same peak → same **Z** RMS in both halves (~94 dB SPL after calibration on 1 kHz half or whole file).

**A-weighted** SPL in the 100 Hz half is ~**26 dB lower** than the 1 kHz half.

## test_pink.wav (10 s)

Pink noise normalized to **−20 dBFS RMS** (Z).

Broadband: **A-weighted Leq/SPL < Z-weighted** by several dB.

## test_log_sweep.wav (10 s)

Logarithmic sine sweep **100 Hz → 10 kHz** at ~−20 dBFS.

Level changes with frequency weighting; good for checking graphs visually.

## test_1kHz.wav

Steady 1 kHz tone (~−20 dBFS). All weightings → ~94 dB after calibration.
