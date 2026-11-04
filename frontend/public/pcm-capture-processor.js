/**
 * Microphone capture: low-pass, resample to the contract rate, and emit 40 ms
 * frames of signed 16-bit PCM.
 *
 * Browsers capture at 44.1 or 48 kHz. Dropping to 16 kHz without filtering
 * first folds everything above 8 kHz (sibilants such as س ص ش ز) back into the
 * speech band as noise, so a windowed-sinc FIR removes it before resampling.
 * (Creating the AudioContext at 16 kHz instead fails in Firefox when the
 * microphone runs at another rate.)
 */

const FILTER_TAPS = 63;
// Cutoff as a fraction of the target rate: 0.4375 * 16 kHz = 7 kHz, leaving the
// filter's transition band room to settle before the 8 kHz folding point.
const CUTOFF_OF_TARGET = 0.4375;

function lowPassTaps(cutoff, taps) {
  // cutoff is in cycles per input sample (0 < cutoff < 0.5); Blackman window.
  const middle = (taps - 1) / 2;
  const coefficients = new Float32Array(taps);
  let sum = 0;
  for (let n = 0; n < taps; n += 1) {
    const x = n - middle;
    const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x);
    const window =
      0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (taps - 1));
    coefficients[n] = sinc * window;
    sum += coefficients[n];
  }
  for (let n = 0; n < taps; n += 1) coefficients[n] /= sum; // unity gain at DC
  return coefficients;
}

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
    // Only downsampling needs the anti-aliasing filter.
    this.taps = this.ratio > 1 ? lowPassTaps((CUTOFF_OF_TARGET * this.targetRate) / sampleRate, FILTER_TAPS) : null;
    this.history = new Float32Array(this.taps ? this.taps.length - 1 : 0);
  }

  lowPass(input) {
    const taps = this.taps;
    if (!taps) return input;
    const keep = this.history.length;
    const extended = new Float32Array(keep + input.length);
    extended.set(this.history);
    extended.set(input, keep);
    const output = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      let acc = 0;
      for (let k = 0; k < taps.length; k += 1) acc += taps[k] * extended[i + k];
      output[i] = acc;
    }
    this.history = extended.slice(input.length);
    return output;
  }

  process(inputs) {
    const raw = inputs[0]?.[0];
    if (!raw || raw.length === 0) return true;
    const input = this.lowPass(raw);

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
