import { Container, Graphics } from 'pixi.js';
import { DEG, TAU, lerp, lerpColor } from '../../core/math';
import { RING_RADII } from '../../data/tree';
import type { NodeView } from './NodeView';

export type EdgeState = 'hidden' | 'ghost' | 'ready' | 'active';

const SAMPLES = 40;
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

  /**
   * One strand of light woven around the branch: a sine offset along the curve's normal that
   * fades to zero at both ends, so every strand meets the others inside the stars.
   */
  private strand(phase: number, amp: number, cycles: number): number[] {
    const out: number[] = [];
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const a = this.pts[Math.max(0, i - 1)];
      const b = this.pts[Math.min(n - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      const t = this.cum[i] / this.length;
      const off = amp * Math.pow(Math.sin(Math.PI * t), 0.9) * Math.sin(TAU * cycles * t + phase);
      out.push(this.pts[i].x - (ty / tl) * off, this.pts[i].y + (tx / tl) * off);
    }
    return out;
  }

  /** Stroke the prefix of a flat point list that lies within the first `maxD` of arc length. */
  private stroke(g: Graphics, flat: number[], maxD: number, width: number, color: number, alpha: number) {
    g.moveTo(flat[0], flat[1]);
    for (let i = 1; i < this.cum.length; i++) {
      if (this.cum[i] > maxD) {
        const f = (maxD - this.cum[i - 1]) / (this.cum[i] - this.cum[i - 1] || 1);
        g.lineTo(lerp(flat[(i - 1) * 2], flat[i * 2], f), lerp(flat[(i - 1) * 2 + 1], flat[i * 2 + 1], f));
        break;
      }
      g.lineTo(flat[i * 2], flat[i * 2 + 1]);
    }
    g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
  }

  /** Draw the visible prefix [0, grow] of the branch. */
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
    const centre: number[] = [];
    for (const p of this.pts) centre.push(p.x, p.y);

    if (this.state === 'ghost') {
      // dotted
      const step = 14;
      for (let d = 6; d < maxD; d += step) {
        const p = this.pointAt(d / this.length);
        line.circle(p.x, p.y, 1.4).fill({ color: 0x7c86bb, alpha: 0.35 });
      }
      return;
    }

    if (this.state === 'ready') {
      // a single faint thread of light toward a node you could grow next
      this.stroke(glow, centre, maxD, 6, cB, 0.05);
      this.stroke(glow, centre, maxD, 1.6, cB, 0.32);
      return;
    }

    // active: three strands of light woven around the path, each with a soft glow and a hot core.
    // Additive blending makes the crossings flare, like light trails crossing.
    if (this.grow < 1) this.stroke(line, centre, this.length, 2, cB, 0.3); // dim branch under the incoming light
    const amp = Math.min(11, Math.max(4, this.length * 0.045));
    const cycles = Math.max(0.75, this.length / 170);
    const strands: [number, number, number][] = [
      [cA, 0, amp],
      [cB, 2.1, amp * 0.82],
      [lerpColor(lerpColor(cA, cB, 0.5), 0xffffff, 0.45), 4.2, amp * 0.55],
    ];
    for (const [col, phase, a] of strands) {
      const pts = this.strand(phase, a, cycles);
      this.stroke(glow, pts, maxD, 10, col, 0.045);
      this.stroke(glow, pts, maxD, 4.6, col, 0.12);
      this.stroke(glow, pts, maxD, 2, col, 0.42);
      this.stroke(glow, pts, maxD, 0.85, lerpColor(col, 0xffffff, 0.7), 0.9);
    }

    // hover highlight overlay (alpha animated in tick)
    this.stroke(hl, centre, this.length, 2, 0xffffff, 0.55);
    this.stroke(hl, centre, this.length, 10, cB, 0.18);
    hl.alpha = this.highlight;
  }
}
