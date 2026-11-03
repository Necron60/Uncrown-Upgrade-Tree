import { Texture } from 'pixi.js';
import { TAU } from '../core/math';

/**
 * All art is generated at runtime with Canvas2D: no image assets.
 * Textures are white so they can be tinted freely.
 */
export interface TextureBank {
  glow: Texture;      // soft radial falloff
  pool: Texture;      // broad, flat-topped light pool (used to cut holes in the darkness)
  flare4: Texture;    // star: long cross spikes + short diagonals
  flare8: Texture;    // star: cross spikes + long diagonals (seed, keystones)
  flare6: Texture;    // star: six even rays (synergies)
  streakH: Texture;   // anamorphic horizontal light streak
  ribbonGlow: Texture; // cross-section of a light strand: soft glow (stretched along a rope)
  ribbonCore: Texture; // cross-section of a light strand: white-hot core
  dot: Texture;       // small hard-core dot
  spark: Texture;     // horizontal streak
  frag: Texture;      // crystal fragment (triangle)
  ring: Texture;      // thin soft ring
  star4: Texture;     // 4-point twinkle
  nebula: Texture[];  // big soft clouds
  shard: Record<number, Texture>; // faceted crystal by number of sides
  shardSheen: Record<number, [Texture, Texture]>; // white facet highlights for two light directions (cross-faded)
  shardCracks: Record<number, Texture>; // glowing fracture lines inside the silhouette
  shardFlash: Record<number, Texture>; // flat white silhouette
}

/** Size of the generated shard art, and the radius of the gem inside it. */
export const SHARD_TEX = 192;
export const SHARD_R = SHARD_TEX * 0.44;

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function radial(size: number, stops: [number, number][]): Texture {
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

function makeSpark(): Texture {
  const [c, ctx] = canvas(64, 16);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(32, 8, 32, 4, 0, 0, TAU);
  ctx.fill();
  return Texture.from(c);
}

/** A splinter of crystal: a shaded sliver with one bright cut edge. */
function makeFrag(): Texture {
  const [c, ctx] = canvas(48);
  const pts: [number, number][] = [[24, 3], [44, 38], [8, 44]];
  const path = () => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  };
  const g = ctx.createLinearGradient(14, 8, 36, 44);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0.3)');
  ctx.fillStyle = g;
  path();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  ctx.lineTo(...pts[2]);
  ctx.stroke();
  return Texture.from(c);
}

