class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions.targetSampleRate;
    this.ratio = sampleRate / this.targetRate;
    this.sourcePosition = 0;
    this.pending = new Float32Array(0);
    this.chunkSamples = Math.max(1, Math.round(this.targetRate * 0.04));
    this.chunk = new Int16Array(this.chunkSamples);
    this.chunkIndex = 0;
    this.chunkSumSquares = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || input.length === 0) return true;

    const samples = new Float32Array(this.pending.length + input.length);
    samples.set(this.pending);
    samples.set(input, this.pending.length);

    const outputLength = Math.floor((samples.length - this.sourcePosition) / this.ratio);
    if (outputLength <= 0) {
      this.pending = samples;
      return true;
    }

    let position = this.sourcePosition;
    for (let index = 0; index < outputLength; index += 1) {
      const left = Math.floor(position);
      const fraction = position - left;
      const right = Math.min(left + 1, samples.length - 1);
      const value = samples[left] + (samples[right] - samples[left]) * fraction;
      const clipped = Math.max(-1, Math.min(1, value));
      this.chunkSumSquares += clipped * clipped;
      this.chunk[this.chunkIndex] =
        clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
      this.chunkIndex += 1;
      if (this.chunkIndex === this.chunkSamples) {
        this.emitChunk();
      }
      position += this.ratio;
    }

    const consumed = Math.floor(position);
    this.sourcePosition = position - consumed;
    this.pending = samples.slice(consumed);
    return true;
  }

  emitChunk() {
    const audio = this.chunk.buffer;
    this.port.postMessage(
      {
        audio,
        level: Math.sqrt(this.chunkSumSquares / this.chunkSamples),
      },
      [audio],
    );
    this.chunk = new Int16Array(this.chunkSamples);
    this.chunkIndex = 0;
    this.chunkSumSquares = 0;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
