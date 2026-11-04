import gsap from 'gsap';
import { Application, BitmapFont, Container, Filter } from 'pixi.js';
import { HalfResBloom, type BloomOptions } from '../render/bloom';
import { effectiveMotion, loadGame, newGame, progressOf, saveGame, wipeSave, type Bloom, type GameState, type Motion, type TreeProgress } from '../core/state';
import { fmt } from '../core/format';
import type { TreeDef, TreeId, TrialDef } from '../data/tree';
import { TREES } from '../data/trees';
import { Background } from '../render/background';
import { Shake } from '../render/shake';
import { textures } from '../render/textures';
import { audio } from '../systems/audio';
import { boot } from '../ui/boot';
import {
  anyAffordable, buy, currentTrial, sealedBy, statsFor, trialProgress, unweave, type BuyResult, type UnweaveResult,
} from '../systems/tree-logic';
import { HarvestScene } from '../scenes/HarvestScene';
import { TreeScene } from '../scenes/TreeScene';
import { NodeView } from '../scenes/tree/NodeView';
import { Ending, HarvestHud, SettingsPanel, Summary, Tooltip, TreeHud, TreePicker, colorOf, h, roman, type RunResult, type SettingsTab } from '../ui/ui';
import { Tips } from '../ui/tips';
import { cloud } from '../core/cloud';

type Mode = 'tree' | 'transition' | 'harvest' | 'summary' | 'finale';

// Pixi renders filters at resolution 1 without antialiasing by default. The bloom filter wraps
// the whole scene, so on HiDPI screens everything came out at half resolution and jagged.
Filter.defaultOptions.resolution = 'inherit';
Filter.defaultOptions.antialias = 'inherit';

const HARVEST_MUSIC = { full: 1, soft: 0.4, off: 0 } as const;
const PARTICLE_DENSITY = { low: 0.35, medium: 0.65, high: 1 } as const;
const BLOOM_OPTIONS: Record<Exclude<Bloom, 'off'>, BloomOptions> = {
  // a high threshold keeps the glow on genuinely bright things (cores, sparks), not on whole regions
  soft: { threshold: 0.7, bloomScale: 0.4, blur: 5, quality: 4 },
  full: { threshold: 0.62, bloomScale: 0.62, blur: 7, quality: 5 },
};

export class Game {
  readonly app = new Application();
  state: GameState;
  bg!: Background;
  /** one scene per tree, made the first time that tree is shown */
  private scenes = new Map<TreeId, TreeScene>();
  harvest: HarvestScene | null = null;
  picker!: TreePicker;
  tips!: Tips;
  /** the trial the current harvest is trying for */
  private runTrial: TrialDef | null = null;
  /** a trial passed in the last harvest: its gate opens on the way back to the tree */
  private pendingGate: TrialDef | null = null;
  hud!: TreeHud;
  tooltip!: Tooltip;
  hhud!: HarvestHud;
  summary!: Summary;
  settings!: SettingsPanel;
  ending!: Ending;
  readonly shake = new Shake(12, 0.012, 1.5);
  canvas!: HTMLCanvasElement;
  private sceneRoot = new Container();
  private blooms: Partial<Record<Bloom, HalfResBloom>> = {};
  private mode: Mode = 'tree';
  private saveT = 0;
  private prevVolume = 0.7;
  private params = new URLSearchParams(location.search);
  private fpsEl = h('div', 'fps num');
  private fpsT = 0;
  private bgDrift = 0;

  constructor() {
    if (this.params.has('fresh')) wipeSave();
    this.state = loadGame();
    if (this.params.has('dev')) {
      this.state.lumen += 5e6;
      this.state.prism += 5e3;
    }
    if (this.params.has('dev')) {
      this.state.crown.lumen += 5e6;
      this.state.crown.prism += 5e3;
    }
    if (this.params.has('lowfx')) this.state.settings.bloom = 'off';
    // test/dev shortcuts: ?crown opens the Hollow Crown, ?trials passes its trials
    if (this.params.has('crown')) this.state.active = 'crown';
    if (this.params.has('trials')) this.state.crown.trials = (TREES.crown.trials ?? []).map((t) => t.id);
    if (this.params.has('ownall')) {
      const tree = TREES[this.state.active];
      const p = progressOf(this.state, this.state.active);
      for (const n of tree.nodes) if (n.kind !== 'awaken' && !sealedBy(tree, n, p.levels)) p.levels[n.id] = n.maxLevel;
    }
  }

