/**
 * Canvas bar chart for RTA spectrum (frequency vs dBFS).
 *
 * @module rtaChart
 */

import type { FrequencyBinData } from "../audio analysis/RTA";
import type { Weighting } from "../audio analysis/dsp";

const Y_MIN = -100;
const Y_MAX = 0;

export type RtaChartOptions = {
    title: string;
    weighting: Weighting;
    timeSec: number;
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

export class RtaChart {
    constructor(private canvas: HTMLCanvasElement) {}

    draw(frame: FrequencyBinData[], options: RtaChartOptions): void {
        const ctx = this.canvas.getContext("2d");
        if (!ctx || frame.length === 0) return;

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

        const yMin = Y_MIN;
        const yMax = Y_MAX;

        const minFreq = frame[0].frequency;
        const maxFreq = frame[frame.length - 1].frequency;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        const xScale = (freq: number) =>
            pad.left + ((Math.log10(freq) - logMin) / (logMax - logMin)) * plotW;
        const yScale = (levelDb: number) =>
            pad.top + (1 - (levelDb - yMin) / (yMax - yMin)) * plotH;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#171b26";
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "#e8ecf4";
        ctx.font = "600 15px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(options.title, pad.left, 24);

        ctx.fillStyle = "#8b95a8";
        ctx.font = "12px Segoe UI, system-ui, sans-serif";
        ctx.fillText(
            `${options.timeSec.toFixed(2)} s / ${options.durationSec.toFixed(2)} s · ${options.weighting}-weighted dBFS`,
            pad.left,
            height - 12
        );

        ctx.strokeStyle = "#252b3a";
        ctx.lineWidth = 1;

        const yTicks = 5;
        for (let i = 0; i <= yTicks; i++) {
            const value = yMin + ((yMax - yMin) * i) / yTicks;
            const y = yScale(value);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(width - pad.right, y);
            ctx.stroke();

            ctx.fillStyle = "#8b95a8";
            ctx.textAlign = "right";
            ctx.fillText(value.toFixed(0), pad.left - 8, y + 4);
        }

        const xTickFreqs = frame.filter((_, index) => index % Math.max(1, Math.floor(frame.length / 8)) === 0);
        for (const band of xTickFreqs) {
            const x = xScale(band.frequency);
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, height - pad.bottom);
            ctx.stroke();

            ctx.fillStyle = "#8b95a8";
            ctx.textAlign = "center";
            ctx.fillText(formatFrequency(band.frequency), x, height - pad.bottom + 18);
        }

        ctx.fillStyle = "#8b95a8";
        ctx.textAlign = "center";
        ctx.fillText("Frequency (Hz)", pad.left + plotW / 2, height - 28);

        ctx.save();
        ctx.translate(16, pad.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("dBFS", 0, 0);
        ctx.restore();

        for (let i = 0; i < frame.length; i++) {
            const band = frame[i];
            const level = bandLevelDbfs(band, options.weighting);
            if (!Number.isFinite(level) || level <= yMin) continue;

            const clampedLevel = Math.min(yMax, Math.max(yMin, level));
            const prevFreq = i > 0 ? frame[i - 1].frequency : band.frequency / 1.26;
            const nextFreq = i < frame.length - 1 ? frame[i + 1].frequency : band.frequency * 1.26;
            const xCenter = xScale(band.frequency);
            const xRight = xScale(Math.sqrt(band.frequency * nextFreq));
            const xLeft = xScale(Math.sqrt(prevFreq * band.frequency));
            const barW = Math.max(4, xRight - xLeft - 2);
            const barH = Math.max(0, yScale(yMin) - yScale(clampedLevel));

            const t = (Math.log10(band.frequency) - logMin) / (logMax - logMin);
            const hue = 210 - t * 50;
            ctx.fillStyle = `hsl(${hue}, 75%, 58%)`;
            ctx.fillRect(xCenter - barW / 2, yScale(clampedLevel), barW, barH);
        }
    }
}
