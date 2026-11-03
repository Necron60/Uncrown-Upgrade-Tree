import { noise1 } from '../core/math';

/**
 * Trauma-based screen shake: offset = max * trauma² * noise(t).
 * Trauma decays linearly, so shakes are short and settle smoothly.
 */
export class Shake {
  trauma = 0;
  x = 0;
  y = 0;
  rot = 0;
  enabled = true;
  private t = 0;

  constructor(private maxOffset = 18, private maxRot = 0.03, private decay = 1.6) {}

  add(amount: number) {
    if (!this.enabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    const k = this.trauma * this.trauma;
    const f = 22;
    this.x = this.maxOffset * k * noise1(this.t * f, 1);
    this.y = this.maxOffset * k * noise1(this.t * f, 2);
    this.rot = this.maxRot * k * noise1(this.t * f, 3);
  }
}