  /** the tree on screen */
  get def(): TreeDef {
    return TREES[this.state.active];
  }

  /** its progress */
  get prog(): TreeProgress {
    return progressOf(this.state, this.state.active);
  }

  /** the scene of the tree on screen */
  get tree(): TreeScene {
    return this.sceneFor(this.state.active);
  }

  private sceneFor(id: TreeId): TreeScene {
    let sc = this.scenes.get(id);
    if (!sc) {
      sc = new TreeScene(this, TREES[id]);
      sc.view.visible = false;
      this.sceneRoot.addChildAt(sc.view, this.sceneRoot.getChildIndex(this.bg.view) + 1);
      sc.resize(this.app.screen.width, this.app.screen.height);
      this.scenes.set(id, sc);
      this.applyTreeSettings(sc);
    }
    return sc;
  }

  /** The Hollow Crown opens once the Bloom has awakened. */
  isOpen(id: TreeId): boolean {
    if (id === 'bloom') return true;
    return this.state.awakened || this.state.crown.runs > 0 || this.params.has('crown');
  }

  private get canPick(): boolean {
    return this.isOpen('crown');
  }

  /** Motion settings as they apply right now (reduced motion overrides the individual ones). */
  get motion(): Motion {
    return effectiveMotion(this.state.settings);
  }

  get particleDensity(): number {
    return PARTICLE_DENSITY[this.state.settings.particles];
  }

