import gsap from 'gsap';
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { ShockwaveFilter } from 'pixi-filters/shockwave';
import { TAU, pick, rand } from '../core/math';
import { fmt } from '../core/format';
import { BRANCH_COLORS, KEYSTONES, NODES, NODE_MAP, RING_RADII, type Branch } from '../data/tree';
import { Particles } from '../render/particles';
import { textures } from '../render/textures';
import { audio } from '../systems/audio';
import {
  canAfford, isOwned, level, nextCost, nodeState, pathToSeed, type BuyResult,
} from '../systems/tree-logic';
import type { Game } from '../game/Game';
import { Camera } from './tree/Camera';
import { EdgeView, type EdgeState } from './tree/EdgeView';
import { NodeView } from './tree/NodeView';

interface Pulse {
  edge: EdgeView;
  t: number;
  speed: number;
  s: Sprite;
  core: Sprite;
}

export class TreeScene {
  readonly view = new Container();
  readonly world = new Container();
  readonly cam = new Camera();
  private rings = new Graphics();
  private edgeLayer = new Container();
  private pulseLayer = new Container();
  private nodeLayer = new Container();
  private fxLayer = new Container();
  private fx = new Particles(2000);
  readonly nodes = new Map<string, NodeView>();
  private edges: EdgeView[] = [];
  private pulses: Pulse[] = [];
  private pulsePool: Pulse[] = [];
  private hovered: NodeView | null = null;
  private pointer = { x: -9999, y: -9999, down: false, sx: 0, sy: 0, moved: 0, lx: 0, ly: 0, lt: 0, vx: 0, vy: 0, mouse: true };
  private touches = new Map<number, { x: number; y: number }>();
  private pinch = { d: 0, mx: 0, my: 0 };
  inputEnabled = true;
  private t = 0;
  private ambientT = 0;
  private savedCam = { x: 0, y: 0, z: 0.9 };

  constructor(private game: Game) {
    this.view.addChild(this.world);
    this.world.addChild(this.rings, this.edgeLayer, this.pulseLayer, this.nodeLayer, this.fxLayer);
    this.fxLayer.addChild(this.fx.view);
    this.drawRings();

    for (const def of NODES) {
      if (def.kind === 'awaken') continue;
      const nv = new NodeView(def);
      this.nodes.set(def.id, nv);
    }
    // core last so it draws on top
    const order = [...this.nodes.values()].sort((a, b) => b.def.ring - a.def.ring);
    for (const nv of order) this.nodeLayer.addChild(nv.c);

    for (const def of NODES) {
      if (def.kind === 'awaken') continue;
      for (const p of def.parents) {
        const e = new EdgeView(this.nodes.get(p)!, this.nodes.get(def.id)!);
        this.edges.push(e);
        this.edgeLayer.addChild(e.view);
      }
    }
    this.bindInput();
  }

