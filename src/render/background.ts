import { Container, Mesh, MeshGeometry, Particle, ParticleContainer, RenderTexture, Shader, Sprite, type Renderer } from 'pixi.js';
import { TAU, damp, pick, rand } from '../core/math';
import { textures } from './textures';
import type { Branch, TreeDef } from '../data/tree';
import { BRANCH_COLORS } from '../data/tree';

const NEBULA_VERT = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

/** Domain-warped fractal noise: gas that folds over itself as it drifts, cut by dark dust lanes. */
const NEBULA_FRAG = `
in vec2 vUV;
out vec4 finalColor;
uniform float uTime;
uniform vec2 uAspect;
uniform vec2 uCam;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
    a *= 0.5;
  }
  return v;
}
void main() {
  vec2 p = (vUV - 0.5) * uAspect * 2.2 + uCam;
  float t = uTime;
  vec2 q = vec2(fbm(p + vec2(0.0, 0.11 * t)), fbm(p + vec2(5.2, 1.3) - 0.08 * t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 0.15 * t), fbm(p + 3.0 * q + vec2(8.3, 2.8) - 0.12 * t));
  float n = fbm(p + 2.6 * r);

  vec3 col = vec3(0.025, 0.020, 0.070);                                               // the void
  col = mix(col, vec3(0.24, 0.10, 0.46), smoothstep(0.25, 0.75, n));                   // violet gas
  col = mix(col, vec3(0.05, 0.33, 0.50), smoothstep(0.55, 1.05, length(q)) * 0.75);    // teal currents
  col = mix(col, vec3(0.55, 0.15, 0.44), smoothstep(0.50, 0.80, r.y) * 0.55);          // magenta embers
  col += vec3(0.65, 0.55, 0.95) * pow(smoothstep(0.50, 0.85, n), 2.0) * 0.35;          // filaments where folds pile up
  col *= 1.0 - smoothstep(0.45, 0.70, fbm(p * 2.4 - r * 1.7 + 4.0)) * 0.5;              // dust lanes
  col *= mix(0.4, 1.0, smoothstep(1.4, 0.25, length((vUV - 0.5) * uAspect * 1.6)));    // vignette
  finalColor = vec4(col, 1.0);
}`;
const NEBULA_SCALE = 0.5; // the gas is soft: rendering it at half resolution looks the same at a quarter of the cost
const NEBULA_FPS = 30; // it drifts slowly, so it does not need every frame
const NEBULA_SPEED = 0.5;

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

/** A living nebula (shader), a parallax starfield and soft clouds that react to tree investment. */
export class Background {
  readonly view = new Container();
  private nebRT = RenderTexture.create({ width: 2, height: 2, resolution: 1 });
  private nebSprite = new Sprite(this.nebRT);
  private nebMesh: Mesh<MeshGeometry, Shader>;
  private nebU: { uTime: number; uAspect: Float32Array; uCam: Float32Array };
  private nebWait = 0;
  private nebTime = rand(0, 100);
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

  constructor(private renderer: Renderer) {
    const tex = textures();
    const shader = Shader.from({
      gl: { vertex: NEBULA_VERT, fragment: NEBULA_FRAG },
      resources: {
        nebula: {
          uTime: { value: 0, type: 'f32' },
          uAspect: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          uCam: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
        },
      },
    });
    this.nebU = shader.resources.nebula.uniforms;
    const quad = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    this.nebMesh = new Mesh({ geometry: new MeshGeometry({ positions: quad, uvs: quad, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) }), shader });
    this.view.addChild(this.nebSprite, this.nebLayer);


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

  /** Branch clouds sit far out behind their own branch, so they never pile up over the centre. */
  setBranches(tree: TreeDef) {
    for (const n of this.nebs) n.s.destroy();
    this.nebs = [];
    const tex = textures();
    for (const b of tree.branches) {
      const first = tree.nodes.find((n) => n.branch === b && n.ring === 1 && !n.branch2);
      const a = ((first?.angle ?? 0) * Math.PI) / 180;
      const s = new Sprite(pick(tex.nebula));
      s.anchor.set(0.5);
      s.scale.set(tree.branches.length > 4 ? 1.7 : 2.0);
      s.tint = BRANCH_COLORS[b];
      s.alpha = 0.04;
      s.blendMode = 'add';
      s.rotation = rand(0, TAU);
      this.nebLayer.addChild(s);
      this.nebs.push({ s, wx: Math.cos(a) * 1050, wy: Math.sin(a) * 1050, baseAlpha: 0.04, target: 0.04, rot: rand(-0.01, 0.01), branch: b });
    }
  }

  /** low detail: no nebula, no shooting stars, only the larger stars */
  setDetail(level: 'low' | 'high') {
    this.lowDetail = level === 'low';
    this.nebLayer.visible = this.nebSprite.visible = !this.lowDetail;
    this.nebWait = 0;
  }

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.nebRT.resize(Math.ceil(w * NEBULA_SCALE), Math.ceil(h * NEBULA_SCALE));
    this.nebMesh.scale.set(this.nebRT.width, this.nebRT.height);
    this.nebSprite.setSize(w, h);
    this.nebU.uAspect[0] = w / h;
    this.nebWait = 0;
  }

  private renderNebula(dt: number, camX: number, camY: number) {
    if (this.lowDetail) return;
    if (this.ambient) this.nebTime += dt * NEBULA_SPEED;
    this.nebWait -= dt;
    if (this.nebWait > 0) return;
    this.nebWait = 1 / NEBULA_FPS;
    const k = (0.02 * 2.2) / this.h; // parallax: the gas moves at 2% of the camera, slower than the farthest stars
    this.nebU.uTime = this.nebTime;
    this.nebU.uCam[0] = camX * k;
    this.nebU.uCam[1] = camY * k;
    this.renderer.render({ container: this.nebMesh, target: this.nebRT, clear: true });
  }

  /** 0..1 investment per branch → nebula brightness */
  setBranchGlow(branch: Branch, amount: number) {
    // additive clouds add up toward white, so keep them a faint tint even when fully invested
    for (const n of this.nebs) if (n.branch === branch) n.target = 0.04 + amount * 0.16;
  }

  update(dt: number, camX: number, camY: number, zoom: number) {
    this.t += dt;
    this.renderNebula(dt, camX, camY);
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
