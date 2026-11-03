import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { TAU, damp, lerpColor, polar } from '../../core/math';
import { BRANCH_COLORS, KEYSTONES, NODE_MAP, RING_RADII, nodeColor, nodeRadius, type NodeDef } from '../../data/tree';
import { drawIcon } from '../../render/icons';
import { textures } from '../../render/textures';
import type { NodeState } from '../../systems/tree-logic';

const DARK = 0x0b0d20;
const GOLD = 0xffe6a0;

function shapePoints(def: NodeDef, r: number): number[] | null {
  const pts: number[] = [];
  const ring = (n: number, rad: number, rot: number) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
    }
  };
  switch (def.kind) {
    case 'major': ring(6, r, -Math.PI / 2); return pts;
    case 'synergy': ring(4, r * 1.12, -Math.PI / 2); return pts;
    case 'keystone': {
      for (let i = 0; i < 16; i++) {
        const a = -Math.PI / 2 + (i / 16) * TAU;
        const rad = i % 2 === 0 ? r : r * 0.8;
        pts.push(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      return pts;
    }
    default: return null; // circle
  }
}

export class NodeView {
  /** idle animation (breathing, rotating rings, expanding pulses, orbiting sparkles): player setting */
  static ambient = true;
  readonly c = new Container();
  readonly inner = new Container();
  readonly def: NodeDef;
  readonly r: number;
  readonly color: number;
  readonly x: number;
  readonly y: number;
  private halo: Sprite;
  private pulseRing: Sprite;
  private deco = new Graphics();
  private progress = new Graphics();
  private body = new Graphics();
  private icon = new Graphics();
  private q: Text;
  private sparkles: Sprite[] = [];
  private quads = new Graphics(); // core only: keystone quadrants

  state: NodeState = 'hidden';
  level = 0;
  affordable = false;
  hover = false;
  /** animated by GSAP */
  punch = 1;
  pop = 1;
  flash = 0;
  private hoverS = 1;
  private phase = Math.random() * TAU;
  private haloBase = 0;
  private stateScale = 1;
  private pulseT = Math.random();
  private awakenReady = false;
  private drawn = false;
  awakened = false;

  constructor(def: NodeDef) {
    this.def = def;
    this.r = nodeRadius(def.kind);
    this.color = nodeColor(def);
    const p = polar(RING_RADII[def.ring], def.angle);
    this.x = p.x;
    this.y = p.y;
    this.c.position.set(p.x, p.y);

    const tex = textures();
    this.halo = new Sprite(tex.glow);
    this.halo.anchor.set(0.5);
    this.halo.blendMode = 'add';
    this.halo.tint = this.color;
    this.halo.scale.set((this.r * (def.kind === 'core' ? 6 : 4.6)) / 128);

    this.pulseRing = new Sprite(tex.ring);
    this.pulseRing.anchor.set(0.5);
    this.pulseRing.blendMode = 'add';
    this.pulseRing.tint = this.color;
    this.pulseRing.alpha = 0;

    this.q = new Text({
      text: '?',
      style: { fontFamily: 'Cormorant Garamond', fontStyle: 'italic', fontWeight: '600', fontSize: Math.round(this.r * 1.15), fill: 0xa99f88 },
    });
    this.q.anchor.set(0.5);
    this.q.resolution = 3;

    this.c.visible = false;
    this.c.addChild(this.halo, this.pulseRing, this.inner);
    this.inner.addChild(this.deco, this.quads, this.progress, this.body, this.icon, this.q);

    if (def.kind === 'core' || def.kind === 'keystone') {
      for (let i = 0; i < (def.kind === 'core' ? 3 : 2); i++) {
        const s = new Sprite(tex.star4);
        s.anchor.set(0.5);
        s.blendMode = 'add';
        s.scale.set(0.35);
        s.alpha = 0;
        this.sparkles.push(s);
        this.c.addChild(s);
      }
    }
  }

  setState(state: NodeState, level: number, affordable: boolean, extra?: { awakenReady?: boolean; awakened?: boolean; keystones?: Record<string, boolean> }) {
    const changed = !this.drawn || state !== this.state || level !== this.level || affordable !== this.affordable
      || (extra && (extra.awakenReady !== this.awakenReady || extra.awakened !== this.awakened)) || this.def.kind === 'core';
    this.state = state;
    this.level = level;
    this.affordable = affordable;
    if (extra) {
      this.awakenReady = !!extra.awakenReady;
      this.awakened = !!extra.awakened;
    }
    if (changed) this.redraw(extra?.keystones);
  }

  get visible() {
    return this.state !== 'hidden';
  }

  redraw(keystones?: Record<string, boolean>) {
    this.drawn = true;
    const { def, r, color } = this;
    const st = this.state;
    this.c.visible = st !== 'hidden';
    this.body.clear();
    this.icon.clear();
    this.deco.clear();
    this.progress.clear();
    this.quads.clear();

    const pts = shapePoints(def, r);
    const shape = (g: Graphics, scale = 1) => {
      if (pts) g.poly(pts.map((v) => v * scale), true);
      else g.circle(0, 0, r * scale);
      return g;
    };

    const owned = st === 'owned' || st === 'maxed';
    this.q.visible = st === 'silhouette';
    this.stateScale = st === 'silhouette' ? 0.72 : 1;

    if (def.kind === 'core') {
      this.drawCore(keystones ?? {});
      return;
    }

    if (st === 'silhouette') {
      shape(this.body).fill({ color: 0x080a18, alpha: 0.75 }).stroke({ width: 1.5, color: 0x58628f, alpha: 0.4 });
      this.haloBase = 0.0;
      return;
    }

    if (st === 'locked') {
      shape(this.body).fill({ color: DARK, alpha: 0.94 }).stroke({ width: 2, color: lerpColor(color, 0x50587a, 0.65), alpha: 0.7 });
      drawIcon(this.icon, def.icon, r * 0.5, 0x7a82a8, 0.55);
      this.haloBase = 0.05;
    } else if (st === 'available') {
      const a = this.affordable;
      shape(this.body).fill({ color: lerpColor(DARK, color, a ? 0.1 : 0.04), alpha: 0.96 })
        .stroke({ width: a ? 3 : 2.2, color: a ? lerpColor(color, 0xffffff, 0.15) : color, alpha: a ? 1 : 0.6 });
      drawIcon(this.icon, def.icon, r * 0.5, color, a ? 1 : 0.65);
      this.haloBase = a ? 0.32 : 0.12;
    } else {
      // owned / maxed
      shape(this.body).fill({ color: lerpColor(DARK, color, 0.32), alpha: 1 });
      shape(this.body, 0.78).fill({ color: lerpColor(DARK, color, 0.5), alpha: 0.6 });
      shape(this.body).stroke({ width: 3, color: lerpColor(color, 0xffffff, 0.4), alpha: 1 });
      drawIcon(this.icon, def.icon, r * 0.5, 0xffffff, 1);
      this.haloBase = st === 'maxed' ? 0.75 : 0.5;
      // rotating dashed outer ring
      const rr = r + (def.maxLevel > 1 ? 15 : 9);
      const dashes = def.kind === 'keystone' ? 24 : 14;
      for (let i = 0; i < dashes; i++) {
        const a0 = (i / dashes) * TAU;
        const a1 = a0 + (TAU / dashes) * 0.45;
        this.deco.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a1)
          .stroke({ width: 1.5, color: st === 'maxed' ? GOLD : color, alpha: st === 'maxed' ? 0.85 : 0.45 });
      }
    }

    // segmented level ring
    if (def.maxLevel > 1) {
      const rr = r + 7;
      const n = def.maxLevel;
      const gap = 0.16;
      const seg = TAU / n;
      for (let i = 0; i < n; i++) {
        const a0 = -Math.PI / 2 + i * seg + gap / 2;
        const a1 = a0 + seg - gap;
        const on = i < this.level;
        this.progress.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a1)
          .stroke({ width: 3.2, color: on ? (st === 'maxed' ? GOLD : lerpColor(color, 0xffffff, 0.25)) : 0xffffff, alpha: on ? 1 : 0.1, cap: 'round' });
      }
    }
    if (def.kind === 'keystone') {
      shape(this.deco, 1.28).stroke({ width: 1.2, color, alpha: owned ? 0.5 : 0.18 });
    }
  }

  private drawCore(keystones: Record<string, boolean>) {
    const { r } = this;
    const awakened = this.awakened;
    const warm = awakened ? 0xfff6dd : 0xffe3a8;
    this.body.circle(0, 0, r).fill({ color: lerpColor(DARK, 0xffc46b, awakened ? 0.6 : 0.22), alpha: 1 });
    this.body.circle(0, 0, r * 0.72).fill({ color: lerpColor(DARK, 0xffd48a, awakened ? 0.85 : 0.4), alpha: 1 });
    this.body.circle(0, 0, r).stroke({ width: 3, color: warm, alpha: 1 });
    this.body.circle(0, 0, r * 0.72).stroke({ width: 1.5, color: warm, alpha: 0.5 });
    drawIcon(this.icon, 'seed', r * 0.55, 0xffffff, 1);
    this.haloBase = awakened ? 0.7 : this.awakenReady ? 0.7 : 0.55;
    this.halo.tint = awakened ? 0xfff0d0 : 0xffc06a;

    // keystone quadrants
    const qr = r + 16;
    KEYSTONES.forEach((k) => {
      const def = NODE_MAP[k];
      const mid = (def.angle * Math.PI) / 180;
      const a0 = mid - 0.62;
      const a1 = mid + 0.62;
      const on = keystones[k];
      const col = BRANCH_COLORS[def.branch];
      this.quads.moveTo(Math.cos(a0) * qr, Math.sin(a0) * qr).arc(0, 0, qr, a0, a1)
        .stroke({ width: on ? 5 : 3, color: on ? col : 0xffffff, alpha: on ? 1 : 0.12, cap: 'round' });
      if (on) {
        this.quads.moveTo(Math.cos(a0) * (qr + 7), Math.sin(a0) * (qr + 7)).arc(0, 0, qr + 7, a0, a1)
          .stroke({ width: 1.2, color: col, alpha: 0.45 });
      }
    });
    // outer decorative rings
    for (let k = 0; k < 2; k++) {
      const rr = r + 34 + k * 12;
      const n = 36 + k * 12;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU;
        const a1 = a0 + (TAU / n) * (k ? 0.25 : 0.5);
        this.deco.moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a1)
          .stroke({ width: 1.2, color: warm, alpha: k ? 0.18 : 0.3 });
      }
    }
  }

  tick(dt: number, t: number) {
    if (!this.c.visible) return;
    this.hoverS = damp(this.hoverS, this.hover ? 1.13 : 1, 16, dt);
    const st = this.state;
    let breathe = 1;
    let haloPulse = 0;
    const amb = NodeView.ambient;
    if (st === 'available' && this.affordable) {
      if (amb) {
        breathe = 1 + Math.sin(t * 3 + this.phase) * 0.035;
        haloPulse = Math.sin(t * 3 + this.phase) * 0.1;
        // repeating outward ring
        this.pulseT += dt / 1.7;
        if (this.pulseT >= 1) this.pulseT -= 1;
        const p = this.pulseT;
        this.pulseRing.scale.set(((this.r * (1.05 + p * 0.9)) / 128) * 2.1);
        this.pulseRing.alpha = (1 - p) * 0.45;
      } else {
        // still readable without motion: a fixed ring marks affordable nodes
        this.pulseRing.scale.set(((this.r * 1.35) / 128) * 2.1);
        this.pulseRing.alpha = 0.35;
      }
    } else {
      this.pulseRing.alpha = 0;
    }
    if (amb && (st === 'owned' || st === 'maxed')) {
      this.deco.rotation += dt * (this.def.kind === 'keystone' ? 0.25 : 0.4);
      haloPulse = Math.sin(t * 1.4 + this.phase) * 0.06;
    }
    if (this.def.kind === 'core') {
      this.quads.rotation = 0;
      if (amb) {
        this.deco.rotation += dt * 0.08;
        breathe = 1 + Math.sin(t * 1.6) * 0.025 * (this.awakenReady ? 2.5 : 1);
        haloPulse = Math.sin(t * 1.6) * (this.awakenReady ? 0.16 : 0.1);
      }
    }
    const s = this.stateScale * this.hoverS * this.punch * breathe * (0.2 + 0.8 * this.pop);
    this.inner.scale.set(s);
    this.c.alpha = Math.min(1, this.pop * 1.4);
    this.halo.alpha = Math.max(0, (this.haloBase + haloPulse + (this.hover ? 0.18 : 0)) * this.pop + this.flash);
    this.halo.scale.set(((this.r * (this.def.kind === 'core' ? 6 : 4.6)) / 128) * (1 + this.flash * 0.6) * (this.awakened ? 1.2 : 1));

    // orbiting sparkles for keystones / core / maxed
    const showSpark = amb && this.sparkles.length && (this.def.kind === 'core' || st === 'owned' || st === 'maxed');
    this.sparkles.forEach((sp, i) => {
      if (!showSpark) { sp.alpha = 0; return; }
      const a = t * (0.7 + i * 0.25) + (i * TAU) / this.sparkles.length + this.phase;
      const rr = this.r + 22 + Math.sin(t * 2 + i) * 6;
      sp.position.set(Math.cos(a) * rr, Math.sin(a) * rr * 0.92);
      sp.alpha = 0.5 + 0.5 * Math.sin(t * 4 + i * 2);
      sp.rotation = t;
      sp.tint = this.def.kind === 'core' ? 0xffe0a0 : this.color;
    });
  }

  /** radius used for hit-testing, in world units */
  get hitR() {
    return this.r * this.stateScale + 8;
  }
}
