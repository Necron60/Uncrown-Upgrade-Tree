import type { Container } from 'pixi.js';
import { clamp, damp } from '../../core/math';

/** Smooth pan/zoom camera with inertia and zoom-toward-cursor. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 0.9;
  tx = 0;
  ty = 0;
  tz = 0.9;
  vx = 0;
  vy = 0;
  w = 1;
  h = 1;
  minZoom = 0.3;
  maxZoom = 1.9;
  bound = 1150;
  dragging = false;
  /** when true, x/y/zoom are driven externally (cinematics) */
  locked = false;

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
  }

  screenToWorld(sx: number, sy: number) {
    return { x: (sx - this.w / 2) / this.zoom + this.x, y: (sy - this.h / 2) / this.zoom + this.y };
  }

  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.x) * this.zoom + this.w / 2, y: (wy - this.y) * this.zoom + this.h / 2 };
  }

  panBy(dx: number, dy: number) {
    this.tx -= dx / this.zoom;
    this.ty -= dy / this.zoom;
    this.x = this.tx;
    this.y = this.ty;
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const nz = clamp(this.tz * factor, this.minZoom, this.maxZoom);
    // keep the world point under the cursor fixed (computed against targets)
    const wx = (sx - this.w / 2) / this.tz + this.tx;
    const wy = (sy - this.h / 2) / this.tz + this.ty;
    this.tx = wx - (sx - this.w / 2) / nz;
    this.ty = wy - (sy - this.h / 2) / nz;
    this.tz = nz;
  }

  set(x: number, y: number, zoom: number, instant = false) {
    this.tx = x;
    this.ty = y;
    this.tz = clamp(zoom, this.minZoom, this.maxZoom);
    this.vx = this.vy = 0;
    if (instant) {
      this.x = x;
      this.y = y;
      this.zoom = this.tz;
    }
  }

  update(dt: number) {
    if (this.locked) return;
    if (!this.dragging) {
      this.tx += this.vx * dt;
      this.ty += this.vy * dt;
      const k = Math.exp(-4.5 * dt);
      this.vx *= k;
      this.vy *= k;
    }
    // soft bounds
    const b = this.bound;
    const len = Math.hypot(this.tx, this.ty);
    if (len > b) {
      this.tx = damp(this.tx, (this.tx / len) * b, 8, dt);
      this.ty = damp(this.ty, (this.ty / len) * b, 8, dt);
    }
    this.x = damp(this.x, this.tx, 14, dt);
    this.y = damp(this.y, this.ty, 14, dt);
    this.zoom = damp(this.zoom, this.tz, 12, dt);
  }

  apply(world: Container) {
    world.scale.set(this.zoom);
    world.position.set(this.w / 2 - this.x * this.zoom, this.h / 2 - this.y * this.zoom);
  }
}
