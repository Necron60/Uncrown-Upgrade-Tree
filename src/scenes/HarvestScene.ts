import gsap from 'gsap';
import { BitmapText, Container, Graphics, Sprite } from 'pixi.js';
import { TAU, chance, clamp, damp, dist2, lerp, rand } from '../core/math';
import { fmt } from '../core/format';
import type { Stats } from '../data/stats';
import { PRISM_COLOR } from '../data/tree';
import { Particles } from '../render/particles';
import { Shake } from '../render/shake';
import { textures } from '../render/textures';
import { audio } from '../systems/audio';
import type { Game } from '../game/Game';
import type { RunResult } from '../ui/ui';
import { Shard, type ShardType } from './harvest/Shard';

interface Mote {
  s: Sprite;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  t: number;
  dur: number;
  amount: number;
  prism: boolean;
  delay: number;
}

interface Num {
  t: BitmapText;
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
}

interface Arc {
  g: Graphics;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  jitterT: number;
}

interface Seeker {
  glow: Sprite;
  core: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  target: Shard | null;
  rest: number; // brief pause after a hit before steering again
  phase: number; // idle orbit angle
}

interface KillInfo {
  crit?: boolean;
  executed?: boolean;
  depth?: number;
}

const ARC_RANGE = 240;
const NOVA_RANGE = 100;

export class HarvestScene {
  readonly view = new Container();
  private root = new Container();
  private shardLayer = new Container();
  private lensLayer = new Container();
  private seekerLayer = new Container();
  /** 0 → 1 as the lens materialises at the start (and back to 0 at the end) */
  private lensIntro = 0;
  private arcLayer = new Container();
  private numLayer = new Container();
  private moteLayer = new Container();
  private fx = new Particles(3500);
  private shake = new Shake(16, 0.025, 1.8);
  private shards: Shard[] = [];
  private w = 1;
  private h = 1;

  // lens
  private lens = { x: 0, y: 0, px: 0, py: 0, R: 56 };
  private lensG = new Graphics();
  private lensTicks = new Graphics();
  private lensGlow: Sprite;
  private lensPulse = 0;
  private drawnR = -1;
  private echo = { x: 0, y: 0 };
  private echoG = new Graphics();
  /** Seeker motes: independent hunters that fly around the field (Seeker Mote node). */
  private seekers: Seeker[] = [];
  private pulseRings: { s: Sprite; t: number; r: number; echo: boolean }[] = [];

  // run state
  private remaining: number;
  private elapsed = 0;
  private overtimeLeft = 0;
  private inOvertime = false;
  private overtimeUsed = false;
  private timeScale = 1;
  private spawnAcc = 0;
  private pulseAcc = 0;
  private ended = false;
  private kills = 0;
  private killsSinceHeart = 0;
  /** time bonuses shrink geometrically so a run can never last forever */
  private timeBonuses = 0;
  private hearts = 0;
  private combo = 0;
  private comboTimer = 0;
  private bestCombo = 0;
  private runLumen = 0;
  private runPrism = 0;
  private shownLumen = 0;
  private shownPrism = 0;
  private bumpT = 0;
  private lastTick = -1;
  private later: { t: number; fn: () => void }[] = [];
  private motes: Mote[] = [];
  private motePool: Sprite[] = [];
  private nums: Num[] = [];
  private numPool: BitmapText[] = [];
  private arcs: Arc[] = [];
  private hitStop = 0;
  /** rises with every flash, decays fast; dense moments get thinner glows so the screen never whites out */
  private heat = 0;
  private onMove = (e: PointerEvent) => {
    this.lens.px = e.clientX;
    this.lens.py = e.clientY;
  };

  onEnd: (r: RunResult) => void = () => {};

