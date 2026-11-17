/* ═══════════════════════════════════════════════════════════════
   AUDIO
   A tiny procedural soundscape: high-altitude wind, ski edge hiss,
   a warm pad, coins, crystals, landings, and the Peak 2 Peak motor.
   Everything is synthesized — no audio files.
   ═══════════════════════════════════════════════════════════════ */

import { clamp } from './util.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.master = null;
    this.ambience = null;
    this.wind = null;
    this.hiss = null;
    this.carve = null;
    this.pad = null;
    this.motor = null;
    this.noiseBuffer = null;
    this.playhead = 0;
    this.started = false;
  }

  get supported() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  async init() {
    if (!this.supported) return false;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch { /* ignore */ }
      }
      return true;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;

    const master = ctx.createGain();
    master.gain.value = this.enabled ? 0.85 : 0;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    const ambience = ctx.createGain();
    ambience.gain.value = 0.9;
    ambience.connect(master);
    this.ambience = ambience;

    this.noiseBuffer = this.makeNoise(4.5);

    // ── wind: broad low-passed noise
    this.wind = this.makeLoopNoise({ type: 'lowpass', freq: 420, q: 0.4, gain: 0.035 });
    // ── high-altitude hiss
    this.hiss = this.makeLoopNoise({ type: 'bandpass', freq: 1500, q: 0.55, gain: 0 });
    // ── edges biting into snow
    this.carve = this.makeLoopNoise({ type: 'bandpass', freq: 2600, q: 1.1, gain: 0 });

    // ── very quiet warm pad. D major, slowly breathing.
    this.pad = ctx.createGain();
    this.pad.gain.value = 0;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 760;
    padFilter.Q.value = 0.4;
    this.pad.connect(padFilter);
    padFilter.connect(master);
    this.padOscillators = [];
    for (const [freq, detune, gain] of [
      [73.42, -3, 0.05], [110.0, 2, 0.036], [146.83, 5, 0.028], [185.0, -4, 0.02],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.055 + Math.random() * 0.035;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = gain * 0.5;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();
      osc.connect(g);
      g.connect(this.pad);
      osc.start();
      this.padOscillators.push({ osc, lfo });
    }
    this.pad.gain.setTargetAtTime(0.5, ctx.currentTime, 2.5);

    // ── Peak 2 Peak motor hum
    this.motor = ctx.createGain();
    this.motor.gain.value = 0;
    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.value = 240;
    motorFilter.Q.value = 2.2;
    this.motor.connect(motorFilter);
    motorFilter.connect(master);
    const motorOsc = ctx.createOscillator();
    motorOsc.type = 'sawtooth';
    motorOsc.frequency.value = 48;
    motorOsc.connect(this.motor);
    motorOsc.start();
    const motorOsc2 = ctx.createOscillator();
    motorOsc2.type = 'triangle';
    motorOsc2.frequency.value = 96.2;
    const motorGain2 = ctx.createGain();
    motorGain2.gain.value = 0.22;
    motorOsc2.connect(motorGain2);
    motorGain2.connect(this.motor);
    motorOsc2.start();
    this.motorOsc = motorOsc;

    this.ready = true;
    try { await ctx.resume(); } catch { /* ignore */ }
    return true;
  }

  makeNoise(seconds = 3) {
    const ctx = this.ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.94 + white * 0.06;
      data[i] = white * 0.36 + last * 2.2;
    }
    // soften the loop edges
    const fade = Math.min(1200, Math.floor(length * 0.02));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] *= k;
      data[length - 1 - i] *= k;
    }
    return buffer;
  }

  makeLoopNoise({ type = 'lowpass', freq = 800, q = 0.7, gain = 0.05 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.ambience);
    src.start(0, Math.random() * 2);
    return { src, filter, gain: g, baseFreq: freq };
  }

  async resume() {
    if (!this.ctx) return this.init();
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    return true;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.85 : 0, this.ctx.currentTime, 0.08);
    }
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }

  /* ── per-frame mix ──────────────────────────────────────────── */

  update(dt, state = {}) {
    if (!this.ready || !this.ctx) return;
    const t = this.ctx.currentTime;
    const {
      speed = 0, grounded = true, airborne = false, crash = false,
      powder = 0, riding = false, paused = false,
    } = state;
    const s = clamp(speed / 36, 0, 1);
    const active = !paused && !crash;
    const windTarget = paused ? 0.012 : 0.028 + s * 0.12 + (airborne ? 0.045 : 0);
    this.wind.gain.gain.setTargetAtTime(windTarget, t, 0.25);
    this.wind.filter.frequency.setTargetAtTime(320 + s * 520, t, 0.3);

    const hissTarget = !active || riding ? 0.004 : (grounded ? 0.014 + s * 0.062 : 0.02);
    this.hiss.gain.gain.setTargetAtTime(hissTarget, t, 0.12);
    this.hiss.filter.frequency.setTargetAtTime(1100 + s * 1800, t, 0.2);

    const carveTarget = (!active || riding || !grounded) ? 0 : (s * s * 0.085 + powder * s * 0.04);
    this.carve.gain.gain.setTargetAtTime(carveTarget, t, 0.08);
    this.carve.filter.frequency.setTargetAtTime(2100 + s * 1300, t, 0.16);

    // pad drops away slightly while moving at speed; the mountain gets quiet up high
    if (this.pad) this.pad.gain.setTargetAtTime(paused ? 0.34 : 0.5 - s * 0.18, t, 0.6);
    if (this.motor) this.motor.gain.setTargetAtTime(riding ? 0.07 : 0, t, riding ? 0.5 : 0.25);
  }

  /* ── one-shots ──────────────────────────────────────────────── */

  tone(freq, { dur = 0.22, type = 'sine', gain = 0.05, when = 0, slide = null, attack = 0.006 } = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.04);
  }

  noiseHit({ dur = 0.35, freq = 600, q = 0.8, gain = 0.08, when = 0, type = 'bandpass', slide = null } = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.value = q;
    if (slide) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.04);
  }

  ui() {
    this.tone(420, { dur: 0.06, type: 'sine', gain: 0.022 });
    this.tone(620, { dur: 0.09, type: 'sine', gain: 0.016, when: 0.03 });
  }

  coin(streak = 0) {
    const step = Math.min(10, Math.floor(streak / 3));
    const base = 940 + step * 46;
    this.tone(base, { dur: 0.12, type: 'triangle', gain: 0.045 });
    this.tone(base * 1.5, { dur: 0.18, type: 'sine', gain: 0.03, when: 0.045 });
  }

  crystal() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.tone(f, { dur: 0.75 - i * 0.07, type: 'sine', gain: 0.05 - i * 0.005, when: i * 0.085 });
      this.tone(f * 2, { dur: 0.5, type: 'triangle', gain: 0.014, when: i * 0.085 });
    });
    this.noiseHit({ dur: 1.2, freq: 5200, q: 0.6, gain: 0.025, type: 'highpass' });
  }

  launch() {
    this.noiseHit({ dur: 0.32, freq: 500, slide: 1800, q: 1.1, gain: 0.05 });
  }

  land(impact = 5, points = 0) {
    this.noiseHit({ dur: 0.24, freq: 420, slide: 160, q: 0.9, gain: clamp(0.03 + impact * 0.004, 0.03, 0.11), type: 'lowpass' });
    this.tone(96 - clamp(impact, 0, 20) * 1.2, { dur: 0.26, type: 'sine', gain: 0.04, slide: 52 });
    if (points > 0) {
      this.tone(880, { dur: 0.18, type: 'triangle', gain: 0.025, when: 0.06 });
      this.tone(1320, { dur: 0.26, type: 'sine', gain: 0.02, when: 0.12 });
    }
  }

  crash() {
    this.noiseHit({ dur: 0.55, freq: 900, slide: 120, q: 0.7, gain: 0.13, type: 'lowpass' });
    this.tone(70, { dur: 0.5, type: 'sine', gain: 0.06, slide: 38 });
    this.tone(180, { dur: 0.3, type: 'triangle', gain: 0.026, slide: 80 });
  }

  finish() {
    const notes = [392, 523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, { dur: 1.1, type: 'triangle', gain: 0.04, when: i * 0.12 }));
    this.noiseHit({ dur: 1.8, freq: 2400, q: 0.4, gain: 0.018, type: 'highpass' });
  }

  gondolaStart() {
    if (!this.ready) return;
    this.tone(392, { dur: 0.6, type: 'sine', gain: 0.03 });
    this.tone(523.25, { dur: 0.9, type: 'sine', gain: 0.025, when: 0.16 });
    this.noiseHit({ dur: 1.6, freq: 160, q: 0.7, gain: 0.07, type: 'lowpass' });
    if (this.motor) this.motor.gain.setTargetAtTime(0.085, this.ctx.currentTime, 0.5);
  }

  gondolaStop() {
    if (!this.ready) return;
    if (this.motor) this.motor.gain.setTargetAtTime(0, this.ctx.currentTime, 0.35);
    this.tone(392, { dur: 0.5, type: 'sine', gain: 0.03 });
    this.tone(329.63, { dur: 0.8, type: 'sine', gain: 0.025, when: 0.12 });
  }

  toast() {
    this.tone(660, { dur: 0.12, type: 'sine', gain: 0.022 });
  }
}
