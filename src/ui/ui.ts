import gsap from 'gsap';
import { fmt, fmtTime } from '../core/format';
import { hexToCss } from '../core/math';
import { GRAPHICS_PRESETS, progressOf, type GameState, type Settings, type TreeProgress } from '../core/state';
import { cloud, type CloudStatus } from '../core/cloud';
import {
  BRANCH_COLORS, BRANCH_NAMES, KIND_NAMES, PRISM_COLOR, lightCost, nodeColor, type NodeDef, type TreeDef, type TreeId, type TrialDef,
} from '../data/tree';
import { TREES, TREE_ORDER } from '../data/trees';
import { STAT_META, formatStat, type StatKey } from '../data/stats';
import {
  checkBuy, countable, currentTrial, forkSiblings, gateOf, isOwned, level, lightCap, lightUsed, needed, nextCost,
  nodeState, ownedCount, refundOf, sealedBy, statsFor, unweaveBlock,
} from '../systems/tree-logic';

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
  // limited light (the Hollow Crown): a small sun
  light: `<i class="glyph light">${SVG('<circle cx="10" cy="10" r="3.4" fill="currentColor" fill-opacity=".35"/><path d="M10 1.8v3.2M10 15v3.2M1.8 10h3.2M15 10h3.2M4.2 4.2l2.2 2.2M13.6 13.6l2.2 2.2M4.2 15.8l2.2-2.2M13.6 6.4l2.2-2.2"/>')}</i>`,
};
const ICON = {
  center: SVG('<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/><path d="M10 1v3.4M10 15.6V19M1 10h3.4M15.6 10H19"/>'),
  settings: SVG('<path d="M3 5.5h14M3 10h14M3 14.5h14" opacity=".55"/><path d="M7 3.6 8.9 5.5 7 7.4 5.1 5.5Z M13 8.1 14.9 10 13 11.9 11.1 10Z M8.5 12.6 10.4 14.5 8.5 16.4 6.6 14.5Z" fill="#0b0a12"/>'),
  sound: SVG('<path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M13.5 7.2a4 4 0 0 1 0 5.6M15.8 5a7 7 0 0 1 0 10"/>'),
  mute: SVG('<path d="M3.5 7.5h3l4-3.5v12l-4-3.5h-3z"/><path d="M13.5 7.5l5 5M18.5 7.5l-5 5"/>'),
  account: SVG('<circle cx="10" cy="7" r="3.3"/><path d="M3.8 17.2c.9-3.3 3.4-5 6.2-5s5.3 1.7 6.2 5"/>'),
};

const avatarUrl = (id: string, avatar: string) => `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64`;
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
  return { el, val: el.querySelector('.val') as HTMLElement, glyph: el.querySelector('.glyph') as HTMLElement, lbl: el.querySelector('.lbl') as HTMLElement };
}

/** Is this a touch-first device (no hover, no right-click)? */
export const touchFirst = () => window.matchMedia?.('(hover: none)').matches ?? false;

/** The finale's name on its button, per tree. */
export const FINALE_LABEL: Record<TreeId, string> = { bloom: 'Awaken the Seed', crown: 'Uncrown' };

const curName = (tree: TreeDef, c: 'lumen' | 'prism') => tree.currency[c].name;
const cap1 = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ───────────────────────────────────────────────────────────────────────────
export class TreeHud {
  readonly root = h('div', 'passthrough');
  readonly lumen: Counter;
  readonly prism: Counter;
  readonly lumenPill: HTMLElement;
  readonly prismPill: HTMLElement;
  readonly lightPill: HTMLElement;
  private lumenLbl: HTMLElement;
  private prismLbl: HTMLElement;
  private lightVal: HTMLElement;
  private lightShown = '';
  readonly harvestBtn: HTMLButtonElement;
  readonly awakenBtn: HTMLButtonElement;
  readonly settingsBtn: HTMLButtonElement;
  readonly accountBtn: HTMLButtonElement;
  readonly centerBtn: HTMLButtonElement;
  readonly muteBtn: HTMLButtonElement;
  /** the tree's name and progress; opens the tree picker once there is more than one tree */
  readonly chip: HTMLButtonElement;
  /** the next trial (the Hollow Crown) */
  readonly trial: HTMLElement;
  private hint: HTMLElement;
  private toasts: HTMLElement;

