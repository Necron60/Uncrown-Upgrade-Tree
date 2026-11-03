import gsap from 'gsap';
import { fmt, fmtTime } from '../core/format';
import { hexToCss } from '../core/math';
import { GRAPHICS_PRESETS, type GameState, type Settings } from '../core/state';
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

/** Engraved line glyphs, drawn to match the hairline UI. */
const SVG = (body: string) => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3">${body}</svg>`;
const GLYPH = {
  // a four-point star of light (deliberately unlike the round recenter icon)
  lumen: `<i class="glyph">${SVG('<path d="M10 1.2C10.7 6.6 13.4 9.3 18.8 10 13.4 10.7 10.7 13.4 10 18.8 9.3 13.4 6.6 10.7 1.2 10 6.6 9.3 9.3 6.6 10 1.2Z" fill="currentColor" fill-opacity=".28"/>')}</i>`,
  prism: `<i class="glyph prism">${SVG('<path d="M10 2.2 17.2 10 10 17.8 2.8 10Z"/><path d="M2.8 10h14.4M10 2.2v15.6" opacity=".45"/>')}</i>`,
};
const ICON = {
  center: SVG('<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M10 1v3.4M10 15.6V19M1 10h3.4M15.6 10H19"/>'),
  settings: SVG('<path d="M3 5.5h14M3 10h14M3 14.5h14" opacity=".55"/><path d="M7 3.6 8.9 5.5 7 7.4 5.1 5.5Z M13 8.1 14.9 10 13 11.9 11.1 10Z M8.5 12.6 10.4 14.5 8.5 16.4 6.6 14.5Z" fill="#0b0a12"/>'),
  sound: SVG('<path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M13.5 7.2a4 4 0 0 1 0 5.6M15.8 5a7 7 0 0 1 0 10"/>'),
  mute: SVG('<path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M13.5 7.5l5 5M18.5 7.5l-5 5"/>'),
};

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function roman(n: number): string {
  let out = '';
  n = Math.max(1, Math.min(3999, Math.floor(n)));
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

const leader = (k: string, v: string) => `<div class="leader"><span class="k">${k}</span><span class="dots"></span><span class="v">${v}</span></div>`;

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
  bump(scale = 1.15) {
    gsap.fromTo(this.el, { scale }, { scale: 1, duration: 0.35, ease: 'back.out(3)', overwrite: true });
  }
}

const costHtml = (cost: Partial<Record<'lumen' | 'prism', number>>, state: { lumen: number; prism: number }) => {
  let out = '';
  if (cost.lumen) out += `<span class="${cost.lumen > state.lumen ? 'poor' : ''}">${GLYPH.lumen}${fmt(cost.lumen)}</span>`;
  if (cost.prism) out += `<span class="${cost.prism > state.prism ? 'poor' : ''}">${GLYPH.prism}${fmt(cost.prism)}</span>`;
  return out;
};

export function colorOf(def: NodeDef): string {
  return hexToCss(nodeColor(def));
}