  constructor(private game: Game, private st: Stats) {
    const tex = textures();
    this.view.addChild(this.root, this.moteLayer);
    this.root.addChild(this.shardLayer, this.fx.view, this.arcLayer, this.seekerLayer, this.lensLayer, this.numLayer);
    this.lensGlow = new Sprite(tex.glow);
    this.lensGlow.anchor.set(0.5);
    this.lensGlow.blendMode = 'add';
    this.lensGlow.tint = 0x9fe8ff;
    this.lensLayer.addChild(this.lensGlow, this.echoG, this.lensG, this.lensTicks);
    this.lensG.blendMode = 'add';
    this.lensTicks.blendMode = 'add';
    this.echoG.blendMode = 'add';
    this.echoG.visible = st.echoPower > 0;
    this.remaining = st.duration;
    this.shake.enabled = game.state.settings.shake && !game.state.settings.reducedMotion;
    this.fx.density = game.state.settings.quality === 'low' ? 0.6 : 1;

    const nSat = Math.round(st.satellites);
    for (let i = 0; i < nSat; i++) {
      const glow = new Sprite(tex.glow);
      glow.anchor.set(0.5);
      glow.blendMode = 'add';
      glow.tint = 0x7fe9ff;
      glow.scale.set(0.42);
      const core = new Sprite(tex.dot);
      core.anchor.set(0.5);
      core.blendMode = 'add';
      core.scale.set(0.42);
      this.seekerLayer.addChild(glow, core);
      this.seekers.push({ glow, core, x: 0, y: 0, vx: 0, vy: 0, target: null, rest: 0.5, phase: (i / nSat) * TAU });
    }
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerdown', this.onMove);
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  start() {
    const { w, h } = this;
    this.lens.x = this.lens.px = this.echo.x = w / 2;
    this.lens.y = this.lens.py = this.echo.y = h / 2;
    // seekers burst out of the lens in a fan
    this.seekers.forEach((m, i) => {
      const a = (i / this.seekers.length) * TAU - Math.PI / 2;
      m.x = this.lens.x;
      m.y = this.lens.y;
      m.vx = Math.cos(a) * 380;
      m.vy = Math.sin(a) * 380;
    });
    const first = Math.min(this.st.maxShards, 6);
    for (let i = 0; i < first; i++) this.after(0.15 + i * 0.07, () => this.spawn());
    audio.whoosh();
    this.game.hhud.showBanner('The Harvest', this.game.state.lifetime.runs === 0 ? 'move your lens over the shards' : '', 'rgba(150,220,255,0.7)');
    // lens materialises in place
    gsap.to(this, { lensIntro: 1, duration: 0.6, ease: 'back.out(2.2)' });
  }

  private after(t: number, fn: () => void) {
    this.later.push({ t, fn });
  }

  // ───────────────────────────────────────────── spawning
  private pickTier(): number {
    const st = this.st;
    const r = Math.random();
    if (st.tier3 > 0) return r < 0.22 ? 2 : r < 0.54 ? 1 : 0;
    if (st.tier2 > 0) return r < 0.32 ? 1 : 0;
    return 0;
  }

  private pickType(): ShardType {
    const st = this.st;
    if (st.heart > 0 && this.killsSinceHeart >= 100 && this.remaining > 4 && !this.shards.some((s) => s.type === 'heart' && !s.dead)) {
      this.killsSinceHeart = 0;
      return 'heart';
    }
    if (chance(st.prismChance)) return 'prism';
    if (chance(st.timeShardChance)) return 'time';
    if (chance(st.goldChance)) return 'gold';
    return 'normal';
  }

  private spawn(x?: number, y?: number, forceType?: ShardType) {
    if (this.ended) return;
    const alive = this.shards.length;
    if (alive >= Math.round(this.st.maxShards) && !forceType) return;
    const type = forceType ?? this.pickType();
    const tier = this.pickTier();
    const m = 50;
    const top = 96;
    const px = x ?? rand(m, this.w - m);
    const py = y ?? rand(top, this.h - m);
    const s = new Shard(tier, type, clamp(px, m, this.w - m), clamp(py, top, this.h - m));
    this.shards.push(s);
    this.shardLayer.addChild(s.c);
    const tex = textures();
    this.fx.emit({ x: s.x, y: s.y, texture: tex.star4, count: 1, color: 0xffffff, speed: [0, 0], life: [0.35, 0.35], size: [type === 'heart' ? 1.6 : 0.7, 0.7], sizeEnd: 0, spin: [2, 3] });
    this.fx.emit({ x: s.x, y: s.y, texture: tex.dot, count: type === 'heart' ? 30 : 6, color: s.color, speed: [20, 90], life: [0.3, 0.6], size: [0.15, 0.3] });
    if (type === 'heart') {
      this.game.hhud.showBanner('A Heart Crystal', 'shatter it before the night ends', 'rgba(255,77,109,0.8)');
      audio.special('heart');
      this.shake.add(0.3);
    }
  }

  // ───────────────────────────────────────────── combat
  private pulseDamage(): number {
    return this.st.damage * this.st.damageMult * (this.inOvertime ? 2 : 1);
  }

  private pulse() {
    const R = this.lens.R;
    const dmg = this.pulseDamage();
    this.lensPulse = 1;
    this.spawnPulseRing(this.lens.x, this.lens.y, R, false);
    audio.pulse();
    const r2 = (s: Shard, x: number, y: number, rr: number) => dist2(s.x, s.y, x, y) < (rr + s.r * 0.65) ** 2;
    const targets = this.shards.filter((s) => !s.dead && s.spawn > 0.3 && r2(s, this.lens.x, this.lens.y, R));
    for (const s of targets) this.damage(s, dmg, { canCrit: true, canArc: true });
    if (this.st.echoPower > 0) {
      const eR = R * 0.85;
      this.spawnPulseRing(this.echo.x, this.echo.y, eR, true);
      const et = this.shards.filter((s) => !s.dead && s.spawn > 0.3 && r2(s, this.echo.x, this.echo.y, eR));
      for (const s of et) this.damage(s, dmg * this.st.echoPower, { canCrit: true, canArc: false });
    }
  }

  private damage(s: Shard, amount: number, o: { canCrit?: boolean; canArc?: boolean; quiet?: boolean; depth?: number }) {
    if (s.dead) return;
    let crit = false;
    if (o.canCrit && chance(this.st.critChance)) {
      crit = true;
      amount *= this.st.critMult;
    }
    s.hp -= amount;
    s.flash = 1;
    s.punch = crit ? 0.35 : 0.18;
    s.hpShow = 1.6;
    if (!o.quiet || crit) this.number(s.x + rand(-6, 6), s.y - s.r - 4, amount, crit);
    const tex = textures();
    this.fx.emit({ x: s.x, y: s.y, texture: tex.spark, count: crit ? 7 : 3, color: [s.color, 0xffffff], speed: [120, crit ? 420 : 260], life: [0.15, 0.35], size: [0.2, 0.35], drag: 4, stretch: 0.004, spread: s.r * 0.4 });
    audio.hit(crit);

    if (s.hp <= 0) this.kill(s, { crit, depth: o.depth });
    else if (this.st.execute > 0 && s.type !== 'heart' && s.hp <= s.maxHp * this.st.execute) this.kill(s, { crit, executed: true, depth: o.depth });

    if (o.canArc && this.st.arcChance > 0 && chance(this.st.arcChance)) {
      this.arcFrom(s, this.pulseDamage() * 0.6, Math.round(this.st.arcChains));
    }
  }

  private arcFrom(origin: Shard, dmg: number, jumps: number) {
    const visited = new Set<Shard>([origin]);
    let cur = { x: origin.x, y: origin.y };
    let delay = 0;
    for (let j = 0; j < jumps; j++) {
      let best: Shard | null = null;
      let bd = ARC_RANGE * ARC_RANGE;
      for (const s of this.shards) {
        if (s.dead || visited.has(s) || s.spawn < 0.5) continue;
        const d = dist2(s.x, s.y, cur.x, cur.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) break;
      visited.add(best);
      const from = cur;
      const target = best;
      delay += 0.055;
      this.after(delay, () => {
        if (target.dead) return;
        this.drawArc(from.x, from.y, target.x, target.y);
        audio.arc();
        this.damage(target, dmg, { canCrit: true, canArc: false });
      });
      cur = { x: best.x, y: best.y };
    }
  }

  private drawArc(x0: number, y0: number, x1: number, y1: number) {
    const g = new Graphics();
    g.blendMode = 'add';
    this.arcLayer.addChild(g);
    const a: Arc = { g, x0, y0, x1, y1, life: 0.22, jitterT: 0 };
    this.redrawArc(a);
    this.arcs.push(a);
    this.fx.emit({ x: x1, y: y1, texture: textures().spark, count: 6, color: [0xbff4ff, 0xffffff], speed: [100, 300], life: [0.15, 0.3], size: [0.2, 0.35], stretch: 0.004, drag: 4 });
  }

  private redrawArc(a: Arc) {
    const g = a.g;
    g.clear();
    const segs = 9;
    const dx = a.x1 - a.x0, dy = a.y1 - a.y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const pts: number[] = [a.x0, a.y0];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = rand(-1, 1) * Math.min(22, len * 0.12) * Math.sin(t * Math.PI);
      pts.push(lerp(a.x0, a.x1, t) + nx * off, lerp(a.y0, a.y1, t) + ny * off);
    }
    pts.push(a.x1, a.y1);
    const path = () => {
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    };
    path();
    g.stroke({ width: 10, color: 0x5fd8ff, alpha: 0.22, join: 'round', cap: 'round' });
    path();
    g.stroke({ width: 2.4, color: 0xeaffff, alpha: 1, join: 'round', cap: 'round' });
  }

  private kill(s: Shard, info: KillInfo) {
    if (s.dead) return;
    s.dead = true;
    const st = this.st;
    this.kills++;
    this.killsSinceHeart++;
    if (s.type === 'heart') this.hearts++;

    // combo
    if (st.comboPerKill > 0) {
      this.combo = Math.min(this.combo + 1, Math.round(st.comboCap));
      this.comboTimer = st.comboWindow;
    } else {
      this.combo++;
      this.comboTimer = st.comboWindow;
    }
    this.bestCombo = Math.max(this.bestCombo, this.combo);

    // value
    const comboMult = 1 + (st.comboPerKill > 0 ? this.combo * st.comboPerKill : 0);
    let typeMult = 1;
    if (s.type === 'gold') typeMult = st.goldValue;
    if (s.type === 'time' && st.goldenHour > 0) typeMult = 3;
    const critBonus = info.crit || info.executed ? 1 + st.critLumen : 1;
    // stochastic rounding: whole numbers on screen, exact expected value
    const raw = s.value * st.lumenMult * st.lumenMultX * typeMult * comboMult * critBonus;
    const lumen = Math.floor(raw) + (Math.random() < raw - Math.floor(raw) ? 1 : 0);
    let prism = 0;
    if (s.type === 'prism') prism = Math.round(st.prismMult);
    if (s.type === 'heart') prism = 3 * Math.round(st.prismMult);
    this.runLumen += lumen;
    this.runPrism += prism;

    // time
    let addTime = 0;
    if (s.type === 'time') addTime = st.timeShardBonus;
    if (s.type === 'gold' && st.goldenHour > 0) addTime = 0.3;
    addTime *= Math.pow(0.93, this.timeBonuses);
    if (addTime >= 0.05 && !this.inOvertime && !this.ended) {
      this.timeBonuses++;
      this.remaining += addTime;
      this.game.hhud.addTimeFx();
      this.floatLabel(s.x + rand(-10, 10), s.y - s.r - 18, `+${addTime.toFixed(addTime < 0.1 ? 2 : 1)}s`, 0x9ff7ff);
    }

    // ── visuals
    const tex = textures();
    const big = s.type === 'heart';
    const fragN = big ? 40 : 6 + s.tier * 4;
    const fs = (s.r / 17) * 0.55;
    this.fx.emit({ x: s.x, y: s.y, texture: tex.frag, count: fragN, color: [s.color, 0xffffff, s.color], speed: [90, big ? 700 : 340], life: [0.45, 0.95], size: [fs * 0.5, fs], sizeEnd: 0.2, drag: 2.4, spin: [-14, 14], spread: s.r * 0.5 });
    this.fx.emit({ x: s.x, y: s.y, texture: tex.spark, count: big ? 60 : 10 + s.tier * 6, color: [s.color, 0xffffff], speed: [160, big ? 1100 : 520], life: [0.2, 0.5], size: [0.3, 0.55], drag: 3.5, stretch: 0.0035 });
    const calm = 1 / (1 + this.heat * 0.35);
    this.heat += 1;
    if (big || this.heat < 10) {
      this.fx.emit({ x: s.x, y: s.y, texture: tex.glow, count: 1, color: s.color, speed: [0, 0], life: [0.24, 0.24], size: [(s.r * 3.4) / 128, (s.r * 3.4) / 128], sizeEnd: 1.4, alpha: big ? 0.9 : 0.45 * calm });
      this.fx.emit({ x: s.x, y: s.y, texture: tex.ring, count: 1, color: s.color, speed: [0, 0], life: [0.32, 0.32], size: [(s.r * 2) / 256, (s.r * 2) / 256], sizeEnd: big ? 8 : 2.6, alpha: big ? 0.9 : 0.5 * calm });
    }
    if (info.executed) {
      this.floatLabel(s.x + rand(-8, 8), s.y + 12, 'SHATTER', 0xffffff, 13);
      this.fx.emit({ x: s.x, y: s.y, texture: tex.star4, count: 1, color: 0xffffff, speed: [0, 0], life: [0.3, 0.3], size: [1.2, 1.2], sizeEnd: 0 });
    }
    if (s.type === 'gold') {
      this.fx.emit({ x: s.x, y: s.y, texture: tex.star4, count: 10, color: [0xffd54a, 0xfff2b0], speed: [40, 220], life: [0.5, 1], size: [0.2, 0.45], spin: [-4, 4], drag: 2 });
      audio.special('gold');
    } else if (s.type === 'time') audio.special('time');
    else if (s.type === 'prism') audio.special('prism');

    if (big) {
      this.hitStop = 0.14;
      this.shake.add(0.85);
      this.game.flash(0.55, 0.05, 0.5);
      audio.special('heart');
      this.floatLabel(s.x, s.y - 30, `+${fmt(lumen)}`, 0xffd77a, 30);
    } else {
      this.shake.add(0.04 + s.tier * 0.05 + (s.type !== 'normal' ? 0.05 : 0));
      if (s.type === 'gold') this.floatLabel(s.x, s.y - s.r - 10, `+${fmt(lumen)}`, 0xffd77a, 18);
    }
    audio.shatter(big ? 3 : s.tier);

    this.spawnMotes(s, lumen, prism);

    // supernova chain reaction
    if (st.novaPower > 0 && (info.depth ?? 0) < 3) {
      const depth = (info.depth ?? 0) + 1;
      const x = s.x, y = s.y;
      const amount = st.novaPower * Math.max(s.maxHp * 0.6, this.pulseDamage() * 3);
      const R = NOVA_RANGE + s.r;
      this.after(0.06, () => {
        const calmN = 1 / (1 + this.heat * 0.4);
        this.heat += 1.5;
        this.fx.emit({ x, y, texture: tex.ring, count: 1, color: 0xff9a4d, speed: [0, 0], life: [0.4, 0.4], size: [0.15, 0.15], sizeEnd: (R * 2) / 256 / 0.15 / 0.9, alpha: 0.7 * calmN });
        if (this.heat < 12) this.fx.emit({ x, y, texture: tex.glow, count: 1, color: 0xff7a3d, speed: [0, 0], life: [0.3, 0.3], size: [(R * 1.5) / 128, (R * 1.5) / 128], sizeEnd: 0.5, alpha: 0.25 * calmN });
        this.fx.emit({ x, y, texture: tex.spark, count: this.heat < 12 ? 14 : 5, color: [0xff9a4d, 0xffe0a0], speed: [200, 600], life: [0.2, 0.4], size: [0.3, 0.5], stretch: 0.004, drag: 3 });
        audio.nova();
        this.shake.add(0.1);
        for (const o of this.shards) {
          if (o.dead || o === s) continue;
          if (dist2(o.x, o.y, x, y) < (R + o.r) ** 2) this.damage(o, amount, { canCrit: false, canArc: false, quiet: true, depth });
        }
      });
    }

    this.shardLayer.removeChild(s.c);
    s.destroy();
  }

  // ───────────────────────────────────────────── motes & numbers
  private spawnMotes(s: Shard, lumen: number, prism: number) {
    const n = s.type === 'heart' ? 24 : Math.min(6, 1 + s.tier * 2 + (s.type === 'gold' ? 3 : 0));
    const make = (prismMote: boolean, amount: number, i: number, count: number) => {
      if (this.motes.length > 260) {
        if (prismMote) this.shownPrism += amount;
        else this.shownLumen += amount;
        return;
      }
      let sp = this.motePool.pop();
      if (!sp) {
        sp = new Sprite(textures().glow);
        sp.anchor.set(0.5);
        sp.blendMode = 'add';
      }
      sp.tint = prismMote ? PRISM_COLOR : s.type === 'gold' ? 0xffd54a : 0xffe6a8;
      sp.scale.set(prismMote ? 0.3 : 0.2);
      sp.alpha = 1;
      sp.position.set(s.x, s.y);
      this.moteLayer.addChild(sp);
      const a = (i / count) * TAU + rand(-0.4, 0.4);
      const out = rand(50, 140) * (s.type === 'heart' ? 2 : 1);
      this.motes.push({
        s: sp, x0: s.x, y0: s.y,
        cx: s.x + Math.cos(a) * out, cy: s.y + Math.sin(a) * out,
        t: 0, dur: rand(0.55, 0.9), amount, prism: prismMote, delay: rand(0, 0.08),
      });
    };
    for (let i = 0; i < n; i++) make(false, lumen / n, i, n);
    for (let i = 0; i < prism; i++) make(true, 1, i, prism);
  }

  private number(x: number, y: number, v: number, crit: boolean) {
    if (this.nums.length > 70 && !crit) return;
    let t = this.numPool.pop();
    if (!t) {
      t = new BitmapText({ text: '', style: { fontFamily: 'dmg', fontSize: 20 } });
      t.anchor.set(0.5);
    }
    t.text = crit ? `${fmt(v)}!` : fmt(v);
    t.tint = crit ? 0xffd77a : 0xffffff;
    t.style.fontSize = crit ? 28 : 18;
    t.alpha = 1;
    t.position.set(x, y);
    this.numLayer.addChild(t);
    this.nums.push({ t, x, y, vy: crit ? -95 : -70, life: crit ? 0.9 : 0.65, max: crit ? 0.9 : 0.65, s0: crit ? 1.8 : 1.4 });
  }

  private floatLabel(x: number, y: number, text: string, color: number, size = 16) {
    let t = this.numPool.pop();
    if (!t) {
      t = new BitmapText({ text: '', style: { fontFamily: 'dmg', fontSize: 20 } });
      t.anchor.set(0.5);
    }
    t.text = text;
    t.tint = color;
    t.style.fontSize = size;
    t.alpha = 1;
    t.position.set(x, y);
    this.numLayer.addChild(t);
    this.nums.push({ t, x, y, vy: -50, life: 1.1, max: 1.1, s0: 1.6 });
  }

  private spawnPulseRing(x: number, y: number, r: number, echo: boolean) {
    const s = new Sprite(textures().ring);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    s.tint = echo ? 0xc58cff : 0xaef0ff;
    s.position.set(x, y);
    this.lensLayer.addChildAt(s, 0);
    this.pulseRings.push({ s, t: 0, r, echo });
  }

  // ───────────────────────────────────────────── lens drawing
  private drawLens() {
    const R = this.lens.R;
    if (Math.abs(R - this.drawnR) < 0.5) return;
    this.drawnR = R;
    const g = this.lensG;
    g.clear();
    g.circle(0, 0, R).fill({ color: 0x8fdcff, alpha: 0.05 });
    g.circle(0, 0, R).stroke({ width: 2, color: 0xcff6ff, alpha: 0.9 });
    g.circle(0, 0, R * 0.86).stroke({ width: 1, color: 0x8fdcff, alpha: 0.25 });
    g.circle(0, 0, 3).fill({ color: 0xffffff, alpha: 1 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      g.moveTo(Math.cos(a) * 7, Math.sin(a) * 7).lineTo(Math.cos(a) * 14, Math.sin(a) * 14).stroke({ width: 1.5, color: 0xffffff, alpha: 0.8 });
    }
    const t = this.lensTicks;
    t.clear();
    const n = 32;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const len = i % 4 === 0 ? 9 : 4;
      t.moveTo(Math.cos(a) * (R + 5), Math.sin(a) * (R + 5)).lineTo(Math.cos(a) * (R + 5 + len), Math.sin(a) * (R + 5 + len));
    }
    t.stroke({ width: 1.4, color: 0xaef0ff, alpha: 0.55 });
    this.lensGlow.scale.set((R * 3.2) / 128);
    const e = this.echoG;
    e.clear();
    const eR = R * 0.85;
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * TAU;
      e.moveTo(Math.cos(a0) * eR, Math.sin(a0) * eR).arc(0, 0, eR, a0, a0 + (TAU / 24) * 0.55);
    }
    e.stroke({ width: 1.6, color: 0xc58cff, alpha: 0.75 });
    e.circle(0, 0, eR).fill({ color: 0xc58cff, alpha: 0.04 });
  }

