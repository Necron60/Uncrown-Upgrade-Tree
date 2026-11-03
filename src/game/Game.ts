import gsap from 'gsap';
import { Application, BitmapFont, Container, Filter } from 'pixi.js';
import { HalfResBloom, type BloomOptions } from '../render/bloom';
import { effectiveMotion, loadGame, newGame, saveGame, wipeSave, type Bloom, type GameState, type Motion } from '../core/state';
import { hexToCss } from '../core/math';
import { fmt } from '../core/format';
import { NODES, NODE_MAP, PRISM_COLOR } from '../data/tree';
import { Background } from '../render/background';
import { Shake } from '../render/shake';
import { textures } from '../render/textures';
import { audio } from '../systems/audio';
import { anyAffordable, buy, statsFor, type BuyResult } from '../systems/tree-logic';
import { HarvestScene } from '../scenes/HarvestScene';
import { TreeScene } from '../scenes/TreeScene';
import { NodeView } from '../scenes/tree/NodeView';
import { Ending, HarvestHud, SettingsPanel, Summary, Tooltip, TreeHud, colorOf, h, roman, type RunResult, type SettingsTab } from '../ui/ui';
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
    if (this.params.has('lowfx')) this.state.settings.bloom = 'off';
    if (this.params.has('ownall')) {
      for (const n of NODES) if (n.kind !== 'awaken') this.state.levels[n.id] = n.maxLevel;
    }
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
    const phase = (name: string) => {
      performance.mark(`init:${name}`);
      performance.measure(`init ${name}`, `init:${last}`, `init:${name}`);
      last = name;
    };
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
    phase('renderer');
    await fonts;
    phase('fonts');
    textures();
    phase('textures');

    this.bg = new Background(this.app.renderer);
    this.app.stage.addChild(this.sceneRoot);
    this.sceneRoot.addChild(this.bg.view);
    this.sceneRoot.filterArea = this.app.screen;
    this.tree = new TreeScene(this);
    this.sceneRoot.addChild(this.tree.view);
    phase('scenes');

    const ui = document.getElementById('ui')!;
    this.hud = new TreeHud(ui);
    this.tooltip = new Tooltip(ui);
    this.hhud = new HarvestHud(ui);
    this.summary = new Summary(ui);
    this.settings = new SettingsPanel(ui);
    this.ending = new Ending(ui);
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
    this.hud.sync(this.state, false, !anyAffordable(this.state));
    phase('ui');
    this.app.renderer.render(this.app.stage); // first frame: uploads textures, compiles shaders
    phase('first-frame');

    // dtcap lets automated tests run in (near) real time on slow software renderers
    const cap = parseFloat(this.params.get('dtcap') ?? '') || 1 / 20;
    if (this.params.has('dtcap')) gsap.ticker.lagSmoothing(0); // tests: UI tweens follow real time too
    // timescale slows everything down so tests can photograph fast animations mid-flight
    const ts = parseFloat(this.params.get('timescale') ?? '') || 1;
    if (ts !== 1) gsap.globalTimeline.timeScale(ts);
    this.app.ticker.add((tk) => this.update(Math.min(tk.deltaMS / 1000, cap) * ts));

    const boot = document.getElementById('boot')!;
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 600);
    // the damage-number font is only needed in a harvest: build it once the tree is up
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
    idle(() => this.ensureDamageFont());
    gsap.from(this.hud.root.querySelectorAll('.hud-tl, .hud-tr, .chip, .hud-bottom'), { y: -16, opacity: 0, stagger: 0.08, duration: 0.7, delay: 0.3, ease: 'power3.out' });
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
    this.ending.onContinue = () => {
      this.mode = 'tree';
      this.tree.inputEnabled = true;
      this.hud.show(true);
      this.hud.sync(this.state);
    };
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
    this.tree.setFilterAntialias(aa);
    if (Math.abs(this.app.renderer.resolution - res) > 1e-3) {
      this.app.renderer.resize(this.app.screen.width, this.app.screen.height, res);
    }
    this.tree.setFxDensity(this.particleDensity);
    this.bg.setDetail(s.background);
    this.tree.setDarkness(s.darkness);
    this.app.ticker.maxFPS = s.fpsCap;
    this.fpsEl.style.display = s.showFps ? '' : 'none';

    // interface
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    this.tooltip.scale = s.uiScale;
    this.hud.setHints(s.hints);
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
      else if (k === 'escape') this.openSettings();
      else if (k === 'l' && this.params.has('dev')) { this.state.lumen += 1e5; this.state.prism += 50; this.walletChanged(); }
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
    this.tree.resize(w, h);
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
    const stats = statsFor(this.state.levels);
    const hs = new HarvestScene(this, stats);
    this.harvest = hs;
    hs.resize(this.app.screen.width, this.app.screen.height);
    this.sceneRoot.addChild(hs.view);
    hs.onEnd = (r) => this.onRunEnd(r);
    this.syncMusic();
    document.body.classList.add('harvest');
    this.hhud.show(true, stats.comboPerKill > 0, stats.prismChance > 0 || stats.heart > 0);
    this.hhud.setTimer(stats.duration, stats.duration, false);
    hs.start();
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
    if (s.settings.skipSummary) {
      // straight back to the tree; the result is shown as an inscription instead
      gsap.delayedCall(0.2, () => void this.leaveHarvest(false, { r, record }));
    } else {
      this.summary.show(r, record, s.lumen, L.runs);
    }
    if (firstPrism) {
      gsap.delayedCall(1.4, () => this.hud.toast(`<span>you found</span><b>Prism</b><span>the rarest light</span>`, hexToCss(PRISM_COLOR), 3.5));
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
    this.tree.enter(true);
    this.tree.inputEnabled = true;
    this.hud.show(true);
    // count the currency up from its pre-run value for a satisfying payoff
    this.hud.sync(this.state, true, !anyAffordable(this.state));
    gsap.to(el, { opacity: 0, duration: 0.7, ease: 'power2.out' });
    this.mode = 'tree';
    if (skipped) {
      const p = skipped.r.prism > 0 ? ` · +${fmt(skipped.r.prism)} prism` : '';
      this.hud.toast(`<span>Harvest ${roman(this.state.lifetime.runs)}</span><b>+${fmt(skipped.r.lumen)} lumen${p}</b>${skipped.record ? '<span>a new record</span>' : ''}`, 'var(--gold)', 2.4);
    }
    if (this.state.lifetime.runs === 1 && this.state.settings.hints) {
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
      if (this.motion.ambient) this.bgDrift += dt * 4;
      this.bg.update(dt, cam.x * 0.2, cam.y * 0.2 + this.bgDrift, 1);
    } else {
      this.bg.update(dt, cam.x, cam.y, cam.zoom);
    }
    this.tree.update(dt);
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