  async init() {
    // startup phases are timed with performance marks (visible in DevTools → Performance)
    let last = 'start';
    performance.mark('init:start');
    // each finished phase moves the loading screen on and names the next one
    const NEXT: Record<string, [number, string]> = {
      renderer: [0.4, 'loading type'],
      fonts: [0.5, 'cutting crystals'],
      textures: [0.62, 'growing the Bloom'],
      scenes: [0.76, 'tuning the stars'],
      ui: [0.9, 'first light'],
    };
    const phase = async (name: string) => {
      performance.mark(`init:${name}`);
      performance.measure(`init ${name}`, `init:${last}`, `init:${name}`);
      last = name;
      const next = NEXT[name];
      if (next) boot.step(...next);
      // hand the browser a moment between phases: the loading screen can paint, and startup is no
      // longer one long blocking task
      await new Promise((r) => setTimeout(r, 0));
    };
    boot.step(0.24, 'waking the renderer');
    // fonts download while the renderer starts; only canvas text further down needs them
    const fonts = Promise.all([
      document.fonts.load('600 20px "IBM Plex Mono"'),
      document.fonts.load('500 20px "IBM Plex Mono"'),
      document.fonts.load('italic 600 20px "Cormorant Garamond"'),
      document.fonts.load('500 20px "Cormorant Garamond"'),
    ]).catch(() => undefined);

    await this.app.init({
      resizeTo: window,
      antialias: true,
      backgroundAlpha: 0,
      resolution: this.renderResolution(),
      autoDensity: true,
      preference: 'webgl',
      powerPreference: 'high-performance',
      // input is handled with plain DOM events, so Pixi's per-pointer-move hit testing is pure overhead
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
    });
    this.canvas = this.app.canvas;
    document.getElementById('stage')!.appendChild(this.canvas);
    await phase('renderer');
    await fonts;
    await phase('fonts');
    textures();
    await phase('textures');

    this.bg = new Background(this.app.renderer);
    this.app.stage.addChild(this.sceneRoot);
    this.sceneRoot.addChild(this.bg.view);
    this.sceneRoot.filterArea = this.app.screen;
    this.bg.setBranches(this.def);
    this.tree.view.visible = true;
    document.body.classList.toggle('tree-crown', this.state.active === 'crown');
    await phase('scenes');

    const ui = document.getElementById('ui')!;
    this.hud = new TreeHud(ui);
    this.tooltip = new Tooltip(ui);
    this.hhud = new HarvestHud(ui);
    this.summary = new Summary(ui);
    this.settings = new SettingsPanel(ui);
    this.ending = new Ending(ui);
    this.picker = new TreePicker(ui);
    this.tips = new Tips(ui);
    ui.append(this.fpsEl);
    this.wireUi();

    this.applySettings();
    this.resize();
    this.app.renderer.on('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.save();
        cloud.flush();
      }
      if (this.state.settings.muteHidden) audio.setSuspended(document.hidden);
    });
    window.addEventListener('beforeunload', () => {
      this.save();
      cloud.flush();
    });

    this.tree.enter(false);
    const z = this.tree.fitZoom();
    if (this.motion.cameraFx) {
      // open with a slow zoom-in onto the seed
      this.tree.cam.set(0, 34 / z, z * 0.6, true);
      this.tree.recenter();
    } else {
      this.tree.recenter(true);
    }
    this.syncHud(false);
    this.tips.bind(() => ({
      state: this.state, tree: this.def, p: this.prog,
      nodeAt: (id) => this.tree.nodeOnScreen(id),
      el: { light: this.hud.lightPill, prism: this.hud.prismPill, trial: this.hud.trial, awaken: this.hud.awakenBtn, harvest: this.hud.harvestBtn, chip: this.hud.chip },
    }));
    gsap.delayedCall(2.2, () => this.tips.check());
    await phase('ui');
    this.app.renderer.render(this.app.stage); // first frame: uploads textures, compiles shaders
    await phase('first-frame');

    // dtcap lets automated tests run in (near) real time on slow software renderers
    const cap = parseFloat(this.params.get('dtcap') ?? '') || 1 / 20;
    if (this.params.has('dtcap')) gsap.ticker.lagSmoothing(0); // tests: UI tweens follow real time too
    // timescale slows everything down so tests can photograph fast animations mid-flight
    const ts = parseFloat(this.params.get('timescale') ?? '') || 1;
    if (ts !== 1) gsap.globalTimeline.timeScale(ts);
    this.app.ticker.add((tk) => this.update(Math.min(tk.deltaMS / 1000, cap) * ts));

    void boot.reveal();
    // the damage-number font is only needed in a harvest: build it once the tree is up
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    idle(() => this.ensureDamageFont());
    // as the loading screen's iris opens. clearProps hands the transform back to the stylesheet afterwards: the chip and
    // the bottom bar are centred with translateX(-50%), which a frozen pixel offset would break once their width changes
    gsap.from(this.hud.root.querySelectorAll('.hud-tl, .hud-tr, .chip, .hud-bottom'), { y: -16, opacity: 0, stagger: 0.08, duration: 0.7, delay: 0.75, ease: 'power3.out', clearProps: 'transform' });
  }

  // ───────────────────────────────────────────── ui wiring
  private wireUi() {
    const unlockAudio = () => audio.unlock();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    this.hud.harvestBtn.addEventListener('click', () => { audio.click(); void this.startHarvest(); });
    this.hud.centerBtn.addEventListener('click', () => { audio.click(); this.tree.recenter(); });
    this.hud.settingsBtn.addEventListener('click', () => { audio.click(); this.openSettings(); });
    this.hhud.settingsBtn.addEventListener('click', () => { audio.click(); this.openSettings(); });
    this.hud.muteBtn.addEventListener('click', () => this.toggleMute());
    this.hud.awakenBtn.addEventListener('click', () => void this.awaken());
    this.hud.chip.addEventListener('click', () => {
      if (!this.canPick || this.mode !== 'tree') return;
      audio.click();
      this.tips.hide();
      this.picker.show(this.state, (id) => this.isOpen(id));
    });
    this.picker.onPick = (id) => void this.switchTree(id);
    this.summary.onContinue = () => void this.leaveHarvest(false);
    this.summary.onAgain = () => void this.leaveHarvest(true);
    this.settings.onChange = () => { this.applySettings(); this.save(); };
    this.settings.onReset = () => {
      wipeSave();
      this.state = newGame();
      saveGame(this.state);
      // the cloud copy has more progress, so it would win at the next boot unless it is overwritten too
      void cloud.replace(this.state).finally(() => location.reload());
    };
    this.hud.accountBtn.addEventListener('click', () => {
      audio.click();
      if (cloud.status === 'signed-out') location.href = '/api/login';
      else this.openSettings('account');
    });
    cloud.onChange = () => {
      this.hud.setAccount(cloud);
      this.settings.refreshAccount();
      if (cloud.status === 'behind') this.hud.toast('<span>newer progress is saved from</span><b>another device</b><span>reload to continue it</span>', 'var(--accent)', 6);
    };
    this.hud.setAccount(cloud);
    const loginError = this.params.get('error');
    if (loginError) {
      this.hud.toast(`<span>Discord</span><b>${loginError.replace(/[<>&]/g, '')}</b>`, 'var(--bad)', 5);
      history.replaceState(null, '', location.pathname);
    }
    this.ending.onContinue = (onward) => {
      this.mode = 'tree';
      this.tree.inputEnabled = true;
      if (onward) {
        void this.switchTree('crown');
        return;
      }
      this.hud.show(true);
      this.syncHud();
      this.tips.check();
    };
  }

  /** Bring the tree HUD in line with the state. */
  private syncHud(animate = true) {
    this.hud.sync(this.state, this.def, animate, !anyAffordable(this.def, this.prog), this.canPick);
  }

  /** Travel to another tree: the dark closes over this one and opens on the other. */
  async switchTree(id: TreeId) {
    if (this.mode !== 'tree' || id === this.state.active || !this.isOpen(id)) return;
    this.mode = 'transition';
    this.tips.hide();
    this.tooltip.hide();
    this.hud.show(false);
    this.tree.inputEnabled = false;
    const el = document.getElementById('flash')!;
    gsap.killTweensOf(el);
    el.style.background = '#05050b';
    el.style.mixBlendMode = 'normal';
    const quick = !this.motion.cameraFx;
    if (!quick) {
      const cam = this.tree.cam;
      cam.locked = true;
      gsap.to(cam, { zoom: cam.zoom * 0.45, duration: 0.9, ease: 'power3.in' });
    }
    await new Promise<void>((res) => gsap.to(el, { opacity: 1, duration: quick ? 0.35 : 0.8, delay: quick ? 0 : 0.2, ease: 'power2.in', onComplete: res }));
    this.tree.cam.locked = false;
    this.tree.exit();
    this.state.active = id;
    this.save();
    document.body.classList.toggle('tree-crown', id === 'crown');
    this.bg.setBranches(this.def);
    const sc = this.tree;
    this.applySettings();
    sc.enter(false);
    sc.inputEnabled = true;
    const z = sc.fitZoom();
    if (!quick) {
      sc.cam.set(0, 34 / z, z * 0.5, true);
      sc.recenter();
    } else sc.recenter(true);
    this.syncHud(false);
    audio.reveal(2);
    gsap.to(el, { opacity: 0, duration: quick ? 0.4 : 1.1, ease: 'power2.out' });
    this.hud.show(true);
    this.hud.toast(`<span>Tree ${this.def.numeral}</span><b>${this.def.name}</b>`, colorOf(this.def.map[this.def.root]), 3);
    this.mode = 'tree';
    gsap.delayedCall(1.4, () => this.tips.check());
  }

  /** From a harvest the run pauses while the panel is open, and the panel can end it early. */
  private openSettings(tab?: SettingsTab) {
    this.settings.show(this.state, this.mode === 'harvest' ? () => this.harvest?.forceEnd() : null, tab);
  }

  /** Music level for the current scene: the Music-in-the-harvest setting applies while a harvest is on screen. */
  private syncMusic() {
    audio.setMusicDuck(this.harvest ? HARVEST_MUSIC[this.state.settings.harvestMusic] : 1);
  }

  private damageFont = false;
  /** Bitmap atlas for damage numbers. Built lazily: only harvests use it. */
  private ensureDamageFont() {
    if (this.damageFont) return;
    this.damageFont = true;
    BitmapFont.install({
      name: 'dmg',
      style: { fontFamily: 'IBM Plex Mono', fontSize: 44, fontWeight: '600', fill: 0xffffff, stroke: { color: 0x07060e, width: 7, join: 'round' } },
      chars: [['0', '9'], ['A', 'Z'], '.+-!×◆ ', ['a', 'z']],
      resolution: 2,
    });
  }

  private renderResolution(): number {
    return Math.min(window.devicePixelRatio || 1, 2) * this.state.settings.resolution;
  }

  /** Push every setting to the systems that use it. Safe to call any time. */
  private applySettings() {
    const s = this.state.settings;
    const m = this.motion;

    // sound
    audio.setVolume(s.volume);
    audio.setBus('game', s.sfxVolume);
    audio.setBus('ui', s.uiVolume);
    audio.setBus('music', s.musicVolume);
    audio.setBus('gems', s.specialVolume);
    audio.setReverb(s.reverb);
    audio.setHoverSounds(s.hoverSounds);
    audio.setTrack(s.musicTrack);
    this.syncMusic();
    this.hud.setMuted(s.volume <= 0);

    // motion
    this.shake.intensity = m.shake;
    NodeView.ambient = m.ambient;
    this.bg.ambient = m.ambient;
    document.body.classList.toggle('still', !m.ambient);

    // graphics
    if (s.bloom === 'off') this.sceneRoot.filters = [];
    else this.sceneRoot.filters = [(this.blooms[s.bloom] ??= new HalfResBloom(BLOOM_OPTIONS[s.bloom]))];
    const res = this.renderResolution();
    // Multisampling the full-screen glow/darkness passes was the single biggest GPU cost (≈35 → 60 fps
    // without it on a fully grown tree). At ~2x pixel density edges look the same without it.
    const aa = s.antialias === 'on' || (s.antialias === 'auto' && res < 1.75) ? 'inherit' : 'off';
    Filter.defaultOptions.antialias = aa;
    for (const f of Object.values(this.blooms)) if (f) f.antialias = aa;
    if (Math.abs(this.app.renderer.resolution - res) > 1e-3) {
      this.app.renderer.resize(this.app.screen.width, this.app.screen.height, res);
    }
    for (const sc of this.scenes.values()) this.applyTreeSettings(sc);
    this.bg.setDetail(s.background);
    this.app.ticker.maxFPS = s.fpsCap;
    this.fpsEl.style.display = s.showFps ? '' : 'none';

    // interface
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    this.tooltip.scale = s.uiScale;
    this.tips.scale = s.uiScale;
    this.tips.enabled = s.hints;
    if (!s.hints) this.tips.hide();
    this.hud.setHints(s.hints);
  }

  /** The settings each tree scene keeps for itself. */
  private applyTreeSettings(sc: TreeScene) {
    const s = this.state.settings;
    const aa = Filter.defaultOptions.antialias === 'off' ? 'off' : 'inherit';
    sc.setFilterAntialias(aa);
    sc.setFxDensity(this.particleDensity);
    sc.setDarkness(s.darkness);
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
    if (this.picker.open) {
      if (k === 'escape') this.picker.hide();
      return;
    }
    if (this.mode === 'tree') {
      if (k === ' ' || k === 'enter') { e.preventDefault(); void this.startHarvest(); }
      else if (k === 'c') this.tree.recenter();
      else if (k === 'm') this.toggleMute();
      else if (k === 'escape') this.openSettings();
      else if (k === 'l' && this.params.has('dev')) { this.prog.lumen += 1e5; this.prog.prism += 50; this.walletChanged(); }
    } else if (this.mode === 'harvest') {
      if (k === 'escape') this.openSettings();
    } else if (this.mode === 'summary' && this.summary.isOpen) {
      if (k === ' ' || k === 'enter') { e.preventDefault(); void this.leaveHarvest(false); }
      else if (k === 'r') void this.leaveHarvest(true);
    }
  }

  private resize() {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    this.bg.resize(w, h);
    for (const sc of this.scenes.values()) sc.resize(w, h);
    this.harvest?.resize(w, h);
  }

  // ───────────────────────────────────────────── helpers
  /** A brief full-screen flash, scaled by the player's flash setting. */
  flash(peak = 1, inDur = 0.2, outDur = 0.5, color = '#f4f7ff') {
    const strength = this.motion.flashes;
    if (strength <= 0.01) return;
    const el = document.getElementById('flash')!;
    el.style.background = color;
    el.style.mixBlendMode = 'screen';
    gsap.killTweensOf(el);
    gsap.timeline().to(el, { opacity: peak * strength, duration: inDur, ease: 'power2.in' }).to(el, { opacity: 0, duration: outDur, ease: 'power2.out' });
  }

  /** The scene-change veil: a bright wash, or a gentle dip to dark when flashes are turned down. */
  private veil(): HTMLElement {
    const el = document.getElementById('flash')!;
    const bright = this.motion.flashes >= 0.5;
    el.style.background = bright ? '#eaf6ff' : '#05050b';
    el.style.mixBlendMode = bright ? 'screen' : 'normal';
    gsap.killTweensOf(el);
    return el;
  }

  save() {
    saveGame(this.state);
    cloud.push(this.state);
  }

  private walletChanged() {
    this.syncHud();
    this.tree.onWalletChanged();
  }

  // ───────────────────────────────────────────── tree actions
  buyNode(id: string): BuyResult {
    const def = this.def.map[id];
    const res = buy(this.def, def, this.prog);
    if (res.ok) {
      this.save();
      this.syncHud();
      this.hud.lumen.bump(1.1);
      if (res.newLevel === 1 && (def.kind === 'major' || def.kind === 'synergy' || def.kind === 'keystone' || def.kind === 'curse')) {
        const label = def.kind === 'keystone' ? 'a keystone awakens' : def.kind === 'synergy' ? 'a synergy forms' : def.kind === 'curse' ? 'a curse takes hold' : 'a new power';
        this.hud.toast(`<span>${label}</span><b>${def.name}</b>`, colorOf(def));
      }
      this.tooltip.refresh();
      gsap.delayedCall(1.2, () => this.tips.check());
    } else if (res.reason === 'dark') {
      this.hud.toast(`<span>not enough</span><b>light</b><span>unweave a star, or pass the next trial</span>`, 'var(--bad)', 2.6);
      this.hud.lightPill.classList.remove('robbed');
      void this.hud.lightPill.offsetWidth;
      this.hud.lightPill.classList.add('robbed');
    }
    return res;
  }

  /** Make a lit star dark again (trees with limited light), for three quarters of its price. */
  unweaveNode(id: string): UnweaveResult {
    const def = this.def.map[id];
    const res = unweave(this.def, def, this.prog);
    if (res.ok) {
      this.save();
      this.syncHud();
      this.tooltip.refresh();
    } else if (res.reason === 'needed' && res.by) {
      this.hud.toast(`<span>${res.by.name} grows from it:</span><b>unweave that first</b>`, 'var(--bad)', 2.4);
    }
    return res;
  }

  async awaken() {
    if (this.mode !== 'tree') return;
    const def = this.def;
    const res = buy(def, def.map[def.finale], this.prog);
    if (!res.ok) {
      audio.deny();
      return;
    }
    this.prog.awakened = true;
    this.save();
    this.mode = 'finale';
    this.tips.hide();
    this.hud.show(false);
    this.tooltip.hide();
    await this.tree.awakenSequence();
    this.ending.show(this.state, def);
  }

  // ───────────────────────────────────────────── harvest flow
  async startHarvest() {
    if (this.mode !== 'tree') return;
    this.mode = 'transition';
    audio.unlock();
    this.tips.hide();
    this.tooltip.hide();
    this.hud.show(false);
    this.tree.inputEnabled = false;
    const quick = this.state.settings.reducedMotion || !this.motion.cameraFx;
    const dur = quick ? 0.35 : 0.75;
    const el = this.veil();
    gsap.to(el, { opacity: 1, duration: dur * 0.6, delay: dur * 0.4, ease: 'power2.in' });
    await this.tree.diveIn(dur);
    this.tree.exit();
    this.beginRun();
  }

  private beginRun() {
    this.ensureDamageFont();
    const def = this.def;
    const p = this.prog;
    const stats = statsFor(def, p.levels);
    this.runTrial = currentTrial(def, p);
    // the Hollow Heart rises once every ring is open
    const boss = !!def.trials?.some((t) => t.goal.kind === 'boss') && def.trials.every((t) => t.goal.kind === 'boss' || p.trials.includes(t.id));
    const hs = new HarvestScene(this, stats, {
      tree: def, depth: p.trials.length, boss, bossWounds: p.heart, trial: this.runTrial,
      seen: new Set(this.state.tips.filter((t) => t.startsWith('hz:')).map((t) => t.slice(3))),
      onSeen: (kind) => this.state.tips.push(`hz:${kind}`),
    });
    this.harvest = hs;
    hs.resize(this.app.screen.width, this.app.screen.height);
    this.sceneRoot.addChild(hs.view);
    hs.onEnd = (r) => this.onRunEnd(r);
    this.syncMusic();
    document.body.classList.add('harvest');
    this.hhud.show(true, stats.comboPerKill > 0, stats.prismChance > 0 || stats.heart > 0 || !!def.trials, def);
    this.hhud.setTimer(stats.duration, stats.duration, false);
    hs.start();
    const el = document.getElementById('flash')!;
    gsap.to(el, { opacity: 0, duration: 0.6, ease: 'power2.out' });
    this.mode = 'harvest';
  }

  private onRunEnd(r: RunResult) {
    const s = this.state;
    const p = this.prog;
    const L = s.lifetime;
    p.lumen += r.lumen;
    p.prism += r.prism;
    p.runs++;
    L.runs++;
    L.shardsBroken += r.kills;
    L.lumenEarned += r.lumen;
    L.prismEarned += r.prism;
    L.bestCombo = Math.max(L.bestCombo, r.bestCombo);
    const record = r.lumen > p.bestRun && p.runs > 1;
    p.bestRun = Math.max(p.bestRun, r.lumen);
    L.bestRun = Math.max(L.bestRun, r.lumen);
    if (r.bossWounds != null) p.heart = Math.max(p.heart, r.bossWounds);
    // trials: remember the best try; a pass opens its gate on the way back
    const t = this.runTrial;
    if (t) {
      p.trialBest[t.id] = Math.max(p.trialBest[t.id] ?? 0, trialProgress(t, r));
      if (r.trial && !p.trials.includes(t.id)) {
        p.trials.push(t.id);
        this.pendingGate = t;
      }
    }
    this.save();
    document.body.classList.remove('harvest');
    this.mode = 'summary';
    if (s.settings.skipSummary) {
      // straight back to the tree; the result is shown as an inscription instead
      gsap.delayedCall(0.2, () => void this.leaveHarvest(false, { r, record }));
    } else {
      this.summary.show(r, record, p, this.def, t);
    }
  }

  private async leaveHarvest(again: boolean, skipped?: { r: RunResult; record: boolean }) {
    if (this.mode !== 'summary') return;
    this.mode = 'transition';
    if (!skipped) audio.click();
    if (this.summary.isOpen) await this.summary.hide();
    const el = this.veil();
    await new Promise<void>((res) => gsap.to(el, { opacity: 1, duration: 0.22, ease: 'power2.in', onComplete: res }));
    this.harvest?.destroy();
    this.harvest = null;
    this.syncMusic();
    if (again) {
      this.beginRun();
      return;
    }
    this.hhud.show(false);
    const gate = this.pendingGate;
    this.pendingGate = null;
    this.tree.enter(true);
    this.tree.inputEnabled = true;
    this.hud.show(true);
    // count the currency up from its pre-run value for a satisfying payoff
    this.syncHud();
    gsap.to(el, { opacity: 0, duration: 0.7, ease: 'power2.out' });
    this.mode = 'tree';
    const def = this.def;
    if (skipped) {
      const p = skipped.r.prism > 0 ? ` · +${fmt(skipped.r.prism)} ${def.currency.prism.name}` : '';
      this.hud.toast(`<span>Harvest ${roman(this.prog.runs)}</span><b>+${fmt(skipped.r.lumen)} ${def.currency.lumen.name}${p}</b>${skipped.record ? '<span>a new record</span>' : ''}`, 'var(--gold)', 2.4);
    }
    if (gate) {
      // the gate opens once the camera has settled
      gsap.delayedCall(0.9, () => {
        if (gate.ring >= 2) this.tree.openGate(gate.ring);
        else this.tree.sync();
        this.syncHud();
        const what = gate.ring >= 2 ? `<span>a ring opens</span><b>+${gate.light} light</b>` : '<span>the crown can be broken</span>';
        this.hud.toast(`<span>${gate.name}</span>${what}`, 'var(--gold-hi)', 4);
      });
    }
    gsap.delayedCall(gate ? 3 : 1, () => this.tips.check());
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
      if (this.motion.ambient) this.bgDrift += dt * 4;
      this.bg.update(dt, cam.x * 0.2, cam.y * 0.2 + this.bgDrift, 1);
    } else {
      this.bg.update(dt, cam.x, cam.y, cam.zoom);
    }
    this.tree.update(dt);
    this.tips.update();
    if (!(this.mode === 'harvest' && this.settings.open)) this.harvest?.update(dt); // paused under the settings
    this.shake.update(dt);
    this.tree.view.position.set(this.shake.x, this.shake.y);

    if (s.settings.showFps) {
      this.fpsT -= dt;
      if (this.fpsT <= 0) {
        this.fpsT = 0.5;
        this.fpsEl.textContent = `${Math.round(this.app.ticker.FPS)} fps`;
      }
    }
  }
}
