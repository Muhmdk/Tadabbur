import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = readFileSync(resolve(projectRoot, "public/pcm-capture-processor.js"), "utf8");

/** Run the worklet outside a browser on a tone; return output RMS / input RMS in dB. */
function gainDb(frequency, inputRate) {
  let Processor;
  const frames = [];
  class AudioWorkletProcessor {
    constructor() { this.port = { postMessage: (message) => frames.push(new Int16Array(message.audio)) }; }
  }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", source)(
    AudioWorkletProcessor,
    (_name, cls) => { Processor = cls; },
    inputRate,
  );
  const processor = new Processor({ processorOptions: { targetSampleRate: 16000 } });
  const amplitude = 0.5;
  for (let start = 0; start < inputRate; start += 128) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i += 1) block[i] = amplitude * Math.sin((2 * Math.PI * frequency * (start + i)) / inputRate);
    processor.process([[block]]);
  }
  const output = frames.flatMap((frame) => Array.from(frame)).slice(1600); // skip the filter's warm-up
  const rms = Math.sqrt(output.reduce((sum, v) => sum + (v / 0x8000) ** 2, 0) / output.length);
  return { db: 20 * Math.log10(rms / (amplitude / Math.SQRT2)), frames };
}

test("speech-band audio passes through unchanged in level", () => {
  for (const rate of [48000, 44100]) {
    assert.ok(Math.abs(gainDb(1000, rate).db) < 0.5, `1 kHz at ${rate} Hz`);
    assert.ok(Math.abs(gainDb(3000, rate).db) < 0.5, `3 kHz at ${rate} Hz`);
  }
});

test("content above 8 kHz is removed instead of aliasing into the speech band", () => {
  for (const rate of [48000, 44100]) {
    // 12 kHz would fold to 4 kHz; 10 kHz to 6 kHz.
    assert.ok(gainDb(12000, rate).db < -60, `12 kHz at ${rate} Hz`);
    assert.ok(gainDb(10000, rate).db < -50, `10 kHz at ${rate} Hz`);
  }
});

test("frames stay 40 ms of 16 kHz mono PCM", () => {
  const { frames } = gainDb(1000, 48000);
  assert.ok(frames.length >= 24);
  assert.ok(frames.every((frame) => frame.length === 640));
});
