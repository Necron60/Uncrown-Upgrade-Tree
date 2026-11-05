import gsap from 'gsap';
import { AlphaFilter, Container, Graphics, Sprite, Text } from 'pixi.js';
import { ShockwaveFilter } from 'pixi-filters/shockwave';
import { TAU, lerpColor, pick, rand } from '../core/math';
import { fmt } from '../core/format';
import { BRANCH_COLORS, type TreeDef } from '../data/tree';
import { progressOf, type TreeProgress } from '../core/state';
import { Particles } from '../render/particles';
import { textures } from '../render/textures';
import { audio } from '../systems/audio';
import {
  canAfford, isOwned, level, nextCost, nodeState, pathToSeed, type BuyResult, type UnweaveResult,
} from '../systems/tree-logic';
import type { Game } from '../game/Game';
import { Camera } from './tree/Camera';
import { EdgeView, type EdgeState } from './tree/EdgeView';
import { NodeView } from './tree/NodeView';

/** A comet of light racing along one or more branches. */
interface Trace {
  segs: { e: EdgeView; rev: boolean }[]; // rev = travel child → parent
  i: number; // current segment
  d: number; // distance along the current segment
  v: number;
  vmax: number;
  accel: number;
  size: number;
  color: number;
  grow: boolean; // draw the branch in behind the head
  head: Sprite;
  core: Sprite;
  /** the light ribbon trailing behind the head */
  tail: Graphics;
  trail: number[]; // recent head positions, flat x,y
  onSeg?: (i: number, at: NodeView, e: EdgeView) => void;
  onDone?: () => void;
}

interface TraceOpts {
  color: number;
  size?: number;
  vmax?: number;
  accel?: number;
  grow?: boolean;
  onSeg?: (i: number, at: NodeView, e: EdgeView) => void;
  onDone?: () => void;
}

