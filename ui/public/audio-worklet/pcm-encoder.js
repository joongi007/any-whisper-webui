class PcmEncoderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions || {};
    this.targetRate = 16000;
    this.frameMs = opts.frameMs || 100;
    this.frameSamples = Math.floor((this.targetRate * this.frameMs) / 1000);
    this.buffer = new Float32Array(this.frameSamples * 8);
    this.bufferLen = 0;
    this._stopped = false;
    this.port.onmessage = (e) => { if (e.data === "stop") this._stopped = true; };
  }

  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const ch = input[0];
    let mono;
    if (input.length > 1) {
      mono = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        let sum = 0;
        for (let c = 0; c < input.length; c++) sum += input[c][i] || 0;
        mono[i] = sum / input.length;
      }
    } else {
      mono = ch;
    }

    let resampled = mono;
    if (sampleRate !== this.targetRate) {
      const ratio = this.targetRate / sampleRate;
      const outLen = Math.floor(mono.length * ratio);
      resampled = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const idx = i / ratio;
        const i0 = Math.floor(idx);
        const i1 = Math.min(mono.length - 1, i0 + 1);
        const frac = idx - i0;
        resampled[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
      }
    }

    if (this.bufferLen + resampled.length > this.buffer.length) {
      const grown = new Float32Array((this.bufferLen + resampled.length) * 2);
      grown.set(this.buffer.subarray(0, this.bufferLen));
      this.buffer = grown;
    }
    this.buffer.set(resampled, this.bufferLen);
    this.bufferLen += resampled.length;

    while (this.bufferLen >= this.frameSamples) {
      const out = new Int16Array(this.frameSamples);
      for (let i = 0; i < this.frameSamples; i++) {
        const v = Math.max(-1, Math.min(1, this.buffer[i]));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
      this.buffer.copyWithin(0, this.frameSamples, this.bufferLen);
      this.bufferLen -= this.frameSamples;
    }
    return true;
  }
}

registerProcessor("pcm-encoder", PcmEncoderProcessor);
