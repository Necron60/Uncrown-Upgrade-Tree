import gsap from 'gsap';
import { Application, BitmapFont, Container, Filter } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters/advanced-bloom';
import { loadGame, newGame, saveGame, wipeSave, type GameState } from '../core/state';
import { hexToCss } from '../core/math';
import { NODES, NODE_MAP, PRISM_COLOR } from '../data/tree';
import { Background } from '../render/background';
import { Shake } from '../render/shake';
import { textures } from '../render/textures';
import { audio } from '../systems/audio';
import { anyAffordable, buy, statsFor, type BuyResult } from '../systems/tree-logic';
import { HarvestScene } from '../scenes/HarvestScene';
import { TreeScene } from '../scenes/TreeScene';
import { Ending, HarvestHud, SettingsPanel, Summary, Tooltip, TreeHud, colorOf, type RunResult } from '../ui/ui';

type Mode = 'tree' | 'transition' | 'harvest' | 'summary' | 'finale';

// Pixi renders filters at resolution 1 without antialiasing by default. The bloom filter wraps
// the whole scene, so on HiDPI screens everything came out at half resolution and jagged.
Filter.defaultOptions.resolution = 'inherit';
Filter.defaultOptions.antialias = 'inherit';

export class Game {
  readonly app = new Application();
  state: GameState;
  bg!: Background;
  tree!: TreeScene;
  harvest: HarvestScene | null = null;
  hud!: TreeHud;
  tooltip!: Tooltip;
  hhud!: HarvestHud;
  summary!: Summary;
  settings!: SettingsPanel;
  ending!: Ending;
  readonly shake = new Shake(12, 0.012, 1.5);
  canvas!: HTMLCanvasElement;
  private sceneRoot = new Container();
  private bloom: AdvancedBloomFilter | null = null;
  private mode: Mode = 'tree';
  private saveT = 0;
  private prevVolume = 0.7;
  private params = new URLSearchParams(location.search);

  constructor() {
    if (this.params.has('fresh')) wipeSave();
    this.state = loadGame();
    if (this.params.has('dev')) {
      this.state.lumen += 5e6;
      this.state.prism += 5e3;
    }
    if (this.params.has('lowfx')) this.state.settings.quality = 'low';
    if (this.params.has('ownall')) {
      for (const n of NODES) if (n.kind !== 'awaken') this.state.levels[n.id] = n.maxLevel;
    }
  }

