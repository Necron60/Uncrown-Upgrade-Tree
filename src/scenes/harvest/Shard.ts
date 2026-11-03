import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { TAU, hsvToHex, lerpColor, rand } from '../../core/math';
import { SHARD_R, textures } from '../../render/textures';

export type ShardType = 'normal' | 'gold' | 'time' | 'prism' | 'heart';

export interface TierDef {
  hp: number;
  value: number;
  r: number;
  sides: number;
  color: number;
}

export const TIERS: TierDef[] = [
  { hp: 3, value: 1, r: 20, sides: 3, color: 0x9fefff },
  { hp: 22, value: 6, r: 26, sides: 4, color: 0x8a9dff },
  { hp: 110, value: 16, r: 33, sides: 5, color: 0xff7ae0 },
];
export const HEART: TierDef = { hp: 2400, value: 600, r: 58, sides: 6, color: 0xff4d6d };

export const TYPE_COLORS: Record<Exclude<ShardType, 'normal' | 'prism'>, number> = {
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
  readonly color: number;
  spawn = 0;
  flash = 0;
  punch = 0;
  hpShow = 0;
  satCd = 0;
  dead = false;
  private hue = Math.random();
  private drawnHp = -1;
  private t = Math.random() * 10;

  constructor(readonly tier: number, readonly type: ShardType, x: number, y: number) {
    const def = type === 'heart' ? HEART : TIERS[tier];
    const tex = textures();
    this.x = x;
    this.y = y;
    const sp = type === 'heart' ? 12 : rand(10, 34);
    const a = rand(0, TAU);
    this.vx = Math.cos(a) * sp;
    this.vy = Math.sin(a) * sp;
    if (type === 'heart') this.vrot = rand(-0.25, 0.25);
    this.r = def.r * (type === 'prism' ? 1.05 : 1);
    this.maxHp = this.hp = def.hp * (type === 'prism' ? 1.5 : type === 'gold' ? 1.2 : 1);
    this.value = def.value;
    this.color = type === 'normal' || type === 'prism' ? def.color : TYPE_COLORS[type];

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
    this.body.tint = this.color;
    this.sheen = [layer(tex.shardSheen[def.sides][0], true), layer(tex.shardSheen[def.sides][1], true)];
    this.cracks = layer(tex.shardCracks[def.sides], true);
    this.cracks.tint = lerpColor(this.color, 0xffffff, 0.6);
    this.cracks.alpha = 0;
    this.flashS = layer(tex.shardFlash[def.sides], true);
    this.flashS.alpha = 0;
    this.glint = layer(tex.star4, true);
    this.glint.alpha = 0;

    this.c.addChild(this.glow, this.body, this.core, ...this.sheen, this.cracks, this.flashS, this.glint, this.hpG);

    if (type === 'time' || type === 'heart') {
      this.deco = new Graphics();
      const rr = this.r + (type === 'heart' ? 16 : 9);
      const n = type === 'heart' ? 18 : 10;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU;
        const a1 = a0 + (TAU / n) * 0.5;
        this.deco.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a1);
      }
      this.deco.stroke({ width: type === 'heart' ? 2.5 : 1.6, color: this.color, alpha: 0.8 });
      this.c.addChildAt(this.deco, 1);
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
    this.rot += this.vrot * dt;

    const base = this.r / SHARD_R;
    const beat = this.type === 'heart' ? 1 + Math.max(0, Math.sin(this.t * 6)) * 0.06 : 1;
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
    this.core.alpha = 0.13 + 0.06 * Math.sin(this.t * 2.1 + this.phase) + this.flash * 0.5;
    this.cracks.alpha = Math.pow(1 - Math.max(0, this.hp / this.maxHp), 0.6) * 0.95;
    this.updateGlint(dt, s);

    if (this.type === 'prism') {
      this.hue += dt * 0.35;
      const col = hsvToHex(this.hue, 0.5, 1);
      this.body.tint = col;
      this.glow.tint = col;
      this.core.tint = this.cracks.tint = lerpColor(col, 0xffffff, 0.45);
    }
    const gpulse = this.type === 'normal' ? 0 : Math.sin(this.t * 5) * 0.12;
    this.glow.alpha = (this.type === 'normal' ? 0.4 : 0.65) + gpulse + this.flash * 0.5;
    if (this.deco) this.deco.rotation -= dt * (this.type === 'heart' ? 0.5 : 1.5);

    const showHp = this.type === 'heart' || this.hpShow > 0;
    if (showHp && this.drawnHp !== this.hp) this.drawHp();
    this.hpG.alpha = this.type === 'heart' ? 1 : Math.min(1, this.hpShow * 2);
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
    const rr = this.r + (this.type === 'heart' ? 26 : 8);
    const frac = Math.max(0, this.hp / this.maxHp);
    const a0 = -Math.PI / 2;
    g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a0 + TAU).stroke({ width: 3, color: 0xffffff, alpha: 0.12 });
    if (frac > 0) {
      g.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a0 + TAU * frac)
        .stroke({ width: 3, color: this.type === 'heart' ? 0xff8fa3 : 0xffffff, alpha: 0.9, cap: 'round' });
    }
  }

  destroy() {
    if (!this.c.destroyed) this.c.destroy({ children: true });
  }
}
