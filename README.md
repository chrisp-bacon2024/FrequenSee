# Audio Visualizer

A browser-based tool and TypeScript library for analyzing **WAV** audio files. It computes **sound pressure level (SPL)**, **equivalent continuous level (Leq)**, and related metrics using frequency and time weighting similar to a sound level meter.

This project is intended for **learning, visualization, and offline analysis**. It is not a certified sound level meter. Results depend on how you calibrate the software.

---

## Quick start

### Run the web app (localhost)

```bash
npm install
npm run dev
```

Open **http://localhost:5173/** in your browser. The app loads a default test tone, computes all graph traces, and lets you upload your own WAV file.

### Run tests (command line)

```bash
npm run test:spl              # SPL over time on steady 1 kHz tone
npm run test:leq              # Leq on steady 1 kHz tone
npm run test:leq:two-level    # Leq/SPL on two-level test file (known answers)
npm run generate:test-wavs    # Regenerate synthetic test WAV files
```

---

## Core ideas (plain language)

### What is a WAV file here?

A WAV file stores **audio samples**: numbers that describe air pressure over time, normalized between −1.0 and +1.0 (digital full scale). The library decodes that into floating-point arrays you can measure.

### dBFS vs dB SPL

| Term | Meaning |
|------|---------|
| **dBFS** | Level relative to **digital full scale** (0 dBFS = maximum sample value). No microphone required. |
| **dB SPL** | Level relative to **real-world sound pressure** (20 µPa reference). Requires **calibration**. |

WAV files only contain digital samples. To report SPL, you apply a **calibration offset** that maps your digital levels to known acoustic levels.

### Frequency weighting (Z, A, C)

Human hearing and regulations treat frequencies differently:

- **Z** — Flat; all frequencies weighted equally.
- **A** — Low frequencies reduced (matches hearing at moderate levels). Common for environmental noise (**dBA**).
- **C** — Less low-frequency roll-off than A.

### Time weighting (Fast, Slow, Instantaneous)

Used for **SPL** “how loud right now?” display:

- **Fast** — 125 ms response; reacts quickly.
- **Slow** — 1 s response; smoother.
- **Instantaneous** — No extra smoothing; RMS over the selected window.

**Leq does not use Fast/Slow.** Leq is an average energy over a period (see below).

### Leq (equivalent continuous level)

**Leq** answers: *“If this varying sound were a steady tone, how loud would it be over the whole period?”*

It averages **energy** (not decibels directly), then converts back to dB:

\[
L_{eq} = 10 \log_{10}\left(\frac{1}{T}\sum_i 10^{L_i/10} \cdot \Delta t_i\right)
\]

On the graph, **cumulative Leq** shows Leq from the start of the file up to each point in time.

### Calibration

The app calibrates by assuming the reference file (`test_1kHz.wav`) represents **94 dB SPL** at **Z / Instantaneous** weighting. That sets an offset added to all SPL/Leq readings:

```
SPL (dB) = measured dBFS + calibration offset
```

For your own hardware chain, you would replace this with a measurement from a known source (calibrator, reference tone, or SPL meter).

---

## Project structure

```
Audio Visualizer/
├── audio analysis/     # Core measurement library (WAV, DSP, SPL, Leq)
│   ├── wav.ts          # Load and hold decoded audio
│   ├── dsp.ts          # RMS, dB, filters, time weighting
│   ├── SPL.ts          # Sound pressure level
│   └── Leq.ts          # Equivalent continuous level
├── src/                # Web UI (Vite + canvas chart)
│   ├── main.ts         # App logic and graph dropdown
│   └── chart.ts        # Canvas line chart
├── test/               # CLI tests and WAV generators
│   ├── audio files/    # Test WAVs + EXPECTED.md
│   └── *.test.ts       # Automated checks
├── public/             # Static assets served to the browser
├── index.html          # App entry page
└── vite.config.ts      # Dev server configuration
```

See [audio analysis/README.md](audio%20analysis/README.md) for API details and [test/README.md](test/README.md) for test files and expected values.

---

## Web app usage

1. **Upload a WAV** or use the default `test_1kHz.wav`.
2. Wait for **“Analyzing audio…”** to finish (all traces are precomputed).
3. Use the **Graph** dropdown:
   - **SPL** group — Fast / Slow / Instantaneous for Z, A, and C.
   - **Leq** group — Cumulative LAeq, LZeq, LCeq over time.
4. Read metadata above the chart: duration, sample rate, calibration offset, Leq interval.

---

## Build for production

```bash
npm run build      # Output in dist/
npm run preview    # Serve dist/ locally
```

Deploy the `dist/` folder to static hosting (e.g. GitHub Pages).

---

## Limitations

- **WAV only** in the browser (via `AudioContext.decodeAudioData`).
- **A-weighting** uses frequency-domain IEC curves; **C-weighting** uses IIR filters.
- **No RTA / FFT bands** yet (future work).
- **Calibration** is a single offset; not a substitute for a traceable meter calibration.

---

## License

No license file is included yet. Add one before public distribution.
