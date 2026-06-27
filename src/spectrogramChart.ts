/**
 * Canvas waterfall spectrogram from RTA band frames over time.
 *
 * @module spectrogramChart
 */

import type { FrequencyBinData } from "../audio analysis/RTA";
import type { Weighting } from "../audio analysis/dsp";

const DB_MIN = -100;
const DB_MAX = 0;

export type SpectrogramChartOptions = {
    title: string;
    weighting: Weighting;
    playheadSec: number;
    durationSec: number;
};

function bandLevelDbfs(band: FrequencyBinData, weighting: Weighting): number {
    if (weighting === "A") return band.dbfsA;
    if (weighting === "C") return band.dbfsC;
    return band.dbfs;
}

function formatFrequency(freq: number): string {
    if (freq >= 1000) return `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k`;
    return String(freq);
}

function levelToRgb(levelDb: number, freqNorm: number): [number, number, number] {
    const t = Math.max(0, Math.min(1, (levelDb - DB_MIN) / (DB_MAX - DB_MIN)));
    const hue = 210 - freqNorm * 50;
    const sat = 75;
    const light = 12 + t * 46;
    const h = (hue / 360) * 6;
    const c = (1 - Math.abs(2 * (light / 100) - 1)) * (sat / 100);
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = light / 100 - c / 2;

    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 1) {
        r = c;
        g = x;
    } else if (h < 2) {
        r = x;
        g = c;
    } else if (h < 3) {
        g = c;
        b = x;
    } else if (h < 4) {
        g = x;
        b = c;
    } else if (h < 5) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }

    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255),
    ];
}

export class SpectrogramChart {
    constructor(private canvas: HTMLCanvasElement) {}

    draw(frames: FrequencyBinData[][], options: SpectrogramChartOptions): void {
        const ctx = this.canvas.getContext("2d");
        if (!ctx || frames.length === 0 || frames[0].length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = this.canvas.clientWidth || this.canvas.width;
        const cssHeight = this.canvas.clientHeight || this.canvas.height;

        this.canvas.width = Math.floor(cssWidth * dpr);
        this.canvas.height = Math.floor(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = cssWidth;
        const height = cssHeight;
        const pad = { top: 36, right: 24, bottom: 52, left: 56 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const plotBottom = pad.top + plotH;

        const bandTemplate = frames[0];
        const minFreq = bandTemplate[0].frequency;
        const maxFreq = bandTemplate[bandTemplate.length - 1].frequency;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        const yForFreq = (freq: number) =>
            pad.top + (1 - (Math.log10(freq) - logMin) / (logMax - logMin)) * plotH;

        const bandBounds: { yTop: number; yBottom: number; freqNorm: number }[] = [];
        for (let i = 0; i < bandTemplate.length; i++) {
            const freq = bandTemplate[i].frequency;
            const yCenter = yForFreq(freq);
            const yTop =
                i < bandTemplate.length - 1
                    ? (yCenter + yForFreq(bandTemplate[i + 1].frequency)) / 2
                    : pad.top;
            const yBottom =
                i > 0
                    ? (yCenter + yForFreq(bandTemplate[i - 1].frequency)) / 2
                    : plotBottom;
            const freqNorm = (Math.log10(freq) - logMin) / (logMax - logMin);
            bandBounds.push({ yTop, yBottom, freqNorm });
        }

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#171b26";
        ctx.fillRect(0, 0, width, height);

        const colW = Math.max(1, plotW / frames.length);

        for (let f = 0; f < frames.length; f++) {
            const frame = frames[f];
            const x = pad.left + (f / frames.length) * plotW;

            for (let b = 0; b < frame.length; b++) {
                const level = bandLevelDbfs(frame[b], options.weighting);
                if (!Number.isFinite(level) || level <= DB_MIN) continue;

                const clamped = Math.min(DB_MAX, Math.max(DB_MIN, level));
                const { yTop, yBottom, freqNorm } = bandBounds[b];
                const [r, g, bColor] = levelToRgb(clamped, freqNorm);

                ctx.fillStyle = `rgb(${r}, ${g}, ${bColor})`;
                ctx.fillRect(x, yTop, colW + 0.5, Math.max(1, yBottom - yTop));
            }
        }

        ctx.fillStyle = "#e8ecf4";
        ctx.font = "600 15px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(options.title, pad.left, 24);

        ctx.fillStyle = "#8b95a8";
        ctx.font = "12px Segoe UI, system-ui, sans-serif";
        ctx.fillText(
            `${options.weighting}-weighted dBFS · ${options.durationSec.toFixed(2)} s`,
            pad.left,
            height - 12
        );

        ctx.strokeStyle = "#252b3a";
        ctx.lineWidth = 1;

        const yTickBands = bandTemplate.filter(
            (_, index) => index % Math.max(1, Math.floor(bandTemplate.length / 6)) === 0
        );
        for (const band of yTickBands) {
            const y = yForFreq(band.frequency);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(width - pad.right, y);
            ctx.stroke();

            ctx.fillStyle = "#8b95a8";
            ctx.textAlign = "right";
            ctx.fillText(formatFrequency(band.frequency), pad.left - 8, y + 4);
        }

        const xTicks = 5;
        for (let i = 0; i <= xTicks; i++) {
            const timeSec = (options.durationSec * i) / xTicks;
            const x = pad.left + (timeSec / options.durationSec) * plotW;
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, plotBottom);
            ctx.stroke();

            ctx.fillStyle = "#8b95a8";
            ctx.textAlign = "center";
            ctx.fillText(timeSec.toFixed(1), x, plotBottom + 18);
        }

        ctx.fillStyle = "#8b95a8";
        ctx.textAlign = "center";
        ctx.fillText("Time (s)", pad.left + plotW / 2, height - 28);

        ctx.save();
        ctx.translate(12, pad.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Frequency (Hz)", 0, 0);
        ctx.restore();

        if (options.durationSec > 0 && options.playheadSec >= 0) {
            const playX = pad.left + (options.playheadSec / options.durationSec) * plotW;
            ctx.strokeStyle = "#ff6b8a";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(playX, pad.top);
            ctx.lineTo(playX, plotBottom);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}
