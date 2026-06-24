declare module "wav-decoder" {
    export type WavAudioData = {
        sampleRate: number;
        channelData: Float32Array[];
    };

    export function decode(buffer: ArrayBuffer): Promise<WavAudioData>;
}
