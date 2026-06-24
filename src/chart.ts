/**
 * Canvas line chart for SPL / Leq vs time.
 *
 * Renders a responsive dark-theme plot with grid lines, axis labels,
 * and support for multiple overlaid series. Used by the web app in `main.ts`.
 *
 * @module chart
 */

/** One sample on the graph: time in seconds and level in decibels. */
export type ChartPoint = {
    timeSec: number;
    levelDb: number;
};

export type ChartSeries = {
    label: string;
    color: string;
    points: ChartPoint[];
    dashed?: boolean;
};

export type SplChartOptions = {
    title: string;
    yLabel?: string;
    series: ChartSeries[];
};

export class SplChart {
    constructor(private canvas: HTMLCanvasElement) {}

    draw(options: SplChartOptions): void {
        const ctx = this.canvas.getContext("2d");
        if (!ctx || options.series.length === 0) return;

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

        const allLevels = options.series.flatMap((series) =>
            series.points.map((point) => point.levelDb).filter(Number.isFinite)
        );

        if (allLevels.length === 0) return;

        let yMin = Math.min(...allLevels);
        let yMax = Math.max(...allLevels);
        const yPad = Math.max(2, (yMax - yMin) * 0.08 || 2);
        yMin -= yPad;
        yMax += yPad;

        const xMax = Math.max(
            ...options.series.map((series) => series.points[series.points.length - 1]?.timeSec ?? 0),
            1
        );

        const xScale = (timeSec: number) => pad.left + (timeSec / xMax) * plotW;
        const yScale = (levelDb: number) =>
            pad.top + (1 - (levelDb - yMin) / (yMax - yMin)) * plotH;

        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#171b26";
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "#e8ecf4";
        ctx.font = "600 15px Segoe UI, system-ui, sans-serif";
        ctx.textAlign = "left";
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
            const value = (xMax * i) / xTicks;
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
        ctx.fillText(options.yLabel ?? "Level (dB)", 0, 0);
        ctx.restore();

        for (const series of options.series) {
            this.drawSeries(ctx, series, xScale, yScale);
        }
    }

    private drawSeries(
        ctx: CanvasRenderingContext2D,
        series: ChartSeries,
        xScale: (timeSec: number) => number,
        yScale: (levelDb: number) => number
    ): void {
        ctx.beginPath();
        ctx.strokeStyle = series.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        if (series.dashed) {
            ctx.setLineDash([6, 4]);
        } else {
            ctx.setLineDash([]);
        }

        let started = false;
        for (const point of series.points) {
            if (!Number.isFinite(point.levelDb)) continue;
            const x = xScale(point.timeSec);
            const y = yScale(point.levelDb);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }

        if (started) ctx.stroke();
        ctx.setLineDash([]);

        const last = series.points[series.points.length - 1];
        if (last && Number.isFinite(last.levelDb)) {
            const x = xScale(last.timeSec);
            const y = yScale(last.levelDb);
            ctx.fillStyle = series.color;
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
