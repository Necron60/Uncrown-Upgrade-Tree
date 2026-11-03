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
  dot: Texture;       // small hard-core dot
  spark: Texture;     // horizontal streak
  frag: Texture;      // crystal fragment (triangle)
  ring: Texture;      // thin soft ring
  star4: Texture;     // 4-point twinkle
  nebula: Texture[];  // big soft clouds
  shard: Record<number, Texture>; // faceted crystal by number of sides
  shardFlash: Record<number, Texture>; // flat white silhouette
}

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

function makeFrag(): Texture {
  const [c, ctx] = canvas(32);
  const g = ctx.createLinearGradient(4, 4, 28, 28);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0.45)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(16, 2);
  ctx.lineTo(30, 26);
  ctx.lineTo(6, 30);
  ctx.closePath();
  ctx.fill();
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

/** A faceted gem: each facet triangle gets its own shade so it reads as 3D. */
function makeShard(sides: number, flash: boolean): Texture {
  const s = 128;
  const [c, ctx] = canvas(s);
  const cx = s / 2, cy = s / 2, R = s * 0.44;
  const outer = polyPoints(sides, R, cx, cy);
  const inner = polyPoints(sides, R * 0.42, cx - R * 0.06, cy - R * 0.08, -Math.PI / 2 + 0.25);
  if (flash) {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    outer.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    return Texture.from(c);
  }
  const light = (a: number) => 0.55 + 0.45 * Math.max(0, Math.cos(a + 2.2)); // light from top-left
  for (let i = 0; i < sides; i++) {
    const [x0, y0] = outer[i];
    const [x1, y1] = outer[(i + 1) % sides];
    const [ix0, iy0] = inner[i];
    const [ix1, iy1] = inner[(i + 1) % sides];
    const mid = Math.atan2((y0 + y1) / 2 - cy, (x0 + x1) / 2 - cx);
    const v = Math.round(255 * light(mid));
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(ix1, iy1);
    ctx.lineTo(ix0, iy0);
    ctx.closePath();
    ctx.fill();
  }
  // table (top facet)
  const tg = ctx.createLinearGradient(cx - R * 0.4, cy - R * 0.4, cx + R * 0.3, cy + R * 0.3);
  tg.addColorStop(0, '#ffffff');
  tg.addColorStop(1, '#b8b8b8');
  ctx.fillStyle = tg;
  ctx.beginPath();
  inner.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  // facet edges
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  outer.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < sides; i++) {
    ctx.beginPath();
    ctx.moveTo(outer[i][0], outer[i][1]);
    ctx.lineTo(inner[i][0], inner[i][1]);
    ctx.stroke();
  }
  ctx.beginPath();
  inner.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  // specular glint
  const sg = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, 0, cx - R * 0.25, cy - R * 0.3, R * 0.35);
  sg.addColorStop(0, 'rgba(255,255,255,0.9)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, s, s);
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

let bank: TextureBank | null = null;

export function textures(): TextureBank {
  if (bank) return bank;
  const shard: Record<number, Texture> = {};
  const shardFlash: Record<number, Texture> = {};
  for (const sides of [3, 4, 5, 6]) {
    shard[sides] = makeShard(sides, false);
    shardFlash[sides] = makeShard(sides, true);
  }
  bank = {
    glow: radial(128, [[0, 1], [0.15, 0.75], [0.4, 0.25], [0.7, 0.06], [1, 0]]),
    pool: radial(256, [[0, 1], [0.3, 0.96], [0.55, 0.72], [0.75, 0.34], [0.9, 0.09], [1, 0]]),
    flare4: makeFlare([0, Math.PI / 2], [Math.PI / 4, (3 * Math.PI) / 4], 0.38),
    flare8: makeFlare([0, Math.PI / 2], [Math.PI / 4, (3 * Math.PI) / 4], 0.62),
    flare6: makeFlare([0, Math.PI / 3, (2 * Math.PI) / 3], [], 0),
    streakH: makeStreak(),
    dot: radial(32, [[0, 1], [0.35, 0.9], [0.6, 0.3], [1, 0]]),
    spark: makeSpark(),
    frag: makeFrag(),
    ring: makeRing(),
    star4: makeStar4(),
    nebula: [makeNebula(1), makeNebula(7), makeNebula(13)],
    shard,
    shardFlash,
  };
  return bank;
}
