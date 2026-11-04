import gsap from 'gsap';
import { LEGACY_TIPS, type GameState, type TreeProgress } from '../core/state';
import type { NodeDef, TreeDef } from '../data/tree';
import { currentTrial, isOwned, lightCap, lightUsed, nodeState, ownedCount, checkBuy, nextCost } from '../systems/tree-logic';
import { h, touchFirst } from './ui';

/** What tips can see of the game. */
export interface TipContext {
  state: GameState;
  tree: TreeDef;
  p: TreeProgress;
  /** a node's position on screen, or null while it is not visible */
  nodeAt(id: string): { x: number; y: number; r: number } | null;
  el: { light: HTMLElement; prism: HTMLElement; trial: HTMLElement; awaken: HTMLElement; harvest: HTMLElement; chip: HTMLElement };
}

type Anchor = { node: string } | { el: HTMLElement } | null;

interface TipDef {
  id: string;
  tree: TreeDef['id'];
  title: string;
  body: (c: TipContext) => string;
  when: (c: TipContext) => boolean;
  at: (c: TipContext) => Anchor;
}

const visible = (c: TipContext, n: NodeDef) => nodeState(c.tree, n, c.p) !== 'hidden';
const find = (c: TipContext, f: (n: NodeDef) => boolean) => c.tree.nodes.find((n) => n.kind !== 'awaken' && f(n));
const stateOf = (c: TipContext, n: NodeDef) => nodeState(c.tree, n, c.p);
const node = (n: NodeDef | undefined): Anchor => (n ? { node: n.id } : null);
const seenTip = (c: TipContext, id: string) => c.state.tips.includes(id);

/**
 * The tutorial: the Bloom explains itself one idea at a time, the moment each one first appears.
 * The Hollow Crown explains only what is new in it.
 */
