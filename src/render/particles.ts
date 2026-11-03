import { Container, Particle, ParticleContainer, type Texture } from 'pixi.js';
import { TAU, lerp, rand } from '../core/math';

export interface EmitOptions {
  x: number;
  y: number;
  count?: number;
  texture: Texture;
  color?: number | number[];
  speed?: [number, number];
  angle?: [number, number]; // radians
  life?: [number, number]; // seconds
  size?: [number, number]; // start scale range
  sizeEnd?: number; // multiplier at end of life
  alpha?: number;
  drag?: number; // per second (0 = none, 3 = strong)
  gravity?: number; // px/s²
  spin?: [number, number];
  stretch?: number; // align to velocity and elongate by speed*stretch
  spread?: number; // spawn radius
  fadeIn?: number; // fraction of life
}

interface Live {
  p: Particle;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  a0: number;
  drag: number;
  grav: number;
  spin: number;
  stretch: number;
  fadeIn: number;
}

/** One ParticleContainer per texture; all additive. Swap-remove keeps it O(1). */
class Layer {
  readonly pc: ParticleContainer;
  readonly live: Live[] = [];
  constructor(texture: Texture, readonly cap: number) {
    this.pc = new ParticleContainer({
      texture,
      dynamicProperties: { position: true, rotation: true, vertex: true, color: true },
    });
    this.pc.blendMode = 'add';
  }
}

export class Particles {
  readonly view = new Container();
  private layers = new Map<Texture, Layer>();
  /** global multiplier so "low quality" / reduced motion can thin effects */
  density = 1;

  constructor(private capPerLayer = 3000) {}

  private layer(tex: Texture): Layer {
    let l = this.layers.get(tex);
    if (!l) {
      l = new Layer(tex, this.capPerLayer);
      this.layers.set(tex, l);
      this.view.addChild(l.pc);
    }
    return l;
  }

  emit(o: EmitOptions): void {
    const l = this.layer(o.texture);
    const n = Math.max(1, Math.round((o.count ?? 1) * this.density));
    const colors = Array.isArray(o.color) ? o.color : [o.color ?? 0xffffff];
    for (let i = 0; i < n; i++) {
      if (l.live.length >= l.cap) break;
      const ang = rand(...(o.angle ?? [0, TAU]));
      const spd = rand(...(o.speed ?? [40, 160]));
      const life = rand(...(o.life ?? [0.4, 0.9]));
      const s0 = rand(...(o.size ?? [0.3, 0.6]));
      const sr = o.spread ?? 0;
      const ox = sr ? rand(-sr, sr) : 0;
      const oy = sr ? rand(-sr, sr) : 0;
      const p = new Particle({
        texture: o.texture,
        x: o.x + ox,
        y: o.y + oy,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: s0,
        scaleY: s0,
        rotation: rand(0, TAU),
        tint: colors[(Math.random() * colors.length) | 0],
        alpha: o.alpha ?? 1,
      });
      l.live.push({
        p,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life,
        max: life,
        s0,
        s1: s0 * (o.sizeEnd ?? 0),
        a0: o.alpha ?? 1,
        drag: o.drag ?? 1.5,
        grav: o.gravity ?? 0,
        spin: o.spin ? rand(...o.spin) : 0,
        stretch: o.stretch ?? 0,
        fadeIn: o.fadeIn ?? 0,
      });
      l.pc.particleChildren.push(p);
    }
    l.pc.update();
  }

  update(dt: number): void {
    for (const l of this.layers.values()) {
      const live = l.live;
      const kids = l.pc.particleChildren;
      let removed = false;
      for (let i = live.length - 1; i >= 0; i--) {
        const q = live[i];
        q.life -= dt;
        if (q.life <= 0) {
          const last = live.length - 1;
          live[i] = live[last];
          kids[i] = kids[last];
          live.pop();
          kids.pop();
          removed = true;
          continue;
        }
        const k = Math.exp(-q.drag * dt);
        q.vx *= k;
        q.vy = q.vy * k + q.grav * dt;
        const p = q.p;
        p.x += q.vx * dt;
        p.y += q.vy * dt;
        const t = 1 - q.life / q.max; // 0 → 1
        const s = lerp(q.s0, q.s1, t * t);
        if (q.stretch) {
          const sp = Math.hypot(q.vx, q.vy);
          p.rotation = Math.atan2(q.vy, q.vx);
          p.scaleX = s * (0.4 + sp * q.stretch);
          p.scaleY = s;
        } else {
          p.rotation += q.spin * dt;
          p.scaleX = p.scaleY = s;
        }
        const fade = q.fadeIn > 0 && t < q.fadeIn ? t / q.fadeIn : 1 - Math.pow(t, 1.6);
        p.alpha = q.a0 * fade;
      }
      if (removed) l.pc.update();
    }
  }

  clear(): void {
    for (const l of this.layers.values()) {
      l.live.length = 0;
      l.pc.particleChildren.length = 0;
      l.pc.update();
    }
  }

  get count(): number {
    let n = 0;
    for (const l of this.layers.values()) n += l.live.length;
    return n;
  }
}
