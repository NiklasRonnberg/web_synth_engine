let audioCtx;
let masterGain;
let voices = [];

export async function initiateAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.125; // keeps total output ≤ 0.5
  masterGain.connect(audioCtx.destination);

  // Load NoiseProcessor if supported
  if (audioCtx.audioWorklet) {
    try {
      await audioCtx.audioWorklet.addModule('noiseProcessor.js');
    } catch (err) {
      console.error("Failed to load NoiseProcessor:", err);
    }
  } else {
    console.warn("AudioWorklet not supported; NoiseVoice will fallback to buffer noise");
  }

  voices = [
    new SquareVoice(audioCtx),
    new SquareVoice(audioCtx),
    new TriangleVoice(audioCtx),
    new NoiseVoice(audioCtx),
  ];
}

function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

// --------------------------------------
// Envelope helper
// --------------------------------------
function applyADREnvelope(gainNode, attack, decay, release, peak = 1) {
  const now = audioCtx.currentTime;

  // cancel any previous automation
  gainNode.gain.cancelScheduledValues(now);

  // start from 0 for last-note priority
  gainNode.gain.setValueAtTime(0, now);

  // Attack: ramp to peak
  gainNode.gain.linearRampToValueAtTime(peak, now + attack);

  // Decay: ramp to 0 if decay > 0
  if (decay > 0) {
    gainNode.gain.linearRampToValueAtTime(0, now + attack + decay);
  }

  // Always return a release function
  return (releaseTime) => {
    const t = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setValueAtTime(gainNode.gain.value, t);
    gainNode.gain.linearRampToValueAtTime(0, t + releaseTime);
  };
}

// --------------------------------------
// CC to ADR
// --------------------------------------
function ccToAttack(value) {
  const min = 0.01, max = 2.0;
  const norm = value / 127;
  return min * Math.pow(max / min, norm);
}

function ccToDecay(value) {
  const min = 0.001, max = 1.0;
  const norm = value / 127;
  return min * Math.pow(max / min, norm);
}

function ccToRelease(value) {
  const min = 0.01, max = 2.0;
  const norm = value / 127;
  return min * Math.pow(max / min, norm);
}

// --------------------------------------
// CC to PW
// --------------------------------------
function ccToPulseWidth(value) {
  const min = 0.02;
  const max = 0.5;
  return max - (value / 127) * (max - min);
}

// --------------------------------------
// CC to vibrato
// --------------------------------------
function ccToVibratoRate(value) {
  const min = 0.1;
  const max = 20;
  return min + (value / 127) * (max - min);
}

function ccToVibratoDepth(value) {
  const min = 0;
  const max = 1200;
  return min + (value / 127) * (max - min);
}

// --------------------------------------
// CC to portamento
// --------------------------------------
function ccToPortamento(value){
  const min = 0.0;
  const max = 1.5;
  const norm = value / 127;
  return min + Math.pow(norm, 2) * (max - min);
}

// --------------------------------------
// Square Voice
// --------------------------------------
class SquareVoice {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0;

    this.attack = 0.01;
    this.decay = 0;
    this.release = 0.01;
    this.pulseWidth = 0.5;

    this.osc = null;
    this.releaseFn = null;
    this.active = false;

    this.vibratoRate = 5;      // Hz (default)
    this.vibratoDepth = 0;     // in cents
    this.lfo = null;
    this.lfoGain = null;

    this.portamento = 0;
    this.lastFreq = null; 

    this.output.connect(masterGain);
  }

  createPulseWave(pulseWidth) {
    const harmonics = 64;
    const real = new Float32Array(harmonics);
    const imag = new Float32Array(harmonics);

    for (let i = 1; i < harmonics; i++) {
      imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * pulseWidth);
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  setCC({ attack, decay, release, pulseWidth, vibratoRate, vibratoDepth, portamento }) {
    if (attack !== undefined) this.attack = attack;
    if (decay !== undefined) this.decay = decay;
    if (release !== undefined) this.release = release;

    if (pulseWidth !== undefined) {
      this.pulseWidth = pulseWidth;
      if (this.osc) {
        this.osc.setPeriodicWave(this.createPulseWave(this.pulseWidth));
      }
    }

    if (vibratoRate !== undefined) {
      this.vibratoRate = vibratoRate;
      if (this.lfo) {
        this.lfo.frequency.setValueAtTime(vibratoRate, this.ctx.currentTime);
      }
    }

    if (vibratoDepth !== undefined) {
      this.vibratoDepth = vibratoDepth;
      if (this.lfoGain) {
        this.lfoGain.gain.setValueAtTime(vibratoDepth, this.ctx.currentTime);
      }
    }

    if (portamento !== undefined) this.portamento = portamento;
  }

  noteOn(freq) {
    const t = this.ctx.currentTime;

    const shouldRetrigger = this.portamento === 0;

    // Recreate Osc if no portamento
    if (shouldRetrigger) {
      if (this.osc) {
        try { this.osc.stop(t); } catch {}
        this.osc = null;
      }
    }

    // create if needed
    if (!this.osc) {
      this.osc = this.ctx.createOscillator();
      this.osc.setPeriodicWave(this.createPulseWave(this.pulseWidth));
      this.osc.connect(this.output);
      this.osc.start(t);

      // LFO (only once per osc)
      this.lfo = this.ctx.createOscillator();
      this.lfo.type = "sine";

      this.lfoGain = this.ctx.createGain();
      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.osc.detune);

      this.lfo.start(t);
    }

    // vibrato update
    this.lfo.frequency.setValueAtTime(this.vibratoRate, t);
    this.lfoGain.gain.setValueAtTime(this.vibratoDepth, t);

    // Portamento vs Retrigger
    if (!shouldRetrigger && this.lastFreq !== null) {
      this.osc.frequency.setValueAtTime(this.lastFreq, t);
      this.osc.frequency.linearRampToValueAtTime(freq, t + this.portamento);
    } else {
      this.osc.frequency.setValueAtTime(freq, t);
    }

    this.lastFreq = freq;

    this.releaseFn = applyADREnvelope(
      this.output,
      this.attack,
      this.decay,
      this.release,
      1
    );
  }

  noteOff() {
    const t = this.ctx.currentTime;
    this.active = false;

    if (this.decay === 0 && this.releaseFn) this.releaseFn(this.release);

    /*if (this.osc) {
      const stopTime = t + (this.decay === 0 ? this.release : 0.05);
      this.osc.stop(stopTime);
    }*/
  }
}

