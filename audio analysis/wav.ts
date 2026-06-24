/**
 * Loads and holds decoded WAV audio for analysis.
 *
 * In the browser, pass a `File` or URL and call {@link load} with an
 * `AudioContext`. In Node tests, use {@link fromDecodedData} with PCM from
 * `wav-decoder` or a generator.
 *
 * @module wav
 */

class Wav {
    /** @param source - Uploaded `File` or URL string fetched in the browser. */
    constructor(private source: File | string) {}

    /**
     * Builds a `Wav` from already-decoded channel data (no `AudioContext`).
     * Used by command-line tests.
     */
    static fromDecodedData(sampleRate: number, channels: Float32Array[]): Wav {
        const wav = new Wav("");
        wav.sampleRate = sampleRate;
        wav.channels = channels;
        wav.channelCount = channels.length;
        wav.duration = channels[0].length / sampleRate;
        return wav;
    }

    /** Populated after {@link load}; null when created via {@link fromDecodedData}. */
    audioBuffer: AudioBuffer | null = null;
    /** Samples per second (e.g. 44100). */
    sampleRate = 0;
    /** Number of channels (1 = mono). */
    channelCount = 0;
    /** Length of the file in seconds. */
    duration = 0;
    /** Per-channel sample data; values typically in −1…+1. */
    channels: Float32Array[] = [];

    /**
     * Decodes the WAV via the Web Audio API and fills {@link channels},
     * {@link sampleRate}, {@link channelCount}, and {@link duration}.
     */
    async load(ctx: AudioContext): Promise<void> {
        const arrayBuffer =
            this.source instanceof File
                ? await this.source.arrayBuffer()
                : await fetch(this.source).then((response) => {
                      if (!response.ok) {
                          throw new Error(`Failed to fetch audio: ${this.source}`);
                      }
                      return response.arrayBuffer();
                  });

        this.audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        this.sampleRate = this.audioBuffer.sampleRate;
        this.channelCount = this.audioBuffer.numberOfChannels;
        this.duration = this.audioBuffer.duration;
        this.channels = Array.from({ length: this.channelCount }, (_, index) =>
            this.audioBuffer!.getChannelData(index)
        );
    }
}

export default Wav;