const TIPS: TipDef[] = [
  // ── the Bloom ──
  {
    id: 'bloom-welcome', tree: 'bloom', title: 'The Bloom',
    body: () => 'This is your upgrade tree. Every star you grow makes your harvests stronger. Touch the seed at its centre, or this button, to begin your first harvest.',
    when: (c) => c.p.runs === 0, at: (c) => ({ el: c.el.harvest }),
  },
  {
    id: 'bloom-spend', tree: 'bloom', title: 'Spend your light',
    body: () => 'The nodes around the seed are ready to grow. Touch one to spend the Lumen you gathered on it.',
    when: (c) => c.p.runs > 0 && ownedCount(c.tree, c.p.levels) === 0,
    at: (c) => node(c.tree.nodes.filter((n) => n.ring === 1).sort((a, b) => (nextCost(a, c.p.levels).lumen ?? 0) - (nextCost(b, c.p.levels).lumen ?? 0))[0]),
  },
  {
    id: 'bloom-levels', tree: 'bloom', title: 'Grow it again',
    body: () => 'Most stars grow several times: the ring around one shows its level. Each level costs more than the last.',
    when: (c) => !!find(c, (n) => n.maxLevel > 1 && isOwned(c.p.levels, n.id) && stateOf(c, n) === 'owned'),
    at: (c) => node(find(c, (n) => n.maxLevel > 1 && isOwned(c.p.levels, n.id) && stateOf(c, n) === 'owned')),
  },
  {
    id: 'bloom-unknown', tree: 'bloom', title: 'Uncharted stars',
    body: () => 'A faint star with a question mark is one you have not reached yet. Grow the star beside it to bring it into the light.',
    when: (c) => ownedCount(c.tree, c.p.levels) >= 2 && !!find(c, (n) => stateOf(c, n) === 'silhouette'),
    at: (c) => node(find(c, (n) => stateOf(c, n) === 'silhouette')),
  },
  {
    id: 'bloom-mechanic', tree: 'bloom', title: 'A new power',
    body: () => 'Hexagons are mechanics. They change how a harvest plays, not just its numbers.',
    when: (c) => !!find(c, (n) => n.kind === 'major' && stateOf(c, n) === 'available'),
    at: (c) => node(find(c, (n) => n.kind === 'major' && stateOf(c, n) === 'available')),
  },
  {
    id: 'bloom-synergy', tree: 'bloom', title: 'Synergies',
    body: () => 'Diamonds join two branches. One can only be grown once every star it grows from is lit.',
    when: (c) => !!find(c, (n) => n.kind === 'synergy' && (stateOf(c, n) === 'locked' || stateOf(c, n) === 'available')),
    at: (c) => node(find(c, (n) => n.kind === 'synergy' && (stateOf(c, n) === 'locked' || stateOf(c, n) === 'available'))),
  },
  {
    id: 'bloom-prism', tree: 'bloom', title: 'Prism',
    body: () => 'The rarest light. It drops from prism shards, and the keystones and the outer stars ask for it.',
    when: (c) => c.p.prism > 0, at: (c) => ({ el: c.el.prism }),
  },
  {
    id: 'bloom-keystone', tree: 'bloom', title: 'Keystones',
    body: () => 'The crown of a branch, and the strongest star on it. Light all four keystones to awaken the seed.',
    when: (c) => !!find(c, (n) => n.kind === 'keystone' && visible(c, n) && stateOf(c, n) !== 'silhouette'),
    at: (c) => node(find(c, (n) => n.kind === 'keystone' && visible(c, n) && stateOf(c, n) !== 'silhouette')),
  },
  {
    id: 'bloom-awaken', tree: 'bloom', title: 'The seed is ready',
    body: () => 'All four keystones are lit. Pour their light back into the seed, and see what lies beyond the Bloom.',
    when: (c) => stateOf(c, c.tree.map[c.tree.finale]) === 'available' && !c.p.awakened, at: (c) => ({ el: c.el.awaken }),
  },
  {
    id: 'bloom-beyond', tree: 'bloom', title: 'Beyond the Bloom',
    body: () => 'In the light of the awakened seed you can see where it fell from. Open your trees to journey to the Hollow Crown.',
    when: (c) => c.p.awakened && c.state.crown.runs === 0, at: (c) => ({ el: c.el.chip }),
  },

  // ── the Hollow Crown ──
  {
    id: 'crown-welcome', tree: 'crown', title: 'The Hollow Crown',
    body: () => 'A harder tree with its own light and its own rules. Nothing from the Bloom carries over: you begin again with nothing.',
    when: (c) => c.p.runs === 0, at: (c) => ({ el: c.el.harvest }),
  },
  {
    id: 'crown-light', tree: 'crown', title: 'Limited light',
    body: () => 'Every star you light uses light: one for small stars, two for mechanics and synergies, three for keystones. There is never enough for everything, so choose.',
    when: (c) => seenTip(c, 'crown-welcome'), at: (c) => ({ el: c.el.light }),
  },
  {
    id: 'crown-sigils', tree: 'crown', title: 'Sigils',
    body: () => 'Only hazards, the shards that fight back, drop Sigils. The deeper stars ask for them.',
    when: (c) => c.p.prism > 0, at: (c) => ({ el: c.el.prism }),
  },
  {
    id: 'crown-trial', tree: 'crown', title: 'Trials',
    body: () => 'The rings beyond are sealed. Meet a gate\'s trial in a single harvest to open it: every gate also gives you more light.',
    when: (c) => !!currentTrial(c.tree, c.p) && ownedCount(c.tree, c.p.levels) > 0, at: (c) => ({ el: c.el.trial }),
  },
  {
    id: 'crown-unweave', tree: 'crown', title: 'Unweave',
    body: () => `${touchFirst() ? 'Hold' : 'Right-click'} a lit star to make it dark again. You get back three quarters of what it cost, and all of its light.`,
    when: (c) => lightUsed(c.tree, c.p.levels) >= lightCap(c.tree, c.p) - 1 && ownedCount(c.tree, c.p.levels) >= 3,
    at: (c) => node(find(c, (n) => isOwned(c.p.levels, n.id) && n.kind !== 'core' && (c.tree.children[n.id] ?? []).every((k) => !isOwned(c.p.levels, k)))),
  },
  {
    id: 'crown-fork', tree: 'crown', title: 'Forks',
    body: () => 'Two stars, one choice. Lighting one seals the other, until you unweave it.',
    when: (c) => !!find(c, (n) => !!n.fork && ['available', 'locked'].includes(stateOf(c, n))),
    at: (c) => node(find(c, (n) => !!n.fork && ['available', 'locked'].includes(stateOf(c, n)))),
  },
  {
    id: 'crown-curse', tree: 'crown', title: 'Curses',
    body: () => 'Great power at a price. Curses burn no light, but they take something from every harvest.',
    when: (c) => !!find(c, (n) => n.kind === 'curse' && ['available', 'locked'].includes(stateOf(c, n))),
    at: (c) => node(find(c, (n) => n.kind === 'curse' && ['available', 'locked'].includes(stateOf(c, n)))),
  },
  {
    id: 'crown-heart', tree: 'crown', title: 'The Hollow Heart',
    body: () => 'Every gate is open. From now on the heart of the crown rises in every harvest: shatter it to pass the last trial.',
    when: (c) => currentTrial(c.tree, c.p)?.goal.kind === 'boss', at: (c) => ({ el: c.el.harvest }),
  },
  {
    id: 'crown-finale', tree: 'crown', title: 'Uncrown',
    body: () => 'The heart is broken. With two keystones lit, the crown itself can be broken.',
    when: (c) => checkBuy(c.tree, c.tree.map[c.tree.finale], c.p)?.reason !== 'gated' && c.p.trials.includes('heart') && !c.p.awakened,
    at: (c) => ({ el: c.el.awaken }),
  },
];