// --------------------------------------
// Triangle Voice
// --------------------------------------
class TriangleVoice {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0;

    this.attack = 0.01;
    this.decay = 0;
    this.release = 0.01;

    this.osc = null;
    this.releaseFn = null;
    this.active = false;

    this.vibratoRate = 5;      // Hz (default)
    this.vibratoDepth = 0;     // in cents
    this.lfo = null;
    this.lfoGain = null;

    this.portamento = 0;
    this.lastFreq = null;

    this.output.connect(masterGain);
  }

  setCC({ attack, decay, release, vibratoRate, vibratoDepth, portamento }) {
    if (attack !== undefined) this.attack = attack;
    if (decay !== undefined) this.decay = decay;
    if (release !== undefined) this.release = release;

    if (vibratoRate !== undefined) {
      this.vibratoRate = vibratoRate;
      if (this.lfo) {
        this.lfo.frequency.setValueAtTime(vibratoRate, this.ctx.currentTime);
      }
    }

    if (vibratoDepth !== undefined) {
      this.vibratoDepth = vibratoDepth;
      if (this.lfoGain) {
        this.lfoGain.gain.setValueAtTime(vibratoDepth, this.ctx.currentTime);
      }
    }

    if (portamento !== undefined) this.portamento = portamento;
  }

  noteOn(freq) {
    const t = this.ctx.currentTime;

    const shouldRetrigger = this.portamento === 0;

    // Recreate Osc if no portamento
    if (shouldRetrigger) {
      if (this.osc) {
        try { this.osc.stop(t); } catch {}
        this.osc = null;
      }
    }

    if (!this.osc) {
      this.osc = this.ctx.createOscillator();
      this.osc.type = "triangle";
      this.osc.connect(this.output);
      this.osc.start(t);

      this.lfo = this.ctx.createOscillator();
      this.lfo.type = "sine";

      this.lfoGain = this.ctx.createGain();
      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.osc.detune);

      this.lfo.start(t);
    }

    this.lfo.frequency.setValueAtTime(this.vibratoRate, t);
    this.lfoGain.gain.setValueAtTime(this.vibratoDepth, t);

    if (this.lastFreq === null) {
      this.osc.frequency.setValueAtTime(freq, t);
    } else if (this.portamento > 0) {
      this.osc.frequency.setValueAtTime(this.lastFreq, t);
      this.osc.frequency.linearRampToValueAtTime(freq, t + this.portamento);
    } else {
      this.osc.frequency.setValueAtTime(freq, t);
    }

    // Portamento vs Retrigger
    if (!shouldRetrigger && this.lastFreq !== null) {
      this.osc.frequency.setValueAtTime(this.lastFreq, t);
      this.osc.frequency.linearRampToValueAtTime(freq, t + this.portamento);
    } else {
      this.osc.frequency.setValueAtTime(freq, t);
    }

    this.lastFreq = freq;

    this.releaseFn = applyADREnvelope(
      this.output,
      this.attack,
      this.decay,
      this.release,
      1
    );
  }

  noteOff() {
    const t = this.ctx.currentTime;
    this.active = false;

    if (this.decay === 0 && this.releaseFn) this.releaseFn(this.release);

    /*if (this.osc) {
      const stopTime = t + (this.decay === 0 ? this.release : 0.05);
      this.osc.stop(stopTime);
    }*/
  }
}

// --------------------------------------
// Noise Voice
// --------------------------------------
class NoiseVoice {
  constructor(ctx) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    this.output.connect(masterGain);

