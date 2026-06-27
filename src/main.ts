/**
 * SPL Visualizer — browser application entry point.
 *
 * Loads a WAV (default or user upload), precomputes SPL and Leq traces,
 * and renders selected series on a combined graph. See project README.md.
 *
 * @module main
 */

import Leq from "../audio analysis/Leq";
import SPL from "../audio analysis/SPL";
import { Weighting } from "../audio analysis/dsp";
import Wav from "../audio analysis/Wav";
import { ChartPoint, ChartSeries, SplChart } from "./chart";

type TraceKey = "SPLZ" | "SPLA" | "SPLC" | "LZEQ" | "LAEQ" | "LCEQ";

type TraceConfig = {
    key: TraceKey;
    label: string;
    color: string;
    kind: "SPL" | "LEQ";
    weighting: Weighting;
    dashed?: boolean;
    defaultOn: boolean;
};

const TRACES: TraceConfig[] = [
    { key: "SPLZ", label: "SPLZ", color: "#5b9cff", kind: "SPL", weighting: "Z", defaultOn: true },
    { key: "SPLA", label: "SPLA", color: "#ff6b8a", kind: "SPL", weighting: "A", defaultOn: false },
    { key: "SPLC", label: "SPLC", color: "#ffd166", kind: "SPL", weighting: "C", defaultOn: false },
    { key: "LZEQ", label: "LZEQ", color: "#7bdcb5", kind: "LEQ", weighting: "Z", dashed: true, defaultOn: false },
    { key: "LAEQ", label: "LAEQ", color: "#c792ea", kind: "LEQ", weighting: "A", dashed: true, defaultOn: false },
    { key: "LCEQ", label: "LCEQ", color: "#f78c6c", kind: "LEQ", weighting: "C", dashed: true, defaultOn: false },
];

const STEP_MS = 100;
const DEFAULT_WAV = "/test_1kHz.wav";

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const seriesToggles = document.getElementById("series-toggles") as HTMLDivElement;
const meta = document.getElementById("meta") as HTMLElement;
const loading = document.getElementById("loading") as HTMLParagraphElement;
const chartCanvas = document.getElementById("chart") as HTMLCanvasElement;

const chart = new SplChart(chartCanvas);
const audioContext = new AudioContext();
const traceData = new Map<TraceKey, ChartPoint[]>();
const enabledTraces = new Set<TraceKey>(
    TRACES.filter((trace) => trace.defaultOn).map((trace) => trace.key)
);

let currentFileName = "";

function populateSeriesToggles(): void {
    seriesToggles.innerHTML = "";

    for (const trace of TRACES) {
        const label = document.createElement("label");
        label.className = "series-toggle";
        label.dataset.trace = trace.key;
        label.style.setProperty("--series-color", trace.color);
        if (enabledTraces.has(trace.key)) {
            label.classList.add("is-active");
        }

        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = "series";
        input.value = trace.key;
        input.checked = enabledTraces.has(trace.key);
        input.disabled = traceData.size === 0;

        const swatch = document.createElement("span");
        swatch.className = "series-swatch";
        swatch.style.setProperty("--series-color", trace.color);
        if (trace.dashed) swatch.classList.add("is-dashed");

        const text = document.createElement("span");
        text.className = "series-label";
        text.textContent = trace.label;

        const kind = document.createElement("span");
        kind.className = "series-kind";
        kind.textContent = trace.kind;

        label.append(input, swatch, text, kind);

        input.addEventListener("change", () => {
            if (!input.checked && enabledTraces.size === 1) {
                input.checked = true;
                return;
            }

            if (input.checked) {
                enabledTraces.add(trace.key);
                label.classList.add("is-active");
            } else {
                enabledTraces.delete(trace.key);
                label.classList.remove("is-active");
            }
            renderGraph();
        });

        seriesToggles.appendChild(label);
    }
}

function setLoading(isLoading: boolean): void {
    loading.hidden = !isLoading;
    fileInput.disabled = isLoading;

    seriesToggles.querySelectorAll("input").forEach((input) => {
        (input as HTMLInputElement).disabled = isLoading || traceData.size === 0;
    });
}

function renderMeta(wav: Wav, spl: SPL, leq: Leq): void {
    meta.innerHTML = `
        <span><strong>File:</strong> ${currentFileName}</span>
        <span><strong>Duration:</strong> ${wav.duration.toFixed(2)} s</span>
        <span><strong>Sample rate:</strong> ${wav.sampleRate} Hz</span>
        <span><strong>Channels:</strong> ${wav.channelCount}</span>
        <span><strong>Calibration:</strong> ${spl.getCalibrationOffsetDb().toFixed(2)} dB offset</span>
        <span><strong>Leq interval:</strong> ${leq.getSampleDuration()} s</span>
    `;
}

function renderGraph(): void {
    const series: ChartSeries[] = [];

    for (const trace of TRACES) {
        if (!enabledTraces.has(trace.key)) continue;
        const points = traceData.get(trace.key);
        if (!points) continue;

        series.push({
            label: trace.label,
            color: trace.color,
            points,
            dashed: trace.dashed,
        });
    }

    chart.draw({
        title: "Sound Level Over Time",
        yLabel: "Level (dB)",
        series,
    });
}

async function analyzeWav(wav: Wav, fileName: string): Promise<void> {
    setLoading(true);
    traceData.clear();
    currentFileName = fileName;

    const spl = new SPL(wav);
    spl.calibrate(94, { weighting: "Z", speed: "INST" });

    const leq = new Leq(wav);
    leq.setTotalMeasurementTime(Math.ceil(wav.duration));
    leq.calibrate(94, { weighting: "Z", speed: "INST" });

    renderMeta(wav, spl, leq);

    for (const trace of TRACES) {
        if (trace.kind === "SPL") {
            traceData.set(
                trace.key,
                spl.measureOverTime({
                    weighting: trace.weighting,
                    speed: "FAST",
                    mode: "SPL",
                    stepMs: STEP_MS,
                })
            );
        } else {
            traceData.set(
                trace.key,
                leq.measureOverTime({
                    weighting: trace.weighting,
                    speed: "INST",
                    stepMs: STEP_MS,
                })
            );
        }
    }

    populateSeriesToggles();
    renderGraph();
    setLoading(false);
}

async function loadFromFile(file: File): Promise<void> {
    const wav = new Wav(file);
    await wav.load(audioContext);
    await analyzeWav(wav, file.name);
}

async function loadDefault(): Promise<void> {
    const wav = new Wav(DEFAULT_WAV);
    await wav.load(audioContext);
    await analyzeWav(wav, "test_1kHz.wav (default)");
}

populateSeriesToggles();

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
        void loadFromFile(file);
    }
});

window.addEventListener("resize", renderGraph);

void loadDefault().catch((error: unknown) => {
    setLoading(false);
    meta.innerHTML = `<span>Failed to load default WAV: ${String(error)}</span>`;
    console.error(error);
});