function readout(cls: string, glyph: string, label: string) {
  const el = h('div', `readout ${cls}`, `${glyph}<span class="val">0</span><span class="lbl">${label}</span>`);
  return { el, val: el.querySelector('.val') as HTMLElement, glyph: el.querySelector('.glyph') as HTMLElement };
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
    const L = readout('lumen', GLYPH.lumen, 'lumen');
    const P = readout('prism', GLYPH.prism, 'prism');
    this.lumenPill = L.el;
    this.prismPill = P.el;
    tl.append(L.el, P.el);
    this.lumen = new Counter(L.val);
    this.prism = new Counter(P.val);

    const tr = h('div', 'hud-tr');
    const btn = (svg: string, title: string) => {
      const b = h('button', 'icon-btn', svg);
      b.title = title;
      b.setAttribute('aria-label', title);
      return b;
    };
    this.centerBtn = btn(ICON.center, 'Recenter (C)');
    this.muteBtn = btn(ICON.sound, 'Mute (M)');
    this.settingsBtn = btn(ICON.settings, 'Settings');
    tr.append(this.centerBtn, this.muteBtn, this.settingsBtn);

    this.chip = h('div', 'chip');

    const bottom = h('div', 'hud-bottom');
    const row = h('div', 'hud-row');
    this.harvestBtn = h('button', 'rite', '<span class="gem"></span>Begin the Harvest<kbd>space</kbd><span class="gem"></span>');
    this.awakenBtn = h('button', 'rite awaken');
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

  setHints(on: boolean) {
    this.hint.style.display = on ? '' : 'none';
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
    this.chip.innerHTML = `<span>the Bloom</span><span class="num">${String(owned).padStart(2, '0')}<i> / </i>${total}</span><span class="ks" title="Keystones">${dots}</span>`;

    const aw = NODE_MAP.awaken;
    const awOn = nodeState(aw, state.levels) === 'available' && !state.awakened;
    this.awakenBtn.classList.toggle('on', awOn);
    if (awOn) this.awakenBtn.innerHTML = `Awaken the Seed <span class="cost">${costHtml(nextCost(aw, state.levels), state)}</span>`;

    if (state.lifetime.runs === 0) this.hint.innerHTML = 'Touch the <b>seed</b> to begin your first harvest';
    else if (urge) this.hint.innerHTML = 'Nothing within reach yet. Gather more light.';
    else this.hint.innerHTML = 'drag to wander · scroll to look closer · touch a lit node to grow it';
  }

  toast(html: string, color = 'var(--gold)', duration = 2.6) {
    const t = h('div', 'toast', html);
    t.style.setProperty('--c', color);
    this.toasts.append(t);
    gsap.fromTo(t, { y: 14, opacity: 0, letterSpacing: '0.12em' }, { y: 0, opacity: 1, letterSpacing: '0em', duration: 0.6, ease: 'expo.out' });
    gsap.to(t, { opacity: 0, y: -8, duration: 0.5, delay: duration, onComplete: () => t.remove() });
  }

  show(on: boolean) {
    gsap.to(this.root, { autoAlpha: on ? 1 : 0, duration: on ? 0.5 : 0.25 });
  }
}

