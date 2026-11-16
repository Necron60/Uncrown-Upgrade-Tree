import { Container, Graphics, MeshRope, Point, type RopeGeometry } from 'pixi.js';
import { DEG, TAU, lerp, lerpColor } from '../../core/math';
import { textures } from '../../render/textures';
import type { NodeView } from './NodeView';

export type EdgeState = 'hidden' | 'ghost' | 'ready' | 'active';

const SAMPLES = 40;
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Strand {
  pts: Point[]; // shared by the glow rope and the core rope
  ropes: MeshRope[];
  phase: number;
  amp: number;
  speed: number; // how fast the weave travels along the branch (rad/s)
}

export interface ViewRect { x0: number; y0: number; x1: number; y1: number }

/**
 * A branch between two nodes, drawn as a polar-interpolated curve so the tree
 * grows outward in organic spirals instead of straight spokes.
 */
export class EdgeView {
  readonly view = new Container();
  private glow = new Graphics();
  private line = new Graphics();
  private hl = new Graphics();
  // woven light strands: textured ropes whose points move every frame
  private ropes = new Container();
  private strands: Strand[] | null = null;
  private nx: Float32Array;
  private ny: Float32Array;
  private env: Float32Array; // weave amplitude envelope: 0 at both ends
  private u: Float32Array; // arc-length fraction of each sample
  private cycles = 1;
  private bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private staticDone = false;
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
    this.ropes.visible = false;
    this.view.addChild(this.glow, this.line, this.ropes, this.hl);

    const r0 = from.tree.rings[from.def.ring];
    const r1 = to.tree.rings[to.def.ring];
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

    const n = this.pts.length;
    this.nx = new Float32Array(n);
    this.ny = new Float32Array(n);
    this.env = new Float32Array(n);
    this.u = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.pts[Math.max(0, i - 1)];
      const b = this.pts[Math.min(n - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y;
      const tl = Math.hypot(tx, ty) || 1;
      this.nx[i] = -ty / tl;
      this.ny[i] = tx / tl;
      this.u[i] = this.cum[i] / total;
      this.env[i] = Math.pow(Math.sin(Math.PI * this.u[i]), 0.9);
    }
    this.cycles = Math.max(0.75, total / 170);
    const xs = this.pts.map((p) => p.x), ys = this.pts.map((p) => p.y);
    this.bbox = { x0: Math.min(...xs) - 24, y0: Math.min(...ys) - 24, x1: Math.max(...xs) + 24, y1: Math.max(...ys) + 24 };
  }

  /** Three strands of light: parent colour, child colour and a pale one, each a soft glow rope plus a hot core rope. */
  private buildStrands() {
    const tex = textures();
    const cA = this.from.def.kind === 'core' ? this.to.color : this.from.color;
    const cB = this.to.color;
    const amp = Math.min(11, Math.max(4, this.length * 0.045));
    const defs: [number, number, number, number][] = [
      [cA, 0, amp, 0.8],
      [cB, 2.1, amp * 0.82, -1.0],
      [lerpColor(lerpColor(cA, cB, 0.5), 0xffffff, 0.45), 4.2, amp * 0.55, 1.3],
    ];
    this.strands = defs.map(([col, phase, a, speed]) => {
      const pts = this.pts.map((p) => new Point(p.x, p.y));
      const glow = new MeshRope({ texture: tex.ribbonGlow, points: pts, width: 12, textureScale: 0 });
      glow.tint = col;
      glow.blendMode = 'add';
      const core = new MeshRope({ texture: tex.ribbonCore, points: pts, width: 1.3, textureScale: 0 });
      core.tint = lerpColor(col, 0xffffff, 0.7);
      core.blendMode = 'add';
      // Pixi 8.22's MeshRope resets its width to the texture height on every render, ignoring the `width`
      // option; take updates over (only when points actually move) so the width sticks
      for (const r of [glow, core]) {
        r.autoUpdate = false;
        r.onRender = null;
      }
      this.ropes.addChild(glow, core);
      return { pts, ropes: [glow, core], phase, amp: a, speed };
    });
  }

  /**
   * Move the strands: the weave travels slowly along the branch, each strand at its own speed, so they
   * keep re-braiding; the sway breathes a little. Off-screen branches are skipped entirely.
   */
  animate(time: number, ambient: boolean, view: ViewRect) {
    if (this.state !== 'active' || !this.strands) return;
    const b = this.bbox;
    const onScreen = b.x1 > view.x0 && b.x0 < view.x1 && b.y1 > view.y0 && b.y0 < view.y1;
    this.ropes.visible = onScreen;
    if (!onScreen) return;
    const growing = this.grow < 1;
    if (!ambient && !growing && this.staticDone) return; // nothing changes: leave the geometry alone
    const tt = ambient ? time : 0;
    const maxD = this.grow * this.length;
    const n = this.pts.length;
    for (const s of this.strands) {
      const amp = s.amp * (1 + 0.14 * Math.sin(tt * 0.7 + s.phase));
      let cutX = this.pts[0].x, cutY = this.pts[0].y;
      for (let i = 0; i < n; i++) {
        const p = s.pts[i];
        if (growing && this.cum[i] > maxD) {
          // not lit yet: fold the rest of the strand onto the point the light has reached
          p.x = cutX;
          p.y = cutY;
          continue;
        }
        const off = amp * this.env[i] * Math.sin(TAU * this.cycles * this.u[i] + s.phase + tt * s.speed);
        p.x = cutX = this.pts[i].x + this.nx[i] * off;
        p.y = cutY = this.pts[i].y + this.ny[i] * off;
      }
      for (const r of s.ropes) (r.geometry as RopeGeometry).update();
    }
    this.staticDone = !growing;
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
    if (this.state !== 'active') this.ropes.visible = false;
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

    // active: three woven strands of light (animated ropes, see animate()). Additive blending makes the
    // crossings flare, like light trails crossing.
    if (this.grow < 1) this.stroke(line, centre, this.length, 2, cB, 0.3); // dim branch under the incoming light
    this.stroke(glow, centre, maxD, 12, lerpColor(cA, cB, 0.5), 0.035); // faint shared haze under the strands
    if (!this.strands) this.buildStrands();
    this.ropes.visible = true;
    this.staticDone = false;

    // hover highlight overlay (alpha animated in tick)
    this.stroke(hl, centre, this.length, 2, 0xffffff, 0.55);
    this.stroke(hl, centre, this.length, 10, cB, 0.18);
    hl.alpha = this.highlight;
  }
}
