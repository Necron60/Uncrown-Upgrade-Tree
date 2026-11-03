import { Container, Particle, ParticleContainer, Sprite } from 'pixi.js';
import { TAU, damp, pick, rand } from '../core/math';
import { textures } from './textures';
import type { Branch } from '../data/tree';
import { BRANCH_COLORS } from '../data/tree';

interface Star {
  p: Particle;
  sx: number;
  sy: number;
  base: number;
  tw: number;
  ph: number;
  layer: number;
}

interface Neb {
  s: Sprite;
  wx: number;
  wy: number;
  baseAlpha: number;
  target: number;
  rot: number;
  branch?: Branch;
}

const LAYER_FACTOR = [0.03, 0.08, 0.16];
const STAR_COLORS = [0xffffff, 0xdfe8ff, 0xbfd4ff, 0xffe9c4, 0xc8f4ff];

/** Parallax starfield + soft nebula clouds that react to tree investment. */
export class Background {
  readonly view = new Container();
  private stars: Star[] = [];
  private starPc: ParticleContainer;
  private nebLayer = new Container();
  private nebs: Neb[] = [];
  private shooting: { s: Sprite; vx: number; vy: number; life: number }[] = [];
  private w = 1;
  private h = 1;
  private t = 0;
  private nextShoot = 3;
  /** twinkling, drifting nebulae and shooting stars (player setting) */
  ambient = true;
  private lowDetail = false;

  constructor() {
    const tex = textures();
    this.view.addChild(this.nebLayer);

    // nebulae (positions in a parallax "world" space)
    const add = (wx: number, wy: number, scale: number, color: number, alpha: number, branch?: Branch) => {
      const s = new Sprite(pick(tex.nebula));
      s.anchor.set(0.5);
      s.scale.set(scale);
      s.tint = color;
      s.alpha = alpha;
      s.blendMode = 'add';
      s.rotation = rand(0, TAU);
      this.nebLayer.addChild(s);
      this.nebs.push({ s, wx, wy, baseAlpha: alpha, target: alpha, rot: rand(-0.01, 0.01), branch });
    };
    add(0, 0, 3.4, 0x3a2a8c, 0.75);
    add(-260, 180, 2.6, 0x16407a, 0.6);
    add(300, -200, 2.4, 0x4a1f6e, 0.55);
    // branch clouds sit far out behind their own branch, so they never pile up over the centre
    add(0, -1050, 2.0, BRANCH_COLORS.force, 0.04, 'force');
    add(1050, 0, 2.0, BRANCH_COLORS.reach, 0.04, 'reach');
    add(0, 1050, 2.0, BRANCH_COLORS.flow, 0.04, 'flow');
    add(-1050, 0, 2.0, BRANCH_COLORS.fortune, 0.04, 'fortune');

    this.starPc = new ParticleContainer({
      texture: tex.dot,
      dynamicProperties: { position: true, color: true, vertex: false, rotation: false },
    });
    this.starPc.blendMode = 'add';
    this.view.addChild(this.starPc);
    const counts = [260, 140, 60];
    counts.forEach((n, layer) => {
      for (let i = 0; i < n; i++) {
        const base = rand(0.25, 0.9) * (layer === 2 ? 1 : 0.8);
        const size = [rand(0.06, 0.12), rand(0.1, 0.18), rand(0.16, 0.3)][layer];
        const p = new Particle({ texture: tex.dot, anchorX: 0.5, anchorY: 0.5, scaleX: size, scaleY: size, tint: pick(STAR_COLORS), alpha: base });
        this.starPc.particleChildren.push(p);
        this.stars.push({ p, sx: Math.random(), sy: Math.random(), base, tw: rand(0.6, 2.4), ph: rand(0, TAU), layer });
      }
    });
    this.starPc.update();
  }

  /** low detail: no nebulae, no shooting stars, only the larger stars */
  setDetail(level: 'low' | 'high') {
    this.lowDetail = level === 'low';
    this.nebLayer.visible = !this.lowDetail;
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  /** 0..1 investment per branch → nebula brightness */
  setBranchGlow(branch: Branch, amount: number) {
    // additive clouds add up toward white, so keep them a faint tint even when fully invested
    for (const n of this.nebs) if (n.branch === branch) n.target = 0.04 + amount * 0.16;
  }

  update(dt: number, camX: number, camY: number, zoom: number) {
    this.t += dt;
    const { w, h } = this;
    const ext = 80;
    for (const s of this.stars) {
      const f = LAYER_FACTOR[s.layer];
      const W = w + ext * 2, H = h + ext * 2;
      let x = (s.sx * W - camX * f) % W;
      let y = (s.sy * H - camY * f) % H;
      if (x < 0) x += W;
      if (y < 0) y += H;
      s.p.x = x - ext;
      s.p.y = y - ext;
      if (this.lowDetail && s.layer === 0) s.p.alpha = 0;
      else s.p.alpha = this.ambient ? s.base * (0.55 + 0.45 * Math.sin(this.t * s.tw + s.ph)) : s.base * 0.75;
    }

    const nz = 0.55 + zoom * 0.25;
    for (const n of this.nebs) {
      n.s.x = w / 2 + (n.wx - camX * 0.35) * nz * 0.6;
      n.s.y = h / 2 + (n.wy - camY * 0.35) * nz * 0.6;
      if (this.ambient) n.s.rotation += n.rot * dt;
      n.s.alpha = damp(n.s.alpha, n.target, 1.5, dt);
    }

    // occasional shooting star
    this.nextShoot -= dt;
    if (this.nextShoot <= 0 && (!this.ambient || this.lowDetail)) this.nextShoot = 2;
    if (this.nextShoot <= 0) {
      this.nextShoot = rand(4, 10);
      const s = new Sprite(textures().spark);
      s.anchor.set(1, 0.5);
      s.blendMode = 'add';
      s.alpha = 0.9;
      s.scale.set(rand(1.5, 2.6), rand(0.25, 0.4));
      s.x = rand(0, w);
      s.y = rand(-20, h * 0.4);
      const ang = rand(0.3, 0.8) * (Math.random() < 0.5 ? 1 : -1) + (Math.random() < 0.5 ? 0 : Math.PI);
      const spd = rand(700, 1100);
      s.rotation = ang;
      this.view.addChild(s);
      this.shooting.push({ s, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 0.9 });
    }
    for (let i = this.shooting.length - 1; i >= 0; i--) {
      const sh = this.shooting[i];
      sh.life -= dt;
      sh.s.x += sh.vx * dt;
      sh.s.y += sh.vy * dt;
      sh.s.alpha = Math.max(0, sh.life);
      if (sh.life <= 0) {
        sh.s.destroy();
        this.shooting.splice(i, 1);
      }
    }
  }
}
