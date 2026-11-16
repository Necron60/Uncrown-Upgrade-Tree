/**
 * Sample-based sound, tuned for calm: every recording in public/sfx is CC0 (see THIRD_PARTY_NOTICES.md).
 * Kalimba, soft-mallet vibraphone, marimba, hand chimes, bell tree, mark tree, zither, frame drum, gong
 * and tubular bell come from the Versilian Community Sample Library; the singing bowl and bubble pops
 * from BigSoundBank. Pitched sounds land on a pentatonic scale so overlapping notes never clash. The
 * soundtrack in public/music is by Scott Buckley (CC-BY 4.0, credited in the Sound settings). In a
 * harvest only destruction makes a sound; the music carries the rest.
 */
import type { MusicTrack } from '../core/state';

const PENTA = [0, 2, 4, 7, 9];
const noteHz = (step: number, base = 523.25) => {
  const oct = Math.floor(step / PENTA.length);
  const deg = PENTA[((step % PENTA.length) + PENTA.length) % PENTA.length];
  return base * Math.pow(2, oct + deg / 12);
};

// tuned samples and the pitch they actually sound at (measured, not taken from the file names)
type PitchSet = Record<string, number>;
const KALIMBA: PitchSet = { kal_g3: 395.4, kal_d4: 585.6, kal_g4: 797.7, kal_cs5: 1144.5, kal_e5: 1295.9, kal_gs5: 1670.8 };
const VIBES: PitchSet = { vib_c3: 261.6, vib_g3: 392, vib_d4: 587.3, vib_a4: 880, vib_c5: 1046.5, vib_e5: 1318.5 };
const MARIMBA: PitchSet = { mar_g2: 196, mar_c4: 524.8, mar_g4: 784 };
const CHIME: PitchSet = { chime_c4: 523.25, chime_e4: 659.25, chime_a4: 880, chime_c5: 1046.5, chime_e5: 1318.5, chime_c6: 2093 };
const BELLS: PitchSet = { bell_d5: 1174.7, bell_e5: 1318.5 };
const BOWL_HZ = 867.4;
const SAMPLES = [
  ...[KALIMBA, VIBES, MARIMBA, CHIME, BELLS].flatMap(Object.keys),
  'marktree_up_fast', 'marktree_up_slow', 'marktree_down', 'vibes_bowed_a2', 'vibes_bowed_e3',
  'gong_soft', 'gong_loud', 'tubular_c4', 'zither_up_slow', 'drum_soft', 'bowl', 'pop_1', 'pop_2', 'pop_3', 'pop_4',
];
// all normalized to -16 LUFS; 'all' plays them one after another, starting at a random piece
const SOUNDTRACK: Record<Exclude<MusicTrack, 'all'>, string> = {
  adrift: 'adrift_among_infinite_stars', hymn: 'hymn_to_the_dawn', cirrus: 'cirrus', hope: 'a_kind_of_hope',
};
// game = shattering, gems = special shards, ui = tree & interface, music = the soundtrack
type Bus = 'game' | 'gems' | 'ui' | 'music';
const BUS_BASE: Record<Bus, number> = { game: 0.9, gems: 0.9, ui: 0.9, music: 0.38 }; // music sits under the effects
const REVERB_MAX = 0.6;
const BREAK_WINDOW = 0.3; // seconds
const MAX_BREAKS = 4; // break sounds of any kind that may start within one window

interface PlayOpts {
  gain?: number;
  rate?: number; // playback speed; also shifts pitch
  delay?: number;
  attack?: number; // fade-in seconds
  dur?: number; // cut off after this many seconds (with a fade)
  offset?: number; // start this far into the sample
  verb?: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = (prefix: string, n: number) => `${prefix}${1 + Math.floor(Math.random() * n)}`;

class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private game!: GainNode;
  private ui!: GainNode;
  private gems!: GainNode;
  private music!: GainNode;
  private musicEl: HTMLAudioElement | null = null;
  private track: MusicTrack = 'all';
  private order = Math.floor(Math.random() * 4);
  private duck = 1; // music level while harvesting
  private busLevels: Record<Bus, number> = { game: 1, gems: 1, ui: 1, music: 1 };
  private reverb = 0.5;
  private hoverOn = true;
  private verbSend!: GainNode;
  private bufs = new Map<string, AudioBuffer>();
  private last = new Map<string, number>();
  private breaks: number[] = []; // start times of recent break sounds
  private queued = new Map<string, { rank: number; fn: () => void }>();
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
    const bus = (b: Bus) => {
      const g = ctx.createGain();
      g.gain.value = this.busGain(b);
      return g;
    };
    this.game = bus('game');
    // harvest sounds pass a gentle lowpass: rounds off the glassy edge of the pops
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass';
    soft.frequency.value = 4500;
    this.game.connect(soft).connect(this.master);
    this.gems = bus('gems');
    this.gems.connect(soft);
    this.ui = bus('ui');
    this.ui.connect(this.master);
    this.music = bus('music');
    this.music.connect(this.master);

