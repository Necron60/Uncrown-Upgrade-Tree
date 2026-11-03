/**
 * Procedural sound: every effect is synthesised with Web Audio, so there are no assets.
 * Chimes use a pentatonic scale so overlapping notes never clash.
 */
const PENTA = [0, 2, 4, 7, 9];
const noteHz = (step: number, base = 523.25) => {
  const oct = Math.floor(step / PENTA.length);
  const deg = PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length];
  return base * Math.pow(2, oct + deg / 12);
};

class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private verb!: ConvolverNode;
  private verbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  private vol = 0.7;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    // generated reverb impulse: decaying stereo noise
    const len = ctx.sampleRate * 2.4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.35;
    this.verbSend.connect(this.verb).connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number) {
    this.vol = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Rate limiter so dense moments do not turn into mush. */
  private gate(key: string, minGap: number): boolean {
    if (!this.ctx || this.vol <= 0) return false;
    const now = this.ctx.currentTime;
    const prev = this.last.get(key) ?? -1;
    if (now - prev < minGap) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(freq: number, opts: { type?: OscillatorType; dur?: number; gain?: number; attack?: number; verb?: number; slide?: number; delay?: number } = {}) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const dur = opts.dur ?? 0.6;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t0 + dur);
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opts.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfx);
    if (opts.verb) {
      const s = ctx.createGain();
      s.gain.value = opts.verb;
      g.connect(s).connect(this.verbSend);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(opts: { dur?: number; gain?: number; type?: BiquadFilterType; freq?: number; q?: number; sweep?: number; delay?: number; verb?: number }) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const dur = opts.dur ?? 0.2;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 2000, t0);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, (opts.freq ?? 2000) * opts.sweep), t0 + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfx);
    if (opts.verb) {
      const s = ctx.createGain();
      s.gain.value = opts.verb;
      g.connect(s).connect(this.verbSend);
    }
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  // ── Tree sounds ──────────────────────────────────────────────────────
  hover() {
    if (!this.gate('hover', 0.04)) return;
    this.tone(2400 + Math.random() * 200, { dur: 0.05, gain: 0.025 });
  }

  purchase(step: number, big = false) {
    if (!this.gate('buy', 0.03)) return;
    const s = 3 + step;
    this.tone(noteHz(s), { dur: 1.2, gain: 0.16, verb: 0.8 });
    this.tone(noteHz(s + 2), { dur: 1.0, gain: 0.11, verb: 0.8, delay: 0.07 });
    this.tone(noteHz(s + 4), { dur: 1.4, gain: 0.09, verb: 0.9, delay: 0.14, type: 'triangle' });
    this.noise({ dur: 0.25, gain: 0.05, type: 'highpass', freq: 5000 });
    if (big) {
      this.tone(65, { dur: 1.8, gain: 0.35, slide: 0.5 });
      this.tone(noteHz(s - 5), { dur: 2.4, gain: 0.12, verb: 1, type: 'triangle', delay: 0.2 });
      this.tone(noteHz(s + 7), { dur: 2.4, gain: 0.08, verb: 1, delay: 0.28 });
      this.noise({ dur: 1.4, gain: 0.12, type: 'lowpass', freq: 3000, sweep: 0.05, verb: 0.6 });
    }
  }

  reveal(i: number) {
    if (!this.gate('reveal' + (i % 4), 0.02)) return;
    this.tone(noteHz(8 + i), { dur: 0.9, gain: 0.05, verb: 1, delay: 0.25 + i * 0.06, type: 'sine' });
  }

  deny() {
    if (!this.gate('deny', 0.1)) return;
    this.tone(180, { type: 'square', dur: 0.14, gain: 0.05, slide: 0.6 });
    this.tone(120, { type: 'square', dur: 0.18, gain: 0.04, slide: 0.6, delay: 0.07 });
  }

  click() {
    if (!this.gate('click', 0.03)) return;
    this.tone(1300, { dur: 0.06, gain: 0.05 });
  }

  // ── Harvest sounds ───────────────────────────────────────────────────
  whoosh() {
    if (!this.gate('whoosh', 0.2)) return;
    this.noise({ dur: 0.9, gain: 0.18, type: 'bandpass', freq: 300, sweep: 12, q: 2, verb: 0.5 });
    this.tone(110, { dur: 1.0, gain: 0.12, slide: 3 });
  }

  pulse() {
    if (!this.gate('pulse', 0.05)) return;
    this.tone(220, { dur: 0.08, gain: 0.03, type: 'triangle', slide: 0.7 });
  }

  hit(crit: boolean) {
    if (!this.gate('hit', crit ? 0.03 : 0.045)) return;
    this.noise({ dur: 0.05, gain: crit ? 0.12 : 0.06, freq: crit ? 5200 : 3800, q: 3 });
    if (crit) this.tone(1800, { dur: 0.12, gain: 0.05, slide: 1.5 });
  }

  shatter(tier: number) {
    if (!this.gate('shatter', 0.025)) return;
    const pitch = [3200, 2400, 1700, 900][Math.min(tier, 3)] * (0.9 + Math.random() * 0.25);
    this.noise({ dur: 0.18 + tier * 0.06, gain: 0.13, type: 'highpass', freq: pitch, q: 0.7, verb: 0.3 });
    this.tone(pitch * 1.3, { dur: 0.25, gain: 0.06, type: 'triangle', slide: 0.8, verb: 0.4 });
  }

  plink(combo: number) {
    if (!this.gate('plink', 0.035)) return;
    this.tone(noteHz(4 + Math.min(combo, 22) * 0.5 | 0, 659.25), { dur: 0.18, gain: 0.05, verb: 0.3 });
  }

  arc() {
    if (!this.gate('arc', 0.06)) return;
    this.tone(1400, { type: 'sawtooth', dur: 0.09, gain: 0.03, slide: 0.3 });
    this.noise({ dur: 0.1, gain: 0.07, freq: 6000, q: 0.5 });
  }

  nova() {
    if (!this.gate('nova', 0.06)) return;
    this.tone(90, { dur: 0.5, gain: 0.25, slide: 0.4 });
    this.noise({ dur: 0.45, gain: 0.12, type: 'lowpass', freq: 1800, sweep: 0.1 });
  }

  special(kind: 'gold' | 'time' | 'prism' | 'heart') {
    if (!this.gate('special', 0.05)) return;
    const base = kind === 'gold' ? 8 : kind === 'time' ? 6 : kind === 'prism' ? 10 : 2;
    [0, 2, 4].forEach((d, i) => this.tone(noteHz(base + d), { dur: 0.7, gain: 0.08, verb: 0.7, delay: i * 0.05 }));
    if (kind === 'heart') this.tone(55, { dur: 1.6, gain: 0.4, slide: 0.5 });
  }

  tick(urgent: boolean) {
    if (!this.gate('tick', 0.2)) return;
    this.tone(urgent ? 1600 : 1200, { dur: 0.05, gain: 0.05, type: 'square' });
  }

  runEnd() {
    if (!this.gate('end', 0.5)) return;
    [9, 7, 4, 2, 0].forEach((s, i) => this.tone(noteHz(s), { dur: 1.4, gain: 0.08, verb: 1, delay: i * 0.09 }));
    this.noise({ dur: 1.2, gain: 0.08, type: 'lowpass', freq: 2000, sweep: 0.1, verb: 0.5 });
  }

  awaken() {
    const chord = [0, 2, 4, 5, 7, 9, 10, 12];
    chord.forEach((s, i) => this.tone(noteHz(s, 261.63), { dur: 5, gain: 0.07, verb: 1, attack: 0.6, delay: i * 0.18, type: i % 2 ? 'triangle' : 'sine' }));
    this.tone(55, { dur: 4, gain: 0.35, attack: 0.4, slide: 0.5, delay: 1.4 });
    this.noise({ dur: 4, gain: 0.15, type: 'lowpass', freq: 8000, sweep: 0.02, verb: 1, delay: 1.4 });
  }
}

export const audio = new Audio();
