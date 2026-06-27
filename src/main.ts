/**
 * SPL Visualizer — browser application entry point.
 *
 * Loads a WAV, precomputes SPL/Leq/RTA traces, and supports playback
 * with synchronized time-series and RTA spectrum views.
 *
 * @module main
 */

import Leq from "../audio analysis/Leq";
import Spectrogram from "../audio analysis/Spectrogram";
import { FrequencyBinData } from "../audio analysis/RTA";
import SPL from "../audio analysis/SPL";
import { Weighting } from "../audio analysis/dsp";
import Wav from "../audio analysis/Wav";
import { ChartPoint, ChartSeries, SplChart } from "./chart";
import { RtaChart } from "./rtaChart";
import { SpectrogramChart } from "./spectrogramChart";

type TraceKey = "SPLZ" | "SPLA" | "SPLC" | "LZEQ" | "LAEQ" | "LCEQ";
type ViewMode = "time" | "rta";

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
const RTA_FFT_SIZE = 2048;

const fileInput = document.getElementById("file-input") as HTMLInputElement;
const viewSelect = document.getElementById("view-select") as HTMLSelectElement;
const rtaWeightingControl = document.getElementById("rta-weighting-control") as HTMLLabelElement;
const rtaWeightingSelect = document.getElementById("rta-weighting-select") as HTMLSelectElement;
const rtaBandwidthControl = document.getElementById("rta-bandwidth-control") as HTMLLabelElement;
const rtaBandwidthSelect = document.getElementById("rta-bandwidth-select") as HTMLSelectElement;
const seriesToggles = document.getElementById("series-toggles") as HTMLDivElement;
const timeSeriesBar = document.getElementById("time-series-bar") as HTMLDivElement;
const meta = document.getElementById("meta") as HTMLElement;
const loading = document.getElementById("loading") as HTMLParagraphElement;
const chartCanvas = document.getElementById("chart") as HTMLCanvasElement;
const rtaStack = document.getElementById("rta-stack") as HTMLDivElement;
const rtaChartCanvas = document.getElementById("rta-chart") as HTMLCanvasElement;
const spectrogramChartCanvas = document.getElementById("spectrogram-chart") as HTMLCanvasElement;
const playbackBar = document.getElementById("playback-bar") as HTMLElement;
const playBtn = document.getElementById("play-btn") as HTMLButtonElement;
const seekSlider = document.getElementById("seek-slider") as HTMLInputElement;
const playbackTime = document.getElementById("playback-time") as HTMLSpanElement;

const chart = new SplChart(chartCanvas);
const rtaChart = new RtaChart(rtaChartCanvas);
const spectrogramChart = new SpectrogramChart(spectrogramChartCanvas);
const audioContext = new AudioContext();

const traceData = new Map<TraceKey, ChartPoint[]>();
const enabledTraces = new Set<TraceKey>(
    TRACES.filter((trace) => trace.defaultOn).map((trace) => trace.key)
);

let currentFileName = "";
let currentWav: Wav | null = null;
let rtaFrames: FrequencyBinData[][] = [];
let rtaFrameDurationSec = 0;
let viewMode: ViewMode = "time";
let rtaWeighting: Weighting = "Z";
let rtaBandwidth = 1 / 3;

let sourceNode: AudioBufferSourceNode | null = null;
let playbackContextStart = 0;
let playbackOffsetSec = 0;
let isPlaying = false;
let isSeeking = false;
let animFrameId = 0;

function formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
}

function frameIndexForTime(timeSec: number): number {
    if (rtaFrames.length === 0 || !currentWav) return 0;
    const idx = Math.floor((timeSec * currentWav.sampleRate) / RTA_FFT_SIZE);
    return Math.max(0, Math.min(rtaFrames.length - 1, idx));
}

function getPlaybackTimeSec(): number {
    if (!currentWav) return 0;
    if (isPlaying) {
        return Math.min(
            currentWav.duration,
            playbackOffsetSec + (audioContext.currentTime - playbackContextStart)
        );
    }
    return playbackOffsetSec;
}

