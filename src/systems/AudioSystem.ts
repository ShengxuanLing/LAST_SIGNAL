// Web Audio API synthesizer SFX — no external audio assets required.
// Deterministic, offline-capable, volume-controlled.
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private masterVol = 0.7;
  private sfxVol = 0.8;
  private enabled = false;

  ensureContext(): void {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVol;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(this.master);
    this.enabled = true;
  }

  resume(): void {
    this.ensureContext();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes(master: number, sfx: number): void {
    this.masterVol = master;
    this.sfxVol = sfx;
    if (this.master) this.master.gain.value = master;
    if (this.sfx) this.sfx.gain.value = sfx;
  }

  private t(): AudioContext | null { return this.ctx; }

  private env(node: GainNode, t0: number, attack: number, decay: number, peak: number): void {
    node.gain.cancelScheduledValues(t0);
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  private tone(freq: number, type: OscillatorType, t0: number, dur: number, peak = 0.3, slideTo?: number): void {
    if (!this.enabled || !this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    this.env(g, t0, 0.005, dur, peak);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(t0: number, dur: number, peak = 0.3, filterFreq = 1200): void {
    if (!this.enabled || !this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = filterFreq;
    const g = ctx.createGain();
    this.env(g, t0, 0.005, dur, peak);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.sfx);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  shoot(kind: 'pulse' | 'scatter' | 'plasma' | 'arc'): void {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    switch (kind) {
      case 'pulse': this.tone(880, 'square', t, 0.08, 0.18, 440); break;      case 'scatter': this.tone(220, 'sawtooth', t, 0.12, 0.2, 120); this.noise(t, 0.06, 0.12, 800); break;
      case 'plasma': this.tone(160, 'sine', t, 0.2, 0.25, 80); break;
      case 'arc': this.tone(1400, 'square', t, 0.06, 0.15, 300); this.noise(t, 0.05, 0.08, 2600); break;
    }
  }

  hit(): void {
    if (!this.enabled) return;
    this.noise(this.ctx!.currentTime, 0.05, 0.14, 1600);
  }

  hurt(): void {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(180, 'sawtooth', t, 0.2, 0.25, 70);
  }

  pickup(): void {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(660, 'square', t, 0.06, 0.14, 990);
  }

  levelup(): void {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'square', t + i * 0.07, 0.15, 0.16, f * 1.0));
  }

  levelchoose(): void {
    if (!this.enabled) return;
    this.tone(880, 'triangle', this.ctx!.currentTime, 0.1, 0.16, 1320);
  }

  death(): void {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(300, 'sawtooth', t, 0.6, 0.3, 60);
    this.noise(t, 0.6, 0.2, 500);
  }

  ui(): void {
    if (!this.enabled) return;
    this.tone(700, 'square', this.ctx!.currentTime, 0.04, 0.1, 1000);
  }

  bossroar(): void {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(90, 'sawtooth', t, 0.9, 0.35, 40);
    this.noise(t, 0.9, 0.3, 400);
  }

  wave(): void {
    if (!this.enabled) return;
    const t = this.ctx!.currentTime;
    this.tone(300, 'sine', t, 0.4, 0.2, 900);
  }
}

export const audio = new AudioSystem();