/** The tip card: a small panel pointing at what it explains, until it is dismissed. */
export class Tips {
  private el = h('div', 'tipcard plate');
  private current: TipDef | null = null;
  private anchor: Anchor = null;
  private ctx!: () => TipContext;
  enabled = true;
  /** UI zoom (the overlay is CSS-zoomed) */
  scale = 1;

  constructor(host: HTMLElement) {
    host.append(this.el);
    this.el.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.tip-ok')) this.hide();
    });
  }

  bind(ctx: () => TipContext) {
    this.ctx = ctx;
    // a save from before there were tips: what the player is already past stays unsaid
    const c = ctx();
    const i = c.state.tips.indexOf(LEGACY_TIPS);
    if (i >= 0) {
      c.state.tips.splice(i, 1);
      // ...except the way to the Hollow Crown, which is new to them too
      for (const t of TIPS) if (t.tree === 'bloom' && t.id !== 'bloom-beyond' && t.when(c)) c.state.tips.push(t.id);
      c.state.tips.push('bloom-welcome', 'bloom-spend');
    }
  }

  get showing() {
    return !!this.current;
  }

  /** Show the next tip that applies, if none is showing; a showing tip the player has already acted on goes away. */
  check() {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx();
    if (this.current) {
      if (this.current.tree !== c.tree.id || !this.current.when(c)) this.hide();
      return;
    }
    const tip = TIPS.find((t) => t.tree === c.tree.id && !c.state.tips.includes(t.id) && t.when(c));
    if (!tip) return;
    const anchor = tip.at(c);
    if (anchor && 'el' in anchor && anchor.el.getBoundingClientRect().width === 0) return; // what it points at is not on screen yet
    c.state.tips.push(tip.id);
    this.current = tip;
    this.anchor = anchor;
    this.el.innerHTML = `<span class="accent"></span><div class="tip-k">tip</div><div class="tip-t">${tip.title}</div><div class="tip-b">${tip.body(c)}</div>
      <div class="tip-f"><button class="text-btn tip-ok">Got it</button></div><i class="tip-arrow"></i>`;
    this.el.classList.add('on');
    this.place();
    gsap.killTweensOf(this.el);
    gsap.fromTo(this.el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, ease: 'expo.out' });
  }

  hide(then?: () => void) {
    if (!this.current) { then?.(); return; }
    this.current = null;
    gsap.killTweensOf(this.el);
    gsap.to(this.el, {
      opacity: 0, y: -6, duration: 0.2, onComplete: () => {
        this.el.classList.remove('on');
        then?.();
        // the next one, if there is one waiting
        gsap.delayedCall(0.5, () => this.check());
      },
    });
  }

  /** Follow what the tip points at (nodes move with the camera). */
  update() {
    if (this.current) this.place();
  }

  private place() {
    const z = this.scale;
    const w = (this.el.offsetWidth || 280) * z, hh = (this.el.offsetHeight || 140) * z;
    const W = window.innerWidth, H = window.innerHeight;
    let x = W / 2 - w / 2, y = H - hh - 150 * z;
    let side: 'left' | 'right' | 'top' | 'bottom' | 'none' = 'none';
    const a = this.anchor;
    let ax = 0, ay = 0;
    if (a && 'node' in a) {
      const n = this.ctx().nodeAt(a.node);
      if (n) {
        // to the left of the node: the hover tooltip opens on the right
        ax = n.x; ay = n.y;
        x = n.x - n.r - 26 - w;
        side = 'right';
        if (x < 12) { x = n.x + n.r + 26; side = 'left'; }
        y = Math.min(Math.max(12, n.y - hh / 2), H - hh - 12);
      }
    } else if (a && 'el' in a) {
      const r = a.el.getBoundingClientRect();
      ax = r.left + r.width / 2; ay = r.top + r.height / 2;
      x = Math.min(Math.max(12, ax - w / 2), W - w - 12);
      if (r.top < H / 2) { y = r.bottom + 16 * z; side = 'top'; } else { y = r.top - hh - 16 * z; side = 'bottom'; }
    }
    this.el.style.left = `${Math.round(x / z)}px`;
    this.el.style.top = `${Math.round(y / z)}px`;
    this.el.dataset.side = side;
    const arrow = this.el.querySelector<HTMLElement>('.tip-arrow');
    if (arrow) {
      if (side === 'left' || side === 'right') arrow.style.top = `${Math.round(Math.min(Math.max(16, (ay - y) / z), hh / z - 16))}px`;
      else arrow.style.top = '';
      if (side === 'top' || side === 'bottom') arrow.style.left = `${Math.round(Math.min(Math.max(16, (ax - x) / z), w / z - 16))}px`;
      else arrow.style.left = '';
    }
  }
}