  // ───────────────────────────────────────────── seeker motes
  /** Prefer shards the lens isn't covering and that no other mote is already chasing. */
  private pickSeekerTarget(m: Seeker): Shard | null {
    let best: Shard | null = null;
    let bestScore = Infinity;
    const L = this.lens;
    for (const s of this.shards) {
      if (s.dead || s.spawn < 0.5) continue;
      let score = Math.hypot(s.x - m.x, s.y - m.y);
      if (this.seekers.some((o) => o !== m && o.target === s)) score += 420;
      if (dist2(s.x, s.y, L.x, L.y) < (L.R + s.r) ** 2) score += 260;
      if (s.type !== 'normal') score -= 120; // special shards are worth chasing
      if (score < bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  private updateSeekers(dt: number) {
    const st = this.st;
    const L = this.lens;
    const tex = textures();
    const speed = 480 * st.satSpeed;
    const accel = 2400 * st.satSpeed;
    const dmg = this.pulseDamage() * 0.8 * st.satDamage;
    for (const m of this.seekers) {
      m.rest -= dt;
      if (m.target?.dead) m.target = null;
      if (!m.target && m.rest <= 0 && !this.ended) m.target = this.pickSeekerTarget(m);

      let tx: number, ty: number, max: number;
      if (m.target && m.rest <= 0) {
        tx = m.target.x;
        ty = m.target.y;
        max = speed;
      } else {
        // idle: a loose orbit around the lens
        m.phase += dt * 1.8;
        tx = L.x + Math.cos(m.phase) * (L.R + 36);
        ty = L.y + Math.sin(m.phase) * (L.R + 36);
        max = speed * 0.65;
      }
      // seek steering: accelerate toward the desired velocity, so paths curve organically
      const dx = tx - m.x, dy = ty - m.y;
      const d = Math.hypot(dx, dy) || 1;
      const dvx = (dx / d) * max - m.vx;
      const dvy = (dy / d) * max - m.vy;
      const dl = Math.hypot(dvx, dvy) || 1;
      const a = Math.min(accel * dt, dl);
      m.vx += (dvx / dl) * a;
      m.vy += (dvy / dl) * a;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x < 10) { m.x = 10; m.vx = Math.abs(m.vx); }
      if (m.x > this.w - 10) { m.x = this.w - 10; m.vx = -Math.abs(m.vx); }
      if (m.y < 84) { m.y = 84; m.vy = Math.abs(m.vy); }
      if (m.y > this.h - 10) { m.y = this.h - 10; m.vy = -Math.abs(m.vy); }

      // comet look: stretched glow along the flight path + a fading trail
      const sp = Math.hypot(m.vx, m.vy);
      m.glow.position.set(m.x, m.y);
      m.glow.rotation = Math.atan2(m.vy, m.vx);
      m.glow.scale.set(0.4 + sp * 0.0006, 0.32);
      m.core.position.set(m.x, m.y);
      if (!this.ended) {
        this.fx.emit({ x: m.x, y: m.y, texture: tex.dot, count: 1, color: [0x7fe9ff, 0xcff8ff], speed: [0, 14], life: [0.22, 0.42], size: [0.16, 0.28], alpha: 0.75, drag: 3 });
      }

      if (this.ended) continue;
      for (const s of this.shards) {
        if (s.dead || s.satCd > 0 || s.spawn < 0.5) continue;
        if (dist2(s.x, s.y, m.x, m.y) >= (s.r + 9) ** 2) continue;
        s.satCd = 0.22;
        this.damage(s, dmg, { canCrit: st.satCrit > 0, canArc: st.satArc > 0, quiet: true });
        // ricochet off, then loop back for another pass
        const nx = m.x - s.x, ny = m.y - s.y;
        const nl = Math.hypot(nx, ny) || 1;
        m.vx = (nx / nl) * speed * 0.75 + rand(-90, 90);
        m.vy = (ny / nl) * speed * 0.75 + rand(-90, 90);
        m.rest = 0.07;
        if (s.dead) m.target = null;
        break;
      }
    }
  }

  // ───────────────────────────────────────────── loop
  update(realDt: number) {
    if (this.hitStop > 0) {
      this.hitStop -= realDt;
      realDt *= 0.05;
    }
    const dt = realDt * this.timeScale;
    const st = this.st;
    this.elapsed += dt;

    // lens follows the pointer
    const L = this.lens;
    L.x = damp(L.x, L.px, 28, realDt);
    L.y = damp(L.y, L.py, 28, realDt);
    L.R = st.radius * (1 + st.radiusGrowth * this.elapsed);
    this.echo.x = damp(this.echo.x, L.x, 3.2, dt);
    this.echo.y = damp(this.echo.y, L.y, 3.2, dt);
    this.drawLens();
    this.lensPulse = Math.max(0, this.lensPulse - realDt * 6);
    const ps = 1 + this.lensPulse * 0.06;
    this.lensG.position.set(L.x, L.y);
    const li = Math.max(0, this.lensIntro);
    this.lensG.scale.set(ps * li);
    this.lensTicks.scale.set(li);
    this.echoG.scale.set(li);
    this.lensTicks.position.set(L.x, L.y);
    this.lensTicks.rotation += dt * 0.6;
    this.lensGlow.position.set(L.x, L.y);
    this.lensGlow.alpha = (0.16 + this.lensPulse * 0.2 + (this.inOvertime ? 0.15 : 0)) * li;
    this.lensGlow.tint = this.inOvertime ? 0xffb36b : 0x9fe8ff;
    this.echoG.position.set(this.echo.x, this.echo.y);
    this.echoG.rotation -= dt * 0.8;

    // timers
    if (!this.ended) {
      if (this.inOvertime) {
        this.overtimeLeft -= dt;
        this.game.hhud.setTimer(this.overtimeLeft, st.overtime, true);
        if (this.overtimeLeft <= 0) this.end();
      } else {
        this.remaining -= dt;
        this.game.hhud.setTimer(this.remaining, Math.max(st.duration, this.remaining), false);
        const whole = Math.ceil(this.remaining);
        if (this.remaining <= 3.5 && whole !== this.lastTick && this.remaining > 0) {
          this.lastTick = whole;
          audio.tick(this.remaining < 2);
        }
        if (this.remaining <= 0) {
          if (st.overtime > 0 && !this.overtimeUsed) {
            this.overtimeUsed = true;
            this.inOvertime = true;
            this.overtimeLeft = st.overtime;
            this.game.hhud.showBanner('Last Light', 'double damage', 'rgba(255,170,80,0.85)');
            this.game.flash(0.35, 0.05, 0.4, '#ffb36b');
            this.shake.add(0.3);
          } else this.end();
        }
      }

      // spawning
      this.spawnAcc += st.spawnRate * dt;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const x = rand(60, this.w - 60), y = rand(110, this.h - 60);
        this.spawn(x, y);
        for (let c = 0; c < Math.round(st.cluster); c++) this.spawn(x + rand(-70, 70), y + rand(-70, 70));
      }

      // lens pulses
      this.pulseAcc += dt;
      const interval = 1 / st.pulseRate;
      let guard = 0;
      while (this.pulseAcc >= interval && guard++ < 4) {
        this.pulseAcc -= interval;
        this.pulse();
      }

      // combo decay
      if (this.combo > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.combo = 0;
      }
      if (st.comboPerKill > 0) this.game.hhud.setCombo(this.combo, this.combo * st.comboPerKill, Math.max(0, this.comboTimer / st.comboWindow));
    }

    // delayed events
    for (let i = this.later.length - 1; i >= 0; i--) {
      const e = this.later[i];
      e.t -= dt;
      if (e.t <= 0) {
        this.later.splice(i, 1);
        e.fn();
      }
    }

    // seeker motes hunt on their own
    if (this.seekers.length) this.updateSeekers(dt);

    // shards
    const grav = st.gravity;
    for (const s of this.shards) {
      if (s.dead) continue;
      if (grav > 0 && !this.ended) {
        const dx = L.x - s.x, dy = L.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        const acc = (grav * 70) / (1 + d / 260);
        s.vx += (dx / d) * acc * dt;
        s.vy += (dy / d) * acc * dt;
        const k = Math.exp(-0.9 * dt);
        s.vx *= k;
        s.vy *= k;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < s.r) { s.x = s.r; s.vx = Math.abs(s.vx); }
      if (s.x > this.w - s.r) { s.x = this.w - s.r; s.vx = -Math.abs(s.vx); }
      if (s.y < 80 + s.r) { s.y = 80 + s.r; s.vy = Math.abs(s.vy); }
      if (s.y > this.h - s.r) { s.y = this.h - s.r; s.vy = -Math.abs(s.vy); }
      s.update(dt);
      if (s.type === 'gold' && Math.random() < dt * 4) {
        this.fx.emit({ x: s.x + rand(-s.r, s.r), y: s.y + rand(-s.r, s.r), texture: textures().star4, count: 1, color: 0xfff0b0, speed: [0, 10], life: [0.4, 0.7], size: [0.15, 0.3], spin: [-2, 2] });
      }
    }
    this.shards = this.shards.filter((s) => !s.dead);

    // pulse rings
    for (let i = this.pulseRings.length - 1; i >= 0; i--) {
      const p = this.pulseRings[i];
      p.t += realDt / 0.35;
      if (p.t >= 1) {
        p.s.destroy();
        this.pulseRings.splice(i, 1);
        continue;
      }
      const sc = ((p.r * 2) / 256 / 0.9) * (1 + p.t * 0.22);
      p.s.scale.set(sc);
      p.s.alpha = (1 - p.t) * (p.echo ? 0.2 : 0.3);
    }

    // arcs flicker then fade
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= realDt;
      a.jitterT -= realDt;
      if (a.life <= 0) {
        a.g.destroy();
        this.arcs.splice(i, 1);
        continue;
      }
      if (a.jitterT <= 0) {
        a.jitterT = 0.035;
        this.redrawArc(a);
      }
      a.g.alpha = Math.min(1, a.life / 0.12);
    }

    // motes fly to the HUD counter (real time so they feel snappy in slow-mo)
    const lt = this.game.hhud.lumenTarget();
    const pt = this.game.hhud.prismTarget();
    for (let i = this.motes.length - 1; i >= 0; i--) {
      const m = this.motes[i];
      if (m.delay > 0) { m.delay -= realDt; continue; }
      m.t += realDt / m.dur;
      const tg = m.prism ? pt : lt;
      if (m.t >= 1) {
        this.moteLayer.removeChild(m.s);
        this.motePool.push(m.s);
        this.motes.splice(i, 1);
        if (m.prism) {
          this.shownPrism += m.amount;
          this.game.hhud.prism.set(this.shownPrism, false);
        } else {
          this.shownLumen += m.amount;
          this.game.hhud.lumen.set(this.shownLumen, false);
          audio.plink(this.combo);
        }
        if (this.bumpT <= 0) {
          (m.prism ? this.game.hhud.prism : this.game.hhud.lumen).bump(1.12);
          this.bumpT = 0.07;
        }
        continue;
      }
      // quadratic bezier with ease-in so motes linger, then whoosh home
      const e = m.t < 0.3 ? (m.t / 0.3) * 0.3 * 0.5 : 0.15 + Math.pow((m.t - 0.3) / 0.7, 2) * 0.85;
      const u = 1 - e;
      m.s.x = u * u * m.x0 + 2 * u * e * m.cx + e * e * tg.x;
      m.s.y = u * u * m.y0 + 2 * u * e * m.cy + e * e * tg.y;
      m.s.scale.set((m.prism ? 0.3 : 0.2) * (1 - e * 0.4));
    }
    this.bumpT -= realDt;

    // damage numbers
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.life -= realDt;
      if (n.life <= 0) {
        this.numLayer.removeChild(n.t);
        this.numPool.push(n.t);
        this.nums.splice(i, 1);
        continue;
      }
      const age = n.max - n.life;
      n.y += n.vy * realDt;
      n.vy *= Math.exp(-3 * realDt);
      const pop = age < 0.12 ? lerp(n.s0, 1, age / 0.12) : 1;
      n.t.scale.set(pop);
      n.t.position.set(n.x, n.y);
      n.t.alpha = n.life < n.max * 0.4 ? n.life / (n.max * 0.4) : 1;
    }