    // Default ADSR values (will be overridden by MIDI CC)
    this.attack = 0.01;
    this.decay = 0;
    this.release = 0.01;

    this.source = null;
    this.node = null;
    this.useWorklet = !!ctx.audioWorklet;

    this.buffer = this.createNoiseBuffer();
    this.releaseFn = null;
  }

  createNoiseBuffer() {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setCC({ attack, decay, release }) {
    if (attack !== undefined) this.attack = attack;
    if (decay !== undefined) this.decay = decay;
    if (release !== undefined) this.release = release;
  }

  async noteOn(freq) {
    const t = this.ctx.currentTime;
    const scaledFreq = Math.min(15000, Math.max(100, freq * 16));

    // --- Initialize source ---
    if (this.useWorklet) {
      if (!this.node) {
        this.node = new AudioWorkletNode(this.ctx, "noiseProcessor", {
          numberOfOutputs: 1,
          outputChannelCount: [1],
          parameterData: { clockFreq: scaledFreq, gain: 1 },
        });
        this.node.connect(this.output);
      } else {
        this.node.parameters.get("clockFreq").setValueAtTime(scaledFreq, t);
      }
    } else {
      if (this.source) try { this.source.stop(t); } catch {}
      this.source = this.ctx.createBufferSource();
      this.source.buffer = this.buffer;
      this.source.loop = true;
      this.source.playbackRate.setValueAtTime(scaledFreq / 440, t);
      this.source.connect(this.output);
      this.source.start(t);
    }

    // --- Envelope retrigger with current attack/decay ---
    const now = this.ctx.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setValueAtTime(0, now);

    // Attack
    this.output.gain.linearRampToValueAtTime(0.3, now + this.attack);

    if (this.decay > 0) {
      // Attack → Decay
      this.output.gain.linearRampToValueAtTime(0, now + this.attack + this.decay);
      this.releaseFn = null; // decay handles release automatically
    } else {
      // Sustain until noteOff
      this.releaseFn = (releaseTime) => {
        const t2 = this.ctx.currentTime;
        this.output.gain.cancelScheduledValues(t2);
        this.output.gain.setValueAtTime(this.output.gain.value, t2);
        this.output.gain.linearRampToValueAtTime(0, t2 + releaseTime);
      };
    }
  }

  noteOff() {
    const t = this.ctx.currentTime;

    if (this.decay === 0 && this.releaseFn) this.releaseFn(this.release);

    if (!this.useWorklet && this.source && this.decay === 0) {
      this.source.stop(t + this.release);
      this.source = null;
    }

    if (this.node && this.decay === 0) {
      setTimeout(() => {
        try { this.node.disconnect(); this.node = null; } catch {}
      }, this.release * 1000);
    }
  }
}

// --------------------------------------
// Handle MIDI Events
// --------------------------------------
export function handleMidiEvent(event) {
  const { type, note, velocity, channel, controller, value } = event;
  const voice = voices[channel - 1];
  if (!voice) return;

  // Only changes here: call setCC on MIDI CC
  if (type === "cc") {
    const ccValues = {};
    if (controller === 73) ccValues.attack  = value === 0 ? 0 : ccToAttack(value); // attack
    if (controller === 75) ccValues.decay   = value === 0 ? 0 : ccToDecay(value); // decay
    if (controller === 72) ccValues.release = ccToRelease(value); // release
    if (controller === 71) ccValues.pulseWidth = ccToPulseWidth(value); // pulse width
    if (controller === 76) ccValues.vibratoRate = ccToVibratoRate(value); // vibrato rate
    if (controller === 77) ccValues.vibratoDepth = ccToVibratoDepth(value); // vibrato depth
    if (controller === 5) ccValues.portamento = ccToPortamento(value); // portamento

    if (typeof voice.setCC === "function") {
      voice.setCC(ccValues);
    }
    return;
  }

  const freq = midiToFreq(note);
  if (type === "noteOn" && velocity > 0) voice.noteOn(freq);
  if (type === "noteOff" || (type === "noteOn" && velocity === 0)) voice.noteOff();
}

// --------------------------------------
// Resest voices
// --------------------------------------
export function resetVoices() {
  if (!voices || voices.length === 0) return;

  voices.forEach(v => {
    // Stop any currently playing notes
    v.noteOff();

    // Reset parameters to default values per voice type
    if (v instanceof SquareVoice) {
      v.attack = 0.01;
      v.decay = 0;
      v.release = 0.01;
      v.pulseWidth = 0.5;
      v.vibratoRate = 5;
      v.vibratoDepth = 0;
    } else if (v instanceof TriangleVoice) {
      v.attack = 0.01;
      v.decay = 0;
      v.release = 0.01;
      v.vibratoRate = 5;
      v.vibratoDepth = 0;
    } else if (v instanceof NoiseVoice) {
      v.attack = 0.01;
      v.decay = 0;
      v.release = 0.01;
    }
  });
}