  constructor(host: HTMLElement) {
    const tl = h('div', 'hud-tl');
    const L = readout('lumen', GLYPH.lumen, 'lumen');
    const P = readout('prism', GLYPH.prism, 'prism');
    const LT = readout('light', GLYPH.light, 'light');
    this.lumenPill = L.el;
    this.prismPill = P.el;
    this.lightPill = LT.el;
    this.lumenLbl = L.lbl;
    this.prismLbl = P.lbl;
    this.lightVal = LT.val;
    tl.append(L.el, P.el, LT.el);
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
    this.accountBtn = btn(ICON.account, 'Sign in with Discord');
    this.accountBtn.classList.add('account-btn');
    tr.append(this.accountBtn, this.centerBtn, this.muteBtn, this.settingsBtn);

    this.chip = h('button', 'chip');

    const bottom = h('div', 'hud-bottom');
    const row = h('div', 'hud-row');
    this.harvestBtn = h('button', 'rite', '<span class="shine">Begin the Harvest</span><kbd>space</kbd>');
    this.awakenBtn = h('button', 'rite awaken');
    this.hint = h('div', 'hint');
    this.trial = h('div', 'trial');
    row.append(this.harvestBtn, this.awakenBtn);
    bottom.append(this.trial, row, this.hint);

    this.toasts = h('div', 'toasts');
    this.root.append(tl, tr, this.chip, bottom, this.toasts);
    host.append(this.root);

    // the light under the cursor on buttons and dialogs reads these (percentages, so UI zoom does not matter)
    document.addEventListener('pointermove', (e) => {
      const el = (e.target as Element).closest?.<HTMLElement>('.text-btn, .icon-btn, .rite, .modal, .tree-card');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
      el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    });
  }

  /** Hidden where there is no backend; the player's Discord avatar once signed in. */
  setAccount(c: typeof cloud) {
    const b = this.accountBtn;
    b.style.display = c.status === 'unavailable' ? 'none' : '';
    const u = c.user;
    b.title = u ? `Signed in as ${u.name}` : 'Sign in with Discord to save your progress in the cloud';
    b.setAttribute('aria-label', b.title);
    b.innerHTML = u?.avatar ? `<img src="${avatarUrl(u.id, u.avatar)}" alt="">` : ICON.account;
    b.classList.toggle('signed-in', !!u);
  }

  setMuted(muted: boolean) {
    this.muteBtn.innerHTML = muted ? ICON.mute : ICON.sound;
  }

  setHints(on: boolean) {
    this.hint.style.display = on ? '' : 'none';
  }

