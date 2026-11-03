import gsap from 'gsap';
import { fmt, fmtTime } from '../core/format';
import { hexToCss } from '../core/math';
import type { GameState, Settings } from '../core/state';
import {
  BRANCH_COLORS, BRANCH_NAMES, KEYSTONES, KIND_NAMES, NODE_MAP, NODES, PRISM_COLOR, nodeColor, type NodeDef,
} from '../data/tree';
import { STAT_META, formatStat, type StatKey } from '../data/stats';
import { canAfford, isOwned, level, nextCost, nodeState, statsFor } from '../systems/tree-logic';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

const ICON = {
  lumen: '<i class="cur-icon lumen"></i>',
  prism: '<i class="cur-icon prism"></i>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  center: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
};

/** A number that animates toward its target value. */
export class Counter {
  private shown = 0;
  private target = 0;
  private tween: gsap.core.Tween | null = null;
  constructor(readonly el: HTMLElement, private format = (v: number) => fmt(Math.floor(v + 1e-6))) {}
  set(v: number, animate = true, duration = 0.6) {
    this.target = v;
    this.tween?.kill();
    if (!animate) {
      this.shown = v;
      this.el.textContent = this.format(v);
      return;
    }
    const o = { v: this.shown };
    this.tween = gsap.to(o, {
      v, duration, ease: 'power2.out',
      onUpdate: () => { this.shown = o.v; this.el.textContent = this.format(o.v); },
    });
  }
  get value() { return this.target; }
  bump(scale = 1.18) {
    gsap.fromTo(this.el, { scale }, { scale: 1, duration: 0.35, ease: 'back.out(3)', overwrite: true });
  }
}

const costHtml = (cost: Partial<Record<'lumen' | 'prism', number>>, state: { lumen: number; prism: number }) => {
  let out = '';
  if (cost.lumen) out += `<span class="currency ${cost.lumen > state.lumen ? 'poor' : ''}">${ICON.lumen}${fmt(cost.lumen)}</span>`;
  if (cost.prism) out += `<span class="currency ${cost.prism > state.prism ? 'poor' : ''}">${ICON.prism}${fmt(cost.prism)}</span>`;
  return out;
};

export function colorOf(def: NodeDef): string {
  return hexToCss(nodeColor(def));
}

// ───────────────────────────────────────────────────────────────────────────
export class TreeHud {
  readonly root = h('div', 'passthrough');
  readonly lumen: Counter;
  readonly prism: Counter;
  readonly lumenPill: HTMLElement;
  private prismPill: HTMLElement;
  readonly harvestBtn: HTMLButtonElement;
  readonly awakenBtn: HTMLButtonElement;
  readonly settingsBtn: HTMLButtonElement;
  readonly centerBtn: HTMLButtonElement;
  readonly muteBtn: HTMLButtonElement;
  private hint: HTMLElement;
  private chip: HTMLElement;
  private toasts: HTMLElement;

  constructor(host: HTMLElement) {
    const tl = h('div', 'hud-tl');
    this.lumenPill = h('div', 'pill glass', `${ICON.lumen}<span class="val currency">0</span><span class="label">Lumen</span>`);
    this.prismPill = h('div', 'pill glass prism', `${ICON.prism}<span class="val currency">0</span><span class="label">Prism</span>`);
    tl.append(this.lumenPill, this.prismPill);
    this.lumen = new Counter(this.lumenPill.querySelector('.val')!);
    this.prism = new Counter(this.prismPill.querySelector('.val')!);

    const tr = h('div', 'hud-tr');
    this.centerBtn = h('button', 'btn icon glass', ICON.center);
    this.centerBtn.title = 'Recenter (C)';
    this.muteBtn = h('button', 'btn icon glass', ICON.sound);
    this.muteBtn.title = 'Mute (M)';
    this.settingsBtn = h('button', 'btn icon glass', ICON.gear);
    this.settingsBtn.title = 'Settings';
    tr.append(this.centerBtn, this.muteBtn, this.settingsBtn);

    this.chip = h('div', 'progress-chip glass');

    const bottom = h('div', 'hud-bottom');
    const row = h('div', 'hud-row');
    this.awakenBtn = h('button', 'btn awaken-btn');
    this.harvestBtn = h('button', 'btn harvest-btn', 'Begin Harvest<kbd>Space</kbd>');
    this.hint = h('div', 'hint');
    row.append(this.harvestBtn, this.awakenBtn);
    bottom.append(row, this.hint);

    this.toasts = h('div', 'toasts');
    this.root.append(tl, tr, this.chip, bottom, this.toasts);
    host.append(this.root);
  }