const DARKNESS = { off: 0, dim: 0.62, deep: 0.94 } as const;

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
  // lit parts of the tree are drawn above the darkness, so they glow out of the black
  private litEdgeLayer = new Container();
  private litNodeLayer = new Container();
  private fxLayer = new Container();
  private fx = new Particles(2400);
  // darkness: a black layer the tree's light cuts holes into ('erase' sprites, one per node)
  private darkLayer = new Container();
  private darkRect = new Graphics();
  private lightLayer = new Container();
  private lightSprites = new Map<NodeView, Sprite>();
  private dawn!: Sprite;
  /** current / target opacity of the darkness */
  darkAlpha: number = DARKNESS.deep;
  private darkTarget: number = DARKNESS.deep;
  private darkHold = false;
  /** radius of the finale's dawn, which dissolves the darkness from the seed outward */
  dawnR = 0;
  private traceLayer = new Container();
  private traces: Trace[] = [];
  private popping = new Set<NodeView>();
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
  /** the node at the centre (the seed, the crown) */
  readonly core: NodeView;
  /** sealed rings (trees with trials), by ring index */
  private gates = new Map<number, Graphics>();
  /** the either/or links between fork pairs */
  private forkLinks: { g: Graphics; a: NodeView; b: NodeView }[] = [];
  /** drawn above the darkness: gates and forks must read as structure, not as part of the dark */
  private overLayer = new Container();
  private longPress = { timer: 0, fired: false };

  constructor(private game: Game, readonly tree: TreeDef) {
    this.view.addChild(this.world);
    // light (pulses, traces, bursts) is drawn *above* the darkness so it shines through it
    this.world.addChild(this.rings, this.edgeLayer, this.nodeLayer, this.darkLayer, this.overLayer, this.litEdgeLayer, this.pulseLayer, this.litNodeLayer, this.traceLayer, this.fxLayer);
    this.fxLayer.addChild(this.fx.view);
    this.darkRect.rect(-7000, -7000, 14000, 14000).fill({ color: tree.voidColor });
    this.darkLayer.addChild(this.darkRect, this.lightLayer);
    // render the darkness as its own layer, so 'erase' cuts only the darkness and not the tree below
    this.darkLayer.filters = [new AlphaFilter({ alpha: 1 })];

    for (const def of tree.nodes) {
      if (def.kind === 'awaken') continue;
      const nv = new NodeView(def, tree);
      this.nodes.set(def.id, nv);
    }
    this.core = this.nodes.get(tree.root)!;
    this.drawRings();
    // core last so it draws on top
    const order = [...this.nodes.values()].sort((a, b) => b.def.ring - a.def.ring);
    for (const nv of order) this.nodeLayer.addChild(nv.c);
    const tex = textures();
    for (const nv of this.nodes.values()) {
      const s = new Sprite(tex.pool);
      s.anchor.set(0.5);
      s.blendMode = 'erase';
      s.position.set(nv.x, nv.y);
      s.scale.set(0);
      this.lightLayer.addChild(s);
      this.lightSprites.set(nv, s);
    }
    this.dawn = new Sprite(tex.pool);
    this.dawn.anchor.set(0.5);
    this.dawn.blendMode = 'erase';
    this.dawn.scale.set(0);
    this.lightLayer.addChild(this.dawn);

    for (const def of tree.nodes) {
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
    const rings = this.tree.rings;
    for (let i = 1; i < rings.length; i++) {
      const r = rings[i];
      const n = 90 + i * 30;
      for (let k = 0; k < n; k++) {
        if (k % 3 === 2) continue;
        const a0 = (k / n) * TAU;
        const a1 = a0 + (TAU / n) * 0.6;
        g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a1);
      }
      g.stroke({ width: 1, color: this.tree.ringColor, alpha: 0.07 });
    }
    // forks: a faint arc between the two sides of a choice, a small diamond where they meet
    const forks = new Map<string, NodeView[]>();
    for (const nv of this.nodes.values()) if (nv.def.fork) forks.set(nv.def.fork, [...(forks.get(nv.def.fork) ?? []), nv]);
    for (const [, pair] of forks) {
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      const g = new Graphics();
      this.overLayer.addChild(g);
      this.forkLinks.push({ g, a, b });
      const r = rings[a.def.ring];
      const aa = (a.def.angle * Math.PI) / 180, ab = (b.def.angle * Math.PI) / 180;
      const lo = Math.min(aa, ab) + (a.r + 10) / r, hi = Math.max(aa, ab) - (b.r + 10) / r;
      const steps = 10;
      for (let k = 0; k < steps; k++) {
        const t0 = lo + ((hi - lo) * k) / steps, t1 = t0 + ((hi - lo) / steps) * 0.45;
        g.moveTo(Math.cos(t0) * r, Math.sin(t0) * r).arc(0, 0, r, t0, t1);
      }
      g.stroke({ width: 1.4, color: a.color, alpha: 0.45 });
      const m = (aa + ab) / 2, d = 5;
      const mx = Math.cos(m) * r, my = Math.sin(m) * r;
      g.poly([mx, my - d, mx + d, my, mx, my + d, mx - d, my]).fill({ color: 0x07050e, alpha: 1 }).stroke({ width: 1.3, color: a.color, alpha: 0.8 });
    }
    // sealed rings: a brighter, denser ring that stays until its trial is passed
    for (const t of this.tree.trials ?? []) {
      if (t.ring < 2) continue;
      const gg = new Graphics();
      const r = (rings[t.ring - 1] + rings[t.ring]) / 2;
      const n = 220;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * TAU;
        gg.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a0 + (TAU / n) * 0.42);
      }
      gg.stroke({ width: 2, color: this.tree.ringColor, alpha: 0.22 });
      gg.circle(0, 0, r).stroke({ width: 12, color: this.tree.ringColor, alpha: 0.03 });
      // seals where the branches meet
      for (let k = 0; k < this.tree.branches.length; k++) {
        const a = ((k + 0.5) / this.tree.branches.length) * TAU - Math.PI / 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r, d = 7;
        gg.poly([x, y - d, x + d, y, x, y + d, x - d, y]).fill({ color: 0x07050e, alpha: 1 }).stroke({ width: 1.4, color: this.tree.ringColor, alpha: 0.7 });
      }
      gg.visible = false;
      this.overLayer.addChild(gg);
      this.gates.set(t.ring, gg);
    }
  }

  /** this tree's progress in the save */
  get prog(): TreeProgress {
    return progressOf(this.game.state, this.tree.id);
  }

  /** Show the gates that are still sealed, and the forks the player has reached (no animation). */
  private syncGates() {
    const p = this.prog;
    for (const f of this.forkLinks) {
      const seen = (n: NodeView) => n.state !== 'hidden' && n.state !== 'silhouette';
      f.g.visible = seen(f.a) && seen(f.b);
    }
    for (const t of this.tree.trials ?? []) {
      const g = this.gates.get(t.ring);
      if (!g) continue;
      const sealed = !p.trials.includes(t.id);
      // only once the ring inside it has been reached, so the outer gates do not give the map away
      const reached = this.tree.nodes.some((n) => n.ring === t.ring - 1 && n.kind !== 'core' && isOwned(p.levels, n.id));
      if (!sealed) { g.visible = false; continue; }
      g.visible = reached;
      g.alpha = 1;
    }
  }

  /** The Hollow Heart was broken: the crown at the centre cracks open, and Uncrown waits. */
  crackCrown() {
    const c = this.core;
    const tex = textures();
    const reduced = this.game.state.settings.reducedMotion;
    const fs = Math.max(0.25, this.game.motion.flashes);
    audio.hollow('boss');
    this.sync();
    gsap.fromTo(c, { punch: 1.5 }, { punch: 1, duration: 1.2, ease: 'elastic.out(1, 0.3)' });
    gsap.fromTo(c, { flash: 1.6 * fs }, { flash: 0, duration: 1.4 });
    gsap.fromTo(c, { flareBoost: 2.6 }, { flareBoost: 1, duration: 1.6, ease: 'expo.out' });
    for (let i = 0; i < 3; i++) gsap.delayedCall(i * 0.14, () => this.shockRing(c.x, c.y, c.r, c.r * (5 + i * 2.5), i === 1 ? 0xffffff : 0xff3d63, 1.2, 0.85));
    this.game.shake.add(0.7);
    this.shockwave(c.x, c.y, 26, 1.4);
    if (!reduced) {
      this.fx.emit({ x: c.x, y: c.y, texture: tex.spark, count: 140, color: [0xff3d63, 0xffd0da, 0xffffff, this.tree.ringColor], speed: [200, 1000], life: [0.5, 1.4], size: [0.4, 0.8], drag: 2, stretch: 0.003 });
      this.fx.emit({ x: c.x, y: c.y, texture: tex.frag, count: 40, color: [0xff3d63, 0xffd0da], speed: [100, 500], life: [0.7, 1.4], size: [0.5, 0.9], sizeEnd: 0.2, drag: 2, spin: [-10, 10] });
    }
  }

  /** A trial was passed: its gate breaks open with light running around the ring. */
  openGate(ring: number) {
    const g = this.gates.get(ring);
    const r = (this.tree.rings[ring - 1] + this.tree.rings[ring]) / 2;
    const tex = textures();
    const reduced = this.game.state.settings.reducedMotion;
    audio.reveal(3);
    gsap.delayedCall(0.15, () => audio.purchase(6, true));
    if (g) {
      g.visible = true;
      gsap.to(g, { alpha: 0, duration: reduced ? 0.4 : 1.4, ease: 'power2.in', onComplete: () => { g.visible = false; g.alpha = 1; } });
    }
    this.shockRing(0, 0, r * 0.96, r * 1.08, this.tree.ringColor, 1.2, 0.9);
    if (!reduced) {
      this.game.shake.add(0.3);
      // the light runs both ways round the ring from the top
      for (let k = 0; k < 48; k++) {
        gsap.delayedCall(k * 0.018, () => {
          for (const dir of [-1, 1]) {
            const a = -Math.PI / 2 + dir * (k / 48) * Math.PI;
            this.fx.emit({ x: Math.cos(a) * r, y: Math.sin(a) * r, texture: tex.spark, count: 2, color: [this.tree.ringColor, 0xffffff], speed: [30, 160], life: [0.4, 0.9], size: [0.3, 0.55], drag: 2.5, stretch: 0.003 });
            if (k % 4 === 0) this.fx.emit({ x: Math.cos(a) * r, y: Math.sin(a) * r, texture: tex.star4, count: 1, color: 0xffffff, speed: [0, 20], life: [0.5, 0.8], size: [0.4, 0.7], sizeEnd: 0, spin: [-2, 2] });
          }
        });
      }
    }
    // the nodes behind it light up as the ring opens
    for (const nv of this.nodes.values()) {
      if (nv.def.ring !== ring || !nv.visible) continue;
      const d = Math.abs(((nv.def.angle + 90 + 540) % 360) - 180) / 180;
      gsap.delayedCall(0.2 + d * 0.9, () => {
        gsap.fromTo(nv, { flash: 0.9 * this.game.motion.flashes }, { flash: 0, duration: 0.8 });
        gsap.fromTo(nv, { punch: 1.25 }, { punch: 1, duration: 0.7, ease: 'elastic.out(1, 0.35)' });
      });
    }
    this.sync();
  }

  // ───────────────────────────────────────────── state sync
  /** Bring every node/edge in line with the game state (no animation). */
  sync() {
    const s = this.prog;
    const ks: Record<string, boolean> = {};
    for (const k of this.tree.keystones) ks[k] = isOwned(s.levels, k);
    const awakenReady = nodeState(this.tree, this.tree.map[this.tree.finale], s) === 'available' && !s.awakened;
    // the Hollow Heart broken: the crown at the centre stays cracked open
    const broken = !!this.tree.trials?.some((t) => t.goal.kind === 'boss' && s.trials.includes(t.id));
    for (const nv of this.nodes.values()) {
      const st = nodeState(this.tree, nv.def, s);
      const aff = st === 'available' || st === 'owned' ? canAfford(nextCost(nv.def, s.levels), s) : false;
      nv.setState(st, level(s.levels, nv.def.id), aff, nv.def.kind === 'core' ? { awakenReady, awakened: s.awakened, keystones: ks, broken } : undefined);
    }
    for (const e of this.edges) e.setState(this.edgeState(e));
    this.placeLayers();
    this.updateBranchGlow();
    this.syncGates();
  }

  /** Lit nodes and branches go above the darkness, everything still unlit below it. */
  private placeLayers() {
    for (const nv of this.nodes.values()) {
      const lit = nv.def.kind === 'core' || ((nv.state === 'owned' || nv.state === 'maxed') && !nv.igniting);
      const want = lit ? this.litNodeLayer : this.nodeLayer;
      if (nv.c.parent !== want) want.addChild(nv.c);
    }
    for (const e of this.edges) {
      const want = e.state === 'active' ? this.litEdgeLayer : this.edgeLayer;
      if (e.view.parent !== want) want.addChild(e.view);
    }
  }

  private edgeState(e: EdgeView): EdgeState {
    const a = e.from.state;
    const b = e.to.state;
    if (a === 'hidden' || b === 'hidden') return 'hidden';
    if (a === 'silhouette' && b === 'silhouette') return 'hidden';
    const ao = a === 'owned' || a === 'maxed';
    const bo = b === 'owned' || b === 'maxed';
    if (ao && bo) return 'active';
    if (ao && (b === 'available' || b === 'locked')) return 'ready';
    return 'ghost';
  }

  /** Every branch's investment lights its cloud in the background. */
  updateBranchGlow() {
    const s = this.prog;
    for (const b of this.tree.branches) {
      let have = 0, max = 0;
      for (const n of this.tree.nodes) {
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
    if (!fromHarvest) this.snapLights();
    if (fromHarvest) {
      if (this.game.motion.cameraFx) {
        // arrive by zooming out of the seed
        this.cam.set(0, 0, 2.4, true);
        this.cam.set(this.savedCam.x, this.savedCam.y, this.savedCam.z);
      } else {
        this.cam.set(this.savedCam.x, this.savedCam.y, this.savedCam.z, true);
      }
    }
  }

  /** Particle amount (player setting). */
  setFxDensity(d: number) {
    this.fx.density = d;
  }

  /** How dark the void beyond the tree's light is (player setting). Once awakened, it is lit for good. */
  setDarkness(level: keyof typeof DARKNESS) {
    this.darkTarget = this.prog.awakened ? 0 : DARKNESS[level];
    if (!this.view.visible) this.darkAlpha = this.darkTarget;
  }

  setFilterAntialias(aa: 'inherit' | 'off') {
    for (const f of this.darkLayer.filters ?? []) f.antialias = aa;
  }

  /** Radius of light a node should cast in its current state. */
  private lightTargetOf(nv: NodeView): number {
    if (!nv.visible) return 0;
    const st = nv.state;
    let r = 0;
    if (nv.def.kind === 'core') r = 300;
    else if (st === 'owned' || st === 'maxed') {
      r = nv.def.kind === 'keystone' ? 250 : nv.def.kind === 'minor' ? 140 : 170;
      if (st === 'maxed') r *= 1.12;
    } else if (st === 'available') r = nv.affordable ? 100 : 82; // an ember, enough to read the node
    else if (st === 'locked' || st === 'gated') r = 58;
    else if (st === 'sealed') r = 54;
    return (r + (nv.hover ? 45 : 0)) * nv.pop;
  }

  private lightStrength(nv: NodeView): number {
    const st = nv.state;
    if (nv.def.kind === 'core' || st === 'owned' || st === 'maxed') return 1;
    if (st === 'available') return nv.affordable ? 0.78 : 0.6;
    return 0.42;
  }

  /** Jump every light straight to its target (on load, no animation). */
  private snapLights() {
    for (const nv of this.nodes.values()) if (!nv.lightHold) nv.light = this.lightTargetOf(nv);
    this.darkAlpha = this.darkTarget;
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
    // camera moves switched off: hold still while the screen fades
    if (!this.game.motion.cameraFx) return new Promise((res) => gsap.delayedCall(duration, res));
    this.cam.locked = true;
    return new Promise((res) => {
      gsap.to(this.cam, { x: 0, y: 0, zoom: 3.2, duration, ease: 'power3.in', onComplete: () => { this.cam.locked = false; this.cam.set(0, 0, 3.2, true); res(); } });
      const core = this.core;
      gsap.to(core, { flash: 1.5 * this.game.motion.flashes, duration: duration * 0.9, ease: 'power2.in', onComplete: () => { core.flash = 0; } });
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
      if (e.button !== 0) return; // right-click unweaves (contextmenu), it must not also buy
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
      // touch has no right-click: holding a lit star unweaves it
      clearTimeout(this.longPress.timer);
      this.longPress.fired = false;
      if (e.pointerType === 'touch' && this.tree.light) {
        const sx = e.clientX, sy = e.clientY;
        this.longPress.timer = window.setTimeout(() => {
          if (!p.down || p.moved > 6 || this.cam.dragging) return;
          const nv = this.pick(sx, sy);
          if (!nv || (nv.state !== 'owned' && nv.state !== 'maxed') || nv.def.kind === 'core') return;
          this.longPress.fired = true;
          this.setHovered(nv);
          this.tryUnweave(nv);
        }, 550);
      }
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
      clearTimeout(this.longPress.timer);
      if (!p.down) return;
      p.down = false;
      if (this.longPress.fired) return; // the hold already unwove a star
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
    // right-click a lit star to unweave it (trees with limited light)
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.view.visible || !this.inputEnabled || !this.tree.light) return;
      this.updateHover(e.clientX, e.clientY);
      const nv = this.hovered;
      if (nv && (nv.state === 'owned' || nv.state === 'maxed')) this.tryUnweave(nv);
    });
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
      const path = pathToSeed(this.tree, nv.def.id, this.prog.levels);
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
    const p = this.cam.worldToScreen(nv.x, nv.y);
    this.game.tooltip.show(this.tree, nv.def, this.prog, p.x, p.y, nv.r * this.cam.zoom * 1.1);
  }

  private clickNode(nv: NodeView) {
    const st = nv.state;
    if (nv.def.kind === 'core') {
      audio.click();
      void this.game.startHarvest();
      return;
    }
    if (st === 'silhouette' || st === 'maxed') {
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
    const t = new Text({ text, style: { fontFamily: 'IBM Plex Mono', fontWeight: '500', fontSize: size, fill: color, dropShadow: { color: 0x000000, alpha: 0.7, blur: 6, distance: 0 } } });
    t.anchor.set(0.5);
    t.resolution = 2;
    t.position.set(x, y);
    this.fxLayer.addChild(t);
    gsap.fromTo(t.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(3)' });
    gsap.to(t, { y: y - 46, duration: 1.3, ease: 'power2.out' });
    gsap.to(t, { alpha: 0, duration: 0.5, delay: 0.8, onComplete: () => t.destroy() });
  }

  // ───────────────────────────────────────────── light traces
  private startTrace(segs: { e: EdgeView; rev: boolean }[], o: TraceOpts): Trace | null {
    if (!segs.length) { o.onDone?.(); return null; }
    const tex = textures();
    const size = o.size ?? 1;
    const mk = (t: typeof tex.glow, tint: number) => {
      const sp = new Sprite(t);
      sp.anchor.set(0.5);
      sp.blendMode = 'add';
      sp.tint = tint;
      this.traceLayer.addChild(sp);
      return sp;
    };
    const tail = new Graphics();
    tail.blendMode = 'add';
    this.traceLayer.addChildAt(tail, 0);
    const head = mk(tex.glow, o.color);
    head.scale.set(0.55 * size);
    const core = mk(tex.dot, 0xffffff);
    core.scale.set(0.42 * size);
    const tr: Trace = {
      segs, i: 0, d: 0, v: 260, vmax: o.vmax ?? 1400, accel: o.accel ?? 5200, size, color: o.color,
      grow: o.grow ?? false, head, core, tail, trail: [], onSeg: o.onSeg, onDone: o.onDone,
    };
    this.traces.push(tr);
    return tr;
  }

  /** Segments from a node back down its path to the seed. */
  private pathSegs(id: string): { e: EdgeView; rev: boolean }[] {
    const path = pathToSeed(this.tree, id, this.prog.levels);
    const segs: { e: EdgeView; rev: boolean }[] = [];
    for (let i = 0; i < path.length - 1; i++) {
      const e = this.edges.find((x) => x.to.def.id === path[i] && x.from.def.id === path[i + 1]);
      if (e) segs.push({ e, rev: true });
    }
    return segs;
  }

  private updateTraces(dt: number) {
    const tex = textures();
    for (let k = this.traces.length - 1; k >= 0; k--) {
      const tr = this.traces[k];
      tr.v = Math.min(tr.vmax, tr.v + tr.accel * dt);
      let step = tr.v * dt;
      while (step > 0 && tr.i < tr.segs.length) {
        const sg = tr.segs[tr.i];
        const left = sg.e.length - tr.d;
        if (step < left) {
          tr.d += step;
          step = 0;
        } else {
          step -= left;
          if (tr.grow && !sg.rev) { sg.e.grow = 1; sg.e.redraw(); }
          tr.onSeg?.(tr.i, sg.rev ? sg.e.from : sg.e.to, sg.e);
          tr.i++;
          tr.d = 0;
        }
      }
      if (tr.i >= tr.segs.length) {
        // arrival: a little flare where the light lands, then the comet fades out
        const last = tr.segs[tr.segs.length - 1];
        const end = last.rev ? last.e.from : last.e.to;
        this.fx.emit({ x: end.x, y: end.y, texture: tex.star4, count: 1, color: 0xffffff, speed: [0, 0], life: [0.3, 0.3], size: [0.9 * tr.size, 0.9 * tr.size], sizeEnd: 0, spin: [2, 3] });
        for (const sp of [tr.head, tr.core, tr.tail]) gsap.to(sp, { alpha: 0, duration: sp === tr.tail ? 0.35 : 0.18, onComplete: () => sp.destroy() });
        this.traces.splice(k, 1);
        tr.onDone?.();
        continue;
      }
      const sg = tr.segs[tr.i];
      const f = tr.d / sg.e.length;
      const tt = sg.rev ? 1 - f : f;
      const p = sg.e.pointAt(tt);
      const q = sg.e.pointAt(sg.rev ? Math.min(1, tt + 0.03) : Math.max(0, tt - 0.03));
      if (tr.grow && !sg.rev) { sg.e.grow = f; sg.e.redraw(); }
      const ang = Math.atan2(p.y - q.y, p.x - q.x);
      tr.head.position.set(p.x, p.y);
      tr.core.position.set(p.x, p.y);
      // a ribbon of light along the head's recent path: glow passes plus a white-hot core, fading toward the tail
      tr.trail.push(p.x, p.y);
      if (tr.trail.length > 36) tr.trail.splice(0, 2);
      this.drawTail(tr);
      if (Math.random() < 0.5) this.fx.emit({ x: p.x, y: p.y, texture: tex.spark, count: 1, color: [tr.color, 0xffffff], speed: [20, 80], angle: [ang + Math.PI - 0.5, ang + Math.PI + 0.5], life: [0.16, 0.3], size: [0.2 * tr.size, 0.32 * tr.size], drag: 4, stretch: 0.004 });
      if (Math.random() < 0.4) this.fx.emit({ x: p.x, y: p.y, texture: tex.dot, count: 1, color: tr.color, speed: [4, 30], life: [0.35, 0.7], size: [0.14 * tr.size, 0.26 * tr.size], drag: 2, spread: 3 });
    }
  }

  private drawTail(tr: Trace) {
    const g = tr.tail;
    g.clear();
    const pts = tr.trail;
    const n = pts.length / 2;
    if (n < 2) return;
    const hot = lerpColor(tr.color, 0xffffff, 0.7);
    for (let i = 1; i < n; i++) {
      const f = i / (n - 1); // 0 = tail end, 1 = at the head
      const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1], x1 = pts[i * 2], y1 = pts[i * 2 + 1];
      const k = f * f;
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 12 * tr.size * (0.4 + 0.6 * f), color: tr.color, alpha: 0.07 * k, cap: 'butt' });
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 4.5 * tr.size * (0.4 + 0.6 * f), color: tr.color, alpha: 0.32 * k, cap: 'butt' });
      g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.6 * tr.size * (0.5 + 0.5 * f), color: hot, alpha: 0.95 * k, cap: 'butt' });
    }
  }

  // ───────────────────────────────────────────── buying
  celebrate(nv: NodeView, res: Extract<BuyResult, { ok: true }>) {
    const reduced = this.game.state.settings.reducedMotion;
    const first = res.newLevel === 1;
    const levels = this.prog.levels;
    const revealed = res.revealed.map((id) => this.nodes.get(id)).filter((n): n is NodeView => !!n);

    // newly revealed nodes stay hidden until the light reaches them
    for (const c of revealed) {
      c.pop = 0;
      for (const e of this.edges) if (e.to === c) e.grow = 0;
    }
    // on a first purchase, the branch(es) from already-lit parents are drawn by the incoming light
    const inbound = first && !reduced ? this.edges.filter((e) => e.to === nv && isOwned(levels, e.from.def.id)) : [];
    for (const e of inbound) e.grow = 0;
    this.sync();
    this.showTooltip();

    // instant tactile answer to the click
    gsap.killTweensOf(nv, 'punch');
    gsap.to(nv, { punch: 0.84, duration: 0.07, ease: 'power2.in' });
    const spent = res.spent;
    const parts: string[] = [];
    if (spent.lumen) parts.push(`-${fmt(spent.lumen)}`);
    if (spent.prism) parts.push(`-${fmt(spent.prism)}◆`);
    if (parts.length) this.floatText(nv.x, nv.y - nv.r - 18, parts.join('  '), 0xffd77a, 17);

    if (inbound.length) {
      // light races in from the lit tree; the node ignites when it lands
      nv.lightHold = true;
      nv.light = 0;
      nv.igniting = true;
      this.placeLayers();
      audio.trace(0);
      let arrived = false;
      for (const e of inbound) {
        this.startTrace([{ e, rev: false }], {
          color: e.from.def.kind === 'core' ? nv.color : e.from.color, grow: true, size: 0.9,
          onDone: () => { if (!arrived) { arrived = true; this.ignite(nv, res, revealed); } },
        });
      }
    } else {
      this.ignite(nv, res, revealed);
    }
  }

  /** The moment light lands in a node: burst, bloom of light, then light flows on to its neighbours. */
  private ignite(nv: NodeView, res: Extract<BuyResult, { ok: true }>, revealed: NodeView[]) {
    const m = this.game.motion;
    const reduced = this.game.state.settings.reducedMotion;
    const big = nv.def.kind === 'keystone';
    const major = nv.def.kind === 'major' || nv.def.kind === 'synergy';
    const first = res.newLevel === 1;
    const tex = textures();
    const { x, y, r, color } = nv;

    nv.igniting = false;
    this.placeLayers();
    gsap.killTweensOf(nv, 'punch,flash,light,flareBoost');
    // the socket becomes a star: its spikes burst far out, then draw back to size
    nv.star = Math.max(nv.star, 0.85);
    gsap.fromTo(nv, { flareBoost: big ? 2.6 : first ? 2.3 : 1.6 }, { flareBoost: 1, duration: first ? 1.3 : 0.8, ease: 'expo.out' });
    gsap.timeline()
      .to(nv, { punch: big ? 1.5 : first ? 1.3 : 1.2, duration: 0.14, ease: 'power2.out' })
      .to(nv, { punch: 1, duration: 0.8, ease: 'elastic.out(1, 0.32)' });
    nv.flash = (big ? 1.5 : first ? 1.1 : 0.8) * Math.max(0.25, m.flashes);
    gsap.to(nv, { flash: 0, duration: big ? 1.3 : 0.7, ease: 'power2.out' });

    // the node's light blooms past its resting size, then settles
    nv.lightHold = true;
    const target = this.lightTargetOf(nv);
    gsap.timeline({ onComplete: () => { nv.lightHold = false; } })
      .to(nv, { light: target * (first ? 1.45 : 1.2), duration: first ? 0.55 : 0.35, ease: 'expo.out' })
      .to(nv, { light: target, duration: 1.4, ease: 'power2.inOut' });

    this.shockRing(x, y, r, r * (big ? 7 : first ? 4.2 : 3.2), color, big ? 1.1 : 0.75);
    if (!reduced) {
      gsap.delayedCall(0.07, () => this.shockRing(x, y, r * 0.8, r * (big ? 5 : 2.6), 0xffffff, 0.6, 0.5));
      this.fx.emit({ x, y, texture: tex.spark, count: big ? 90 : major ? 48 : first ? 36 : 22, color: [color, 0xffffff], speed: [160, big ? 760 : 480], life: [0.35, 0.85], size: [0.35, 0.7], drag: 3.4, stretch: 0.0035, spread: r * 0.4 });
      this.fx.emit({ x, y, texture: tex.star4, count: big ? 24 : first ? 12 : 6, color: [color, 0xffffff], speed: [30, 200], life: [0.6, 1.3], size: [0.2, 0.5], spin: [-3, 3], drag: 2 });
      this.fx.emit({ x, y, texture: tex.dot, count: big ? 40 : 16, color, speed: [20, 140], life: [0.8, 1.6], size: [0.15, 0.35], drag: 1.2, gravity: -30, spread: r });
    }
    if (nv.def.maxLevel > 1) this.floatText(x, y + r + 26, `LV ${res.newLevel}`, color, 14);
    audio.purchase(Math.min(res.newLevel, 6) + (major ? 2 : 0), big);

    if (big) {
      this.game.shake.add(0.55);
      this.shockwave(x, y, 16, 1.1);
      // the keystone's light runs home along the branches and lights its arc of the seed
      const core = this.core;
      gsap.delayedCall(0.25, () => {
        audio.trace(5);
        this.startTrace(this.pathSegs(nv.def.id), {
          color, size: 1.5, vmax: 1300, accel: 2600,
          onSeg: (_i, at) => { if (at !== core) gsap.fromTo(at, { flash: 0.7 }, { flash: 0, duration: 0.7 }); },
          onDone: () => {
            gsap.fromTo(core, { flash: 1.3 * Math.max(0.25, m.flashes) }, { flash: 0, duration: 1.2 });
            gsap.fromTo(core, { punch: 1.3 }, { punch: 1, duration: 1, ease: 'elastic.out(1, 0.3)' });
            this.shockRing(core.x, core.y, core.r, core.r * 4.5, color, 1.1);
            this.game.shake.add(0.3);
            audio.reveal(6);
          },
        });
      });
    } else if (major) {
      this.game.shake.add(0.18);
    }
    if (!first && !big && !reduced) {
      // a level-up sends a pulse of light home to the seed
      gsap.delayedCall(0.12, () => this.startTrace(this.pathSegs(nv.def.id), {
        color, size: 0.55, vmax: 1900, accel: 7000,
        onDone: () => { gsap.fromTo(this.core, { flash: 0.35 * m.flashes }, { flash: 0, duration: 0.5 }); },
      }));
    }

    this.revealFrom(nv, revealed);
  }

  /** Light flows on from `src` to each newly revealed neighbour; each one appears as its light arrives. */
  private revealFrom(src: NodeView, revealed: NodeView[]) {
    if (!revealed.length) return;
    const reduced = this.game.state.settings.reducedMotion;
    const direct = revealed.filter((c) => this.edges.some((e) => e.from === src && e.to === c));
    const rest = revealed.filter((c) => !direct.includes(c));
    if (reduced) {
      revealed.forEach((c, i) => gsap.delayedCall(0.1 + i * 0.05, () => this.popNode(c, i, [])));
      return;
    }
    if (direct.length) audio.trace(2);
    direct.forEach((c, i) => {
      const e = this.edges.find((x) => x.from === src && x.to === c)!;
      gsap.delayedCall(0.08 + i * 0.07, () => this.startTrace([{ e, rev: false }], {
        color: c.color, grow: true, size: c.state === 'silhouette' ? 0.45 : 0.75, vmax: 1100, accel: 3400,
        onDone: () => this.popNode(c, i, rest),
      }));
    });
    // anything not reachable from a direct reveal just fades in
    for (const c of rest) {
      if (!c.def.parents.some((p) => direct.some((d) => d.def.id === p))) gsap.delayedCall(0.7, () => this.popNode(c, 0, []));
    }
  }

  private popNode(c: NodeView, i: number, rest: NodeView[]) {
    if (this.popping.has(c) || c.pop >= 1) return;
    this.popping.add(c);
    const sil = c.state === 'silhouette';
    for (const e of this.edges) {
      if (e.to === c && e.grow < 1) gsap.to(e, { grow: 1, duration: 0.45, ease: 'power2.out', onUpdate: () => e.redraw() });
    }
    gsap.to(c, {
      pop: 1, duration: sil ? 0.6 : 0.7, ease: sil ? 'power2.out' : 'back.out(2.4)',
      onComplete: () => this.popping.delete(c),
    });
    if (!sil) {
      audio.reveal(i);
      this.shockRing(c.x, c.y, c.r * 0.5, c.r * 2.6, c.color, 0.6, 0.7);
      this.fx.emit({ x: c.x, y: c.y, texture: textures().star4, count: 8, color: [c.color, 0xffffff], speed: [30, 140], life: [0.5, 1], size: [0.2, 0.4], spin: [-2, 2] });
    }
    // the faint "?" stars beyond it follow along dotted branches
    for (const s of rest) {
      if (!s.def.parents.includes(c.def.id) || this.popping.has(s) || s.pop >= 1) continue;
      gsap.delayedCall(0.15, () => this.popNode(s, 0, []));
    }
  }

  /** Screen-space displacement ripple (keystones, finale). */
  shockwave(wx: number, wy: number, amplitude = 28, dur = 1.3) {
    if (!this.game.motion.ripples) return;
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
    const m = this.game.motion;
    const reduced = this.game.state.settings.reducedMotion;
    const tex = textures();
    const wait = (s: number) => new Promise<void>((r) => gsap.delayedCall(s, r));
    const core = this.core;
    const lit = [...this.nodes.values()].filter((n) => n.visible);
    const fs = Math.max(0.25, m.flashes);
    const keystones = this.tree.keystones.filter((k) => isOwned(this.prog.levels, k));
    const branchColors = this.tree.branches.map((b) => BRANCH_COLORS[b]);

    // 1 ─ the lights go out: everything you grew sinks to embers in a near-black void
    this.darkHold = true;
    gsap.to(this, { darkAlpha: 0.97, duration: 1.6, ease: 'power2.inOut' });
    for (const n of lit) {
      n.lightHold = true;
      gsap.to(n, { light: n === core ? 140 : 34, duration: 1.6, ease: 'power2.inOut' });
      if (n !== core) gsap.to(n, { dim: 1, duration: 1.6, ease: 'power2.inOut' });
    }
    for (const e of this.edges) gsap.to(e, { dim: 1, duration: 1.6, ease: 'power2.inOut' });
    gsap.to(this.pulseLayer, { alpha: 0, duration: 1.2 });
    audio.drone();
    const fit = this.fitZoom();
    if (m.cameraFx) {
      this.cam.locked = true;
      gsap.to(this.cam, { x: 0, y: 0, zoom: fit, duration: 1.8, ease: 'power3.inOut' });
    } else {
      this.cam.set(0, 0, fit, true);
      this.cam.locked = true;
    }
    await wait(1.9);

    // 2 ─ four lights race home from the keystones, re-lighting every node they pass
    const relight = (n: NodeView, i: number) => {
      gsap.to(n, { dim: 0, duration: 0.35, ease: 'power2.out' });
      gsap.fromTo(n, { flareBoost: 1.9 }, { flareBoost: 1, duration: 1, ease: 'expo.out' });
      gsap.fromTo(n, { flash: 0.9 * fs }, { flash: 0, duration: 0.8 });
      gsap.fromTo(n, { punch: 1.25 }, { punch: 1, duration: 0.7, ease: 'elastic.out(1, 0.35)' });
      gsap.to(n, { light: this.lightTargetOf(n) * 0.75, duration: 0.6, ease: 'expo.out' });
      this.fx.emit({ x: n.x, y: n.y, texture: tex.star4, count: 5, color: [n.color, 0xffffff], speed: [30, 130], life: [0.5, 1], size: [0.25, 0.5], spin: [-2, 2] });
      audio.reveal(i);
    };
    if (reduced) {
      for (const n of lit) gsap.to(n, { light: this.lightTargetOf(n) * 0.6, dim: 0, duration: 0.8 });
      for (const e of this.edges) gsap.to(e, { dim: 0, duration: 0.8 });
      await wait(0.9);
    } else {
      await Promise.all(keystones.map((k, j) => new Promise<void>((res) => {
        const ks = this.nodes.get(k)!;
        gsap.delayedCall(j * 0.12, () => {
          relight(ks, j);
          this.shockRing(ks.x, ks.y, ks.r, ks.r * 3.5, ks.color, 0.8);
          audio.trace(j);
          this.startTrace(this.pathSegs(k), {
            color: ks.color, size: 1.6, vmax: 620, accel: 700,
            onSeg: (i, at, e) => {
              gsap.to(e, { dim: 0, duration: 0.3 }); // the branch it just ran along stays lit
              if (at !== core) relight(at, i + j);
            },
            onDone: res,
          });
        });
      })));
    }

    // 3 ─ the seed gathers the light: it swells while sparks spiral in from the dark
    audio.awaken();
    gsap.to(core, { punch: 1.9, duration: 1.4, ease: 'power2.in' });
    gsap.to(core, { flash: 2.2 * fs, duration: 1.4, ease: 'power2.in' });
    gsap.to(core, { light: 300, duration: 1.4, ease: 'power2.in' });
    if (!reduced) {
      for (let k = 0; k < 12; k++) {
        gsap.delayedCall(k * 0.1, () => {
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * TAU + k * 0.4;
            const R = rand(520, 760);
            const life = 1.3 - k * 0.1; // every wave converges on the seed just as it bursts
            this.fx.emit({
              x: Math.cos(a) * R, y: Math.sin(a) * R, texture: tex.spark, count: 1,
              color: [this.tree.id === 'crown' ? 0xd8ccff : 0xffe6a8, 0xffffff, pick(branchColors)],
              angle: [a + Math.PI + 0.28, a + Math.PI + 0.32], speed: [R / life, R / life], life: [life, life],
              size: [0.35, 0.5], sizeEnd: 0.6, drag: 0, stretch: 0.0018, alpha: 0.9,
            });
          }
        });
      }
    }
    await wait(1.4);

    // 4 ─ dawn: the seed bursts and its light dissolves the darkness for good
    this.game.flash(1, 0.12, 1.8);
    this.game.shake.add(0.9);
    this.shockwave(0, 0, 40, 1.8);
    this.fx.emit({ x: 0, y: 0, texture: tex.spark, count: 260, color: [0xffffff, this.tree.id === 'crown' ? 0xe0d6ff : 0xffe0a0, ...branchColors], speed: [300, 1500], life: [0.6, 1.8], size: [0.4, 0.9], drag: 1.6, stretch: 0.0025 });
    this.fx.emit({ x: 0, y: 0, texture: tex.star4, count: 80, color: [0xffffff, 0xffe0a0], speed: [60, 600], life: [1, 2.4], size: [0.3, 0.7], spin: [-3, 3], drag: 1.2 });
    for (let i = 0; i < 4; i++) gsap.delayedCall(i * 0.15, () => this.shockRing(0, 0, 60, 900 + i * 300, pick([0xffffff, 0xffe0a0, 0xfff6dd]), 1.6, 0.8));
    gsap.fromTo(this, { dawnR: 0 }, { dawnR: 4600, duration: 2.8, ease: 'power2.out' });
    gsap.to(this, { darkAlpha: 0, duration: 2.4, delay: 1.2, ease: 'power2.inOut' });
    // nodes flare as the dawn passes over them
    for (const n of lit) {
      if (n === core) continue;
      const d = Math.hypot(n.x, n.y);
      const delay = 2.8 * (1 - Math.sqrt(1 - Math.min(1, d / 4600))); // inverse of power2.out
      gsap.delayedCall(delay, () => {
        gsap.to(n, { dim: 0, duration: 0.4 });
        gsap.fromTo(n, { flareBoost: 2 }, { flareBoost: 1, duration: 1.2, ease: 'expo.out' });
        for (const e of this.edges) if (e.to === n && e.dim > 0) gsap.to(e, { dim: 0, duration: 0.5 });
        gsap.fromTo(n, { flash: 1 * fs }, { flash: 0, duration: 0.9 });
        gsap.fromTo(n, { punch: 1.3 }, { punch: 1, duration: 0.8, ease: 'elastic.out(1, 0.35)' });
        gsap.to(n, { light: this.lightTargetOf(n) * 1.2, duration: 0.8, ease: 'expo.out' });
      });
    }
    for (const e of this.edges) if (e.state === 'active') for (let k = 0; k < 3; k++) this.spawnPulse(e, 1 - k * 0.3, 700);
    gsap.to(core, { punch: 1, flash: 0, duration: 2.2, ease: 'elastic.out(1, 0.4)' });
    gsap.to(this.pulseLayer, { alpha: 1, duration: 1 });
    this.sync();
    await wait(2.6);

    // the void stays lit from now on
    for (const n of lit) { n.lightHold = false; n.dim = 0; }
    for (const e of this.edges) e.dim = 0;
    this.darkHold = false;
    this.darkTarget = 0;
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

    // darkness and the light each node casts into it
    if (!this.darkHold) this.darkAlpha += (this.darkTarget - this.darkAlpha) * Math.min(1, dt * 3);
    this.darkLayer.visible = this.darkAlpha > 0.005;
    if (this.darkLayer.visible) {
      this.darkRect.alpha = this.darkAlpha;
      const amb = this.game.motion.ambient;
      for (const [nv, sp] of this.lightSprites) {
        if (!nv.lightHold) nv.light += (this.lightTargetOf(nv) - nv.light) * Math.min(1, dt * 4);
        const flicker = amb ? 1 + Math.sin(t * 1.3 + nv.x * 0.01) * 0.035 : 1;
        sp.scale.set(((nv.light * 2) / 256) * flicker);
        sp.alpha = this.lightStrength(nv);
        sp.visible = nv.light > 1;
      }
      this.dawn.scale.set((this.dawnR * 2) / 256);
      this.dawn.visible = this.dawnR > 1;
    }
    this.updateTraces(dt);
    // the woven strands sway; only branches on screen are updated
    const hw = this.cam.w / 2 / this.cam.zoom, hh = this.cam.h / 2 / this.cam.zoom;
    const view = { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
    const amb = this.game.motion.ambient;
    for (const e of this.edges) {
      e.tick(dt);
      e.animate(t, amb, view);
      if (e.state === 'active' && e.grow >= 1 && amb) {
        e.pulseTimer -= dt;
        if (e.pulseTimer <= 0) {
          e.pulseTimer = rand(1.4, 3.2) * (this.prog.awakened ? 0.4 : 1);
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
    if (this.ambientT <= 0 && this.game.motion.ambient) {
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
    this.game.tooltip.refresh();
  }

  /** World position of a node on screen (tips point at nodes), or null while it is not shown. */
  nodeOnScreen(id: string): { x: number; y: number; r: number } | null {
    const nv = this.nodes.get(id);
    if (!nv || !nv.visible || !this.view.visible) return null;
    const p = this.cam.worldToScreen(nv.x, nv.y);
    return { x: p.x, y: p.y, r: nv.r * this.cam.zoom };
  }

  // ───────────────────────────────────────────── unweaving
  private tryUnweave(nv: NodeView) {
    if (!this.tree.light || nv.def.kind === 'core') return;
    const res = this.game.unweaveNode(nv.def.id);
    if (!res.ok) {
      if (res.reason !== 'fixed') this.deny(nv);
      return;
    }
    this.darken(nv, res);
  }

  /** A star goes dark: its light collapses inward, the refund runs home to the root. */
  private darken(nv: NodeView, res: Extract<UnweaveResult, { ok: true }>) {
    const tex = textures();
    const reduced = this.game.state.settings.reducedMotion;
    const { x, y, r, color } = nv;
    const segs = this.pathSegs(nv.def.id);
    this.sync();
    this.showTooltip();
    audio.deny();
    gsap.delayedCall(0.12, () => audio.reveal(1));
    gsap.fromTo(nv, { punch: 1.25 }, { punch: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    this.shockRing(x, y, r * 3, r * 0.6, color, 0.5, 0.6);
    if (!reduced) {
      // sparks fall inward and go out
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        const R = r * 3.2;
        this.fx.emit({ x: x + Math.cos(a) * R, y: y + Math.sin(a) * R, texture: tex.spark, count: 1, color: [color, 0xffffff], angle: [a + Math.PI - 0.05, a + Math.PI + 0.05], speed: [R / 0.4, R / 0.4], life: [0.4, 0.4], size: [0.3, 0.45], sizeEnd: 0, drag: 0, stretch: 0.003 });
      }
      this.startTrace(segs, { color: this.tree.id === 'crown' ? 0xd8ccff : 0xffd77a, size: 0.6, vmax: 1700, accel: 6000 });
    }
    const parts: string[] = [];
    if (res.refund.lumen) parts.push(`+${fmt(res.refund.lumen)}`);
    if (res.refund.prism) parts.push(`+${fmt(res.refund.prism)}◆`);
    if (parts.length) this.floatText(x, y - r - 18, parts.join('  '), 0xd8e0ff, 17);
  }
}