function stopPlayback(): void {
    if (sourceNode) {
        sourceNode.onended = null;
        try {
            sourceNode.stop();
        } catch {
            /* already stopped */
        }
        sourceNode.disconnect();
        sourceNode = null;
    }
    isPlaying = false;
    playBtn.textContent = "▶";
    playBtn.setAttribute("aria-label", "Play");
    cancelAnimationFrame(animFrameId);
}

function updatePlaybackUi(): void {
    if (!currentWav) return;

    const t = getPlaybackTimeSec();
    const duration = currentWav.duration;
    const ratio = duration > 0 ? t / duration : 0;

    if (!isSeeking) {
        seekSlider.value = String(Math.round(ratio * 1000));
    }
    playbackTime.textContent = `${formatTime(t)} / ${formatTime(duration)}`;
    renderActiveView(t);
}

function playbackTick(): void {
    updatePlaybackUi();

    if (!isPlaying || !currentWav) return;

    if (getPlaybackTimeSec() >= currentWav.duration - 0.02) {
        playbackOffsetSec = currentWav.duration;
        stopPlayback();
        updatePlaybackUi();
        return;
    }

    animFrameId = requestAnimationFrame(playbackTick);
}

async function startPlayback(): Promise<void> {
    if (!currentWav?.audioBuffer) return;

    if (audioContext.state === "suspended") {
        await audioContext.resume();
    }

    stopPlayback();

    sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = currentWav.audioBuffer;
    sourceNode.connect(audioContext.destination);

    playbackContextStart = audioContext.currentTime;
    const startAt = playbackOffsetSec;
    sourceNode.start(0, startAt);

    sourceNode.onended = () => {
        if (isPlaying) {
            playbackOffsetSec = currentWav?.duration ?? 0;
            stopPlayback();
            updatePlaybackUi();
        }
    };

    isPlaying = true;
    playBtn.textContent = "⏸";
    playBtn.setAttribute("aria-label", "Pause");
    animFrameId = requestAnimationFrame(playbackTick);
}

function togglePlayback(): void {
    if (!currentWav?.audioBuffer) return;

    if (isPlaying) {
        playbackOffsetSec = getPlaybackTimeSec();
        stopPlayback();
        updatePlaybackUi();
        return;
    }

    if (playbackOffsetSec >= currentWav.duration - 0.02) {
        playbackOffsetSec = 0;
    }

    void startPlayback();
}

function seekTo(ratio: number): void {
    if (!currentWav) return;

    playbackOffsetSec = ratio * currentWav.duration;

    if (isPlaying) {
        void startPlayback();
    } else {
        updatePlaybackUi();
    }
}

function setViewMode(mode: ViewMode): void {
    viewMode = mode;
    const isRta = mode === "rta";

    chartCanvas.hidden = isRta;
    rtaStack.hidden = !isRta;
    timeSeriesBar.hidden = isRta;
    rtaWeightingControl.hidden = !isRta;
    rtaBandwidthControl.hidden = !isRta;

    updatePlaybackUi();
}

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
            renderActiveView(getPlaybackTimeSec());
        });

        seriesToggles.appendChild(label);
    }
}

function setLoading(isLoading: boolean): void {
    loading.hidden = !isLoading;
    fileInput.disabled = isLoading;
    playBtn.disabled = isLoading || !currentWav?.audioBuffer;

    seriesToggles.querySelectorAll("input").forEach((input) => {
        (input as HTMLInputElement).disabled = isLoading || traceData.size === 0;
    });
}

function renderMeta(wav: Wav, spl: SPL, leq: Leq, frameCount: number): void {
    meta.innerHTML = `
        <span><strong>File:</strong> ${currentFileName}</span>
        <span><strong>Duration:</strong> ${wav.duration.toFixed(2)} s</span>
        <span><strong>Sample rate:</strong> ${wav.sampleRate} Hz</span>
        <span><strong>Channels:</strong> ${wav.channelCount}</span>
        <span><strong>Calibration:</strong> ${spl.getCalibrationOffsetDb().toFixed(2)} dB offset</span>
        <span><strong>Leq interval:</strong> ${leq.getSampleDuration()} s</span>
        <span><strong>RTA frames:</strong> ${frameCount} (${rtaFrameDurationSec.toFixed(3)} s each)</span>
    `;
}