  setMuted(muted: boolean) {
    this.muteBtn.innerHTML = muted ? ICON.mute : ICON.sound;
  }

  sync(state: GameState, animate = true, urge = false) {
    this.lumen.set(state.lumen, animate);
    this.prism.set(state.prism, animate);
    const showPrism = state.prism > 0 || (state.levels.fortune_4a ?? 0) > 0;
    this.prismPill.classList.toggle('on', showPrism);
    this.harvestBtn.classList.toggle('urge', urge);

    const owned = NODES.filter((n) => n.kind !== 'core' && n.kind !== 'awaken' && isOwned(state.levels, n.id)).length;
    const total = NODES.filter((n) => n.kind !== 'core' && n.kind !== 'awaken').length;
    const dots = KEYSTONES.map((k) => {
      const c = hexToCss(BRANCH_COLORS[NODE_MAP[k].branch]);
      return `<i class="${isOwned(state.levels, k) ? 'on' : ''}" style="color:${c}"></i>`;
    }).join('');
    this.chip.innerHTML = `<span>Bloom <b>${owned}</b> / ${total}</span><span class="ks-dots" title="Keystones">${dots}</span>`;

    const aw = NODE_MAP.awaken;
    const awState = nodeState(aw, state.levels);
    const awOn = awState === 'available' && !state.awakened;
    this.awakenBtn.classList.toggle('on', awOn);
    if (awOn) {
      this.awakenBtn.innerHTML = `Awaken the Seed<div class="cost">${costHtml(nextCost(aw, state.levels), state)}</div>`;
    }

    if (state.lifetime.runs === 0) this.hint.innerHTML = 'Click the <b>Seed</b> or press <kbd>Space</kbd> to begin your first Harvest';
    else if (urge) this.hint.innerHTML = 'Nothing affordable yet. Harvest more Lumen';
    else this.hint.innerHTML = 'Drag to pan · Scroll to zoom · Click a node to grow it';
  }

