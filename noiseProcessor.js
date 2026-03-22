class NoiseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "clockFreq", defaultValue: 440, minValue: 20, maxValue: 20000 },
      { name: "gain", defaultValue: 0.3, minValue: 0, maxValue: 1 }
    ];
  }

  constructor() {
    super();
    this.sampleCounter = 0;
    this.currentSample = 0;
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];

    // Use the built-in sampleRate directly (do NOT declare const sampleRate = sampleRate)
    const sr = sampleRate;

    const clockFreq = parameters.clockFreq;
    const gainParam = parameters.gain;

    for (let channel = 0; channel < output.length; channel++) {
      const channelOut = output[channel];
      for (let i = 0; i < channelOut.length; i++) {
        // calculate clock step per sample
        const freq = clockFreq.length > 1 ? clockFreq[i] : clockFreq[0];
        const step = Math.max(1, sr / freq);

        if (this.sampleCounter >= step) {
          this.currentSample = Math.random() * 2 - 1;
          this.sampleCounter = 0;
        }

        channelOut[i] = this.currentSample * (gainParam.length > 1 ? gainParam[i] : gainParam[0]);
        this.sampleCounter++;
      }
    }

    return true;
  }
}

registerProcessor("noiseProcessor", NoiseProcessor);