  async init() {
    await Promise.all([
      document.fonts.load('600 20px "IBM Plex Mono"'),
      document.fonts.load('500 20px "IBM Plex Mono"'),
      document.fonts.load('italic 600 20px "Cormorant Garamond"'),
      document.fonts.load('500 20px "Cormorant Garamond"'),
    ]).catch(() => undefined);

    await this.app.init({
      resizeTo: window,
      antialias: true,
      backgroundAlpha: 0,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    this.canvas = this.app.canvas;
    document.getElementById('stage')!.appendChild(this.canvas);

    BitmapFont.install({
      name: 'dmg',
      style: { fontFamily: 'IBM Plex Mono', fontSize: 44, fontWeight: '600', fill: 0xffffff, stroke: { color: 0x07060e, width: 7, join: 'round' } },
      chars: [['0', '9'], ['A', 'Z'], '.+-!×◆ ', ['a', 'z']],
      resolution: 2,
    });
    textures();

    this.bg = new Background();
    this.app.stage.addChild(this.sceneRoot);
    this.sceneRoot.addChild(this.bg.view);
    this.sceneRoot.filterArea = this.app.screen;
    this.tree = new TreeScene(this);
    this.sceneRoot.addChild(this.tree.view);

    const ui = document.getElementById('ui')!;
    this.hud = new TreeHud(ui);
    this.tooltip = new Tooltip(ui);
    this.hhud = new HarvestHud(ui);
    this.summary = new Summary(ui);
    this.settings = new SettingsPanel(ui);
    this.ending = new Ending(ui);
    this.wireUi();

    this.applySettings();
    this.resize();
    this.app.renderer.on('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    window.addEventListener('beforeunload', () => this.save());

    this.tree.enter(false);
    // open with a slow zoom-in onto the seed
    const z = this.tree.fitZoom();
    this.tree.cam.set(0, 34 / z, z * 0.6, true);
    this.tree.recenter();
    this.hud.sync(this.state, false, !anyAffordable(this.state));

    // dtcap lets automated tests run in (near) real time on slow software renderers
    const cap = parseFloat(this.params.get('dtcap') ?? '') || 1 / 20;
    if (this.params.has('dtcap')) gsap.ticker.lagSmoothing(0); // tests: UI tweens follow real time too
    this.app.ticker.add((tk) => this.update(Math.min(tk.deltaMS / 1000, cap)));

    const boot = document.getElementById('boot')!;
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 1000);
    gsap.from(this.hud.root.querySelectorAll('.hud-tl, .hud-tr, .chip, .hud-bottom'), { y: -16, opacity: 0, stagger: 0.08, duration: 0.7, delay: 0.3, ease: 'power3.out' });
  }

  // ───────────────────────────────────────────── ui wiring
  private wireUi() {
    const unlockAudio = () => audio.unlock();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    this.hud.harvestBtn.addEventListener('click', () => { audio.click(); void this.startHarvest(); });
    this.hud.centerBtn.addEventListener('click', () => { audio.click(); this.tree.recenter(); });
    this.hud.settingsBtn.addEventListener('click', () => { audio.click(); this.settings.show(this.state); });
    this.hud.muteBtn.addEventListener('click', () => this.toggleMute());
    this.hud.awakenBtn.addEventListener('click', () => void this.awaken());
    this.summary.onContinue = () => void this.leaveHarvest(false);
    this.summary.onAgain = () => void this.leaveHarvest(true);
    this.settings.onChange = () => { this.applySettings(); this.save(); };
    this.settings.onReset = () => {
      wipeSave();
      this.state = newGame();
      saveGame(this.state);
      location.reload();
    };
    this.ending.onContinue = () => {
      this.mode = 'tree';
      this.tree.inputEnabled = true;
      this.hud.show(true);
      this.hud.sync(this.state);
    };
  }

  private applySettings() {
    const s = this.state.settings;
    audio.setVolume(s.volume);
    this.hud.setMuted(s.volume <= 0);
    this.shake.enabled = s.shake && !s.reducedMotion;
    if (s.quality === 'high') {
      this.bloom ??= new AdvancedBloomFilter({ threshold: 0.5, bloomScale: 0.8, brightness: 1, blur: 7, quality: 5 });
      this.sceneRoot.filters = [this.bloom];
    } else {
      this.sceneRoot.filters = [];
    }
  }

  private toggleMute() {
    const s = this.state.settings;
    if (s.volume > 0) {
      this.prevVolume = s.volume;
      s.volume = 0;
    } else {
      s.volume = this.prevVolume || 0.7;
      audio.unlock();
    }
    this.applySettings();
    this.save();
  }

  private onKey(e: KeyboardEvent) {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (this.settings.open) {
      if (k === 'escape') this.settings.hide();
      return;
    }
    if (this.mode === 'tree') {
      if (k === ' ' || k === 'enter') { e.preventDefault(); void this.startHarvest(); }
      else if (k === 'c') this.tree.recenter();
      else if (k === 'm') this.toggleMute();
      else if (k === 'l' && this.params.has('dev')) { this.state.lumen += 1e5; this.state.prism += 50; this.walletChanged(); }
    } else if (this.mode === 'harvest') {
      if (k === 'escape') this.harvest?.forceEnd();
    } else if (this.mode === 'summary' && this.summary.isOpen) {
      if (k === ' ' || k === 'enter') { e.preventDefault(); void this.leaveHarvest(false); }
      else if (k === 'r') void this.leaveHarvest(true);
    }
  }

  private resize() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.bg.resize(w, h);
    this.tree.resize(w, h);
    this.harvest?.resize(w, h);
  }

  // ───────────────────────────────────────────── helpers
  flash(peak = 1, inDur = 0.2, outDur = 0.5, color = '#f4f7ff') {
    const el = document.getElementById('flash')!;
    el.style.background = color;
    gsap.killTweensOf(el);
    gsap.timeline().to(el, { opacity: peak, duration: inDur, ease: 'power2.in' }).to(el, { opacity: 0, duration: outDur, ease: 'power2.out' });
  }

  save() {
    saveGame(this.state);
  }

  private walletChanged() {
    this.hud.sync(this.state, true, !anyAffordable(this.state));
    this.tree.onWalletChanged();
  }

  // ───────────────────────────────────────────── tree actions
  buyNode(id: string): BuyResult {
    const def = NODE_MAP[id];
    const res = buy(def, this.state);
    if (res.ok) {
      this.save();
      this.hud.sync(this.state, true, !anyAffordable(this.state));
      this.hud.lumen.bump(1.1);
      if (res.newLevel === 1 && (def.kind === 'major' || def.kind === 'synergy' || def.kind === 'keystone')) {
        const label = def.kind === 'keystone' ? 'a keystone awakens' : def.kind === 'synergy' ? 'a synergy forms' : 'a new power';
        this.hud.toast(`<span>${label}</span><b>${def.name}</b>`, colorOf(def));
      }
      this.tooltip.refresh(this.state);
    }
    return res;
  }

  async awaken() {
    if (this.mode !== 'tree') return;
    const res = buy(NODE_MAP.awaken, this.state);
    if (!res.ok) {
      audio.deny();
      return;
    }
    this.state.awakened = true;
    this.save();
    this.mode = 'finale';
    this.hud.show(false);
    this.tooltip.hide();
    await this.tree.awakenSequence();
    this.ending.show(this.state);
  }

  // ───────────────────────────────────────────── harvest flow
  async startHarvest() {
    if (this.mode !== 'tree') return;
    this.mode = 'transition';
    audio.unlock();
    this.tooltip.hide();
    this.hud.show(false);
    this.tree.inputEnabled = false;
    const reduced = this.state.settings.reducedMotion;
    const dur = reduced ? 0.25 : 0.75;
    const el = document.getElementById('flash')!;
    el.style.background = '#eaf6ff';
    gsap.killTweensOf(el);
    gsap.to(el, { opacity: 1, duration: dur * 0.6, delay: dur * 0.4, ease: 'power2.in' });
    await this.tree.diveIn(dur);
    this.tree.exit();
    this.beginRun();
  }

  private beginRun() {
    const stats = statsFor(this.state.levels);
    const h = new HarvestScene(this, stats);
    this.harvest = h;
    h.resize(this.app.screen.width, this.app.screen.height);
    this.sceneRoot.addChild(h.view);
    h.onEnd = (r) => this.onRunEnd(r);
    document.body.classList.add('harvest');
    this.hhud.show(true, stats.comboPerKill > 0, stats.prismChance > 0 || stats.heart > 0);
    this.hhud.setTimer(stats.duration, stats.duration, false);
    h.start();
    const el = document.getElementById('flash')!;
    gsap.to(el, { opacity: 0, duration: 0.6, ease: 'power2.out' });
    this.mode = 'harvest';
  }

  private onRunEnd(r: RunResult) {
    const s = this.state;
    const L = s.lifetime;
    const firstPrism = s.prism === 0 && L.prismEarned === 0 && r.prism > 0;
    s.lumen += r.lumen;
    s.prism += r.prism;
    L.runs++;
    L.shardsBroken += r.kills;
    L.lumenEarned += r.lumen;
    L.prismEarned += r.prism;
    L.bestCombo = Math.max(L.bestCombo, r.bestCombo);
    const record = r.lumen > L.bestRun && L.runs > 1;
    L.bestRun = Math.max(L.bestRun, r.lumen);
    this.save();
    document.body.classList.remove('harvest');
    this.mode = 'summary';
    this.summary.show(r, record, s.lumen, L.runs);
    if (firstPrism) {
      gsap.delayedCall(1.4, () => this.hud.toast(`<span>you found</span><b>Prism</b><span>the rarest light</span>`, hexToCss(PRISM_COLOR), 3.5));
    }
  }

  private async leaveHarvest(again: boolean) {
    if (this.mode !== 'summary') return;
    this.mode = 'transition';
    audio.click();
    await this.summary.hide();
    const el = document.getElementById('flash')!;
    el.style.background = '#eaf6ff';
    gsap.killTweensOf(el);
    await new Promise<void>((res) => gsap.to(el, { opacity: 1, duration: 0.22, ease: 'power2.in', onComplete: res }));
    this.harvest?.destroy();
    this.harvest = null;
    if (again) {
      this.beginRun();
      return;
    }
    this.hhud.show(false);
    this.tree.enter(true);
    this.tree.inputEnabled = true;
    this.hud.show(true);
    // count the currency up from its pre-run value for a satisfying payoff
    this.hud.sync(this.state, true, !anyAffordable(this.state));
    gsap.to(el, { opacity: 0, duration: 0.7, ease: 'power2.out' });
    this.mode = 'tree';
    if (this.state.lifetime.runs === 1) {
      gsap.delayedCall(1, () => this.hud.toast(`<span>spend your</span><b>Lumen</b><span>on a lit node to grow the Bloom</span>`, 'var(--gold)', 4));
    }
  }

  // ───────────────────────────────────────────── loop
  private update(dt: number) {
    const s = this.state;
    if (!document.hidden) s.lifetime.playTime += dt;
    this.saveT += dt;
    if (this.saveT > 15) {
      this.saveT = 0;
      this.save();
    }
    const cam = this.tree.cam;
    if (this.mode === 'harvest' || (this.harvest && this.mode !== 'tree')) {
      this.bg.update(dt, cam.x * 0.2, cam.y * 0.2 + performance.now() * 0.004, 1);
    } else {
      this.bg.update(dt, cam.x, cam.y, cam.zoom);
    }
    this.tree.update(dt);
    this.harvest?.update(dt);
    this.shake.update(dt);
    this.tree.view.position.set(this.shake.x, this.shake.y);
  }
}

