export let audioCtx;
let masterGain;
export let voices = [];

export async function initiateAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.2;
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

  return voices;
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
  const min = 0.01, max = 4.0;
  const norm = value / 127;
  return min * Math.pow(max / min, norm);
}

function ccToDecay(value) {
  const min = 0.01, max = 4.0;
  const norm = value / 127;
  return min * Math.pow(max / min, norm);
}

function ccToRelease(value) {
  const min = 0.01, max = 4.0;
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
  const max = 600;
  return min + (value / 127) * (max - min);
}

// --------------------------------------
// CC to portamento
// --------------------------------------
function ccToPortamento(value){
  const min = 0;
  const max = 2;
  const norm = value / 127;
  return min + Math.pow(norm, 2) * (max - min);
}

// --------------------------------------
// CC to pitch bend range
// --------------------------------------
function ccToPitchBendRange(value){
  const min = 2;
  const max = 24;
  const norm = value / 127;
  return min + Math.pow(norm, 2) * (max - min);
}

// --------------------------------------
// CC to detune
// --------------------------------------
function ccToDetune(value){
  const min = 0;
  const max = 100;
  const norm = value / 127;
  return min + Math.pow(norm, 2) * (max - min);
}

// --------------------------------------
// CC to sound level
// --------------------------------------
function ccToSoundLevel(value){
  const min = 0;
  const max = 1;
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

    this.vibratoRate = 5;
    this.vibratoDepth = 0;
    this.lfo = null;
    this.lfoGain = null;

    this.portamento = 0;
    this.lastFreq = null;

    this.pitchBend = 0;
    this.pitchBendRange = 2;

    this.pitchDetune = 0;

    this.soundLevel = 0.75;

    this.type = "square";

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

  setPitchBend(value) {
    this.pitchBend = value;
    const cents = this.pitchBend * this.pitchBendRange * 100;
    const t = this.ctx.currentTime;

    if (this.osc) {
      // apply detune in cents
      this.osc.detune.setValueAtTime(cents, t);
    }
  }

  setCC({ attack, decay, release, pulseWidth, vibratoRate, vibratoDepth, portamento, pitchBendRange, pitchDetune, soundLevel }) {
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
    if (pitchBendRange !== undefined) this.pitchBendRange = pitchBendRange;
    if (pitchDetune !== undefined) this.pitchDetune = pitchDetune;
    if (soundLevel !== undefined) this.soundLevel = soundLevel;
    
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

    // pitch bend & detune
    const cents = this.pitchBend * this.pitchBendRange * 100 + this.pitchDetune;
    this.osc.detune.setValueAtTime(cents, t);

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
      this.soundLevel
    );
  }

  noteOff() {
    const t = this.ctx.currentTime;
    const g = this.output.gain;

    // interrupt on noteOff
    g.cancelScheduledValues(t);

    if (this.release > 0) {
      g.linearRampToValueAtTime(0, t + this.release);
    } else {
      g.setValueAtTime(0, t + 0.01);
    }
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

    this.vibratoRate = 5;
    this.vibratoDepth = 0;
    this.lfo = null;
    this.lfoGain = null;

    this.portamento = 0;
    this.lastFreq = null;

    this.pitchBend = 0;
    this.pitchBendRange = 2;

    this.pitchDetune = 0;

    this.type = "triangle";

    this.soundLevel = 0.75;

    this.output.connect(masterGain);
  }

  setPitchBend(value) {
    this.pitchBend = value;
    const cents = this.pitchBend * this.pitchBendRange * 100;
    const t = this.ctx.currentTime;

    if (this.osc) {
      // apply detune in cents
      this.osc.detune.setValueAtTime(cents, t);
    }
  }

  setCC({ attack, decay, release, vibratoRate, vibratoDepth, portamento, pitchBendRange, pitchDetune, soundLevel }) {
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
    if (pitchBendRange !== undefined) this.pitchBendRange = pitchBendRange;
    if (pitchDetune !== undefined) this.pitchDetune = pitchDetune;
    if (soundLevel !== undefined) this.soundLevel = soundLevel;

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

    // pitch bend
    const cents = this.pitchBend * this.pitchBendRange * 100 + this.pitchDetune;
    this.osc.detune.setValueAtTime(cents, t);

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
      this.soundLevel
    );
  }

  noteOff() {
    const t = this.ctx.currentTime;
    const g = this.output.gain;

    // interrupt on noteOff
    g.cancelScheduledValues(t);

    if (this.release > 0) {
      g.linearRampToValueAtTime(0, t + this.release);
    } else {
      g.setValueAtTime(0, t + 0.01);
    }
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

    this.pitchBend = 0;
    this.pitchBendRange = 2;

    this.source = null;
    this.node = null;
    this.useWorklet = !!ctx.audioWorklet;

    this.buffer = this.createNoiseBuffer();
    this.releaseFn = null;
    this.lastFreq = null;

    this.soundLevel = 0.25;

    this.type = "noise";
  }

  createNoiseBuffer() {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setPitchBend(value) {
    this.pitchBend = value;
    if (!this.lastFreq) return; // no note playing

    const t = this.ctx.currentTime;
    const bendFactor = Math.pow(2, (this.pitchBend * this.pitchBendRange) / 12);
    const targetFreq = this.lastFreq * bendFactor;

    if (this.useWorklet && this.node) {
      this.node.parameters.get("clockFreq").setValueAtTime(targetFreq * 8, t); // keep your multiplier
    } else if (this.source) {
      this.source.playbackRate.setValueAtTime(targetFreq / this.lastFreq, t);
    }
  }

  setCC({ attack, decay, release, pitchBendRange, soundLevel }) {
    if (attack !== undefined) this.attack = attack;
    if (decay !== undefined) this.decay = decay;
    if (release !== undefined) this.release = release;
    if (pitchBendRange !== undefined) this.pitchBendRange = pitchBendRange;
    if (soundLevel !== undefined) this.soundLevel = soundLevel;
  }

  async noteOn(freq) {
    this.lastFreq = freq;
    const t = this.ctx.currentTime;
    const bendFactor = Math.pow(2, (this.pitchBend * this.pitchBendRange) / 12);
    const scaledFreq = Math.min(20000, Math.max(1, freq * 8 * bendFactor));
    
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
      this.source.playbackRate.setValueAtTime(scaledFreq / freq, t);
      this.source.connect(this.output);
      this.source.start(t);
    }

    this.releaseFn = applyADREnvelope(
      this.output,
      this.attack,
      this.decay,
      this.release,
      this.soundLevel
    );
  }

  noteOff() {
    const t = this.ctx.currentTime;

    // Only trigger release if decay = 0
    if (this.decay === 0 && this.releaseFn) {
      this.releaseFn(this.release);
    }

    // Stop source/worklet **after release completes**
    const stopDelay = this.decay === 0 ? this.release : 0;

    if (!this.useWorklet && this.source) {
      const src = this.source;
      setTimeout(() => {
        try { src.stop(); } catch {}
      }, stopDelay * 1000 + 0.01);
      this.source = null;
    }

    if (this.node) {
      const node = this.node;
      setTimeout(() => {
        try { node.disconnect(); } catch {}
      }, stopDelay * 1000 + 0.01);
      this.node = null;
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

  if (type === "pitchBend") {
    const voice = voices[channel - 1];
    if (voice && typeof voice.setPitchBend === "function") {
      voice.setPitchBend(event.normalized);
    }
  }
  // Call setCC on MIDI CC
  if (type === "cc") {
    const ccValues = {};
    if (controller === 73) ccValues.attack  = value === 0 ? 0 : ccToAttack(value); // attack
    if (controller === 75) ccValues.decay   = value === 0 ? 0 : ccToDecay(value); // decay
    if (controller === 72) ccValues.release = ccToRelease(value); // release
    if (controller === 71) ccValues.pulseWidth = ccToPulseWidth(value); // pulse width
    if (controller === 76) ccValues.vibratoRate = ccToVibratoRate(value); // vibrato rate
    if (controller === 77) ccValues.vibratoDepth = ccToVibratoDepth(value); // vibrato depth
    if (controller === 5) ccValues.portamento = ccToPortamento(value); // portamento
    if (controller === 9) ccValues.pitchBendRange = ccToPitchBendRange(value); // pitch bend range
    if (controller === 3) ccValues.pitchDetune = ccToDetune(value); // detune
    if (controller === 7) ccValues.soundLevel = ccToSoundLevel(value); // detune

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