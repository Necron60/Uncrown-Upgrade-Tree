import type { Graphics } from 'pixi.js';
import type { IconKey } from '../data/tree';
import { TAU } from '../core/math';

/** Procedural vector glyphs for tree nodes. `r` is the half-size of the icon. */
export function drawIcon(g: Graphics, key: IconKey, r: number, color: number, alpha = 1): void {
  const w = Math.max(1.6, r * 0.16);
  const st = { width: w, color, alpha, cap: 'round' as const, join: 'round' as const };
  const fill = { color, alpha };
  const poly = (sides: number, rad: number, rot = -Math.PI / 2, cx = 0, cy = 0) => {
    const pts: number[] = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * TAU;
      pts.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    return pts;
  };
  const arcStroke = (cx: number, cy: number, rad: number, a0: number, a1: number) => {
    g.moveTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad).arc(cx, cy, rad, a0, a1).stroke(st);
  };

  switch (key) {
    case 'seed': {
      g.circle(0, 0, r * 0.32).fill(fill);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const r0 = r * 0.55, r1 = i % 2 ? r * 0.8 : r * 1.0;
        g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * r1, Math.sin(a) * r1).stroke(st);
      }
      break;
    }
    case 'blade': {
      g.poly([0, -r, r * 0.28, r * 0.35, 0, r * 0.15, -r * 0.28, r * 0.35]).fill(fill);
      g.moveTo(-r * 0.45, r * 0.55).lineTo(r * 0.45, r * 0.55).stroke(st);
      g.moveTo(0, r * 0.55).lineTo(0, r * 0.95).stroke(st);
      break;
    }
    case 'aperture': {
      g.circle(0, 0, r * 0.85).stroke(st);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.moveTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85)
          .lineTo(Math.cos(a + 1.9) * r * 0.35, Math.sin(a + 1.9) * r * 0.35)
          .stroke({ ...st, width: w * 0.8 });
      }
      break;
    }
    case 'hourglass': {
      g.poly([-r * 0.6, -r * 0.85, r * 0.6, -r * 0.85, 0, 0, r * 0.6, r * 0.85, -r * 0.6, r * 0.85, 0, 0]).stroke(st);
      g.poly([-r * 0.35, r * 0.7, r * 0.35, r * 0.7, 0, r * 0.3]).fill(fill);
      break;
    }
    case 'gem': {
      g.poly([-r * 0.8, -r * 0.25, -r * 0.4, -r * 0.75, r * 0.4, -r * 0.75, r * 0.8, -r * 0.25, 0, r * 0.9]).stroke(st);
      g.moveTo(-r * 0.8, -r * 0.25).lineTo(r * 0.8, -r * 0.25).stroke({ ...st, width: w * 0.7 });
      g.moveTo(-r * 0.3, -r * 0.25).lineTo(0, r * 0.9).lineTo(r * 0.3, -r * 0.25).stroke({ ...st, width: w * 0.7 });
      break;
    }
    case 'pulse': {
      g.moveTo(-r, 0).lineTo(-r * 0.45, 0).lineTo(-r * 0.2, -r * 0.75).lineTo(r * 0.15, r * 0.75)
        .lineTo(r * 0.4, 0).lineTo(r, 0).stroke(st);
      break;
    }
    case 'crosshair': {
      g.circle(0, 0, r * 0.6).stroke(st);
      g.circle(0, 0, r * 0.14).fill(fill);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        g.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35).lineTo(Math.cos(a) * r, Math.sin(a) * r).stroke(st);
      }
      break;
    }
    case 'comet':
    case 'comet2': {
      // a bright head with a fanned tail of light streaming down-left
      const comet = (hx: number, hy: number, sc: number, a: number) => {
        const base = Math.PI * 0.75;
        for (const [da, len, wa] of [[0, 1.3, 0.95], [-0.24, 0.9, 0.6], [0.24, 0.9, 0.6]]) {
          const ang = base + da;
          g.moveTo(hx + Math.cos(ang) * r * 0.22 * sc, hy + Math.sin(ang) * r * 0.22 * sc)
            .lineTo(hx + Math.cos(ang) * r * len * sc, hy + Math.sin(ang) * r * len * sc)
            .stroke({ ...st, width: w * wa, alpha: alpha * a * (da === 0 ? 0.9 : 0.55) });
        }
        g.circle(hx, hy, r * 0.25 * sc).fill({ color, alpha: alpha * a });
      };
      if (key === 'comet') comet(r * 0.35, -r * 0.35, 1, 1);
      else {
        comet(r * 0.45, -r * 0.5, 0.78, 1);
        comet(-r * 0.05, r * 0.25, 0.62, 0.8);
      }
      break;
    }
    case 'bolt': {
      g.poly([r * 0.15, -r, -r * 0.55, r * 0.1, -r * 0.05, r * 0.1, -r * 0.2, r, r * 0.55, -r * 0.15, r * 0.05, -r * 0.15]).fill(fill);
      break;
    }
    case 'fork': {
      g.moveTo(0, r).lineTo(0, 0).lineTo(-r * 0.6, -r * 0.8).stroke(st);
      g.moveTo(0, 0).lineTo(r * 0.6, -r * 0.8).stroke(st);
      g.moveTo(0, 0).lineTo(0, -r * 0.9).stroke(st);
      g.circle(-r * 0.6, -r * 0.8, r * 0.14).fill(fill);
      g.circle(r * 0.6, -r * 0.8, r * 0.14).fill(fill);
      g.circle(0, -r * 0.9, r * 0.14).fill(fill);
      break;
    }
    case 'sprout': {
      g.moveTo(0, r).bezierCurveTo(0, r * 0.2, 0, 0, 0, -r * 0.2).stroke(st);
      g.moveTo(0, -r * 0.1).bezierCurveTo(-r * 0.2, -r * 0.8, -r * 0.9, -r * 0.6, -r * 0.8, -r * 0.1)
        .bezierCurveTo(-r * 0.5, -r * 0.05, -r * 0.2, -r * 0.05, 0, -r * 0.1).fill(fill);
      g.moveTo(0, r * 0.25).bezierCurveTo(r * 0.2, -r * 0.4, r * 0.9, -r * 0.3, r * 0.8, r * 0.2)
        .bezierCurveTo(r * 0.5, r * 0.3, r * 0.2, r * 0.3, 0, r * 0.25).fill(fill);
      break;
    }
    case 'cluster': {
      g.poly(poly(3, r * 0.42, -Math.PI / 2, -r * 0.45, r * 0.3)).fill(fill);
      g.poly(poly(4, r * 0.38, 0, r * 0.45, r * 0.35)).fill({ color, alpha: alpha * 0.8 });
      g.poly(poly(5, r * 0.4, -Math.PI / 2, 0, -r * 0.45)).fill({ color, alpha: alpha * 0.9 });
      break;
    }
    case 'coin': {
      g.circle(0, 0, r * 0.85).stroke(st);
      g.poly(poly(4, r * 0.48, -Math.PI / 2)).fill(fill);
      break;
    }
    case 'rhythm': {
      const hs = [0.35, 0.7, 1, 0.6, 0.85];
      hs.forEach((hh, i) => {
        const x = -r * 0.8 + i * r * 0.4;
        g.moveTo(x, r * 0.6).lineTo(x, r * 0.6 - hh * r * 1.3).stroke(st);
      });
      break;
    }
    case 'flare': {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        g.poly([0, 0, Math.cos(a - 0.22) * r * 0.35, Math.sin(a - 0.22) * r * 0.35, Math.cos(a) * r, Math.sin(a) * r, Math.cos(a + 0.22) * r * 0.35, Math.sin(a + 0.22) * r * 0.35]).fill(fill);
      }
      g.circle(0, 0, r * 0.2).fill(fill);
      break;
    }
    case 'sun': {
      g.circle(0, 0, r * 0.42).fill(fill);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        g.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62).lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95).stroke(st);
      }
      break;
    }
    case 'crack': {
      g.poly(poly(6, r * 0.9)).stroke(st);
      g.moveTo(-r * 0.2, -r * 0.8).lineTo(r * 0.1, -r * 0.2).lineTo(-r * 0.15, r * 0.15).lineTo(r * 0.2, r * 0.8).stroke(st);
      g.moveTo(r * 0.1, -r * 0.2).lineTo(r * 0.6, -r * 0.1).stroke({ ...st, width: w * 0.7 });
      break;
    }
    case 'clock': {
      g.circle(0, 0, r * 0.85).stroke(st);
      g.moveTo(0, 0).lineTo(0, -r * 0.55).stroke(st);
      g.moveTo(0, 0).lineTo(r * 0.4, r * 0.2).stroke(st);
      g.circle(0, 0, r * 0.1).fill(fill);
      break;
    }
    case 'wave': {
      for (let k = 0; k < 2; k++) {
        const y = -r * 0.3 + k * r * 0.6;
        g.moveTo(-r, y).bezierCurveTo(-r * 0.5, y - r * 0.5, 0, y + r * 0.5, r * 0.5, y).quadraticCurveTo(r * 0.75, y - r * 0.25, r, y).stroke(st);
      }
      break;
    }
    case 'layers': {
      for (let k = 0; k < 3; k++) {
        const y = -r * 0.45 + k * r * 0.45;
        g.poly([-r * 0.9, y, 0, y - r * 0.38, r * 0.9, y, 0, y + r * 0.38]).stroke({ ...st, alpha: alpha * (1 - k * 0.25) });
      }
      break;
    }
    case 'abyss': {
      g.poly(poly(5, r * 0.9)).stroke(st);
      g.poly(poly(5, r * 0.55, Math.PI / 2)).stroke({ ...st, width: w * 0.8 });
      g.circle(0, 0, r * 0.18).fill(fill);
      break;
    }
    case 'nova': {
      g.circle(0, 0, r * 0.3).fill(fill);
      g.circle(0, 0, r * 0.62).stroke({ ...st, width: w * 0.7 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const r1 = i % 2 ? r * 0.85 : r * 1.0;
        g.moveTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72).lineTo(Math.cos(a) * r1, Math.sin(a) * r1).stroke({ ...st, width: w * 0.8 });
      }
      break;
    }
    case 'echo': {
      g.circle(r * 0.18, 0, r * 0.62).stroke(st);
      g.circle(-r * 0.25, 0, r * 0.62).stroke({ ...st, alpha: alpha * 0.5 });
      g.circle(r * 0.18, 0, r * 0.14).fill(fill);
      break;
    }
    case 'well': {
      for (let k = 0; k < 3; k++) arcStroke(0, 0, r * (0.3 + k * 0.3), k * 1.3, k * 1.3 + TAU * 0.72);
      g.circle(0, 0, r * 0.12).fill(fill);
      break;
    }
    case 'eclipse': {
      g.circle(0, 0, r * 0.7).fill(fill);
      g.circle(r * 0.28, -r * 0.18, r * 0.6).fill({ color: 0x0b0d1c, alpha: 1 });
      g.circle(0, 0, r * 0.95).stroke({ ...st, width: w * 0.7, alpha: alpha * 0.6 });
      break;
    }
    case 'prism': {
      g.poly([0, -r * 0.9, r * 0.85, r * 0.65, -r * 0.85, r * 0.65]).stroke(st);
      g.moveTo(-r, -r * 0.1).lineTo(-r * 0.2, r * 0.05).stroke({ ...st, width: w * 0.8 });
      g.moveTo(r * 0.3, 0).lineTo(r, -r * 0.35).stroke({ ...st, width: w * 0.7, alpha: alpha * 0.8 });
      g.moveTo(r * 0.3, 0.05).lineTo(r, r * 0.05).stroke({ ...st, width: w * 0.7, alpha: alpha * 0.6 });
      break;
    }
    case 'spark': {
      g.poly([0, -r, r * 0.22, -r * 0.22, r, 0, r * 0.22, r * 0.22, 0, r, -r * 0.22, r * 0.22, -r, 0, -r * 0.22, -r * 0.22]).fill(fill);
      break;
    }
    case 'spiral': {
      g.moveTo(0, 0);
      for (let i = 1; i <= 40; i++) {
        const t = i / 40;
        const a = t * TAU * 2.2;
        g.lineTo(Math.cos(a) * r * t, Math.sin(a) * r * t);
      }
      g.stroke(st);
      break;
    }
    case 'sunset': {
      arcStroke(0, r * 0.25, r * 0.6, Math.PI, TAU);
      g.moveTo(-r, r * 0.25).lineTo(r, r * 0.25).stroke(st);
      g.moveTo(-r * 0.6, r * 0.6).lineTo(r * 0.6, r * 0.6).stroke({ ...st, alpha: alpha * 0.6 });
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i + 0.5) * (Math.PI / 5);
        g.moveTo(Math.cos(a) * r * 0.75, r * 0.25 + Math.sin(a) * r * 0.75).lineTo(Math.cos(a) * r * 0.98, r * 0.25 + Math.sin(a) * r * 0.98).stroke({ ...st, width: w * 0.7 });
      }
      break;
    }
    case 'shards': {
      g.poly(poly(3, r * 0.5, -Math.PI / 2 + 0.3, -r * 0.35, -r * 0.2)).fill(fill);
      g.poly(poly(3, r * 0.42, Math.PI / 2 - 0.5, r * 0.4, r * 0.25)).fill({ color, alpha: alpha * 0.8 });
      g.poly(poly(3, r * 0.3, 0.4, r * 0.3, -r * 0.55)).fill({ color, alpha: alpha * 0.6 });
      break;
    }
    case 'star': {
      g.star(0, 0, 5, r, r * 0.45).fill(fill);
      break;
    }
    case 'constellation': {
      const pts = [[-r * 0.8, r * 0.5], [-r * 0.3, -r * 0.2], [r * 0.25, r * 0.1], [r * 0.8, -r * 0.6], [r * 0.1, -r * 0.8]];
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke({ ...st, width: w * 0.7, alpha: alpha * 0.7 });
      for (const [x, y] of pts) g.circle(x, y, r * 0.15).fill(fill);
      break;
    }
    case 'moon': {
      g.circle(0, 0, r * 0.85).fill(fill);
      g.circle(r * 0.38, -r * 0.25, r * 0.7).fill({ color: 0x0b0d1c, alpha: 1 });
      g.star(r * 0.5, r * 0.45, 4, r * 0.22, r * 0.07).fill(fill);
      break;
    }
    case 'crown': {
      g.poly([-r * 0.9, r * 0.5, -r * 0.9, -r * 0.45, -r * 0.45, 0, 0, -r * 0.85, r * 0.45, 0, r * 0.9, -r * 0.45, r * 0.9, r * 0.5]).fill(fill);
      g.moveTo(-r * 0.9, r * 0.75).lineTo(r * 0.9, r * 0.75).stroke(st);
      break;
    }
    case 'heart': {
      g.moveTo(0, r * 0.85)
        .bezierCurveTo(-r * 1.1, r * 0.05, -r * 0.7, -r * 0.95, 0, -r * 0.35)
        .bezierCurveTo(r * 0.7, -r * 0.95, r * 1.1, r * 0.05, 0, r * 0.85)
        .fill(fill);
      break;
    }
    // ── the Hollow Crown ──
    case 'flame': {
      // an outer tongue of fire and a hot inner one
      g.moveTo(0, -r).bezierCurveTo(r * 0.25, -r * 0.45, r * 0.85, -r * 0.2, r * 0.7, r * 0.35)
        .bezierCurveTo(r * 0.6, r * 0.8, r * 0.2, r * 0.95, 0, r * 0.95)
        .bezierCurveTo(-r * 0.2, r * 0.95, -r * 0.65, r * 0.8, -r * 0.7, r * 0.3)
        .bezierCurveTo(-r * 0.75, -r * 0.05, -r * 0.4, -r * 0.2, -r * 0.3, -r * 0.55)
        .bezierCurveTo(-r * 0.1, -r * 0.35, -r * 0.05, -r * 0.6, 0, -r).stroke(st);
      g.moveTo(0, -r * 0.15).bezierCurveTo(r * 0.3, r * 0.15, r * 0.35, r * 0.75, 0, r * 0.72)
        .bezierCurveTo(-r * 0.35, r * 0.75, -r * 0.3, r * 0.3, 0, -r * 0.15).fill(fill);
      break;
    }
    case 'snow': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI + Math.PI / 2;
        const cx = Math.cos(a), cy = Math.sin(a);
        g.moveTo(-cx * r, -cy * r).lineTo(cx * r, cy * r).stroke(st);
        for (const sgn of [-1, 1]) {
          const bx = cx * r * 0.6 * sgn, by = cy * r * 0.6 * sgn;
          for (const d of [-0.6, 0.6]) {
            const b = a + d + (sgn < 0 ? Math.PI : 0);
            g.moveTo(bx, by).lineTo(bx + Math.cos(b) * r * 0.3, by + Math.sin(b) * r * 0.3).stroke({ ...st, width: w * 0.8 });
          }
        }
      }
      break;
    }
    case 'skull': {
      g.moveTo(-r * 0.75, r * 0.1).bezierCurveTo(-r * 0.85, -r * 0.95, r * 0.85, -r * 0.95, r * 0.75, r * 0.1)
        .lineTo(r * 0.5, r * 0.35).lineTo(r * 0.5, r * 0.8).lineTo(-r * 0.5, r * 0.8).lineTo(-r * 0.5, r * 0.35).closePath().stroke(st);
      g.circle(-r * 0.32, -r * 0.12, r * 0.2).fill(fill);
      g.circle(r * 0.32, -r * 0.12, r * 0.2).fill(fill);
      g.moveTo(-r * 0.15, r * 0.55).lineTo(-r * 0.15, r * 0.8).stroke({ ...st, width: w * 0.7 });
      g.moveTo(r * 0.15, r * 0.55).lineTo(r * 0.15, r * 0.8).stroke({ ...st, width: w * 0.7 });
      break;
    }
    case 'eye': {
      g.moveTo(-r, 0).quadraticCurveTo(0, -r * 0.95, r, 0).quadraticCurveTo(0, r * 0.95, -r, 0).stroke(st);
      g.circle(0, 0, r * 0.36).fill(fill);
      g.circle(0, 0, r * 0.13).fill({ color: 0x0b0d1c, alpha: 1 });
      break;
    }
    case 'shield': {
      g.moveTo(0, -r * 0.95).lineTo(r * 0.8, -r * 0.6).bezierCurveTo(r * 0.8, r * 0.25, r * 0.4, r * 0.7, 0, r * 0.95)
        .bezierCurveTo(-r * 0.4, r * 0.7, -r * 0.8, r * 0.25, -r * 0.8, -r * 0.6).closePath().stroke(st);
      g.moveTo(-r * 0.35, -r * 0.2).lineTo(r * 0.35, r * 0.35).stroke(st);
      break;
    }
    case 'fang': {
      for (const sx of [-1, 1]) {
        g.moveTo(sx * r * 0.85, -r * 0.55).bezierCurveTo(sx * r * 0.7, r * 0.1, sx * r * 0.35, r * 0.6, sx * r * 0.18, r * 0.95)
          .bezierCurveTo(sx * r * 0.12, r * 0.35, sx * r * 0.2, -r * 0.1, sx * r * 0.32, -r * 0.55).closePath().fill(fill);
      }
      g.moveTo(-r * 0.95, -r * 0.7).quadraticCurveTo(0, -r * 0.4, r * 0.95, -r * 0.7).stroke({ ...st, width: w * 0.8, alpha: alpha * 0.7 });
      break;
    }
    case 'chain': {
      for (const [cx, cy, rot] of [[-r * 0.35, r * 0.35, -0.785], [r * 0.35, -r * 0.35, -0.785]] as const) {
        const c = Math.cos(rot), sn = Math.sin(rot);
        const rx = r * 0.55, ry = r * 0.3;
        g.moveTo(cx + c * rx, cy + sn * rx);
        for (let i = 1; i <= 24; i++) {
          const t = (i / 24) * TAU;
          const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
          g.lineTo(cx + x * c - y * sn, cy + x * sn + y * c);
        }
        g.stroke(st);
      }
      break;
    }
    case 'storm': {
      // a cloud with a bolt falling from it
      g.moveTo(-r * 0.75, r * 0.05).bezierCurveTo(-r * 1.05, -r * 0.2, -r * 0.65, -r * 0.7, -r * 0.3, -r * 0.5)
        .bezierCurveTo(-r * 0.15, -r * 0.95, r * 0.55, -r * 0.95, r * 0.55, -r * 0.45)
        .bezierCurveTo(r * 1.0, -r * 0.5, r * 1.05, r * 0.05, r * 0.7, r * 0.05).closePath().stroke(st);
      g.poly([r * 0.05, r * 0.05, -r * 0.3, r * 0.55, -r * 0.02, r * 0.55, -r * 0.2, r * 1.0, r * 0.35, r * 0.4, r * 0.05, r * 0.4, r * 0.2, r * 0.05]).fill(fill);
      break;
    }
  }
}