// ───────────────────────────────────────────────────────────────────────────
export class Tooltip {
  readonly el = h('div', 'tooltip plate');
  /** interface size setting: the overlay is CSS-zoomed, so positions are divided by it */
  scale = 1;
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
      gsap.fromTo(this.el, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.2, ease: 'power3.out' });
    }
  }

  refresh(state: GameState) {
    if (this.current && this.visible) this.render(NODE_MAP[this.current], state);
  }

  place(sx: number, sy: number, nodeR: number) {
    const z = this.scale;
    const w = (this.el.offsetWidth || 318) * z;
    const hh = (this.el.offsetHeight || 200) * z;
    let x = sx + nodeR + 18;
    if (x + w > window.innerWidth - 12) x = sx - nodeR - 18 - w;
    const y = Math.min(Math.max(12, sy - hh / 2), window.innerHeight - hh - 12);
    this.el.style.left = `${Math.round(x / z)}px`;
    this.el.style.top = `${Math.round(y / z)}px`;
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.current = null;
    // cancel a fade-in still in flight, or it would finish *after* this and leave the card showing
    gsap.killTweensOf(this.el);
    gsap.to(this.el, { opacity: 0, x: 0, duration: 0.12 });
  }

  /** Shake: feedback for a denied purchase. */
  deny() {
    if (!this.visible) return;
    gsap.fromTo(this.el, { x: -7 }, { x: 0, duration: 0.35, ease: 'elastic.out(1.5, 0.25)' });
  }

  private render(def: NodeDef, state: GameState) {
    const st = nodeState(def, state.levels);
    const color = def.kind === 'awaken' || def.kind === 'core' ? 'var(--gold-hi)' : colorOf(def);
    this.el.style.setProperty('--c', color);
    const lvl = level(state.levels, def.id);
    const branch = def.branch2 ? `${BRANCH_NAMES[def.branch]} + ${BRANCH_NAMES[def.branch2]}` : BRANCH_NAMES[def.branch];

    if (st === 'silhouette') {
      this.el.innerHTML = `<span class="accent"></span><div class="tt-head"><span class="kind">uncharted</span></div>
        <div class="tt-name">Unknown star</div><div class="tt-desc">Grow a neighbouring node to bring it into the light.</div>`;
      return;
    }

    let stats = '';
    if (def.mods.length && def.kind !== 'core') {
      const cur = statsFor(state.levels);
      const nxt = statsFor({ ...state.levels, [def.id]: Math.min(lvl + 1, def.maxLevel) });
      const seen = new Set<StatKey>();
      for (const m of def.mods) {
        if (seen.has(m.stat)) continue;
        seen.add(m.stat);
        const a = formatStat(m.stat, cur[m.stat]);
        const b = formatStat(m.stat, nxt[m.stat]);
        const v = lvl >= def.maxLevel ? a : `${a}<span class="arrow">→</span><span class="next">${b}</span>`;
        stats += leader(STAT_META[m.stat].label, v);
      }
    }

    let req = '';
    if (st === 'locked') {
      const items = def.parents.map((p) => `<div class="${isOwned(state.levels, p) ? 'met' : ''}">${NODE_MAP[p].name}</div>`).join('');
      req = `<div class="tt-req"><span class="t">${def.req === 'all' ? 'Requires all of' : 'Requires one of'}</span>${items}</div>`;
    }

    let lvlText = '';
    if (def.kind !== 'core') {
      if (def.maxLevel > 1) {
        const pips = Array.from({ length: def.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        lvlText = `<span class="tt-lvl"><span class="pips">${pips}</span>${lvl ? `${roman(lvl)} / ${roman(def.maxLevel)}` : ''}</span>`;
      } else if (lvl) lvlText = '<span class="tt-lvl">grown</span>';
    }

    let right = '';
    if (def.kind === 'core') right = '<span class="tt-act">touch to harvest <kbd>space</kbd></span>';
    else if (lvl >= def.maxLevel) right = '<span class="tt-maxed">fully grown</span>';
    else if (st !== 'locked') right = `<span class="tt-cost">${costHtml(nextCost(def, state.levels), state)}</span>`;

    const kind = def.kind === 'core' ? 'origin' : `${KIND_NAMES[def.kind].toLowerCase()} · ${branch.toLowerCase()}`;
    const ready = st === 'available' || st === 'owned';
    const affordHint = ready && def.kind !== 'core' && canAfford(nextCost(def, state.levels), state) ? '<span>ready</span>' : '';
    this.el.innerHTML = `
      <span class="accent"></span>
      <div class="tt-head"><span class="kind">${kind}</span>${affordHint}</div>
      <div class="tt-name">${def.name}</div>
      <div class="tt-desc">${def.desc.replace(/^KEYSTONE\. /, '')}</div>
      ${stats || req ? '<div class="rule"></div>' : ''}
      ${stats ? `<div class="tt-stats">${stats}</div>` : ''}
      ${req}
      ${lvlText || right ? `<div class="rule"></div><div class="tt-foot">${lvlText || '<span></span>'}${right}</div>` : ''}`;
  }
}

// ───────────────────────────────────────────────────────────────────────────
export class HarvestHud {
  readonly root = h('div', 'passthrough');
  readonly lumen: Counter;
  readonly prism: Counter;
  readonly lumenPill: HTMLElement;
  readonly prismPill: HTMLElement;
  private lumenGlyph: HTMLElement;
  private prismGlyph: HTMLElement;
  private timer: HTMLElement;
  private fill: HTMLElement;
  private tText: HTMLElement;
  private tLabel: HTMLElement;
  private combo: HTMLElement;
  private comboX: HTMLElement;
  private comboLbl: HTMLElement;
  private comboMeter: HTMLElement;
  private kills: HTMLElement;
  private banner: HTMLElement;
  private lastCombo = 0;

  constructor(host: HTMLElement) {
    const tl = h('div', 'hud-tl');
    const L = readout('lumen', GLYPH.lumen, 'gathered');
    const P = readout('prism', GLYPH.prism, 'prism');
    this.lumenPill = L.el;
    this.prismPill = P.el;
    this.lumenGlyph = L.glyph;
    this.prismGlyph = P.glyph;
    tl.append(L.el, P.el);
    this.lumen = new Counter(L.val);
    this.prism = new Counter(P.val);

    this.timer = h('div', 'timer', `<div class="timer-row"><span class="lbl">the harvest</span><span class="t">0.0</span></div><div class="timer-bar"><div class="timer-fill"></div></div>`);
    this.fill = this.timer.querySelector('.timer-fill')!;
    this.tText = this.timer.querySelector('.t')!;
    this.tLabel = this.timer.querySelector('.lbl')!;

    this.combo = h('div', 'combo', `<div class="x">×1.00</div><div class="lbl">combo 0</div><div class="meter"><i></i></div>`);
    this.comboX = this.combo.querySelector('.x')!;
    this.comboLbl = this.combo.querySelector('.lbl')!;
    this.comboMeter = this.combo.querySelector('.meter i')!;
    this.combo.style.display = 'none';

    this.kills = h('div', 'kills', 'shards broken<b>0</b>');
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
      gsap.fromTo(this.timer, { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out', delay: 0.15 });
    }
    gsap.to(this.root, { autoAlpha: on ? 1 : 0, duration: on ? 0.4 : 0.3 });
  }

  setTimer(remaining: number, total: number, overtime: boolean) {
    const frac = Math.max(0, Math.min(1, remaining / total));
    this.fill.style.transform = `scaleX(${frac})`;
    this.tText.textContent = Math.max(0, remaining).toFixed(1);
    this.timer.classList.toggle('overtime', overtime);
    this.timer.classList.toggle('warn', !overtime && remaining <= 5 && remaining > 2.5);
    this.timer.classList.toggle('crit', !overtime && remaining <= 2.5);
    this.tLabel.textContent = overtime ? 'last light' : 'the harvest';
  }

  addTimeFx() {
    gsap.fromTo(this.tText, { color: '#f1d79a', scale: 1.15 }, { color: '#ece3cf', scale: 1, duration: 0.5, ease: 'back.out(3)' });
  }

  setCombo(stacks: number, bonus: number, frac: number) {
    this.comboX.textContent = `×${(1 + bonus).toFixed(2)}`;
    this.comboLbl.textContent = `combo ${stacks}`;
    this.comboMeter.style.transform = `scaleX(${frac})`;
    if (stacks > this.lastCombo) gsap.fromTo(this.comboX, { scale: 1.2 }, { scale: 1, duration: 0.25, ease: 'back.out(3)', overwrite: true });
    this.lastCombo = stacks;
  }

  setKills(n: number) {
    this.kills.innerHTML = `shards broken<b>${n}</b>`;
  }

  showBanner(text: string, sub = '', color = '') {
    this.banner.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.banner.style.setProperty('--glow', color || 'rgba(241, 215, 154, 0.55)');
    gsap.killTweensOf(this.banner);
    gsap.timeline()
      .fromTo(this.banner, { opacity: 0, y: 10, letterSpacing: '0.2em' }, { opacity: 1, y: 0, letterSpacing: '0.04em', duration: 0.7, ease: 'expo.out' })
      .to(this.banner, { opacity: 0, y: -6, duration: 0.6, delay: 0.8, ease: 'power2.in' });
  }

  /** screen-space centre of the lumen glyph (target for flying motes) */
  lumenTarget(): { x: number; y: number } {
    const r = this.lumenGlyph.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  prismTarget(): { x: number; y: number } {
    const r = this.prismGlyph.getBoundingClientRect();
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
  private modal = h('div', 'modal plate double');
  onContinue: () => void = () => {};
  onAgain: () => void = () => {};
  private open = false;

  constructor(host: HTMLElement) {
    this.wrap.append(this.modal);
    host.append(this.wrap);
  }

  get isOpen() { return this.open; }

  show(r: RunResult, record: boolean, total: number, runNumber: number) {
    this.open = true;
    const rows = [
      r.prism > 0 ? leader('Prism', `${GLYPH.prism}+${fmt(r.prism)}`) : '',
      leader('Shards broken', fmt(r.kills)),
      r.hearts > 0 ? leader('Heart crystals', String(r.hearts)) : '',
      r.bestCombo > 1 ? leader('Longest combo', String(r.bestCombo)) : '',
      leader('Length of night', `${r.duration.toFixed(1)}s`),
      leader('Lumen in store', `${GLYPH.lumen}${fmt(total)}`),
    ].join('');
    this.modal.innerHTML = `
      <div class="title">Harvest ${roman(runNumber)}</div>
      <div class="sum-main">
        <div class="big">${GLYPH.lumen}<span class="lv">0</span></div>
        <div class="sub">lumen gathered</div>
        ${record ? '<div class="record">◆ a new record ◆</div>' : ''}
      </div>
      <div class="rule orn"></div>
      <div class="sum-rows">${rows}</div>
      <div class="rule"></div>
      <div class="sum-actions">
        <button class="text-btn again">Again<kbd>r</kbd></button>
        <button class="text-btn primary cont">To the Bloom<kbd>space</kbd></button>
      </div>`;
    this.modal.querySelector('.cont')!.addEventListener('click', () => this.onContinue());
    this.modal.querySelector('.again')!.addEventListener('click', () => this.onAgain());
    this.wrap.classList.add('on');
    const lv = this.modal.querySelector('.lv') as HTMLElement;
    const o = { v: 0 };
    gsap.timeline()
      .fromTo(this.wrap, { opacity: 0 }, { opacity: 1, duration: 0.3 })
      .fromTo(this.modal, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'expo.out' }, 0)
      .to(o, { v: r.lumen, duration: 1.1, ease: 'power3.out', onUpdate: () => { lv.textContent = fmt(Math.floor(o.v)); } }, 0.2)
      .to(this.modal.querySelectorAll('.sum-rows .leader'), { opacity: 1, x: 0, stagger: 0.06, duration: 0.35, startAt: { x: -10 } }, 0.35)
      .to(this.modal.querySelector('.record'), { opacity: 1, duration: 0.5 }, 1.2);
  }

  hide(): Promise<void> {
    this.open = false;
    return new Promise((res) => {
      gsap.to(this.modal, { y: -14, opacity: 0, duration: 0.25, ease: 'power2.in' });
      gsap.to(this.wrap, { opacity: 0, duration: 0.3, onComplete: () => { this.wrap.classList.remove('on'); res(); } });
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
type Tab = 'graphics' | 'motion' | 'sound' | 'interface' | 'records';
const TABS: [Tab, string][] = [['graphics', 'Graphics'], ['motion', 'Motion'], ['sound', 'Sound'], ['interface', 'Interface'], ['records', 'Records']];
const UI_SIZES: [string, string][] = [['0.9', 'small'], ['1', 'normal'], ['1.15', 'large'], ['1.3', 'larger']];

const choice = (k: string, opts: [string, string][], cur: string) =>
  `<span class="choice" data-k="${k}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('<i>·</i>')}</span>`;
const toggle = (k: string, on: boolean) => choice(k, [['1', 'on'], ['0', 'off']], on ? '1' : '0');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const slider = (k: string, v: number) =>
  `<span class="slider"><input type="range" min="0" max="1" step="0.05" value="${v}" data-k="${k}" aria-label="${k}"><b class="sv">${pct(v)}</b></span>`;
const row = (label: string, control: string, note = '', dim = false) =>
  `<div class="row${dim ? ' dim' : ''}">${leader(label, control)}${note ? `<div class="note">${note}</div>` : ''}</div>`;

export class SettingsPanel {
  readonly wrap = h('div', 'modal-wrap');
  private modal = h('div', 'modal plate double settings');
  onChange: (s: Settings) => void = () => {};
  onReset: () => void = () => {};
  open = false;
  private tab: Tab = 'graphics';
  private state!: GameState;

  constructor(host: HTMLElement) {
    this.wrap.append(this.modal);
    host.append(this.wrap);
    this.wrap.addEventListener('pointerdown', (e) => { if (e.target === this.wrap) this.hide(); });
  }

  show(state: GameState) {
    this.state = state;
    this.open = true;
    this.render();
    this.wrap.classList.add('on');
    gsap.fromTo(this.modal, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'expo.out' });
    gsap.fromTo(this.wrap, { opacity: 0 }, { opacity: 1, duration: 0.25 });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    gsap.to(this.wrap, { opacity: 0, duration: 0.2, onComplete: () => this.wrap.classList.remove('on') });
  }

  private body(): string {
    const s = this.state.settings;
    switch (this.tab) {
      case 'graphics': {
        const preset = (Object.keys(GRAPHICS_PRESETS) as (keyof typeof GRAPHICS_PRESETS)[])
          .find((p) => Object.entries(GRAPHICS_PRESETS[p]).every(([k, v]) => s[k as keyof Settings] === v)) ?? '';
        return [
          row('Preset', choice('preset', [['low', 'low'], ['medium', 'medium'], ['high', 'high']], preset), 'Sets the four options below at once.'),
          row('Glow', choice('bloom', [['off', 'off'], ['soft', 'soft'], ['full', 'full']], s.bloom), 'The soft light bleeding off bright things. The heaviest effect on the GPU.'),
          row('Resolution', choice('resolution', [['0.5', '50%'], ['0.75', '75%'], ['1', '100%']], String(s.resolution)), 'Share of your screen\'s sharpness to render at. Lower runs faster.'),
          row('Particles', choice('particles', [['low', 'few'], ['medium', 'some'], ['high', 'many']], s.particles)),
          row('Background', choice('background', [['low', 'simple'], ['high', 'rich']], s.background), 'Simple drops the nebulae, faint stars and shooting stars.'),
          row('Darkness', choice('darkness', [['off', 'off'], ['dim', 'dim'], ['deep', 'deep']], s.darkness), 'How dark the void is beyond the light of your tree.'),
          row('Frame rate', choice('fpsCap', [['30', '30'], ['60', '60'], ['120', '120'], ['0', 'max']], String(s.fpsCap))),
          row('Frame counter', toggle('showFps', s.showFps)),
        ].join('');
      }
      case 'motion': {
        const rm = s.reducedMotion;
        const why = rm ? 'Off while reduced motion is on.' : '';
        return [
          row('Reduced motion', toggle('reducedMotion', rm), 'One switch for everything below: no shake, camera moves, ripples, slow motion or ambient motion, and dimmer flashes.'),
          '<div class="rule"></div>',
          row('Screen shake', slider('shake', s.shake), why, rm),
          row('Camera moves', toggle('cameraFx', s.cameraFx), why || 'Zooming into the seed and back out, and the opening and finale camera moves.', rm),
          row('Distortion ripples', toggle('ripples', s.ripples), why || 'The shockwave that warps the screen on keystones and the finale.', rm),
          row('Flashes', slider('flashes', s.flashes), rm ? 'Capped at 30% while reduced motion is on.' : 'Below 50%, scene changes fade to dark instead of white.'),
          row('Slow motion', toggle('slowmo', s.slowmo), why || 'Hit-stop on heart crystals and the slowdown when a harvest ends.', rm),
          row('Ambient motion', toggle('ambient', s.ambient), why || 'Twinkling stars, drifting motes, light flowing along branches and breathing nodes.', rm),
        ].join('');
      }
      case 'sound':
        return [
          row('Master volume', slider('volume', s.volume)),
          row('Harvest sounds', slider('sfxVolume', s.sfxVolume), 'Pulses, shattering crystals, lightning and novas.'),
          row('Interface sounds', slider('uiVolume', s.uiVolume), 'Hovering, growing nodes and menu clicks.'),
          row('Silent in background', toggle('muteHidden', s.muteHidden), 'Pause all sound while the tab is hidden.'),
        ].join('');
      case 'interface':
        return [
          row('Interface size', choice('uiScale', UI_SIZES, String(s.uiScale))),
          row('Damage numbers', toggle('damageNumbers', s.damageNumbers)),
          row('Hints', toggle('hints', s.hints), 'Help lines under the harvest button and first-time tips.'),
          row('Skip harvest summary', toggle('skipSummary', s.skipSummary), 'Go straight back to the Bloom; the result shows as a short line instead.'),
        ].join('');
      case 'records': {
        const L = this.state.lifetime;
        return `<div class="ledger-sm">
          ${leader('Harvests', fmt(L.runs))}
          ${leader('Shards broken', fmt(L.shardsBroken))}
          ${leader('Lumen gathered', fmt(L.lumenEarned))}
          ${leader('Prism gathered', fmt(L.prismEarned))}
          ${leader('Best harvest', fmt(L.bestRun))}
          ${leader('Longest combo', fmt(L.bestCombo))}
          ${leader('Time under the stars', fmtTime(L.playTime))}
        </div>
        <div class="rule"></div>
        <div class="danger-zone"><span class="note">Erase every node, all Lumen and these records.</span><button class="text-btn danger reset">Begin anew</button></div>`;
      }
    }
  }

  private render() {
    const tabs = TABS.map(([t, l]) => `<button class="tab ${t === this.tab ? 'on' : ''}" data-tab="${t}">${l}</button>`).join('');
    this.modal.innerHTML = `
      <div class="title">Settings</div>
      <div class="tabs">${tabs}</div>
      <div class="rule"></div>
      <div class="settings-body">${this.body()}</div>
      <div class="rule"></div>
      <div class="foot"><button class="text-btn close">Close<kbd>esc</kbd></button></div>`;
    this.bind();
  }

  private set(k: string, v: string) {
    const s = this.state.settings;
    switch (k) {
      case 'preset': Object.assign(s, GRAPHICS_PRESETS[v as keyof typeof GRAPHICS_PRESETS]); break;
      case 'bloom': s.bloom = v as Settings['bloom']; break;
      case 'particles': s.particles = v as Settings['particles']; break;
      case 'background': s.background = v as Settings['background']; break;
      case 'darkness': s.darkness = v as Settings['darkness']; break;
      case 'resolution': case 'fpsCap': case 'uiScale':
      case 'volume': case 'sfxVolume': case 'uiVolume': case 'shake': case 'flashes':
        s[k] = Number(v); break;
      case 'showFps': case 'muteHidden': case 'reducedMotion': case 'cameraFx': case 'ripples':
      case 'slowmo': case 'ambient': case 'damageNumbers': case 'hints': case 'skipSummary':
        s[k] = v === '1'; break;
    }
    this.onChange(s);
  }

  private bind() {
    this.modal.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.tab as Tab;
      this.render();
    }));
    this.modal.querySelectorAll<HTMLElement>('.choice').forEach((c) => c.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        this.set(c.dataset.k!, b.dataset.v!);
        this.render(); // presets and reduced motion change other rows
      })));
    this.modal.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
      inp.parentElement!.querySelector('.sv')!.textContent = pct(Number(inp.value));
      this.set(inp.dataset.k!, inp.value);
    }));
    const reset = this.modal.querySelector<HTMLButtonElement>('.reset');
    if (reset) {
      let armed = false;
      reset.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          reset.textContent = 'Erase everything?';
          return;
        }
        this.onReset();
      });
    }
    this.modal.querySelector('.close')!.addEventListener('click', () => this.hide());
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
      <h1>The Seed Awakens</h1>
      <p>Four lights became one. The void is no longer dark: it blooms, endlessly, with everything you grew.</p>
      <div class="stats">
        <div><b>${fmtTime(L.playTime)}</b><span>beneath the stars</span></div>
        <div><b>${roman(Math.max(1, L.runs))}</b><span>harvests</span></div>
        <div><b>${fmt(L.shardsBroken)}</b><span>shards</span></div>
        <div><b>${fmt(L.lumenEarned)}</b><span>lumen</span></div>
      </div>
      <button class="rite"><span class="gem"></span>Keep blooming<span class="gem"></span></button></div>`;
    this.el.querySelector('button')!.addEventListener('click', () => {
      gsap.to(this.el, { opacity: 0, duration: 0.6, onComplete: () => { this.el.classList.remove('on'); this.onContinue(); } });
    });
    this.el.classList.add('on');
    gsap.timeline()
      .fromTo(this.el, { opacity: 0 }, { opacity: 1, duration: 1.2 })
      .fromTo(this.el.querySelector('h1'), { letterSpacing: '0.3em', opacity: 0 }, { letterSpacing: '0.02em', opacity: 1, duration: 2.2, ease: 'expo.out' }, 0.2)
      .fromTo(this.el.querySelectorAll('p, .stats > div, button'), { y: 16, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.15, duration: 0.8, ease: 'power3.out' }, 1.2);
  }
}

export const PRISM_CSS = hexToCss(PRISM_COLOR);
