import RTA from "./RTA";
import Wav from "./Wav";

/**
 * RTA-based spectrogram — reuses {@link RTA.calculate} band frames over time
 * for waterfall / heatmap display.
 */
class Spectrogram extends RTA {
    constructor(source: Wav, bandwidth: number = 1, N: number = 2048) {
        super(source, bandwidth, N);
    }

    /** Time in seconds at the start of a frame index. */
    frameTimeSec(frameIndex: number): number {
        return frameIndex * this.getFrameDurationSec();
    }
}

export default Spectrogram;