    // reverb for the void: a decaying stereo noise impulse
    const len = ctx.sampleRate * 2.4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = this.reverb * REVERB_MAX;
    this.verbSend.connect(verb).connect(this.master);

    // sounds that are still loading (or failed to) just stay silent
    for (const name of SAMPLES) {
      fetch(`sfx/${name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => ctx.decodeAudioData(b))
        .then((buf) => this.bufs.set(name, buf))
        .catch((e) => console.warn(`sound ${name} failed to load`, e));
    }

    // the soundtrack streams through an <audio> element: a 7-minute piece decoded into memory would be ~150 MB
    const el = new window.Audio();
    this.musicEl = el;
    el.onended = () => setTimeout(() => this.nextPiece(), 4000); // a breath of silence between pieces
    ctx.createMediaElementSource(el).connect(this.music);
    this.nextPiece();
  }

  /** The chosen piece again, or the next one in turn when playing them all. */
  private nextPiece() {
    const el = this.musicEl;
    if (!el) return;
    const ids = Object.keys(SOUNDTRACK) as (keyof typeof SOUNDTRACK)[];
    const id = this.track === 'all' ? ids[this.order++ % ids.length] : this.track;
    el.src = `music/${SOUNDTRACK[id]}.mp3`;
    el.play().catch((e) => console.warn('music failed to play', e));
  }

  /** Pick a piece (switches right away) or 'all' (lets the current piece finish first). */
  setTrack(t: MusicTrack) {
    if (t === this.track) return;
    this.track = t;
    if (t !== 'all') this.nextPiece();
  }

  /** Music level relative to the Music slider, faded smoothly: lowered or silenced during a harvest. */
  setMusicDuck(d: number) {
    this.duck = d;
    if (this.ctx) this.music.gain.setTargetAtTime(this.busGain('music'), this.ctx.currentTime, 0.6);
  }

  setReverb(v: number) {
    this.reverb = v;
    if (this.ctx) this.verbSend.gain.setTargetAtTime(v * REVERB_MAX, this.ctx.currentTime, 0.05);
  }

  setHoverSounds(on: boolean) {
    this.hoverOn = on;
  }

  private busGain(b: Bus) {
    return BUS_BASE[b] * this.busLevels[b] * (b === 'music' ? this.duck : 1);
  }

  setVolume(v: number) {
    this.vol = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Volume of one channel (see Bus). */
  setBus(bus: Bus, v: number) {
    this.busLevels[bus] = v;
    if (this.ctx) this[bus].gain.setTargetAtTime(this.busGain(bus), this.ctx.currentTime, 0.05);
  }

  /** Pause/resume all sound (used when the tab is hidden). */
  setSuspended(off: boolean) {
    if (!this.ctx) return;
    if (off && this.ctx.state === 'running') void this.ctx.suspend();
    if (!off && this.ctx.state === 'suspended') void this.ctx.resume();
    // the music element would otherwise keep running silently and lose its place
    if (off) this.musicEl?.pause();
    else this.musicEl?.play().catch(() => {});
  }

  private bus: Exclude<Bus, 'music'> = 'game';
  /** Run fn with every sound it makes routed to the given channel. */
  private on(bus: Exclude<Bus, 'music'>, fn: () => void) {
    this.bus = bus;
    fn();
    this.bus = 'game';
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

  /** Everything one frame asks for under a key collapses into one sound, the highest rank: twenty
   *  shards breaking at once sound like the biggest of them, and a pebble never takes a heart's slot. */
  private perFrame(key: string, rank: number, fn: () => void) {
    const q = this.queued.get(key);
    if (q && q.rank >= rank) return;
    if (!q) queueMicrotask(() => {
      const w = this.queued.get(key);
      this.queued.delete(key);
      w?.fn();
    });
    this.queued.set(key, { rank, fn });
  }

  /** One budget shared by every kind of break sound, however many kinds there come to be: at most
   *  MAX_BREAKS start within any BREAK_WINDOW. A must-play sound always starts, but still counts. */
  private breakSlot(must = false): boolean {
    if (!this.ctx || this.vol <= 0) return false;
    const now = this.ctx.currentTime;
    this.breaks = this.breaks.filter((t) => now - t < BREAK_WINDOW);
    if (!must && this.breaks.length >= MAX_BREAKS) return false;
    this.breaks.push(now);
    return true;
  }

  private play(name: string, o: PlayOpts = {}) {
    const buf = this.bufs.get(name);
    if (!buf) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.2;
    if (o.attack) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + o.attack);
    } else g.gain.setValueAtTime(peak, t0);
    src.connect(g).connect(this[this.bus]);
    if (o.verb) {
      const s = ctx.createGain();
      s.gain.value = o.verb;
      g.connect(s).connect(this.verbSend);
    }
    src.start(t0, o.offset ?? 0);
    if (o.dur) {
      g.gain.setValueAtTime(peak, t0 + Math.max(o.attack ?? 0, o.dur * 0.6));
      g.gain.linearRampToValueAtTime(0, t0 + o.dur);
      src.stop(t0 + o.dur + 0.02);
    }
  }

  /** Play the sample from a tuned set nearest to hz, re-pitched to hit hz exactly. */
  private note(set: PitchSet, hz: number, o: PlayOpts = {}) {
    const pitches = Object.values(set);
    const lo = Math.min(...pitches), hi = Math.max(...pitches);
    // fold far-off notes by octaves: same pentatonic note, no chipmunk or sludge
    while (hz > hi * 2) hz /= 2;
    while (hz < lo / 1.42) hz *= 2;
    let best = '', dist = Infinity;
    for (const [name, p] of Object.entries(set)) {
      const d = Math.abs(Math.log(hz / p));
      if (d < dist) { dist = d; best = name; }
    }
    this.play(best, { ...o, rate: hz / set[best] });
  }

  // ── Tree sounds ──────────────────────────────────────────────────────
  hover() {
    if (!this.hoverOn || !this.gate('hover', 0.04)) return;
    this.on('ui', () => this.note(KALIMBA, noteHz(10), { gain: 0.045, dur: 0.2 }));
  }

  purchase(step: number, big = false) {
    if (!this.gate('buy', 0.03)) return;
    this.on('ui', () => {
      const s = 3 + step;
      this.note(VIBES, noteHz(s, 261.63), { gain: 0.4, verb: 0.8 });
      this.note(VIBES, noteHz(s + 2, 261.63), { gain: 0.28, verb: 0.8, delay: 0.07 });
      this.note(KALIMBA, noteHz(s + 4, 261.63), { gain: 0.22, verb: 0.9, delay: 0.14 });
      if (big) {
        this.play('tubular_c4', { gain: 0.35, verb: 1 });
        this.play('gong_soft', { gain: 0.25, verb: 0.6 });
        this.note(CHIME, noteHz(s - 5, 261.63), { gain: 0.2, verb: 1, delay: 0.2 });
        this.play('marktree_down', { gain: 0.22, verb: 0.6, delay: 0.1 });
      }
    });
  }

  /** A streak of light racing along a branch: a quick upward run on the mark tree. */
  trace(step = 0) {
    if (!this.gate('trace', 0.04)) return;
    this.on('ui', () => this.play('marktree_up_fast', { gain: 0.14, rate: 0.9 + step * 0.04, dur: 1.2, verb: 0.6 }));
  }

  /** The low swell under the finale, before the seed awakens: a singing bowl over bowed vibraphone. */
  drone() {
    this.on('ui', () => {
      this.play('bowl', { gain: 0.35, rate: 880 / BOWL_HZ, attack: 1.4, dur: 5.5, verb: 0.6 });
      this.play('vibes_bowed_a2', { gain: 0.3, rate: 0.5, attack: 1.4, dur: 5.5 });
      this.play('vibes_bowed_e3', { gain: 0.18, rate: 0.5, attack: 1.8, dur: 5.5 });
    });
  }

  reveal(i: number) {
    if (!this.gate('reveal' + (i % 4), 0.02)) return;
    this.on('ui', () => this.note(KALIMBA, noteHz(8 + i, 261.63), { gain: 0.13, verb: 1, delay: 0.25 + i * 0.06 }));
  }

  /** A soft two-note "no" on low marimba. */
  deny() {
    if (!this.gate('deny', 0.1)) return;
    this.on('ui', () => {
      this.note(MARIMBA, 196, { gain: 0.3, dur: 0.6 });
      this.note(MARIMBA, 164.8, { gain: 0.25, dur: 0.7, delay: 0.1 });
    });
  }

  click() {
    if (!this.gate('click', 0.03)) return;
    this.on('ui', () => this.note(MARIMBA, 784, { gain: 0.25, dur: 0.6 }));
  }

  // ── Harvest sounds: only things breaking ─────────────────────────────
  // Every break sound goes through perFrame and breakSlot, so a burst never turns into a wall of sound.

  /** A bubble pop, a few per second at most; bigger shards pop lower, with a little bell (tier 2+) and a soft drum (biggest). */
  shatter(tier: number) {
    const t = Math.min(tier, 3);
    this.perFrame('shatter', t, () => {
      if (!this.gate('shatter', 0.09) || !this.breakSlot()) return;
      this.play(pick('pop_', 4), { gain: 0.2, rate: [1.2, 1.05, 0.92, 0.8][t] * rnd(0.94, 1.06), verb: 0.2 });
      if (t >= 2) this.note(BELLS, noteHz(10 - t), { gain: 0.05, dur: 0.8, verb: 0.3 });
      if (t === 3) this.play('drum_soft', { gain: 0.18, rate: 0.9 });
    });
  }

  /** A special shard breaking: a short chime arpeggio (a gong under the heart crystal, which always sounds). */
  special(kind: 'gold' | 'time' | 'prism' | 'heart') {
    this.perFrame('special', ['time', 'gold', 'prism', 'heart'].indexOf(kind), () => {
      const heart = kind === 'heart';
      if (heart ? !this.breakSlot(true) : !this.gate('special', 0.05) || !this.breakSlot()) return;
      const base = kind === 'gold' ? 8 : kind === 'time' ? 6 : kind === 'prism' ? 10 : 2;
      this.on('gems', () => {
        [0, 2, 4].forEach((d, i) => this.note(CHIME, noteHz(base + d), { gain: 0.14, verb: 0.7, delay: i * 0.05 }));
        if (heart) this.play('gong_soft', { gain: 0.3, dur: 3, verb: 0.5 });
      });
    });
  }

  /** The Hollow Crown's harvest: wards, lightning, frost, a thief getting away, the Hollow Heart, a trial passed. */
  hollow(kind: 'ward' | 'wardbreak' | 'strike' | 'freeze' | 'flee' | 'boss' | 'trial') {
    switch (kind) {
      case 'ward':
        if (!this.gate('ward', 0.07)) return;
        this.note(BELLS, noteHz(14), { gain: 0.035, dur: 0.25 });
        return;
      case 'wardbreak':
        if (!this.gate('wardbreak', 0.08) || !this.breakSlot()) return;
        this.note(BELLS, noteHz(12), { gain: 0.08, dur: 0.6, verb: 0.4 });
        this.play(pick('pop_', 4), { gain: 0.12, rate: 1.4 });
        return;
      case 'strike':
        if (!this.gate('strike', 0.12)) return;
        this.play('drum_soft', { gain: 0.16, rate: rnd(1.3, 1.6), verb: 0.5 });
        this.note(CHIME, noteHz(rnd(11, 13) | 0), { gain: 0.04, dur: 0.4, verb: 0.6 });
        return;
      case 'freeze':
        if (!this.gate('freeze', 0.1)) return;
        this.on('gems', () => this.note(CHIME, noteHz(13), { gain: 0.06, dur: 0.5, verb: 0.7 }));
        return;
      case 'flee':
        this.on('gems', () => {
          this.play('marktree_down', { gain: 0.22, rate: 1.2, verb: 0.4 });
          this.note(MARIMBA, 220, { gain: 0.2, dur: 0.5, delay: 0.05 });
        });
        return;
      case 'boss':
        this.on('gems', () => {
          this.play('gong_loud', { gain: 0.4, rate: 0.8, verb: 1 });
          this.play('vibes_bowed_a2', { gain: 0.25, rate: 0.5, attack: 0.3, dur: 3 });
        });
        return;
      case 'trial':
        this.on('ui', () => {
          [0, 4, 7, 12].forEach((d, i) => this.note(CHIME, noteHz(d, 261.63), { gain: 0.14, verb: 1, delay: i * 0.09 }));
          this.play('tubular_c4', { gain: 0.3, verb: 1 });
        });
        return;
    }
  }

  awaken() {
    this.on('ui', () => {
      const chord = [0, 2, 4, 5, 7, 9, 10, 12];
      chord.forEach((s, i) => this.note(CHIME, noteHz(s, 261.63), { gain: 0.13, verb: 1, attack: 0.6, delay: i * 0.18 }));
      this.play('zither_up_slow', { gain: 0.25, verb: 0.8 });
      this.play('bowl', { gain: 0.3, rate: 880 / BOWL_HZ, attack: 0.8, dur: 8, verb: 0.8, delay: 1.4 });
      this.play('gong_loud', { gain: 0.45, verb: 1, delay: 1.4 });
      this.play('tubular_c4', { gain: 0.3, verb: 1, delay: 1.4 });
      this.play('marktree_up_slow', { gain: 0.3, verb: 1, delay: 1.4 });
    });
  }
}

export const audio = new Audio();