function renderTimeGraph(playheadSec?: number): void {
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
        playheadSec,
    });
}

function renderRtaGraph(timeSec: number): void {
    if (rtaFrames.length === 0 || !currentWav) return;

    const frameIndex = frameIndexForTime(timeSec);
    const frame = rtaFrames[frameIndex];

    rtaChart.draw(frame, {
        title: "RTA Spectrum",
        weighting: rtaWeighting,
        timeSec,
        durationSec: currentWav.duration,
    });

    spectrogramChart.draw(rtaFrames, {
        title: "Spectrogram",
        weighting: rtaWeighting,
        playheadSec: timeSec,
        durationSec: currentWav.duration,
    });
}

function renderActiveView(timeSec?: number): void {
    const t = timeSec ?? getPlaybackTimeSec();

    if (viewMode === "rta") {
        renderRtaGraph(t);
    } else {
        renderTimeGraph(currentWav ? t : undefined);
    }
}

async function analyzeWav(wav: Wav, fileName: string): Promise<void> {
    setLoading(true);
    stopPlayback();
    traceData.clear();
    rtaFrames = [];
    currentWav = wav;
    currentFileName = fileName;
    playbackOffsetSec = 0;

    try {
        const spl = new SPL(wav);
        spl.calibrate(94, { weighting: "Z", speed: "INST" });

        const leq = new Leq(wav);
        leq.setTotalMeasurementTime(Math.ceil(wav.duration));
        leq.calibrate(94, { weighting: "Z", speed: "INST" });

        const spectrogram = new Spectrogram(wav, rtaBandwidth, RTA_FFT_SIZE);
        spectrogram.calibrate(94, { weighting: "Z", speed: "INST" });
        rtaFrames = spectrogram.calculate(0, "hann");
        rtaFrameDurationSec = spectrogram.getFrameDurationSec();

        renderMeta(wav, spl, leq, rtaFrames.length);

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

            // Yield so the browser can paint the loading overlay between heavy traces.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }

        playbackBar.hidden = !wav.audioBuffer;
        seekSlider.value = "0";
        playBtn.disabled = !wav.audioBuffer;

        populateSeriesToggles();
        setViewMode(viewMode);
    } finally {
        setLoading(false);
    }
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
setViewMode("time");

viewSelect.addEventListener("change", () => {
    setViewMode(viewSelect.value as ViewMode);
});

rtaWeightingSelect.addEventListener("change", () => {
    rtaWeighting = rtaWeightingSelect.value as Weighting;
    renderActiveView(getPlaybackTimeSec());
});

rtaBandwidthSelect.addEventListener("change", () => {
    rtaBandwidth = Number(rtaBandwidthSelect.value);
    if (currentWav) {
        void analyzeWav(currentWav, currentFileName);
    }
});

playBtn.addEventListener("click", () => {
    void togglePlayback();
});

seekSlider.addEventListener("input", () => {
    isSeeking = true;
    if (!currentWav) return;
    const ratio = Number(seekSlider.value) / 1000;
    playbackTime.textContent = `${formatTime(ratio * currentWav.duration)} / ${formatTime(currentWav.duration)}`;
    if (viewMode === "rta") {
        renderRtaGraph(ratio * currentWav.duration);
    } else {
        renderTimeGraph(ratio * currentWav.duration);
    }
});

seekSlider.addEventListener("change", () => {
    isSeeking = false;
    seekTo(Number(seekSlider.value) / 1000);
});

fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
        void loadFromFile(file);
    }
});

window.addEventListener("resize", () => {
    renderActiveView(getPlaybackTimeSec());
});

void loadDefault().catch((error: unknown) => {
    meta.innerHTML = `<span>Failed to load default WAV: ${String(error)}</span>`;
    console.error(error);
});
