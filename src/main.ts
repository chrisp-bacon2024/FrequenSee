/**
 * SPL Visualizer — browser application entry point.
 *
 * Loads a WAV (default or user upload), precomputes all SPL and Leq traces,
 * and renders the selected graph from the dropdown. See project README.md.
 *
 * @module main
 */

import Leq from "../audio analysis/Leq";
import SPL from "../audio analysis/SPL";
import { TimeWeighting, Weighting } from "../audio analysis/dsp";
import Wav from "../audio analysis/wav";
import { ChartPoint, SplChart } from "./chart";

type SplGraphKey = `${Weighting}_${TimeWeighting}`;
type LeqGraphKey = `LEQ_${Weighting}`;
type GraphKey = SplGraphKey | LeqGraphKey;

type GraphConfig = {
    key: GraphKey;
    label: string;
    kind: "SPL" | "LEQ";
    weighting: Weighting;
    speed?: TimeWeighting;
    yLabel: string;
};

const SPL_GRAPHS: GraphConfig[] = [
    { key: "Z_FAST", label: "SPL — Z-weighted Fast (LZF)", kind: "SPL", weighting: "Z", speed: "FAST", yLabel: "SPL (dB)" },
    { key: "Z_SLOW", label: "SPL — Z-weighted Slow (LZS)", kind: "SPL", weighting: "Z", speed: "SLOW", yLabel: "SPL (dB)" },
    { key: "Z_INST", label: "SPL — Z-weighted Instantaneous", kind: "SPL", weighting: "Z", speed: "INST", yLabel: "SPL (dB)" },
    { key: "A_FAST", label: "SPL — A-weighted Fast (LAF)", kind: "SPL", weighting: "A", speed: "FAST", yLabel: "SPL (dB)" },
    { key: "A_SLOW", label: "SPL — A-weighted Slow (LAS)", kind: "SPL", weighting: "A", speed: "SLOW", yLabel: "SPL (dB)" },
    { key: "A_INST", label: "SPL — A-weighted Instantaneous", kind: "SPL", weighting: "A", speed: "INST", yLabel: "SPL (dB)" },
    { key: "C_FAST", label: "SPL — C-weighted Fast (LCF)", kind: "SPL", weighting: "C", speed: "FAST", yLabel: "SPL (dB)" },
    { key: "C_SLOW", label: "SPL — C-weighted Slow (LCS)", kind: "SPL", weighting: "C", speed: "SLOW", yLabel: "SPL (dB)" },
    { key: "C_INST", label: "SPL — C-weighted Instantaneous", kind: "SPL", weighting: "C", speed: "INST", yLabel: "SPL (dB)" },
];

const LEQ_GRAPHS: GraphConfig[] = [
    { key: "LEQ_Z", label: "Leq — Z-weighted (LZeq)", kind: "LEQ", weighting: "Z", yLabel: "Leq (dB)" },
    { key: "LEQ_A", label: "Leq — A-weighted (LAeq)", kind: "LEQ", weighting: "A", yLabel: "Leq (dB)" },
    { key: "LEQ_C", label: "Leq — C-weighted (LCeq)", kind: "LEQ", weighting: "C", yLabel: "Leq (dB)" },
];

const GRAPHS: GraphConfig[] = [...SPL_GRAPHS, ...LEQ_GRAPHS];

const STEP_MS = 100;
const DEFAULT_WAV = "/test_1kHz.wav";

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const graphSelect = document.getElementById("graph-select") as HTMLSelectElement;
const meta = document.getElementById("meta") as HTMLElement;
const loading = document.getElementById("loading") as HTMLParagraphElement;
const chartCanvas = document.getElementById("chart") as HTMLCanvasElement;

const chart = new SplChart(chartCanvas);
const audioContext = new AudioContext();
const traces = new Map<GraphKey, ChartPoint[]>();

let currentFileName = "";

function populateGraphSelect(): void {
    graphSelect.innerHTML = "";

    const splGroup = document.createElement("optgroup");
    splGroup.label = "SPL";
    for (const graph of SPL_GRAPHS) {
        const option = document.createElement("option");
        option.value = graph.key;
        option.textContent = graph.label;
        splGroup.appendChild(option);
    }
    graphSelect.appendChild(splGroup);

    const leqGroup = document.createElement("optgroup");
    leqGroup.label = "Leq";
    for (const graph of LEQ_GRAPHS) {
        const option = document.createElement("option");
        option.value = graph.key;
        option.textContent = graph.label;
        leqGroup.appendChild(option);
    }
    graphSelect.appendChild(leqGroup);

    graphSelect.disabled = false;
}

function setLoading(isLoading: boolean): void {
    loading.hidden = !isLoading;
    graphSelect.disabled = isLoading || traces.size === 0;
    fileInput.disabled = isLoading;
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

function renderSelectedGraph(): void {
    const key = graphSelect.value as GraphKey;
    const config = GRAPHS.find((graph) => graph.key === key);
    const points = traces.get(key);

    if (!config || !points) return;

    chart.draw(points, {
        title: config.label,
        yLabel: config.yLabel,
    });
}

async function analyzeWav(wav: Wav, fileName: string): Promise<void> {
    setLoading(true);
    traces.clear();
    currentFileName = fileName;

    const spl = new SPL(wav);
    spl.calibrate(94, { weighting: "Z", speed: "INST" });

    const leq = new Leq(wav);
    leq.setTotalMeasurementTime(Math.ceil(wav.duration));
    leq.calibrate(94, { weighting: "Z", speed: "INST" });

    renderMeta(wav, spl, leq);

    for (const graph of SPL_GRAPHS) {
        traces.set(
            graph.key,
            spl.measureOverTime({
                weighting: graph.weighting,
                speed: graph.speed!,
                mode: "SPL",
                stepMs: STEP_MS,
            })
        );
    }

    for (const graph of LEQ_GRAPHS) {
        traces.set(
            graph.key,
            leq.measureOverTime({
                weighting: graph.weighting,
                speed: "INST",
                stepMs: STEP_MS,
            })
        );
    }

    renderSelectedGraph();
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

populateGraphSelect();

graphSelect.addEventListener("change", renderSelectedGraph);

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
        void loadFromFile(file);
    }
});

window.addEventListener("resize", renderSelectedGraph);

void loadDefault().catch((error: unknown) => {
    setLoading(false);
    meta.innerHTML = `<span>Failed to load default WAV: ${String(error)}</span>`;
    console.error(error);
});
