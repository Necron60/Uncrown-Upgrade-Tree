import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { TAU, hsvToHex, lerpColor, rand } from '../../core/math';
import type { ShardTier } from '../../data/tree';
import { SHARD_R, textures } from '../../render/textures';

/**
 * normal and the specials (gold, time, prism, heart) are the Bloom's; the hazards (warded, thief,
 * dimmer, skittish) and the boss (the Hollow Heart) belong to the Hollow Crown.
 */
export type ShardType = 'normal' | 'gold' | 'time' | 'prism' | 'heart' | HazardType | 'boss';
export type HazardType = 'warded' | 'thief' | 'dimmer' | 'skittish';

export const HAZARDS: HazardType[] = ['warded', 'thief', 'dimmer', 'skittish'];
export const isHazard = (t: ShardType): t is HazardType => (HAZARDS as string[]).includes(t);

/** How a hazard differs from a plain shard of its tier. */
export const HAZARD_DEF: Record<HazardType, { hp: number; value: number; color: number; r: number }> = {
  warded: { hp: 1, value: 2, color: 0xdfe6ff, r: 1.05 },
  thief: { hp: 2, value: 3, color: 0xff3355, r: 1 },
  dimmer: { hp: 2.5, value: 3, color: 0x7a4dff, r: 1.1 },
  skittish: { hp: 0.8, value: 4, color: 0x9dffd2, r: 0.85 },
};

export const TYPE_COLORS: Record<'gold' | 'time' | 'heart', number> = {
  gold: 0xffd54a,
  time: 0x7ff7ff,
  heart: 0xff4d6d,
};