function makeRing(): Texture {
  const size = 256;
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.78, 'rgba(255,255,255,0)');
  g.addColorStop(0.9, 'rgba(255,255,255,1)');
  g.addColorStop(0.96, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

function makeStar4(): Texture {
  const s = 64;
  const [c, ctx] = canvas(s);
  ctx.translate(32, 32);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.ellipse(0, 0, 32, 2.6, (i * Math.PI) / 2, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, TAU);
  ctx.fill();
  return Texture.from(c);
}

function makeNebula(seed: number): Texture {
  const s = 512;
  const [c, ctx] = canvas(s);
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const x = s / 2 + (rnd() - 0.5) * s * 0.55;
    const y = s / 2 + (rnd() - 0.5) * s * 0.55;
    const rad = s * (0.08 + rnd() * 0.22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const a = 0.05 + rnd() * 0.08;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  // fade the edges so sprites never show a hard square
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(s / 2, s / 2, s * 0.2, s / 2, s / 2, s / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, s, s);
  return Texture.from(c);
}

function polyPoints(sides: number, r: number, cx: number, cy: number, rot = -Math.PI / 2) {
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * TAU;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

type Pt = [number, number];
type Vec3 = [number, number, number];
interface Facet { pts: Pt[]; tilt: number; ang: number }

const unit = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
const KEY_LIGHT = unit(-0.55, -0.7, 0.55); // from the top-left, toward the viewer
const SHEEN_LIGHTS: [Vec3, Vec3] = [unit(-0.75, -0.35, 0.45), unit(0.6, 0.55, 0.5)];

/** How brightly a facet (tilted away from the viewer by `tilt`, facing `ang`) catches light from `L`. */
function lit(f: Facet, L: Vec3): number {
  const s = Math.sin(f.tilt);
  return Math.max(0, s * Math.cos(f.ang) * L[0] + s * Math.sin(f.ang) * L[1] + Math.cos(f.tilt) * L[2]);
}

/**
 * A brilliant-style cut seen from above: rim triangles at the girdle, kite (bezel) facets split in two,
 * star facets around the table, and the flat table in the middle. Steeper facets sit further out.
 */
function gemFacets(sides: number, c: number, R: number): Facet[] {
  const mR = R * Math.cos(Math.PI / sides) * 0.86; // stays inside the outline even for triangles
  const O = polyPoints(sides, R, c, c);
  const M = polyPoints(sides, mR, c, c, -Math.PI / 2 + Math.PI / sides);
  const T = polyPoints(sides, mR * 0.58, c, c);
  const out: Facet[] = [];
  const add = (pts: Pt[], tilt: number) => {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    out.push({ pts, tilt, ang: Math.atan2(my - c, mx - c) });
  };
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides, h = (i + sides - 1) % sides;
    add([O[i], O[j], M[i]], 1.05);
    add([O[i], M[h], T[i]], 0.72);
    add([O[i], T[i], M[i]], 0.72);
    add([T[i], T[j], M[i]], 0.38);
  }
  add(T, 0);
  return out;
}

const tracePath = (ctx: CanvasRenderingContext2D, pts: Pt[]) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
};

/** The gem body, white so it can be tinted: every facet shaded by the key light, lit from within. */
function makeShard(sides: number): Texture {
  const s = SHARD_TEX, cx = s / 2;
  const [c, ctx] = canvas(s);
  const facets = gemFacets(sides, cx, SHARD_R);
  let seed = sides * 7919;
  const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.16;
  for (const f of facets) {
    const v = Math.min(1, 0.28 + 0.72 * lit(f, KEY_LIGHT) + jitter());
    // each facet darkens slightly toward the girdle, which reads as depth
    const [ox, oy] = f.pts[0];
    const mx = f.pts.reduce((a, p) => a + p[0], 0) / f.pts.length, my = f.pts.reduce((a, p) => a + p[1], 0) / f.pts.length;
    const g = ctx.createLinearGradient(mx, my, ox, oy);
    const shade = (k: number) => `rgb(${Math.round(255 * v * k)},${Math.round(255 * v * k)},${Math.round(255 * v * k)})`;
    g.addColorStop(0, shade(1));
    g.addColorStop(1, shade(0.68));
    ctx.fillStyle = g;
    tracePath(ctx, f.pts);
    ctx.fill();
  }
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 1;
  for (const f of facets) {
    tracePath(ctx, f.pts);
    ctx.stroke();
  }
  // light from within, then a bright rim
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(cx, cx, 0, cx, cx, SHARD_R * 0.7);
  core.addColorStop(0, 'rgba(255,255,255,0.16)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  tracePath(ctx, polyPoints(sides, SHARD_R, cx, cx));
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  return Texture.from(c);
}

/** Only the facets that catch light L, in white: added on top and cross-faded so the light seems to move. */
function makeSheen(sides: number, L: Vec3): Texture {
  const s = SHARD_TEX;
  const [c, ctx] = canvas(s);
  for (const f of gemFacets(sides, s / 2, SHARD_R)) {
    const a = Math.pow(lit(f, L), 9);
    if (a < 0.02) continue;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    tracePath(ctx, f.pts);
    ctx.fill();
  }
  return Texture.from(c);
}

/** Jagged fracture lines branching out from near the centre, clipped to the gem. */
function makeCracks(sides: number): Texture {
  const s = SHARD_TEX, cx = s / 2;
  const [c, ctx] = canvas(s);
  let seed = sides * 104729 + 17;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const branch = (x: number, y: number, ang: number, len: number, depth: number) => {
    ctx.moveTo(x, y);
    for (let left = len; left > 0; left -= 9) {
      ang += (rnd() - 0.5) * 0.9;
      x += Math.cos(ang) * 9;
      y += Math.sin(ang) * 9;
      ctx.lineTo(x, y);
      if (depth < 2 && rnd() < 0.18) {
        branch(x, y, ang + (rnd() < 0.5 ? 0.8 : -0.8), left * 0.5, depth + 1);
        ctx.moveTo(x, y);
      }
    }
  };
  ctx.beginPath();
  const n = 3 + sides;
  for (let i = 0; i < n; i++) branch(cx + (rnd() - 0.5) * 10, cx + (rnd() - 0.5) * 10, (i / n) * TAU + rnd() * 0.6, SHARD_R * (0.75 + rnd() * 0.4), 0);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#fff';
  tracePath(ctx, polyPoints(sides, SHARD_R * 0.97, cx, cx));
  ctx.fill();
  return Texture.from(c);
}

function makeShardFlash(sides: number): Texture {
  const [c, ctx] = canvas(SHARD_TEX);
  ctx.fillStyle = '#fff';
  tracePath(ctx, polyPoints(sides, SHARD_R, SHARD_TEX / 2, SHARD_TEX / 2));
  ctx.fill();
  return Texture.from(c);
}

/**
 * A lens-flare star: a hot core and thin spikes that fade to nothing at the tips.
 * Each spike is a long, very thin rhombus with a gradient along its length, drawn twice
 * (a soft wide pass and a crisp narrow one) and added together.
 */
function makeFlare(main: number[], diag: number[], diagLen: number, size = 512): Texture {
  const [c, ctx] = canvas(size);
  const m = size / 2;
  ctx.translate(m, m);
  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.06);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(-m, -m, size, size);
  const spike = (ang: number, len: number, w: number, a: number) => {
    ctx.save();
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    // bright for most of its length, fading only toward the very tips
    const stops: [number, number][] = [[0, 0], [0.1, 0.06], [0.26, 0.3], [0.4, 0.68], [0.5, 1], [0.6, 0.68], [0.74, 0.3], [0.9, 0.06], [1, 0]];
    for (const [o, k] of stops) g.addColorStop(o, `rgba(255,255,255,${k * a})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(0, -w);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, w);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  const L = m * 0.98;
  for (const a of main) {
    spike(a, L, size * 0.036, 0.4);
    spike(a, L * 0.96, size * 0.013, 1);
  }
  for (const a of diag) {
    spike(a, L * diagLen, size * 0.024, 0.32);
    spike(a, L * diagLen * 0.94, size * 0.009, 0.85);
  }
  return Texture.from(c);
}

function makeStreak(): Texture {
  const [c, ctx] = canvas(512, 32);
  const g = ctx.createLinearGradient(0, 0, 512, 0);
  for (const [o, k] of [[0, 0], [0.25, 0.08], [0.42, 0.4], [0.5, 1], [0.58, 0.4], [0.75, 0.08], [1, 0]] as [number, number][]) g.addColorStop(o, `rgba(255,255,255,${k})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(256, 16, 256, 3, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.ellipse(256, 16, 256, 9, 0, 0, TAU);
  ctx.fill();
  return Texture.from(c);
}

/**
 * The cross-section of a light strand, for MeshRope: across the height a falloff from the centre,
 * along the length a short fade at both ends so strands melt into the stars they connect.
 */
function makeRibbon(profile: (d: number) => number): Texture {
  const W = 128, H = 32;
  const [c, ctx] = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const d = Math.abs((y + 0.5) / H - 0.5) * 2; // 0 at the centre line, 1 at the edge
    const a = profile(d);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const end = Math.min(1, u / 0.06, (1 - u) / 0.06);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * a * end);
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

let bank: TextureBank | null = null;

export function textures(): TextureBank {
  if (bank) return bank;
  const shard: Record<number, Texture> = {};
  const shardSheen: Record<number, [Texture, Texture]> = {};
  const shardCracks: Record<number, Texture> = {};
  const shardFlash: Record<number, Texture> = {};
  for (const sides of [3, 4, 5, 6]) {
    shard[sides] = makeShard(sides);
    shardSheen[sides] = [makeSheen(sides, SHEEN_LIGHTS[0]), makeSheen(sides, SHEEN_LIGHTS[1])];
    shardCracks[sides] = makeCracks(sides);
    shardFlash[sides] = makeShardFlash(sides);
  }
  bank = {
    glow: radial(128, [[0, 1], [0.15, 0.75], [0.4, 0.25], [0.7, 0.06], [1, 0]]),
    pool: radial(256, [[0, 1], [0.3, 0.96], [0.55, 0.72], [0.75, 0.34], [0.9, 0.09], [1, 0]]),
    flare4: makeFlare([0, Math.PI / 2], [Math.PI / 4, (3 * Math.PI) / 4], 0.38),
    flare8: makeFlare([0, Math.PI / 2], [Math.PI / 4, (3 * Math.PI) / 4], 0.62),
    flare6: makeFlare([0, Math.PI / 3, (2 * Math.PI) / 3], [], 0),
    streakH: makeStreak(),
    // a narrow bright peak over a faint wide haze, matching the old multi-pass strokes
    ribbonGlow: makeRibbon((d) => 0.4 * Math.exp(-d * d * 14) + 0.1 * Math.exp(-d * d * 2.5)),
    ribbonCore: makeRibbon((d) => Math.max(0, 1 - Math.pow(d, 1.6))),
    dot: radial(32, [[0, 1], [0.35, 0.9], [0.6, 0.3], [1, 0]]),
    spark: makeSpark(),
    frag: makeFrag(),
    ring: makeRing(),
    star4: makeStar4(),
    nebula: [makeNebula(1), makeNebula(7), makeNebula(13)],
    shard,
    shardSheen,
    shardCracks,
    shardFlash,
  };
  return bank;
}