    this.heat *= Math.exp(-5 * realDt);
    // after the run, effects play out in real time behind the summary
    this.fx.update(this.ended ? realDt : dt);
    this.shake.update(realDt);
    this.root.position.set(this.shake.x, this.shake.y);
    this.root.rotation = this.shake.rot;
    this.root.pivot.set(0, 0);
    this.game.hhud.setKills(this.kills);
  }

  private end() {
    if (this.ended) return;
    this.ended = true;
    audio.runEnd();
    gsap.to(this, { timeScale: 0.12, duration: 0.5, ease: 'power2.out' });
    this.game.hhud.setTimer(0, 1, this.inOvertime);
    // remaining shards dissolve
    const tex = textures();
    this.shards.forEach((s, i) => {
      gsap.delayedCall(0.15 + i * 0.03, () => {
        if (s.dead || this.view.destroyed) return;
        s.dead = true;
        this.fx.emit({ x: s.x, y: s.y, texture: tex.dot, count: 10, color: s.color, speed: [20, 120], life: [0.5, 1], size: [0.15, 0.35], drag: 1, gravity: -60 });
        gsap.to(s.c, { alpha: 0, duration: 0.3, onComplete: () => { if (!this.view.destroyed) this.shardLayer.removeChild(s.c); s.destroy(); } });
      });
    });
    gsap.to(this, { lensIntro: 0, duration: 0.5, delay: 0.3, ease: 'back.in(2)' });
    for (const m of this.seekers) gsap.to([m.glow, m.core], { alpha: 0, duration: 0.4 });
    gsap.delayedCall(1.0, () => { if (!this.view.destroyed) this.finish(); });
  }

  /** player bailed out early (Esc) */
  forceEnd() {
    this.end();
  }

  get isEnded() {
    return this.ended;
  }

  private finish() {
    // flush motes that are still flying so the HUD total is exact
    this.shownLumen = this.runLumen;
    this.shownPrism = this.runPrism;
    this.game.hhud.lumen.set(this.runLumen, true, 0.3);
    this.game.hhud.prism.set(this.runPrism, true, 0.3);
    this.onEnd({
      lumen: this.runLumen,
      prism: this.runPrism,
      kills: this.kills,
      bestCombo: this.bestCombo,
      duration: this.elapsed,
      hearts: this.hearts,
    });
  }

  destroy() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerdown', this.onMove);
    gsap.killTweensOf(this);
    this.fx.clear();
    this.view.destroy({ children: true });
  }
}