const easeOutBack = (t: number) => {
  const c1 = 2.2, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export class Shard {
  readonly c = new Container();
  private glow: Sprite;
  private core: Sprite; // light inside the crystal
  private body: Sprite;
  private sheen: [Sprite, Sprite]; // white facet highlights, cross-faded so the light seems to travel
  private cracks: Sprite; // fractures glow in as it takes damage
  private flashS: Sprite;
  private glint: Sprite; // a star that twinkles on one of the corners now and then
  private glintT = 1;
  private glintWait = rand(0.4, 2.5);
  private sides: number;
  private phase = rand(0, TAU);
  private hpG = new Graphics();
  private deco: Graphics | null = null;
  // hollow crown states, drawn lazily
  private fire: Sprite | null = null;
  private ice: Sprite | null = null;
  private aura: Sprite | null = null;
  private wardG: Graphics | null = null;
  private drawnWards = -1;
  private timerG: Graphics | null = null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot = rand(0, TAU);
  vrot = rand(-0.8, 0.8);
  readonly r: number;
  hp: number;
  readonly maxHp: number;
  readonly value: number;
  /** value multiplier for its type (hazards) */
  readonly bonus: number;
  readonly color: number;
  readonly hazard: boolean;
  /** the heart crystal or the Hollow Heart: big, always shows its health */
  readonly big: boolean;
  spawn = 0;
  flash = 0;
  punch = 0;
  hpShow = 0;
  /** the Hollow Heart: the share of it broken in earlier harvests, drawn as a scar on its ring */
  scar = 0;
  satCd = 0;
  dead = false;
  /** seconds of fire left; damage builds up in burnAcc and lands in small ticks */
  burn = 0;
  burnAcc = 0;
  burnTick = 0;
  /** 0..0.85: slows the shard, fades */
  chill = 0;
  /** hits toward the next freeze */
  frost = 0;
  /** seconds frozen solid */
  frozen = 0;
  wards = 0;
  /** thieves: seconds until it flees */
  fuse = 0;
  fuseMax = 0;
  private hue = Math.random();
  private drawnHp = -1;
  private t = Math.random() * 10;

  constructor(def: ShardTier, readonly tier: number, readonly type: ShardType, x: number, y: number, o: { wards?: number; fuse?: number } = {}) {
    const tex = textures();
    this.x = x;
    this.y = y;
    this.big = type === 'heart' || type === 'boss';
    this.hazard = isHazard(type);
    const hz = this.hazard ? HAZARD_DEF[type as HazardType] : null;
    const sp = this.big ? 12 : type === 'skittish' ? rand(40, 70) : rand(10, 34);
    const a = rand(0, TAU);
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp;
    if (this.big) this.vrot = rand(-0.25, 0.25);
    this.r = def.r * (type === 'prism' ? 1.05 : hz ? hz.r : 1);
    this.maxHp = this.hp = def.hp * (type === 'prism' ? 1.5 : type === 'gold' ? 1.2 : hz ? hz.hp : 1);
    this.value = def.value;
    this.bonus = hz ? hz.value : 1;
    this.color = type === 'normal' || type === 'prism' || type === 'boss' ? def.color : hz ? hz.color : TYPE_COLORS[type as 'gold' | 'time' | 'heart'];
    this.wards = o.wards ?? 0;
    this.fuse = this.fuseMax = o.fuse ?? 0;

    this.glow = new Sprite(tex.glow);
    this.glow.anchor.set(0.5);
    this.glow.blendMode = 'add';
    this.glow.tint = this.color;
    this.glow.scale.set((this.r * (type === 'normal' ? 4.6 : 6.5)) / 128);
    this.glow.alpha = type === 'normal' ? 0.42 : 0.65;

    this.sides = def.sides;
    const layer = (t: Texture, add: boolean) => {
      const sp = new Sprite(t);
      sp.anchor.set(0.5);
      if (add) sp.blendMode = 'add';
      return sp;
    };
    this.core = layer(tex.glow, true);
    this.core.tint = lerpColor(this.color, 0xffffff, 0.35);
    this.body = layer(tex.shard[def.sides], false);
    // thieves and dimmers are dark crystals with a coloured light inside
    this.body.tint = type === 'thief' ? 0x4a1524 : type === 'dimmer' ? 0x2c1a5e : this.color;
    this.sheen = [layer(tex.shardSheen[def.sides][0], true), layer(tex.shardSheen[def.sides][1], true)];
    this.cracks = layer(tex.shardCracks[def.sides], true);
    this.cracks.tint = lerpColor(this.color, 0xffffff, 0.6);
    this.cracks.alpha = 0;
    this.flashS = layer(tex.shardFlash[def.sides], true);
    this.flashS.alpha = 0;
    this.glint = layer(tex.star4, true);
    this.glint.alpha = 0;

    this.c.addChild(this.glow, this.body, this.core, ...this.sheen, this.cracks, this.flashS, this.glint, this.hpG);

    if (type === 'dimmer') {
      // a pool of darkness around it: drawn normally (not added), so it eats the light behind it
      this.aura = new Sprite(tex.glow);
      this.aura.anchor.set(0.5);
      this.aura.tint = 0x000000;
      this.aura.alpha = 0.55;
      this.aura.scale.set((this.r * 7) / 128);
      this.c.addChildAt(this.aura, 0);
    }
    if (type === 'time' || this.big) {
      this.deco = new Graphics();
      const rr = this.r + (this.big ? 16 : 9);
      const n = this.big ? 18 : 10;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU;
        const a1 = a0 + (TAU / n) * 0.5;
        this.deco.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a1);
      }
      this.deco.stroke({ width: this.big ? 2.5 : 1.6, color: this.color, alpha: 0.8 });
      if (type === 'boss') {
        // the Hollow Heart wears a crown of thorns
        for (let i = 0; i < 12; i++) {
          const a0 = (i / 12) * TAU;
          const r0 = this.r + 26, r1 = this.r + (i % 2 ? 38 : 50);
          this.deco.moveTo(Math.cos(a0 - 0.08) * r0, Math.sin(a0 - 0.08) * r0).lineTo(Math.cos(a0) * r1, Math.sin(a0) * r1).lineTo(Math.cos(a0 + 0.08) * r0, Math.sin(a0 + 0.08) * r0);
        }
        this.deco.stroke({ width: 2, color: 0xffb3c2, alpha: 0.7, join: 'round' });
      }
      this.c.addChildAt(this.deco, 1);
    }
    if (this.wards > 0) {
      this.wardG = new Graphics();
      this.wardG.blendMode = 'add';
      this.c.addChild(this.wardG);
    }
    if (this.fuseMax > 0) {
      this.timerG = new Graphics();
      this.c.addChild(this.timerG);
    }
    this.c.position.set(x, y);
    this.c.scale.set(0);
  }

  update(dt: number) {
    this.t += dt;
    this.spawn = Math.min(1, this.spawn + dt / 0.38);
    this.flash = Math.max(0, this.flash - dt * 7);
    this.punch = Math.max(0, this.punch - dt * 2.2);
    this.hpShow = Math.max(0, this.hpShow - dt);
    this.satCd -= dt;
    if (this.frozen <= 0) this.rot += this.vrot * dt * (1 - this.chill);

    const base = this.r / SHARD_R;
    const beat = this.big ? 1 + Math.max(0, Math.sin(this.t * (this.type === 'boss' ? 4 : 6))) * 0.06 : 1;
    const s = base * easeOutBack(this.spawn) * (1 + this.punch * 0.6) * beat;
    this.c.position.set(this.x, this.y);
    for (const sp of [this.body, ...this.sheen, this.cracks, this.flashS]) {
      sp.rotation = this.rot;
      sp.scale.set(s);
    }
    this.flashS.alpha = this.flash * 0.7;
    this.c.scale.set(1);
    this.c.alpha = Math.min(1, this.spawn * 2.5);

    // light drifting across the facets, a slow inner pulse, cracks spreading with damage
    const k = 0.5 + 0.5 * Math.sin(this.t * 1.3 + this.phase);
    this.sheen[0].alpha = 0.55 * k * k * k;
    this.sheen[1].alpha = 0.55 * (1 - k) ** 3;
    this.core.scale.set((this.r * 1.2) / 128);
    this.core.alpha = 0.13 + 0.06 * Math.sin(this.t * 2.1 + this.phase) + this.flash * 0.5 + (this.type === 'thief' ? 0.25 : 0);
    this.cracks.alpha = Math.pow(1 - Math.max(0, this.hp / this.maxHp), 0.6) * 0.95;
    this.updateGlint(dt, s);

    if (this.type === 'prism') {
      this.hue += dt * 0.35;
      const col = hsvToHex(this.hue, 0.5, 1);
      this.body.tint = col;
      this.glow.tint = col;
      this.core.tint = this.cracks.tint = lerpColor(col, 0xffffff, 0.45);
    }
    const gpulse = this.type === 'normal' ? 0 : Math.sin(this.t * (this.type === 'thief' ? 9 : 5)) * 0.12;
    this.glow.alpha = (this.type === 'normal' ? 0.4 : 0.65) + gpulse + this.flash * 0.5;
    if (this.deco) this.deco.rotation -= dt * (this.big ? 0.5 : 1.5);
    if (this.aura) this.aura.alpha = 0.5 + Math.sin(this.t * 2) * 0.08;

    this.updateStates(dt, s);

    const showHp = this.big || this.hpShow > 0;
    if (showHp && this.drawnHp !== this.hp) this.drawHp();
    this.hpG.alpha = this.big ? 1 : Math.min(1, this.hpShow * 2);
  }

  /** Fire, frost, wards and a thief's fuse. */
  private updateStates(dt: number, s: number) {
    const tex = textures();
    // fire: a flickering orange light over the crystal
    if (this.burn > 0 && !this.fire) {
      this.fire = new Sprite(tex.glow);
      this.fire.anchor.set(0.5);
      this.fire.blendMode = 'add';
      this.fire.tint = 0xff7a2e;
      this.c.addChildAt(this.fire, this.c.getChildIndex(this.core) + 1);
    }
    if (this.fire) {
      const on = this.burn > 0;
      this.fire.visible = on;
      if (on) {
        const f = 0.75 + Math.sin(this.t * 17 + this.phase) * 0.12 + Math.sin(this.t * 29) * 0.08;
        this.fire.alpha = 0.55 * f;
        this.fire.scale.set(((this.r * 3) / 128) * (0.95 + f * 0.1));
      }
    }
    // frost: chill tints the crystal ice-blue; frozen, it is sheathed in ice
    if (this.chill > 0.01 || this.frozen > 0) {
      if (!this.ice) {
        this.ice = new Sprite(tex.shardFlash[this.sides]);
        this.ice.anchor.set(0.5);
        this.ice.blendMode = 'add';
        this.ice.tint = 0xbfe8ff;
        this.c.addChildAt(this.ice, this.c.getChildIndex(this.flashS));
      }
      this.ice.visible = true;
      this.ice.rotation = this.rot;
      this.ice.scale.set(s * (this.frozen > 0 ? 1.12 : 1));
      this.ice.alpha = this.frozen > 0 ? 0.6 + Math.sin(this.t * 3) * 0.05 : this.chill * 0.35;
    } else if (this.ice) this.ice.visible = false;
    // wards: plates of light around it, one per ward
    if (this.wardG && this.drawnWards !== this.wards) {
      this.drawnWards = this.wards;
      const g = this.wardG;
      g.clear();
      const n = this.wards;
      const rr = this.r + 11;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + 0.12, a1 = ((i + 1) / n) * TAU - 0.12;
        g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a1);
      }
      if (n) g.stroke({ width: 3, color: 0xe6ecff, alpha: 0.9, cap: 'round' });
      if (n) g.circle(0, 0, rr).stroke({ width: 9, color: 0xc8d4ff, alpha: 0.08 });
    }
    if (this.wardG) this.wardG.rotation += dt * 0.7;
    // a thief's fuse burns down around it, faster and brighter as it is about to flee
    if (this.timerG && this.fuseMax > 0) {
      const g = this.timerG;
      g.clear();
      const f = Math.max(0, this.fuse / this.fuseMax);
      const rr = this.r + 9;
      const a0 = -Math.PI / 2;
      const hot = f < 0.33 ? 0.6 + 0.4 * Math.sin(this.t * 24) : 0.85;
      g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a0 + TAU * f).stroke({ width: 2.5, color: 0xff5470, alpha: hot, cap: 'round' });
    }
  }

  /** Every few seconds a four-point star flares on one corner of the gem and fades. */
  private updateGlint(dt: number, s: number) {
    this.glintWait -= dt;
    if (this.glintWait <= 0 && this.glintT >= 1) {
      this.glintT = 0;
      this.glintWait = rand(1.4, 4);
      const a = this.rot - Math.PI / 2 + Math.floor(rand(0, this.sides)) * (TAU / this.sides);
      this.glint.position.set(Math.cos(a) * SHARD_R * s * 0.96, Math.sin(a) * SHARD_R * s * 0.96);
      this.glint.rotation = rand(-0.3, 0.3);
    }
    if (this.glintT < 1) this.glintT = Math.min(1, this.glintT + dt / 0.45);
    const g = Math.sin(Math.PI * this.glintT);
    this.glint.alpha = g;
    this.glint.scale.set((this.r / 34) * g * 0.9);
  }

  private drawHp() {
    this.drawnHp = this.hp;
    const g = this.hpG;
    g.clear();
    const rr = this.r + (this.big ? 26 : 8);
    const frac = Math.max(0, this.hp / this.maxHp);
    const a0 = -Math.PI / 2;
    g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a0 + TAU).stroke({ width: 3, color: 0xffffff, alpha: 0.12 });
    if (this.scar > 0.002) {
      // what earlier harvests broke stays dark: the ring ends where this harvest's damage began
      const s0 = a0 + TAU * (1 - this.scar);
      g.moveTo(Math.cos(s0) * rr, Math.sin(s0) * rr).arc(0, 0, rr, s0, a0 + TAU).stroke({ width: 4, color: 0x7a1830, alpha: 0.75 });
    }
    if (frac > 0) {
      g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a0 + TAU * frac)
        .stroke({ width: this.type === 'boss' ? 4 : 3, color: this.big ? 0xff8fa3 : 0xffffff, alpha: 0.9, cap: 'round' });
    }
  }

  destroy() {
    if (!this.c.destroyed) this.c.destroy({ children: true });
  }
}