  private drawRings() {
    const g = this.rings;
    for (let i = 1; i < RING_RADII.length; i++) {
      const r = RING_RADII[i];
      const n = 90 + i * 30;
      for (let k = 0; k < n; k++) {
        if (k % 3 === 2) continue;
        const a0 = (k / n) * TAU;
        const a1 = a0 + (TAU / n) * 0.6;
        g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a1);
      }
      g.stroke({ width: 1, color: 0x8fa0ff, alpha: 0.07 });
    }
  }

  // ───────────────────────────────────────────── state sync
  /** Bring every node/edge in line with the game state (no animation). */
  sync() {
    const s = this.game.state;
    const ks: Record<string, boolean> = {};
    for (const k of KEYSTONES) ks[k] = isOwned(s.levels, k);
    const awakenReady = nodeState(NODE_MAP.awaken, s.levels) === 'available' && !s.awakened;
    for (const nv of this.nodes.values()) {
      const st = nodeState(nv.def, s.levels);
      const aff = st === 'available' || st === 'owned' ? canAfford(nextCost(nv.def, s.levels), s) : false;
      nv.setState(st, level(s.levels, nv.def.id), aff, nv.def.kind === 'core' ? { awakenReady, awakened: s.awakened, keystones: ks } : undefined);
    }
    for (const e of this.edges) e.setState(this.edgeState(e));
    this.updateBranchGlow();
  }

  private edgeState(e: EdgeView): EdgeState {
    const a = e.from.state;
    const b = e.to.state;
    if (a === 'hidden' || b === 'hidden') return 'hidden';
    if (a === 'silhouette' && b === 'silhouette') return 'hidden';
    const ao = a === 'owned' || a === 'maxed';
    const bo = b === 'owned' || b === 'maxed';
    if (ao && bo) return 'active';
    if (ao && b !== 'silhouette') return 'ready';
    return 'ghost';
  }

  private updateBranchGlow() {
    const s = this.game.state;
    const branches: Branch[] = ['force', 'reach', 'flow', 'fortune'];
    for (const b of branches) {
      let have = 0, max = 0;
      for (const n of NODES) {
        if (n.branch !== b && n.branch2 !== b) continue;
        max += n.maxLevel;
        have += level(s.levels, n.id);
      }
      this.game.bg.setBranchGlow(b, max ? have / max : 0);
    }
  }

  // ───────────────────────────────────────────── lifecycle
  enter(fromHarvest: boolean) {
    this.view.visible = true;
    this.sync();
    if (fromHarvest) {
      // arrive by zooming out of the seed
      this.cam.set(0, 0, 2.4, true);
      this.cam.set(this.savedCam.x, this.savedCam.y, this.savedCam.z);
    }
  }

  /** Hide the tree. The camera to come back to was stored by diveIn(). */
  exit() {
    this.setHovered(null);
    this.view.visible = false;
  }

  /** Cinematic dive into the seed before a Harvest. */
  diveIn(duration = 0.7): Promise<void> {
    this.savedCam = { x: this.cam.tx, y: this.cam.ty, z: this.cam.tz };
    this.setHovered(null);
    this.cam.locked = true;
    return new Promise((res) => {
      gsap.to(this.cam, { x: 0, y: 0, zoom: 3.2, duration, ease: 'power3.in', onComplete: () => { this.cam.locked = false; this.cam.set(0, 0, 3.2, true); res(); } });
      const core = this.nodes.get('seed')!;
      gsap.to(core, { flash: 1.5, duration: duration * 0.9, ease: 'power2.in', onComplete: () => { core.flash = 0; } });
    });
  }

  /** Fit every visible node on screen, leaving room for the HUD bars. */
  fitZoom(): number {
    const ext = 2 * this.visibleExtent();
    const fit = Math.min((this.cam.w - 160) / ext, (this.cam.h - 250) / ext);
    return Math.max(0.33, Math.min(1.1, fit));
  }

  recenter(instant = false) {
    const z = this.fitZoom();
    // HUD is heavier at the bottom, so nudge the tree up a little
    this.cam.set(0, 34 / z, z, instant);
  }

  private visibleExtent(): number {
    let max = 200;
    for (const nv of this.nodes.values()) if (nv.visible) max = Math.max(max, Math.hypot(nv.x, nv.y) + nv.r);
    return max;
  }

  resize(w: number, h: number) {
    this.cam.resize(w, h);
  }

  // ───────────────────────────────────────────── input
  private bindInput() {
    const el = this.game.canvas;
    el.addEventListener('pointerdown', (e) => {
      if (!this.view.visible || !this.inputEnabled) return;
      audio.unlock();
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        this.pointer.down = false;
        return;
      }
      const p = this.pointer;
      p.down = true;
      p.sx = p.lx = e.clientX;
      p.sy = p.ly = e.clientY;
      p.lt = performance.now();
      p.moved = 0;
      p.vx = p.vy = 0;
      this.cam.vx = this.cam.vy = 0;
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.view.visible) return;
      const p = this.pointer;
      p.x = e.clientX;
      p.y = e.clientY;
      p.mouse = e.pointerType !== 'touch';
      if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        const [a, b] = [...this.touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.pinch.d > 0) this.cam.zoomAt(mx, my, d / this.pinch.d);
        this.cam.panBy(mx - this.pinch.mx, my - this.pinch.my);
        this.pinch = { d, mx, my };
        return;
      }
      if (!this.inputEnabled) return;
      if (p.down) {
        const dx = e.clientX - p.lx, dy = e.clientY - p.ly;
        p.moved += Math.abs(dx) + Math.abs(dy);
        if (p.moved > 6) {
          if (!this.cam.dragging) {
            this.cam.dragging = true;
            el.classList.add('dragging');
            this.setHovered(null);
          }
          this.cam.panBy(dx, dy);
          const now = performance.now();
          const dtm = Math.max(1, now - p.lt) / 1000;
          p.vx = p.vx * 0.6 + (-dx / this.cam.zoom / dtm) * 0.4;
          p.vy = p.vy * 0.6 + (-dy / this.cam.zoom / dtm) * 0.4;
          p.lt = now;
        }
        p.lx = e.clientX;
        p.ly = e.clientY;
      }
    });
    const up = (e: PointerEvent) => {
      this.touches.delete(e.pointerId);
      const p = this.pointer;
      if (!p.down) return;
      p.down = false;
      if (this.cam.dragging) {
        this.cam.dragging = false;
        el.classList.remove('dragging');
        if (performance.now() - p.lt < 80) {
          this.cam.vx = p.vx;
          this.cam.vy = p.vy;
        }
        return;
      }
      if (!this.inputEnabled || !this.view.visible) return;
      if (e.type === 'pointerup') {
        const prev = this.hovered;
        this.updateHover(e.clientX, e.clientY);
        const nv = this.hovered;
        if (!nv) return;
        // touch has no hover: the first tap previews (tooltip), the second tap buys
        if (e.pointerType === 'touch' && nv !== prev && nv.def.kind !== 'core') return;
        this.clickNode(nv);
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'touch') return;
      if (!this.pointer.down) this.setHovered(null);
      this.pointer.x = -9999;
    });
    el.addEventListener('wheel', (e) => {
      if (!this.view.visible || !this.inputEnabled) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      this.cam.zoomAt(e.clientX, e.clientY, Math.exp(-delta * 0.0016));
    }, { passive: false });
    el.addEventListener('dblclick', (e) => {
      if (!this.view.visible || !this.inputEnabled) return;
      this.updateHover(e.clientX, e.clientY);
      if (!this.hovered) this.recenter();
    });
  }

  private pick(sx: number, sy: number): NodeView | null {
    const w = this.cam.screenToWorld(sx, sy);
    let best: NodeView | null = null;
    let bestD = Infinity;
    for (const nv of this.nodes.values()) {
      if (!nv.visible || nv.pop < 0.5) continue;
      const d = Math.hypot(w.x - nv.x, w.y - nv.y);
      if (d < nv.hitR && d < bestD) { best = nv; bestD = d; }
    }
    return best;
  }

  private updateHover(sx: number, sy: number) {
    this.setHovered(this.pick(sx, sy));
  }

  private setHovered(nv: NodeView | null) {
    if (nv === this.hovered) return;
    if (this.hovered) this.hovered.hover = false;
    this.hovered = nv;
    for (const e of this.edges) e.setHighlight(false);
    if (nv) {
      nv.hover = true;
      audio.hover();
      const path = pathToSeed(nv.def.id, this.game.state.levels);
      for (let i = 0; i < path.length - 1; i++) {
        const e = this.edges.find((x) => x.to.def.id === path[i] && x.from.def.id === path[i + 1]);
        e?.setHighlight(true);
      }
      this.game.canvas.classList.add('pointer');
      this.showTooltip();
    } else {
      this.game.canvas.classList.remove('pointer');
      this.game.tooltip.hide();
    }
  }

  private showTooltip() {
    const nv = this.hovered;
    if (!nv) return;
    const def = nv.def.kind === 'core' ? NODE_MAP.seed : nv.def;
    const p = this.cam.worldToScreen(nv.x, nv.y);
    this.game.tooltip.show(def, this.game.state, p.x, p.y, nv.r * this.cam.zoom * 1.1);
  }

  private clickNode(nv: NodeView) {
    const st = nv.state;
    if (nv.def.kind === 'core') {
      audio.click();
      void this.game.startHarvest();
      return;
    }
    if (st === 'silhouette') {
      this.wobble(nv, 0.5);
      return;
    }
    if (st === 'maxed') {
      this.wobble(nv, 0.5);
      return;
    }
    const res = this.game.buyNode(nv.def.id);
    if (!res.ok) {
      this.deny(nv);
      return;
    }
    this.celebrate(nv, res);
  }

  // ───────────────────────────────────────────── feedback
  private wobble(nv: NodeView, strength = 1) {
    gsap.killTweensOf(nv, 'punch');
    gsap.fromTo(nv, { punch: 1 - 0.08 * strength }, { punch: 1, duration: 0.5, ease: 'elastic.out(1.2, 0.3)' });
  }

  private deny(nv: NodeView) {
    audio.deny();
    this.game.tooltip.deny();
    const c = nv.c;
    const x0 = nv.x;
    gsap.killTweensOf(c.position);
    gsap.fromTo(c.position, { x: x0 - 7 }, { x: x0, duration: 0.45, ease: 'elastic.out(1.4, 0.2)', onComplete: () => { c.position.x = x0; } });
    // red flash ring
    const ring = new Sprite(textures().ring);
    ring.anchor.set(0.5);
    ring.blendMode = 'add';
    ring.tint = 0xff4d6d;
    ring.position.set(nv.x, nv.y);
    ring.scale.set((nv.r * 2.4) / 256);
    this.fxLayer.addChild(ring);
    gsap.to(ring, { alpha: 0, duration: 0.4, onComplete: () => ring.destroy() });
    gsap.to(ring.scale, { x: (nv.r * 3.2) / 256, y: (nv.r * 3.2) / 256, duration: 0.4, ease: 'power2.out' });
  }

  private shockRing(x: number, y: number, r0: number, r1: number, color: number, dur = 0.7, alpha = 0.9) {
    const ring = new Sprite(textures().ring);
    ring.anchor.set(0.5);
    ring.blendMode = 'add';
    ring.tint = color;
    ring.position.set(x, y);
    ring.scale.set((r0 * 2) / 256 / 0.9);
    ring.alpha = alpha;
    this.fxLayer.addChild(ring);
    const s = (r1 * 2) / 256 / 0.9;
    gsap.to(ring.scale, { x: s, y: s, duration: dur, ease: 'expo.out' });
    gsap.to(ring, { alpha: 0, duration: dur, ease: 'power2.in', onComplete: () => ring.destroy() });
  }

  private floatText(x: number, y: number, text: string, color: number, size = 18) {
    const t = new Text({ text, style: { fontFamily: 'Chakra Petch', fontWeight: '700', fontSize: size, fill: color, dropShadow: { color: 0x000000, alpha: 0.6, blur: 6, distance: 0 } } });
    t.anchor.set(0.5);
    t.resolution = 2;
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    gsap.fromTo(t.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(3)' });
    gsap.to(t, { y: y - 46, duration: 1.3, ease: 'power2.out' });
    gsap.to(t, { alpha: 0, duration: 0.5, delay: 0.8, onComplete: () => t.destroy() });
  }

  celebrate(nv: NodeView, res: Extract<BuyResult, { ok: true }>) {
    const reduced = this.game.state.settings.reducedMotion;
    const big = nv.def.kind === 'keystone';
    const major = nv.def.kind === 'major' || nv.def.kind === 'synergy';
    const tex = textures();
    const { x, y, r, color } = nv;

    // squash → overshoot → settle
    gsap.killTweensOf(nv, 'punch,flash');
    gsap.timeline()
      .to(nv, { punch: 0.8, duration: 0.07, ease: 'power2.in' })
      .to(nv, { punch: big ? 1.45 : 1.25, duration: 0.16, ease: 'power2.out' })
      .to(nv, { punch: 1, duration: 0.8, ease: 'elastic.out(1, 0.32)' });
    nv.flash = big ? 1.4 : 0.9;
    gsap.to(nv, { flash: 0, duration: big ? 1.2 : 0.6, ease: 'power2.out' });

    this.shockRing(x, y, r, r * (big ? 7 : 3.6), color, big ? 1.1 : 0.7);
    if (!reduced) {
      gsap.delayedCall(0.08, () => this.shockRing(x, y, r * 0.8, r * (big ? 5 : 2.6), 0xffffff, 0.6, 0.5));
      this.fx.emit({ x, y, texture: tex.spark, count: big ? 90 : major ? 46 : 30, color: [color, 0xffffff], speed: [160, big ? 720 : 460], life: [0.35, 0.85], size: [0.35, 0.7], drag: 3.4, stretch: 0.0035, spread: r * 0.4 });
      this.fx.emit({ x, y, texture: tex.star4, count: big ? 24 : 10, color: [color, 0xffffff], speed: [30, 200], life: [0.6, 1.3], size: [0.2, 0.5], spin: [-3, 3], drag: 2 });
      this.fx.emit({ x, y, texture: tex.dot, count: big ? 40 : 16, color, speed: [20, 140], life: [0.8, 1.6], size: [0.15, 0.35], drag: 1.2, gravity: -30, spread: r });
    }

    // cost readout + level
    const spent = res.spent;
    const parts: string[] = [];
    if (spent.lumen) parts.push(`-${fmt(spent.lumen)}`);
    if (spent.prism) parts.push(`-${fmt(spent.prism)}◆`);
    if (parts.length) this.floatText(x, y - r - 18, parts.join('  '), 0xffd77a, 17);
    if (nv.def.maxLevel > 1) this.floatText(x, y + r + 26, `LV ${res.newLevel}`, color, 14);

    audio.purchase(Math.min(res.newLevel, 6) + (major ? 2 : 0), big);

    if (big && !reduced) {
      this.game.shake.add(0.55);
      this.keystoneBeam(nv);
      this.shockwave(x, y, 16, 1.1);
    } else if (major && !reduced) {
      this.game.shake.add(0.18);
    }

    // newly revealed neighbours grow out along their branch
    res.revealed.forEach((id, i) => this.reveal(id, 0.22 + i * 0.1, i));
    this.sync();
    this.showTooltip();
  }

  private reveal(id: string, delay: number, i: number) {
    const nv = this.nodes.get(id);
    if (!nv) return;
    const st = nodeState(nv.def, this.game.state.levels);
    nv.pop = 0;
    const inbound = this.edges.filter((e) => e.to === nv);
    for (const e of inbound) {
      e.grow = 0;
      e.redraw();
      gsap.to(e, {
        grow: 1, duration: 0.5, delay, ease: 'power2.inOut',
        onUpdate: () => {
          e.redraw();
          if (st !== 'silhouette' && Math.random() < 0.6) {
            const p = e.pointAt(e.grow);
            this.fx.emit({ x: p.x, y: p.y, texture: textures().dot, count: 1, color: nv.color, speed: [5, 30], life: [0.3, 0.6], size: [0.25, 0.4] });
          }
        },
      });
    }
    gsap.to(nv, {
      pop: 1, duration: st === 'silhouette' ? 0.6 : 0.7, delay: delay + 0.42, ease: st === 'silhouette' ? 'power2.out' : 'back.out(2.4)',
      onStart: () => {
        if (st === 'silhouette') return;
        audio.reveal(i);
        this.shockRing(nv.x, nv.y, nv.r * 0.5, nv.r * 2.6, nv.color, 0.6, 0.7);
        this.fx.emit({ x: nv.x, y: nv.y, texture: textures().star4, count: 8, color: [nv.color, 0xffffff], speed: [30, 140], life: [0.5, 1], size: [0.2, 0.4], spin: [-2, 2] });
      },
    });
  }

  private keystoneBeam(nv: NodeView) {
    const core = this.nodes.get('seed')!;
    const beam = new Graphics();
    beam.blendMode = 'add';
    beam.moveTo(nv.x, nv.y).lineTo(core.x, core.y).stroke({ width: 26, color: nv.color, alpha: 0.25 });
    beam.moveTo(nv.x, nv.y).lineTo(core.x, core.y).stroke({ width: 5, color: 0xffffff, alpha: 0.85 });
    this.fxLayer.addChild(beam);
    beam.alpha = 0;
    gsap.timeline()
      .to(beam, { alpha: 1, duration: 0.15, delay: 0.25 })
      .to(beam, { alpha: 0, duration: 1.1, ease: 'power2.in', onComplete: () => beam.destroy() });
    gsap.delayedCall(0.4, () => {
      gsap.fromTo(core, { flash: 1.2 }, { flash: 0, duration: 1.2 });
      gsap.fromTo(core, { punch: 1.25 }, { punch: 1, duration: 1, ease: 'elastic.out(1, 0.3)' });
      this.shockRing(core.x, core.y, core.r, core.r * 4, nv.color, 1);
    });
  }

  /** Screen-space displacement ripple (keystones, finale). */
  shockwave(wx: number, wy: number, amplitude = 28, dur = 1.3) {
    const p = this.cam.worldToScreen(wx, wy);
    const f = new ShockwaveFilter({ center: { x: p.x, y: p.y }, amplitude, wavelength: 160, speed: 820, brightness: 1.12, radius: -1 });
    f.time = 0;
    const filters = [...(this.view.filters ?? []), f];
    this.view.filters = filters;
    gsap.to(f, {
      time: dur, duration: dur, ease: 'none',
      onComplete: () => {
        this.view.filters = (this.view.filters ?? []).filter((x) => x !== f);
        f.destroy();
      },
    });
  }

  // ───────────────────────────────────────────── finale
  async awakenSequence(): Promise<void> {
    this.inputEnabled = false;
    this.setHovered(null);
    this.cam.locked = true;
    const fit = this.fitZoom();
    await new Promise<void>((res) => gsap.to(this.cam, { x: 0, y: 0, zoom: fit, duration: 1.6, ease: 'power3.inOut', onComplete: res }));
    const tex = textures();
    // wave of light from the rim inward
    const byRing = [...this.nodes.values()].filter((n) => n.def.kind !== 'core').sort((a, b) => b.def.ring - a.def.ring);
    byRing.forEach((nv) => {
      const d = (5 - nv.def.ring) * 0.28 + Math.random() * 0.1;
      gsap.delayedCall(d, () => {
        gsap.fromTo(nv, { flash: 1 }, { flash: 0, duration: 0.9 });
        gsap.fromTo(nv, { punch: 1.3 }, { punch: 1, duration: 0.8, ease: 'elastic.out(1, 0.35)' });
        this.fx.emit({ x: nv.x, y: nv.y, texture: tex.star4, count: 5, color: [nv.color, 0xffffff], speed: [30, 120], life: [0.5, 1], size: [0.25, 0.5] });
        audio.reveal(nv.def.ring);
      });
    });
    for (const e of this.edges) if (e.state === 'active') for (let k = 0; k < 3; k++) this.spawnPulse(e, 1 - k * 0.3, 700);
    await new Promise<void>((r) => gsap.delayedCall(1.7, r));
    const core = this.nodes.get('seed')!;
    audio.awaken();
    gsap.to(core, { punch: 2.3, duration: 1.4, ease: 'power2.in' });
    gsap.to(core, { flash: 3, duration: 1.4, ease: 'power2.in' });
    await new Promise<void>((r) => gsap.delayedCall(1.4, r));
    this.game.flash(1, 0.15, 1.6);
    this.game.shake.add(0.9);
    this.shockwave(0, 0, 40, 1.8);
    this.fx.emit({ x: 0, y: 0, texture: tex.spark, count: 260, color: [0xffffff, 0xffe0a0, BRANCH_COLORS.force, BRANCH_COLORS.reach, BRANCH_COLORS.flow, BRANCH_COLORS.fortune], speed: [300, 1500], life: [0.6, 1.8], size: [0.4, 0.9], drag: 1.6, stretch: 0.0025 });
    this.fx.emit({ x: 0, y: 0, texture: tex.star4, count: 80, color: [0xffffff, 0xffe0a0], speed: [60, 600], life: [1, 2.4], size: [0.3, 0.7], spin: [-3, 3], drag: 1.2 });
    for (let i = 0; i < 4; i++) gsap.delayedCall(i * 0.15, () => this.shockRing(0, 0, 60, 900 + i * 300, pick([0xffffff, 0xffe0a0, 0xfff6dd]), 1.6, 0.8));
    gsap.to(core, { punch: 1, flash: 0, duration: 2.2, ease: 'elastic.out(1, 0.4)' });
    this.sync();
    await new Promise<void>((r) => gsap.delayedCall(1.2, r));
    this.cam.locked = false;
    this.cam.set(this.cam.x, this.cam.y, this.cam.zoom, true);
  }

  // ───────────────────────────────────────────── per frame
  private spawnPulse(edge: EdgeView, t = 1, speed = rand(170, 260)) {
    let p = this.pulsePool.pop();
    if (!p) {
      const tex = textures();
      const s = new Sprite(tex.glow);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      const core = new Sprite(tex.dot);
      core.anchor.set(0.5);
      core.blendMode = 'add';
      p = { edge, t, speed, s, core };
    }
    p.edge = edge;
    p.t = t;
    p.speed = speed;
    p.s.tint = edge.to.color;
    p.s.scale.set(0.32);
    p.core.scale.set(0.32);
    p.s.visible = p.core.visible = true;
    this.pulseLayer.addChild(p.s, p.core);
    this.pulses.push(p);
  }

  update(dt: number) {
    if (!this.view.visible) return;
    this.t += dt;
    const t = this.t;
    this.cam.update(dt);
    this.cam.apply(this.world);
    this.rings.rotation += dt * 0.004;

    if (!this.cam.dragging && this.pointer.x > -9999 && this.inputEnabled && !this.pointer.down && this.pointer.mouse) {
      this.updateHover(this.pointer.x, this.pointer.y);
    }
    if (this.hovered) {
      const p = this.cam.worldToScreen(this.hovered.x, this.hovered.y);
      this.game.tooltip.place(p.x, p.y, this.hovered.r * this.cam.zoom * 1.1);
    }

    for (const nv of this.nodes.values()) nv.tick(dt, t);
    for (const e of this.edges) {
      e.tick(dt);
      if (e.state === 'active' && e.grow >= 1) {
        e.pulseTimer -= dt;
        if (e.pulseTimer <= 0) {
          e.pulseTimer = rand(1.4, 3.2) * (this.game.state.awakened ? 0.4 : 1);
          this.spawnPulse(e);
        }
      }
    }

    // light pulses flow from the tips back to the seed
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t -= (p.speed * dt) / p.edge.length;
      if (p.t <= 0 || p.edge.state !== 'active') {
        p.s.visible = p.core.visible = false;
        this.pulseLayer.removeChild(p.s, p.core);
        this.pulses.splice(i, 1);
        this.pulsePool.push(p);
        continue;
      }
      const pt = p.edge.pointAt(p.t);
      p.s.position.set(pt.x, pt.y);
      p.core.position.set(pt.x, pt.y);
      const fade = Math.min(1, p.t * 4, (1 - p.t) * 6);
      p.s.alpha = 0.7 * fade;
      p.core.alpha = fade;
    }

    // ambient motes drifting off owned nodes
    this.ambientT -= dt;
    if (this.ambientT <= 0 && !this.game.state.settings.reducedMotion) {
      this.ambientT = 0.08;
      const owned = [...this.nodes.values()].filter((n) => n.state === 'owned' || n.state === 'maxed');
      if (owned.length) {
        const nv = pick(owned);
        const a = rand(0, TAU);
        this.fx.emit({ x: nv.x + Math.cos(a) * nv.r, y: nv.y + Math.sin(a) * nv.r, texture: textures().dot, count: 1, color: nv.def.kind === 'core' ? 0xffe0a0 : nv.color, speed: [8, 26], angle: [a - 0.5, a + 0.5], life: [1.2, 2.4], size: [0.12, 0.26], alpha: 0.8, drag: 0.4, fadeIn: 0.2 });
      }
    }
    this.fx.update(dt);
  }

  /** current lumen/prism changed: refresh affordability visuals */
  onWalletChanged() {
    this.sync();
    this.game.tooltip.refresh(this.game.state);
  }
}
