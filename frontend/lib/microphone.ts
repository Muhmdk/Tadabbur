import { AUDIO_FORMAT } from "@contract";

export type MicrophoneStats = {
  level: number;
  bytesSent: number;
};

export class PcmMicrophone {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private silence: GainNode | null = null;

  async start(
    onAudio: (chunk: ArrayBuffer) => void,
    onStats?: (stats: MicrophoneStats) => void,
  ): Promise<void> {
    if (this.context) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: AUDIO_FORMAT.channels,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    try {
      const context = new AudioContext();
      await context.audioWorklet.addModule("/pcm-capture-processor.js");
      await context.resume();

      const source = context.createMediaStreamSource(stream);
      const processor = new AudioWorkletNode(context, "pcm-capture-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: AUDIO_FORMAT.channels,
        processorOptions: {
          targetSampleRate: AUDIO_FORMAT.sampleRateHz,
        },
      });
      const silence = context.createGain();
      silence.gain.value = 0;
      let bytesSent = 0;
      let lastStatsAt = 0;
      processor.port.onmessage = (
        event: MessageEvent<{ audio: ArrayBuffer; level: number }>,
      ) => {
        onAudio(event.data.audio);
        bytesSent += event.data.audio.byteLength;
        const now = performance.now();
        if (onStats && now - lastStatsAt >= 100) {
          onStats({ level: event.data.level, bytesSent });
          lastStatsAt = now;
        }
      };

      source.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);

      this.context = context;
      this.stream = stream;
      this.source = source;
      this.processor = processor;
      this.silence = silence;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silence?.disconnect();
    this.processor = null;
    this.source = null;
    this.silence = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    await this.context?.close();
    this.context = null;
  }
}
