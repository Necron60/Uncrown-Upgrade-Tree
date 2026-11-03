import { Container, Graphics } from 'pixi.js';
import { DEG, lerp, lerpColor } from '../../core/math';
import { RING_RADII } from '../../data/tree';
import type { NodeView } from './NodeView';

export type EdgeState = 'hidden' | 'ghost' | 'ready' | 'active';

const SAMPLES = 24;
const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * A branch between two nodes, drawn as a polar-interpolated curve so the tree
 * grows outward in organic spirals instead of straight spokes.
 */
export class EdgeView {
  readonly view = new Container();
  private glow = new Graphics();
  private line = new Graphics();
  private hl = new Graphics();
  readonly pts: { x: number; y: number }[] = [];
  private cum: number[] = [];
  readonly length: number;
  state: EdgeState = 'hidden';
  /** 0..1, animated when the child is revealed */
  grow = 1;
  highlight = 0;
  private hlTarget = 0;
  pulseTimer = Math.random() * 2;
  /** 0..1: sinks the branch toward darkness (finale) */
  dim = 0;

  constructor(readonly from: NodeView, readonly to: NodeView) {
    this.glow.blendMode = 'add';
    this.hl.blendMode = 'add';
    this.view.addChild(this.glow, this.line, this.hl);

    const r0 = RING_RADII[from.def.ring];
    const r1 = RING_RADII[to.def.ring];
    let a0 = from.def.angle;
    const a1 = to.def.angle;
    if (r0 === 0) a0 = a1;
    const dA = ((a1 - a0 + 540) % 360) - 180;
    let total = 0;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const r = lerp(r0, r1, t);
      const a = (a0 + dA * smooth(t)) * DEG;
      const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
      if (i > 0) total += Math.hypot(p.x - this.pts[i - 1].x, p.y - this.pts[i - 1].y);
      this.pts.push(p);
      this.cum.push(total);
    }
    this.length = total;
  }

  /** Point at arc-length fraction t (0 = parent, 1 = child). */
  pointAt(t: number): { x: number; y: number } {
    const d = Math.max(0, Math.min(1, t)) * this.length;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const f = (d - this.cum[i - 1]) / seg;
    const a = this.pts[i - 1], b = this.pts[i];
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) };
  }

  setState(s: EdgeState) {
    if (s === this.state) return;
    this.state = s;
    this.redraw();
  }

  setHighlight(on: boolean) {
    this.hlTarget = on ? 1 : 0;
  }

  tick(dt: number) {
    this.highlight += (this.hlTarget - this.highlight) * Math.min(1, dt * 12);
    this.hl.alpha = this.highlight;
    this.view.alpha = 1 - this.dim * 0.85;
  }

  /** Draw the visible prefix [0, grow] of the curve, in colour chunks for a parent→child gradient. */
  redraw() {
    const { glow, line, hl } = this;
    glow.clear();
    line.clear();
    hl.clear();
    this.view.visible = this.state !== 'hidden';
    if (this.state === 'hidden') return;

    const cA = this.from.def.kind === 'core' ? this.to.color : this.from.color;
    const cB = this.to.color;
    const maxD = this.grow * this.length;

    if (this.state === 'ghost') {
      // dotted
      const step = 14;
      for (let d = 6; d < maxD; d += step) {
        const p = this.pointAt(d / this.length);
        line.circle(p.x, p.y, 1.4).fill({ color: 0x7c86bb, alpha: 0.35 });
      }
      return;
    }

    const active = this.state === 'active';
    if (active && this.grow < 1) {
      // light is still racing along: keep the dim branch underneath the bright stroke
      line.moveTo(this.pts[0].x, this.pts[0].y);
      for (let i = 1; i < this.pts.length; i++) line.lineTo(this.pts[i].x, this.pts[i].y);
      line.stroke({ width: 2, color: cB, alpha: 0.32, cap: 'round', join: 'round' });
    }
    const chunks = 4;
    const per = SAMPLES / chunks;
    for (let c = 0; c < chunks; c++) {
      const col = lerpColor(cA, cB, (c + 0.5) / chunks);
      let started = false;
      for (let i = c * per; i <= (c + 1) * per; i++) {
        if (this.cum[i] > maxD) {
          // partial tail
          if (started && i > 0) {
            const p = this.pointAt(maxD / this.length);
            line.lineTo(p.x, p.y);
            glow.lineTo(p.x, p.y);
          }
          break;
        }
        const p = this.pts[i];
        if (!started) {
          line.moveTo(p.x, p.y);
          glow.moveTo(p.x, p.y);
          started = true;
        } else {
          line.lineTo(p.x, p.y);
          glow.lineTo(p.x, p.y);
        }
      }
      if (!started) break;
      line.stroke({ width: active ? 3 : 2, color: active ? lerpColor(col, 0xffffff, 0.1) : col, alpha: active ? 0.9 : 0.38, cap: 'round', join: 'round' });
      glow.stroke({ width: active ? 10 : 7, color: col, alpha: active ? 0.11 : 0.05, cap: 'round', join: 'round' });
    }

    // hover highlight overlay (alpha animated in tick)
    hl.moveTo(this.pts[0].x, this.pts[0].y);
    for (let i = 1; i < this.pts.length; i++) hl.lineTo(this.pts[i].x, this.pts[i].y);
    hl.stroke({ width: 2, color: 0xffffff, alpha: 0.55, cap: 'round', join: 'round' });
    hl.moveTo(this.pts[0].x, this.pts[0].y);
    for (let i = 1; i < this.pts.length; i++) hl.lineTo(this.pts[i].x, this.pts[i].y);
    hl.stroke({ width: 10, color: cB, alpha: 0.18, cap: 'round', join: 'round' });
    hl.alpha = this.highlight;
  }
}