  toast(html: string, color = '#fff', duration = 2.6) {
    const t = h('div', 'toast glass', html);
    t.style.setProperty('--c', color);
    this.toasts.append(t);
    gsap.fromTo(t, { y: 20, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' });
    gsap.to(t, { opacity: 0, y: -10, duration: 0.4, delay: duration, onComplete: () => t.remove() });
  }

  show(on: boolean) {
    gsap.to(this.root, { autoAlpha: on ? 1 : 0, duration: on ? 0.5 : 0.25 });
  }
}

// ───────────────────────────────────────────────────────────────────────────
export class Tooltip {
  readonly el = h('div', 'tooltip glass');
  private current: string | null = null;
  private visible = false;

  constructor(host: HTMLElement) {
    host.append(this.el);
  }

  show(def: NodeDef, state: GameState, sx: number, sy: number, nodeR: number) {
    const changed = this.current !== def.id;
    this.current = def.id;
    this.render(def, state);
    this.place(sx, sy, nodeR);
    if (!this.visible || changed) {
      this.visible = true;
      gsap.killTweensOf(this.el);
      gsap.fromTo(this.el, { opacity: 0, scale: 0.94, x: '-=8' }, { opacity: 1, scale: 1, x: '+=8', duration: 0.22, ease: 'power3.out' });
    }
  }

  refresh(state: GameState) {
    if (this.current && this.visible) this.render(NODE_MAP[this.current], state);
  }

  place(sx: number, sy: number, nodeR: number) {
    const w = this.el.offsetWidth || 300;
    const hh = this.el.offsetHeight || 200;
    let x = sx + nodeR + 18;
    if (x + w > window.innerWidth - 12) x = sx - nodeR - 18 - w;
    const y = Math.min(Math.max(12, sy - hh / 2), window.innerHeight - hh - 12);
    this.el.style.left = `${Math.round(x)}px`;
    this.el.style.top = `${Math.round(y)}px`;
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.current = null;
    gsap.to(this.el, { opacity: 0, duration: 0.15 });
  }

  /** Flash the cost red: feedback for a denied purchase. */
  deny() {
    gsap.fromTo(this.el, { x: '-=6' }, { x: '+=6', duration: 0.3, ease: 'elastic.out(1.5, 0.25)' });
  }

  private render(def: NodeDef, state: GameState) {
    const st = nodeState(def, state.levels);
    const color = def.kind === 'awaken' || def.kind === 'core' ? '#ffe9b0' : colorOf(def);
    this.el.style.setProperty('--c', color);
    const lvl = level(state.levels, def.id);
    const branchName = def.branch2 ? `${BRANCH_NAMES[def.branch]} + ${BRANCH_NAMES[def.branch2]}` : BRANCH_NAMES[def.branch];

    if (st === 'silhouette') {
      this.el.innerHTML = `<div class="tt-kind"><span>Unknown</span></div><div class="tt-name">???</div>
        <div class="tt-desc">Grow a neighbouring node to reveal what lies here.</div>`;
      return;
    }

    let stats = '';
    if (def.mods.length && def.kind !== 'core') {
      const cur = statsFor(state.levels);
      const nextLevels = { ...state.levels, [def.id]: Math.min(lvl + 1, def.maxLevel) };
      const nxt = statsFor(nextLevels);
      const seen = new Set<StatKey>();
      for (const m of def.mods) {
        if (seen.has(m.stat)) continue;
        seen.add(m.stat);
        const a = formatStat(m.stat, cur[m.stat]);
        const b = formatStat(m.stat, nxt[m.stat]);
        const v = lvl >= def.maxLevel ? `<span>${a}</span>` : `<span>${a}</span><span class="arrow">→</span><span class="next">${b}</span>`;
        stats += `<div class="tt-stat"><span class="k">${STAT_META[m.stat].label}</span><span class="v">${v}</span></div>`;
      }
    }

    let req = '';
    if (st === 'locked') {
      const items = def.parents.map((p) => `<div class="${isOwned(state.levels, p) ? 'met' : ''}">${NODE_MAP[p].name}</div>`).join('');
      req = `<div class="tt-req">${def.req === 'all' ? 'Requires all of:' : 'Requires one of:'}${items}</div>`;
    }

    const pips = def.maxLevel > 1
      ? `<span class="pips">${Array.from({ length: def.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>`
      : '';
    const lvlText = def.kind === 'core' ? '' : `<span class="tt-level">${def.maxLevel > 1 ? `Lv ${lvl}/${def.maxLevel}` : lvl ? 'Owned' : 'Unowned'}${pips}</span>`;

    let right = '';
    if (def.kind === 'core') right = '<span class="tt-action">Click to Harvest · Space</span>';
    else if (lvl >= def.maxLevel) right = '<span class="tt-maxed">◆ MAXED</span>';
    else if (st !== 'locked') {
      const cost = nextCost(def, state.levels);
      right = `<span class="tt-cost">${costHtml(cost, state)}</span>`;
    }

    const kind = def.kind === 'core' ? 'Origin' : `${KIND_NAMES[def.kind]} · ${branchName}`;
    const affordHint = st === 'available' && def.kind !== 'core' && canAfford(nextCost(def, state.levels), state)
      ? '<span>Click to grow</span>' : '';
    this.el.innerHTML = `
      <div class="tt-kind"><span>${kind}</span>${affordHint}</div>
      <div class="tt-name">${def.name}</div>
      <div class="tt-desc">${def.desc}</div>
      ${stats ? `<div class="tt-stats">${stats}</div>` : ''}
      ${req}
      <div class="tt-foot">${lvlText}${right}</div>`;
  }
}

// ───────────────────────────────────────────────────────────────────────────
export class HarvestHud {
  readonly root = h('div', 'passthrough');
  readonly lumen: Counter;
  readonly prism: Counter;
  readonly lumenPill: HTMLElement;
  readonly prismPill: HTMLElement;
  private timer: HTMLElement;
  private fill: HTMLElement;
  private tText: HTMLElement;
  private tLabel: HTMLElement;
  private combo: HTMLElement;
  private comboX: HTMLElement;
  private comboMeter: HTMLElement;
  private kills: HTMLElement;
  private banner: HTMLElement;
  private lastCombo = 0;

  constructor(host: HTMLElement) {
    const tl = h('div', 'hud-tl');
    this.lumenPill = h('div', 'pill glass', `${ICON.lumen}<span class="val currency">0</span><span class="label">Harvested</span>`);
    this.prismPill = h('div', 'pill glass prism', `${ICON.prism}<span class="val currency">0</span><span class="label">Prism</span>`);
    tl.append(this.lumenPill, this.prismPill);
    this.lumen = new Counter(this.lumenPill.querySelector('.val')!);
    this.prism = new Counter(this.prismPill.querySelector('.val')!);

    this.timer = h('div', 'timer glass', `<div class="timer-row"><span>Harvest</span><span class="t">0.0s</span></div><div class="timer-bar"><div class="timer-fill"></div></div>`);
    this.fill = this.timer.querySelector('.timer-fill')!;
    this.tText = this.timer.querySelector('.t')!;
    this.tLabel = this.timer.querySelector('.timer-row span')!;

    this.combo = h('div', 'combo glass', `<div class="x">×1.00</div><div class="lbl">Combo 0</div><div class="meter"><i></i></div>`);
    this.comboX = this.combo.querySelector('.x')!;
    this.comboMeter = this.combo.querySelector('.meter i')!;
    this.combo.style.display = 'none';

    this.kills = h('div', 'kills', 'Shards <b>0</b>');
    this.banner = h('div', 'banner');
    this.root.append(tl, this.timer, this.combo, this.kills, this.banner);
    host.append(this.root);
    gsap.set(this.root, { autoAlpha: 0 });
  }

  show(on: boolean, comboEnabled = false, prismEnabled = false) {
    this.combo.style.display = comboEnabled ? '' : 'none';
    this.prismPill.classList.toggle('on', prismEnabled);
    if (on) {
      this.lumen.set(0, false);
      this.prism.set(0, false);
      gsap.fromTo(this.timer, { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'back.out(2)', delay: 0.15 });
    }
    gsap.to(this.root, { autoAlpha: on ? 1 : 0, duration: on ? 0.4 : 0.3 });
  }

  setTimer(remaining: number, total: number, overtime: boolean) {
    const frac = Math.max(0, Math.min(1, remaining / total));
    this.fill.style.transform = `scaleX(${frac})`;
    this.tText.textContent = `${Math.max(0, remaining).toFixed(1)}s`;
    this.timer.classList.toggle('overtime', overtime);
    this.timer.classList.toggle('warn', !overtime && remaining <= 5 && remaining > 2.5);
    this.timer.classList.toggle('crit', !overtime && remaining <= 2.5);
    this.tLabel.textContent = overtime ? 'Last Light' : 'Harvest';
  }

  addTimeFx() {
    gsap.fromTo(this.timer, { scale: 1.06 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
  }

  setCombo(stacks: number, bonus: number, frac: number) {
    this.comboX.textContent = `×${(1 + bonus).toFixed(2)}`;
    (this.combo.querySelector('.lbl') as HTMLElement).textContent = `Combo ${stacks}`;
    this.comboMeter.style.transform = `scaleX(${frac})`;
    if (stacks > this.lastCombo) gsap.fromTo(this.comboX, { scale: 1.25 }, { scale: 1, duration: 0.25, ease: 'back.out(3)', overwrite: true });
    this.lastCombo = stacks;
  }

  setKills(n: number) {
    this.kills.innerHTML = `Shards <b>${n}</b>`;
  }

  showBanner(text: string, sub = '', color = '') {
    this.banner.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    if (color) this.banner.style.textShadow = `0 0 30px ${color}, 0 0 80px ${color}`;
    gsap.killTweensOf(this.banner);
    gsap.timeline()
      .fromTo(this.banner, { opacity: 0, scale: 1.4, letterSpacing: '0.6em' }, { opacity: 1, scale: 1, letterSpacing: '0.3em', duration: 0.5, ease: 'expo.out' })
      .to(this.banner, { opacity: 0, scale: 0.96, duration: 0.6, delay: 0.9, ease: 'power2.in' });
  }

  /** screen-space centre of the lumen counter (target for flying motes) */
  lumenTarget(): { x: number; y: number } {
    const r = this.lumenPill.querySelector('.cur-icon')!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  prismTarget(): { x: number; y: number } {
    const r = this.prismPill.querySelector('.cur-icon')!.getBoundingClientRect();
    if (r.width === 0) return this.lumenTarget();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
}

// ───────────────────────────────────────────────────────────────────────────
export interface RunResult {
  lumen: number;
  prism: number;
  kills: number;
  bestCombo: number;
  duration: number;
  hearts: number;
}

export class Summary {
  readonly wrap = h('div', 'modal-wrap');
  private modal = h('div', 'modal glass');
  onContinue: () => void = () => {};
  onAgain: () => void = () => {};
  private open = false;

  constructor(host: HTMLElement) {
    this.wrap.append(this.modal);
    host.append(this.wrap);
  }

  get isOpen() { return this.open; }

  show(r: RunResult, record: boolean, total: number) {
    this.open = true;
    this.modal.innerHTML = `
      <h2>Harvest Complete</h2>
      <div class="sum-main">
        <div class="big"><i class="cur-icon lumen"></i><span class="lv">0</span></div>
        <div class="sub">Lumen gathered</div>
        ${record ? '<div class="record">◆ New Record</div>' : ''}
      </div>
      <div class="sum-rows">
        ${r.prism > 0 ? `<div class="sum-row"><span class="k">Prism</span><span class="v currency"><i class="cur-icon prism"></i>+${fmt(r.prism)}</span></div>` : ''}
        <div class="sum-row"><span class="k">Shards broken</span><span class="v">${fmt(r.kills)}</span></div>
        ${r.hearts > 0 ? `<div class="sum-row"><span class="k">Heart crystals</span><span class="v">${r.hearts}</span></div>` : ''}
        ${r.bestCombo > 1 ? `<div class="sum-row"><span class="k">Best combo</span><span class="v">${r.bestCombo}</span></div>` : ''}
        <div class="sum-row"><span class="k">Harvest length</span><span class="v">${r.duration.toFixed(1)}s</span></div>
        <div class="sum-row"><span class="k">Total Lumen</span><span class="v currency"><i class="cur-icon lumen"></i>${fmt(total)}</span></div>
      </div>
      <div class="sum-actions">
        <button class="btn again">Harvest again <kbd>R</kbd></button>
        <button class="btn primary cont">To the Bloom <kbd>Space</kbd></button>
      </div>`;
    this.modal.querySelector('.cont')!.addEventListener('click', () => this.onContinue());
    this.modal.querySelector('.again')!.addEventListener('click', () => this.onAgain());
    this.wrap.classList.add('on');
    const lv = this.modal.querySelector('.lv') as HTMLElement;
    const o = { v: 0 };
    gsap.timeline()
      .fromTo(this.wrap, { opacity: 0 }, { opacity: 1, duration: 0.3 })
      .fromTo(this.modal, { y: 40, scale: 0.92, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.6)' }, 0)
      .to(o, { v: r.lumen, duration: 1.1, ease: 'power3.out', onUpdate: () => { lv.textContent = fmt(Math.floor(o.v)); } }, 0.2)
      .to(this.modal.querySelectorAll('.sum-row'), { opacity: 1, x: 0, stagger: 0.06, duration: 0.3, startAt: { x: -12 } }, 0.35)
      .to(this.modal.querySelector('.record'), { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(3)', startAt: { scale: 1.6 } }, 1.2);
  }

  hide(): Promise<void> {
    this.open = false;
    return new Promise((res) => {
      gsap.to(this.modal, { y: -20, opacity: 0, scale: 0.96, duration: 0.25, ease: 'power2.in' });
      gsap.to(this.wrap, { opacity: 0, duration: 0.3, onComplete: () => { this.wrap.classList.remove('on'); res(); } });
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
export class SettingsPanel {
  readonly wrap = h('div', 'modal-wrap');
  private modal = h('div', 'modal glass settings');
  onChange: (s: Settings) => void = () => {};
  onReset: () => void = () => {};
  open = false;

  constructor(host: HTMLElement) {
    this.wrap.append(this.modal);
    host.append(this.wrap);
    this.wrap.addEventListener('pointerdown', (e) => { if (e.target === this.wrap) this.hide(); });
  }

  show(state: GameState) {
    this.open = true;
    const s = state.settings;
    const L = state.lifetime;
    this.modal.innerHTML = `
      <h2>Settings</h2>
      <div class="row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></div>
      <div class="row"><span>Screen shake</span><div class="toggle ${s.shake ? 'on' : ''}" data-k="shake"></div></div>
      <div class="row"><span>Reduced motion</span><div class="toggle ${s.reducedMotion ? 'on' : ''}" data-k="reducedMotion"></div></div>
      <div class="row"><span>Bloom glow (GPU)</span><div class="toggle ${s.quality === 'high' ? 'on' : ''}" data-k="quality"></div></div>
      <div class="stats">
        <span>Harvests</span><b>${fmt(L.runs)}</b>
        <span>Shards broken</span><b>${fmt(L.shardsBroken)}</b>
        <span>Lumen earned</span><b>${fmt(L.lumenEarned)}</b>
        <span>Best harvest</span><b>${fmt(L.bestRun)}</b>
        <span>Time played</span><b>${fmtTime(L.playTime)}</b>
      </div>
      <div class="foot"><button class="btn danger reset">Reset progress</button><button class="btn close">Close</button></div>`;
    const emit = () => this.onChange(s);
    (this.modal.querySelector('input[data-k=volume]') as HTMLInputElement).addEventListener('input', (e) => {
      s.volume = parseFloat((e.target as HTMLInputElement).value);
      emit();
    });
    this.modal.querySelectorAll<HTMLElement>('.toggle').forEach((t) => t.addEventListener('click', () => {
      const k = t.dataset.k!;
      t.classList.toggle('on');
      const on = t.classList.contains('on');
      if (k === 'shake') s.shake = on;
      if (k === 'reducedMotion') s.reducedMotion = on;
      if (k === 'quality') s.quality = on ? 'high' : 'low';
      emit();
    }));
    const reset = this.modal.querySelector('.reset') as HTMLButtonElement;
    let armed = false;
    reset.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        reset.textContent = 'Click again to confirm';
        return;
      }
      this.onReset();
    });
    this.modal.querySelector('.close')!.addEventListener('click', () => this.hide());
    this.wrap.classList.add('on');
    gsap.fromTo(this.modal, { y: 30, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.7)' });
    gsap.fromTo(this.wrap, { opacity: 0 }, { opacity: 1, duration: 0.25 });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    gsap.to(this.wrap, { opacity: 0, duration: 0.2, onComplete: () => this.wrap.classList.remove('on') });
  }
}

// ───────────────────────────────────────────────────────────────────────────
export class Ending {
  readonly el = h('div', 'ending');
  onContinue: () => void = () => {};
  constructor(host: HTMLElement) {
    host.append(this.el);
  }
  show(state: GameState) {
    const L = state.lifetime;
    this.el.innerHTML = `<div>
      <h1>THE SEED AWAKENS</h1>
      <p>Four lights became one. The void is no longer dark: it blooms, endlessly, with everything you grew.</p>
      <div class="stats">
        <div><b>${fmtTime(L.playTime)}</b><span>Time</span></div>
        <div><b>${fmt(L.runs)}</b><span>Harvests</span></div>
        <div><b>${fmt(L.shardsBroken)}</b><span>Shards</span></div>
        <div><b>${fmt(L.lumenEarned)}</b><span>Lumen</span></div>
      </div>
      <button class="btn">Keep blooming</button></div>`;
    this.el.querySelector('button')!.addEventListener('click', () => {
      gsap.to(this.el, { opacity: 0, duration: 0.6, onComplete: () => { this.el.classList.remove('on'); this.onContinue(); } });
    });
    this.el.classList.add('on');
    const tl = gsap.timeline();
    tl.fromTo(this.el, { opacity: 0 }, { opacity: 1, duration: 1.2 })
      .fromTo(this.el.querySelector('h1'), { letterSpacing: '0.8em', opacity: 0, scale: 1.15 }, { letterSpacing: '0.28em', opacity: 1, scale: 1, duration: 2.2, ease: 'expo.out' }, 0.2)
      .fromTo(this.el.querySelectorAll('p, .stats > div, button'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.15, duration: 0.8, ease: 'power3.out' }, 1.2);
  }
}

export const PRISM_CSS = hexToCss(PRISM_COLOR);
