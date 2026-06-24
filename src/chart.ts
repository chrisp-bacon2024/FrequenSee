/**
 * Canvas line chart for SPL / Leq vs time.
 *
 * Renders a responsive dark-theme plot with grid lines, axis labels,
 * and a highlighted final point. Used by the web app in `main.ts`.
 *
 * @module chart
 */

/** One sample on the graph: time in seconds and level in decibels. */
export type ChartPoint = {
    timeSec: number;
    levelDb: number;
};

export type SplChartOptions = {
    title: string;
    yLabel?: string;
};

export class SplChart {
    constructor(private canvas: HTMLCanvasElement) {}

    draw(points: ChartPoint[], options: SplChartOptions): void {
        const ctx = this.canvas.getContext("2d");
        if (!ctx || points.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = this.canvas.clientWidth || this.canvas.width;
        const cssHeight = this.canvas.clientHeight || this.canvas.height;

        this.canvas.width = Math.floor(cssWidth * dpr);
        this.canvas.height = Math.floor(cssHeight * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = cssWidth;
        const height = cssHeight;
        const pad = { top: 36, right: 24, bottom: 48, left: 56 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;

        const finiteLevels = points
            .map((point) => point.levelDb)
            .filter((value) => Number.isFinite(value));

        if (finiteLevels.length === 0) return;

        let yMin = Math.min(...finiteLevels);
        let yMax = Math.max(...finiteLevels);
        const yPad = Math.max(2, (yMax - yMin) * 0.08 || 2);
        yMin -= yPad;
        yMax += yPad;

        const xMin = 0;
        const xMax = points[points.length - 1].timeSec || 1;

        const xScale = (timeSec: number) =>
            pad.left + ((timeSec - xMin) / (xMax - xMin)) * plotW;
        const yScale = (levelDb: number) =>
            pad.top + (1 - (levelDb - yMin) / (yMax - yMin)) * plotH;

        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#171b26";
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "#e8ecf4";
        ctx.font = "600 15px Segoe UI, system-ui, sans-serif";
        ctx.fillText(options.title, pad.left, 24);

        ctx.strokeStyle = "#252b3a";
        ctx.lineWidth = 1;

        const yTicks = 6;
        for (let i = 0; i <= yTicks; i++) {
            const value = yMin + ((yMax - yMin) * i) / yTicks;
            const y = yScale(value);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(width - pad.right, y);
            ctx.stroke();

            ctx.fillStyle = "#8b95a8";
            ctx.font = "12px Segoe UI, system-ui, sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(value.toFixed(1), pad.left - 8, y + 4);
        }

        const xTicks = 8;
        for (let i = 0; i <= xTicks; i++) {
            const value = xMin + ((xMax - xMin) * i) / xTicks;
            const x = xScale(value);
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, height - pad.bottom);
            ctx.stroke();

            ctx.fillStyle = "#8b95a8";
            ctx.textAlign = "center";
            ctx.fillText(value.toFixed(1), x, height - pad.bottom + 20);
        }

        ctx.fillStyle = "#8b95a8";
        ctx.font = "12px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Time (s)", pad.left + plotW / 2, height - 8);

        ctx.save();
        ctx.translate(16, pad.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(options.yLabel ?? "SPL (dB)", 0, 0);
        ctx.restore();

        ctx.beginPath();
        ctx.strokeStyle = "#5b9cff";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        points.forEach((point, index) => {
            if (!Number.isFinite(point.levelDb)) return;
            const x = xScale(point.timeSec);
            const y = yScale(point.levelDb);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });

        ctx.stroke();

        const last = points[points.length - 1];
        if (Number.isFinite(last.levelDb)) {
            const x = xScale(last.timeSec);
            const y = yScale(last.levelDb);
            ctx.fillStyle = "#5b9cff";
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