  /** canPick: more than one tree is open, so the chip opens the tree picker */
  sync(state: GameState, tree: TreeDef, animate = true, urge = false, canPick = false) {
    const p = progressOf(state, tree.id);
    this.lumen.set(p.lumen, animate);
    this.prism.set(p.prism, animate);
    this.lumenLbl.textContent = curName(tree, 'lumen');
    this.prismLbl.textContent = curName(tree, 'prism');
    const showPrism = !!tree.trials || p.prism > 0 || (p.levels.fortune_4a ?? 0) > 0;
    this.prismPill.classList.toggle('on', showPrism);
    this.harvestBtn.classList.toggle('urge', urge);

    // light: used of the cap, full is a warning
    this.lightPill.classList.toggle('on', !!tree.light);
    if (tree.light) {
      const used = lightUsed(tree, p.levels), cap = lightCap(tree, p);
      const txt = `${Math.max(0, cap - used)}<i> / ${cap}</i>`;
      if (txt !== this.lightShown) {
        if (this.lightShown && animate) gsap.fromTo(this.lightVal, { scale: 1.15 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
        this.lightShown = txt;
        this.lightVal.innerHTML = txt;
      }
      this.lightPill.classList.toggle('full', used >= cap);
      this.lightPill.title = `${Math.max(0, cap - used)} of ${cap} light free. Lighting a star uses some; unweaving it gives it back.`;
    }

    const total = countable(tree).length;
    const owned = ownedCount(tree, p.levels);
    const dots = tree.keystones.map((k) => {
      const c = hexToCss(BRANCH_COLORS[tree.map[k].branch]);
      return `<i class="${isOwned(p.levels, k) ? 'on' : ''}" style="color:${c}"></i>`;
    }).join('');
    this.chip.classList.toggle('pick', canPick);
    this.chip.title = canPick ? 'Your trees' : '';
    this.chip.innerHTML = `<span>${tree.name.replace(/^The /, 'the ')}</span><span class="num">${String(owned).padStart(2, '0')}<i> / </i>${total}</span><span class="ks" title="Keystones">${dots}</span>${canPick ? '<span class="caret"></span>' : ''}`;

    const aw = tree.map[tree.finale];
    const awOn = nodeState(tree, aw, p) === 'available' && !p.awakened;
    this.awakenBtn.classList.toggle('on', awOn);
    if (awOn) this.awakenBtn.innerHTML = `<span class="shine">${FINALE_LABEL[tree.id]}</span> <span class="cost">${costHtml(nextCost(aw, p.levels), p)}</span>`;

    // the next trial, and the best a harvest has come so far
    const t = currentTrial(tree, p);
    this.trial.classList.toggle('on', !!t && owned > 0);
    if (t) {
      const best = p.trialBest[t.id] ?? 0;
      const bestTxt = best > 0 && t.goal.kind !== 'boss' ? `<span class="best">best ${fmt(Math.floor(best))} / ${fmt(t.goal.n)}</span>` : '';
      this.trial.innerHTML = `<span class="tk">${t.name}</span><span class="tt">${t.text}</span>${bestTxt}`;
    }

    const touch = touchFirst();
    if (p.runs === 0) this.hint.innerHTML = `Touch the <b>${tree.id === 'crown' ? 'crown' : 'seed'}</b> to begin your first harvest`;
    else if (urge) this.hint.innerHTML = 'Nothing within reach yet. Gather more light.';
    else if (tree.light) this.hint.innerHTML = `drag to wander · touch a node to light it · ${touch ? 'hold' : 'right-click'} a lit star to unweave it`;
    else this.hint.innerHTML = 'drag to wander · scroll to look closer · touch a lit node to grow it';
  }

  toast(html: string, color = 'var(--accent)', duration = 2.6) {
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
  private current: { tree: TreeDef; def: NodeDef; p: TreeProgress } | null = null;
  private visible = false;

  constructor(host: HTMLElement) {
    host.append(this.el);
  }

  show(tree: TreeDef, def: NodeDef, p: TreeProgress, sx: number, sy: number, nodeR: number) {
    const changed = this.current?.def !== def;
    this.current = { tree, def, p };
    this.render();
    this.place(sx, sy, nodeR);
    if (!this.visible || changed) {
      this.visible = true;
      gsap.killTweensOf(this.el);
      gsap.fromTo(this.el, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.2, ease: 'power3.out' });
    }
  }

  refresh() {
    if (this.current && this.visible) this.render();
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

  private render() {
    if (!this.current) return;
    const { tree, def, p } = this.current;
    const st = nodeState(tree, def, p);
    const color = def.kind === 'awaken' || def.kind === 'core' ? 'var(--gold-hi)' : colorOf(def);
    this.el.style.setProperty('--c', color);
    const lvl = level(p.levels, def.id);
    const branch = def.branch2 ? `${BRANCH_NAMES[def.branch]} + ${BRANCH_NAMES[def.branch2]}` : BRANCH_NAMES[def.branch];

    if (st === 'silhouette') {
      this.el.innerHTML = `<span class="accent"></span><div class="tt-head"><span class="kind">uncharted</span></div>
        <div class="tt-name">Unknown star</div><div class="tt-desc">Grow a neighbouring node to bring it into the light.</div>`;
      return;
    }

    let stats = '';
    if (def.mods.length && def.kind !== 'core') {
      const cur = statsFor(tree, p.levels);
      const nxt = statsFor(tree, { ...p.levels, [def.id]: Math.min(lvl + 1, def.maxLevel) });
      const seen = new Set<StatKey>();
      for (const m of def.mods) {
        if (seen.has(m.stat)) continue;
        seen.add(m.stat);
        const a = formatStat(m.stat, cur[m.stat]);
        const b = formatStat(m.stat, nxt[m.stat]);
        // a curse's price reads red: the change goes the wrong way for the player
        const worse = STAT_META[m.stat].worse ? nxt[m.stat] > cur[m.stat] : nxt[m.stat] < cur[m.stat];
        const v = lvl >= def.maxLevel ? a : `${a}<span class="arrow">→</span><span class="next${worse ? ' worse' : ''}">${b}</span>`;
        stats += leader(STAT_META[m.stat].label, v);
      }
    }

    let req = '';
    if (st === 'locked') {
      const n = needed(def);
      const lead = n === def.parents.length && n > 1 ? 'Requires all of' : n > 1 ? `Requires ${n} of` : 'Requires one of';
      const items = def.parents.map((id) => `<div class="${isOwned(p.levels, id) ? 'met' : ''}">${tree.map[id].name}</div>`).join('');
      req = `<div class="tt-req"><span class="t">${lead}</span>${items}</div>`;
    }
    const gate = st === 'gated' ? gateOf(tree, def, p) : null;
    if (gate) req = `<div class="tt-gate"><span class="t">Sealed by ${gate.name}</span>Trial: ${gate.text}.</div>`;
    const by = st === 'sealed' ? sealedBy(tree, def, p.levels) : null;
    if (by) req = `<div class="tt-gate"><span class="t">Fork · ${esc(by.name)} is lit</span>Unweave ${esc(by.name)} to choose this instead.</div>`;
    let fork = '';
    if (def.fork && lvl === 0 && st !== 'sealed') {
      const other = forkSiblings(tree, def).map((n) => n.name).join(', ');
      fork = `<div class="tt-note"><span class="t">Fork</span>Lighting this seals ${esc(other)}.</div>`;
    }
    const curse = def.drawback ? `<div class="tt-curse"><span class="t">The price</span>${def.drawback}</div>` : '';

    let lvlText = '';
    if (def.kind !== 'core') {
      if (def.maxLevel > 1) {
        const pips = Array.from({ length: def.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        lvlText = `<span class="tt-lvl"><span class="pips">${pips}</span>${lvl ? `${roman(lvl)} / ${roman(def.maxLevel)}` : ''}</span>`;
      } else if (lvl) lvlText = '<span class="tt-lvl">grown</span>';
    }

    // limited light: what this star uses, or would use
    let light = '';
    if (tree.light && def.kind !== 'core') {
      const c = lightCost(def);
      const free = lightCap(tree, p) - lightUsed(tree, p.levels);
      const suns = c ? Array.from({ length: c }, () => '<i></i>').join('') : '';
      if (lvl > 0) light = c ? `<span class="tt-light">${suns}uses ${c} light</span>` : '<span class="tt-light none">burns no light</span>';
      else light = c ? `<span class="tt-light${c > free ? ' short' : ''}">${suns}${c} light${c > free ? ` · ${free} free` : ''}</span>` : '<span class="tt-light none">burns no light</span>';
    }

    let right = '';
    const fail = checkBuy(tree, def, p);
    if (def.kind === 'core') right = '<span class="tt-act">touch to harvest <kbd>space</kbd></span>';
    else if (lvl >= def.maxLevel) right = '<span class="tt-maxed">fully grown</span>';
    else if (fail?.reason === 'dark') right = '<span class="tt-maxed short">not enough light</span>';
    else if (st !== 'locked' && st !== 'gated' && st !== 'sealed') right = `<span class="tt-cost">${costHtml(nextCost(def, p.levels), p)}</span>`;

    // unweaving: what comes back, or what holds it in place
    let unweave = '';
    if (tree.light && lvl > 0 && def.kind !== 'core') {
      const block = unweaveBlock(tree, def, p);
      const how = touchFirst() ? 'Hold' : 'Right-click';
      if (block && typeof block === 'object') unweave = `<div class="tt-unweave">${esc(block.name)} grows from it, so it can't be unwoven.</div>`;
      else if (!block) unweave = `<div class="tt-unweave">${how} to unweave: back comes ${costText(refundOf(def, lvl), tree)} and its light.</div>`;
    }

    const kind = def.kind === 'core' ? 'origin' : `${KIND_NAMES[def.kind].toLowerCase()} · ${branch.toLowerCase()}`;
    const ready = st === 'available' || st === 'owned';
    const affordHint = ready && def.kind !== 'core' && !fail ? '<span>ready</span>' : '';
    const desc = def.desc.replace(/^KEYSTONE\. /, '');
    const foot = lvlText || right || light;
    this.el.innerHTML = `
      <span class="accent"></span>
      <div class="tt-head"><span class="kind">${kind}</span>${affordHint}</div>
      <div class="tt-name">${def.name}</div>
      <div class="tt-desc">${desc}</div>
      ${curse}
      ${stats || req || fork ? '<div class="rule"></div>' : ''}
      ${stats ? `<div class="tt-stats">${stats}</div>` : ''}
      ${req}${fork}
      ${foot ? `<div class="rule"></div><div class="tt-foot">${lvlText || light || '<span></span>'}${right}</div>` : ''}
      ${lvlText && light ? `<div class="tt-foot2">${light}</div>` : ''}
      ${unweave}`;
  }
}

/** "1.2K gloam and 3 sigils" */
function costText(c: Partial<Record<'lumen' | 'prism', number>>, tree: TreeDef): string {
  const parts: string[] = [];
  if (c.lumen) parts.push(`${fmt(c.lumen)} ${curName(tree, 'lumen')}`);
  if (c.prism) parts.push(`${fmt(c.prism)} ${curName(tree, 'prism')}`);
  return parts.join(' and ') || 'nothing';
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
  private prismLbl: HTMLElement;
  private timer: HTMLElement;
  private fill: HTMLElement;
  private tText: HTMLElement;
  private tLabel: HTMLElement;
  private trialEl: HTMLElement;
  private combo: HTMLElement;
  private comboX: HTMLElement;
  private comboLbl: HTMLElement;
  private comboMeter: HTMLElement;
  private kills: HTMLElement;
  private banner: HTMLElement;
  readonly settingsBtn: HTMLButtonElement;
  private lastCombo = 0;
  private tree: TreeDef = TREES.bloom;

  constructor(host: HTMLElement) {
    const tl = h('div', 'hud-tl');
    const L = readout('lumen', GLYPH.lumen, 'gathered');
    const P = readout('prism', GLYPH.prism, 'prism');
    this.lumenPill = L.el;
    this.prismPill = P.el;
    this.lumenGlyph = L.glyph;
    this.prismGlyph = P.glyph;
    this.prismLbl = P.lbl;
    tl.append(L.el, P.el);
    this.lumen = new Counter(L.val);
    this.prism = new Counter(P.val);

    this.timer = h('div', 'timer', `<div class="timer-row"><span class="lbl">the harvest</span><span class="t">0.0</span></div><div class="timer-bar"><div class="timer-fill"></div></div><div class="htrial"></div>`);
    this.fill = this.timer.querySelector('.timer-fill')!;
    this.tText = this.timer.querySelector('.t')!;
    this.tLabel = this.timer.querySelector('.lbl')!;
    this.trialEl = this.timer.querySelector('.htrial')!;

    this.combo = h('div', 'combo', `<div class="x">×1.00</div><div class="lbl">combo 0</div><div class="meter"><i></i></div>`);
    this.comboX = this.combo.querySelector('.x')!;
    this.comboLbl = this.combo.querySelector('.lbl')!;
    this.comboMeter = this.combo.querySelector('.meter i')!;
    this.combo.style.display = 'none';

    this.kills = h('div', 'kills', 'shards broken<b>0</b>');
    this.banner = h('div', 'banner');
    this.settingsBtn = h('button', 'icon-btn hh-settings', ICON.settings);
    this.settingsBtn.title = 'Pause and settings (Esc)';
    this.settingsBtn.setAttribute('aria-label', this.settingsBtn.title);
    this.root.append(tl, this.timer, this.combo, this.kills, this.banner, this.settingsBtn);
    host.append(this.root);
    gsap.set(this.root, { autoAlpha: 0 });
  }

  show(on: boolean, comboEnabled = false, prismEnabled = false, tree?: TreeDef) {
    if (tree) {
      this.tree = tree;
      this.prismLbl.textContent = curName(tree, 'prism');
    }
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

  /** The trial this harvest is trying for, and how far it has got. */
  setTrial(t: TrialDef | null, v: number) {
    this.trialEl.classList.remove('done');
    this.trialEl.style.display = t ? '' : 'none';
    if (!t) return;
    const unit = t.goal.kind === 'gather' ? ` ${curName(this.tree, 'lumen')}` : t.goal.kind === 'hazards' ? ' hazards' : t.goal.kind === 'kills' ? ' shards' : '';
    this.trialEl.innerHTML = t.goal.kind === 'boss'
      ? `<span>trial</span><b>${t.text.toLowerCase()}</b>`
      : `<span>trial · ${t.name.toLowerCase()}</span><b>${fmt(Math.min(v, t.goal.n))} / ${fmt(t.goal.n)}${unit}</b>`;
  }

  trialPassed(t: TrialDef, banner = true) {
    this.trialEl.classList.add('done');
    this.trialEl.innerHTML = `<span>trial passed</span><b>${t.name}</b>`;
    gsap.fromTo(this.trialEl, { scale: 1.25 }, { scale: 1, duration: 0.6, ease: 'back.out(3)' });
    if (banner) this.showBanner('Trial passed', t.name, 'rgba(216,204,255,0.85)');
  }

  addTimeFx() {
    gsap.fromTo(this.tText, { color: '#8fd3ff', scale: 1.15 }, { color: '#ececf1', scale: 1, duration: 0.5, ease: 'back.out(3)' });
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
    this.banner.style.setProperty('--glow', color || 'rgba(184, 168, 255, 0.6)');
    gsap.killTweensOf(this.banner);
    gsap.timeline()
      .fromTo(this.banner, { opacity: 0, y: 10, letterSpacing: '0.2em' }, { opacity: 1, y: 0, letterSpacing: '0.04em', duration: 0.7, ease: 'expo.out' })
      .to(this.banner, { opacity: 0, y: -6, duration: 0.6, delay: sub.length > 30 ? 1.6 : 0.8, ease: 'power2.in' });
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
  /** the Hollow Crown: hazards broken, the Hollow Heart broken, gloam thieves got away with, trial met */
  hazards: number;
  boss: number;
  /** how broken the Hollow Heart is after this harvest, its old wounds included (null: it did not rise) */
  bossWounds: number | null;
  stolen: number;
  trial: boolean;
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

  /** trial: the trial this harvest went for, if any */
  show(r: RunResult, record: boolean, p: TreeProgress, tree: TreeDef, trial: TrialDef | null) {
    this.open = true;
    const A = curName(tree, 'lumen'), B = curName(tree, 'prism');
    let trialRow = '';
    if (trial) {
      trialRow = r.trial
        ? `<div class="sum-trial done"><span>trial passed</span><b>${trial.name}</b><span>${tree.trials && trial.ring ? 'a ring opens · +' + trial.light + ' light' : 'the crown can be broken'}</span></div>`
        : `<div class="sum-trial"><span>trial · ${trial.name.toLowerCase()}</span><b>${trial.text}</b></div>`;
    }
    const rows = [
      r.prism > 0 ? leader(cap1(B), `${GLYPH.prism}+${fmt(r.prism)}`) : '',
      leader('Shards broken', fmt(r.kills)),
      tree.trials ? leader('Hazards broken', fmt(r.hazards)) : '',
      r.stolen > 0 ? leader('Stolen by thieves', `<span class="bad">-${fmt(r.stolen)}</span>`) : '',
      r.hearts > 0 ? leader('Heart crystals', String(r.hearts)) : '',
      r.boss > 0 ? leader('The Hollow Heart', 'shattered') : r.bossWounds != null ? leader('The Hollow Heart', `${Math.round(r.bossWounds * 100)}% broken`) : '',
      r.bestCombo > 1 ? leader('Longest combo', String(r.bestCombo)) : '',
      leader('Length of night', `${r.duration.toFixed(1)}s`),
      leader(`${cap1(A)} in store`, `${GLYPH.lumen}${fmt(p.lumen)}`),
    ].join('');
    this.modal.innerHTML = `
      <div class="title">Harvest ${roman(p.runs)}</div>
      <div class="sum-main">
        <div class="big">${GLYPH.lumen}<span class="lv">0</span></div>
        <div class="sub">${A} gathered</div>
        ${record ? '<div class="record">New record</div>' : ''}
      </div>
      ${trialRow}
      <div class="rule orn"></div>
      <div class="sum-rows">${rows}</div>
      <div class="rule"></div>
      <div class="sum-actions">
        <button class="text-btn again">Again<kbd>r</kbd></button>
        <button class="text-btn primary cont"><span class="shine">To the ${tree.id === 'crown' ? 'Crown' : 'Bloom'}</span><kbd>space</kbd></button>
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
      .fromTo(this.modal.querySelector('.sum-trial'), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.5 }, 0.5)
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
/** The trees: where you are, how far each has come, and the way to the next. */
export class TreePicker {
  readonly wrap = h('div', 'modal-wrap');
  private modal = h('div', 'modal plate double picker');
  onPick: (id: TreeId) => void = () => {};
  open = false;

  constructor(host: HTMLElement) {
    this.wrap.append(this.modal);
    host.append(this.wrap);
    this.wrap.addEventListener('pointerdown', (e) => { if (e.target === this.wrap) this.hide(); });
  }

  show(state: GameState, unlocked: (id: TreeId) => boolean) {
    this.open = true;
    const cards = TREE_ORDER.map((id) => {
      const tree = TREES[id];
      const p = progressOf(state, id);
      const on = unlocked(id);
      const here = state.active === id;
      const owned = ownedCount(tree, p.levels), total = countable(tree).length;
      const status = !on ? 'Awaken the seed to find it'
        : p.awakened ? `${tree.id === 'crown' ? 'Uncrowned' : 'Awakened'} · ${owned} / ${total} stars`
        : p.runs === 0 ? 'Not yet begun'
        : `${owned} / ${total} stars · ${p.runs} harvest${p.runs === 1 ? '' : 's'}`;
      return `<button class="tree-card${here ? ' here' : ''}${on ? '' : ' locked'}" data-id="${id}" ${on ? '' : 'disabled'}>
        <span class="tc-num">${tree.numeral}</span>
        <span class="tc-body"><span class="tc-name">${on ? tree.name : 'Unknown'}</span>
        <span class="tc-blurb">${on ? tree.blurb : 'Something waits beyond the Bloom.'}</span>
        <span class="tc-status">${status}</span></span>
        ${here ? '<span class="tc-here">you are here</span>' : ''}</button>`;
    }).join('');
    this.modal.innerHTML = `<div class="title">Your trees</div><div class="tree-cards">${cards}</div>
      <div class="rule"></div><div class="foot"><span class="note">Each tree keeps its own light. Nothing carries over between them.</span><button class="text-btn close">Close<kbd>esc</kbd></button></div>`;
    this.modal.querySelectorAll<HTMLButtonElement>('.tree-card').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id as TreeId;
      this.hide();
      if (id !== state.active) this.onPick(id);
    }));
    this.modal.querySelector('.close')!.addEventListener('click', () => this.hide());
    this.wrap.classList.add('on');
    gsap.fromTo(this.modal, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'expo.out' });
    gsap.fromTo(this.wrap, { opacity: 0 }, { opacity: 1, duration: 0.25 });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    gsap.to(this.wrap, { opacity: 0, duration: 0.2, onComplete: () => this.wrap.classList.remove('on') });
  }
}

// ───────────────────────────────────────────────────────────────────────────
type Tab = 'graphics' | 'motion' | 'sound' | 'interface' | 'records' | 'account';
export type SettingsTab = Tab;
const TABS: [Tab, string][] = [['graphics', 'Graphics'], ['motion', 'Motion'], ['sound', 'Sound'], ['interface', 'Interface'], ['records', 'Records'], ['account', 'Account']];
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
  private endRun: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.wrap.append(this.modal);
    host.append(this.wrap);
    this.wrap.addEventListener('pointerdown', (e) => { if (e.target === this.wrap) this.hide(); });
  }

  /** endRun: when given (opened from a harvest), the footer offers to end the run early. */
  show(state: GameState, endRun: (() => void) | null = null, tab?: Tab) {
    this.state = state;
    this.endRun = endRun;
    if (tab) this.tab = tab;
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

  /** Cloud status changed: redraw if the Account tab is the one showing. */
  refreshAccount() {
    if (this.open && this.tab === 'account') this.render();
  }

  private account(): string {
    if (cloud.status === 'unavailable') return '<div class="note">Cloud saves are available on the hosted version of the game. Your progress is saved in this browser.</div>';
    const u = cloud.user;
    if (!u) {
      return `<div class="note">Sign in with Discord to keep your progress in the cloud and continue on any device. Only your Discord name and avatar are used.</div>
        <div class="account-actions"><a class="text-btn primary" href="/api/login"><span class="shine">Sign in with Discord</span></a></div>`;
    }
    const ago = cloud.lastSync ? fmtTime(Math.max(1, (Date.now() - cloud.lastSync) / 1000)) + ' ago' : 'not yet';
    const status: Record<CloudStatus, string> = {
      unavailable: '', 'signed-out': '', saving: 'Saving…', synced: `Saved ${ago}`,
      behind: 'Another device saved newer progress. Reload to continue from it.',
      error: 'Could not reach the cloud. It retries with the next save.',
    };
    const face = u.avatar ? `<img class="avatar" src="${avatarUrl(u.id, u.avatar)}" alt="">` : '';
    return [
      row('Signed in as', `<span class="who">${face}${esc(u.name)}</span>`),
      row('Cloud save', esc(status[cloud.status])),
      `<div class="account-actions"><span class="note">Signing out keeps your progress in this browser.</span><a class="text-btn" href="/api/logout">Sign out</a></div>`,
    ].join('');
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
          row('Edge smoothing', choice('antialias', [['auto', 'auto'], ['on', 'on'], ['off', 'off']], s.antialias), 'Auto smooths edges only where it shows: on lower-density screens. "On" costs a lot of GPU time.'),
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
          '<div class="rule"></div>',
          row('Music', slider('musicVolume', s.musicVolume)),
          row('Soundtrack', choice('musicTrack', [['all', 'all'], ['adrift', 'Adrift'], ['hymn', 'Hymn'], ['cirrus', 'Cirrus'], ['hope', 'Hope']], s.musicTrack), 'By Scott Buckley (scottbuckley.com.au), CC-BY 4.0. "All" plays the four pieces in turn.'),
          row('Music in the harvest', choice('harvestMusic', [['full', 'full'], ['soft', 'soft'], ['off', 'off']], s.harvestMusic), 'Lower or silence the music while you harvest.'),
          '<div class="rule"></div>',
          row('Shattering', slider('sfxVolume', s.sfxVolume), 'Crystals breaking in a harvest.'),
          row('Special shards', slider('specialVolume', s.specialVolume), 'Chimes and gongs for gold, time, prism and heart crystals.'),
          row('Interface', slider('uiVolume', s.uiVolume), 'Growing nodes, menu clicks and the finale.'),
          row('Hover sounds', toggle('hoverSounds', s.hoverSounds), 'The soft note when the cursor finds a node.'),
          row('Reverb', slider('reverb', s.reverb), 'How long sounds ring out into the void.'),
          '<div class="rule"></div>',
          row('Silent in background', toggle('muteHidden', s.muteHidden), 'Pause all sound while the tab is hidden.'),
        ].join('');
      case 'interface':
        return [
          row('Interface size', choice('uiScale', UI_SIZES, String(s.uiScale))),
          row('Damage numbers', toggle('damageNumbers', s.damageNumbers)),
          row('Hints', toggle('hints', s.hints), 'Help lines under the harvest button and first-time tips.'),
          row('Skip harvest summary', toggle('skipSummary', s.skipSummary), 'Go straight back to the Bloom; the result shows as a short line instead.'),
        ].join('');
      case 'account':
        return this.account();
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
        <div class="danger-zone"><span class="note">Erase both trees, all their light and these records.</span><button class="text-btn danger reset">Begin anew</button></div>`;
      }
    }
  }

  private render() {
    const tabs = TABS.map(([t, l]) => `<button class="tab ${t === this.tab ? 'on' : ''}" data-tab="${t}">${l}</button>`).join('');
    this.modal.innerHTML = `
      <div class="title">Settings</div>
      <div class="tabs">${tabs}</div>
      <div class="settings-body">${this.body()}</div>
      <div class="rule"></div>
      <div class="foot">${this.endRun ? '<button class="text-btn danger end">End harvest</button>' : ''}<button class="text-btn close">${this.endRun ? 'Resume' : 'Close'}<kbd>esc</kbd></button></div>`;
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
      case 'antialias': s.antialias = v as Settings['antialias']; break;
      case 'musicTrack': s.musicTrack = v as Settings['musicTrack']; break;
      case 'harvestMusic': s.harvestMusic = v as Settings['harvestMusic']; break;
      case 'resolution': case 'fpsCap': case 'uiScale':
      case 'volume': case 'sfxVolume': case 'specialVolume': case 'uiVolume': case 'musicVolume': case 'reverb': case 'shake': case 'flashes':
        s[k] = Number(v); break;
      case 'showFps': case 'muteHidden': case 'reducedMotion': case 'cameraFx': case 'ripples':
      case 'slowmo': case 'ambient': case 'damageNumbers': case 'hints': case 'skipSummary': case 'hoverSounds':
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
    this.modal.querySelector('.end')?.addEventListener('click', () => {
      const end = this.endRun;
      this.hide();
      end?.();
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
export class Ending {
  readonly el = h('div', 'ending');
  /** onward: the player chose to go on to the next tree */
  onContinue: (onward: boolean) => void = () => {};
  constructor(host: HTMLElement) {
    host.append(this.el);
  }
  show(state: GameState, tree: TreeDef) {
    const p = progressOf(state, tree.id);
    const L = state.lifetime;
    const crown = tree.id === 'crown';
    // the Bloom's end opens the way to the Hollow Crown
    const onward = !crown && state.crown.runs === 0;
    const text = crown
      ? { h: 'Uncrowned', p: 'The hollow crown breaks, and the light you grew pours into it. What was empty is full.' }
      : { h: 'The Seed Awakens', p: onward
        ? 'Four lights became one. In the new light you can see where the seed fell from: a hollow crown, far out in the dark.'
        : 'Four lights became one. The void is no longer dark: it blooms, endlessly, with everything you grew.' };
    this.el.innerHTML = `<div>
      <h1>${text.h}</h1>
      <p>${text.p}</p>
      <div class="stats">
        <div><b>${fmtTime(L.playTime)}</b><span>beneath the stars</span></div>
        <div><b>${roman(Math.max(1, p.runs))}</b><span>harvests</span></div>
        <div><b>${fmt(L.shardsBroken)}</b><span>shards</span></div>
        <div><b>${fmt(crown ? p.bestRun : L.lumenEarned)}</b><span>${crown ? 'best harvest' : 'lumen'}</span></div>
      </div>
      <div class="ending-actions">
        ${onward ? '<button class="text-btn stay">Stay in the Bloom</button><button class="rite onward"><span class="shine">Journey to the Hollow Crown</span></button>'
        : `<button class="rite stay"><span class="shine">${crown ? 'Keep the crown' : 'Keep blooming'}</span></button>`}
      </div></div>`;
    const leave = (go: boolean) => gsap.to(this.el, { opacity: 0, duration: 0.6, onComplete: () => { this.el.classList.remove('on'); this.onContinue(go); } });
    this.el.querySelector('.stay')!.addEventListener('click', () => leave(false));
    this.el.querySelector('.onward')?.addEventListener('click', () => leave(true));
    this.el.classList.add('on');
    gsap.timeline()
      .fromTo(this.el, { opacity: 0 }, { opacity: 1, duration: 1.2 })
      .fromTo(this.el.querySelector('h1'), { letterSpacing: '0.3em', opacity: 0 }, { letterSpacing: '0.02em', opacity: 1, duration: 2.2, ease: 'expo.out' }, 0.2)
      .fromTo(this.el.querySelectorAll('p, .stats > div, .ending-actions > *'), { y: 16, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.15, duration: 0.8, ease: 'power3.out' }, 1.2);
  }
}

export const PRISM_CSS = hexToCss(PRISM_COLOR);
