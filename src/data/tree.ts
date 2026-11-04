import type { Mod, Stats } from './stats';

/** The trees of the game: the Bloom (I, the tutorial) and the Hollow Crown (II). */
export type TreeId = 'bloom' | 'crown';

export type Branch =
  | 'core'
  // the Bloom
  | 'force' | 'reach' | 'flow' | 'fortune'
  // the Hollow Crown
  | 'ember' | 'frost' | 'storm' | 'tide' | 'gild' | 'hollow';

export type NodeKind = 'core' | 'minor' | 'major' | 'synergy' | 'keystone' | 'curse' | 'awaken';

/**
 * Currency slots. Every tree has a common and a rare currency; each tree names them itself
 * (the Bloom: Lumen and Prism, the Hollow Crown: Gloam and Sigils).
 */
export type Currency = 'lumen' | 'prism';

export type IconKey =
  | 'seed' | 'blade' | 'aperture' | 'hourglass' | 'gem' | 'pulse' | 'crosshair' | 'comet'
  | 'bolt' | 'sprout' | 'cluster' | 'coin' | 'rhythm' | 'flare' | 'sun' | 'crack' | 'comet2'
  | 'fork' | 'clock' | 'wave' | 'layers' | 'nova' | 'echo' | 'well' | 'eclipse' | 'prism'
  | 'spark' | 'spiral' | 'sunset' | 'shards' | 'star' | 'constellation' | 'moon' | 'crown'
  | 'heart' | 'abyss'
  // the Hollow Crown
  | 'flame' | 'snow' | 'skull' | 'eye' | 'shield' | 'fang' | 'chain' | 'storm';

export interface CostDef {
  currency: Currency;
  base: number;
  growth: number;
}

export interface NodeDef {
  id: string;
  name: string;
  desc: string;
  branch: Branch;
  /** Second branch for synergy nodes (affects colour). */
  branch2?: Branch;
  kind: NodeKind;
  ring: number;
  angle: number; // degrees, -90 = up
  parents: string[];
  /** which parents must be grown: one of them, all of them, or at least this many */
  req: 'any' | 'all' | number;
  maxLevel: number;
  costs: CostDef[];
  mods: Mod[];
  icon: IconKey;
  /** nodes that share a fork id exclude each other: lighting one seals the rest */
  fork?: string;
  /** curses only: the price, shown apart from the power */
  drawback?: string;
}

/** A harvest challenge that opens a sealed ring of the Hollow Crown. */
export interface TrialDef {
  id: string;
  /** the ring it opens (0: the finale) */
  ring: number;
  name: string;
  goal: { kind: 'gather' | 'kills' | 'hazards' | 'boss'; n: number };
  /** e.g. "Gather 120 gloam in one harvest" */
  text: string;
  /** light gained when it is passed */
  light: number;
}

export interface CurrencyMeta {
  name: string;
  color: number;
}

export interface ShardTier {
  hp: number;
  value: number;
  r: number;
  sides: number;
  color: number;
}

export interface TreeDef {
  id: TreeId;
  numeral: string;
  name: string;
  /** a line for the tree picker */
  blurb: string;
  nodes: NodeDef[];
  map: Record<string, NodeDef>;
  children: Record<string, string[]>;
  rings: number[];
  /** the branches, in order around the tree */
  branches: Branch[];
  keystones: string[];
  /** the node at the centre: touching it starts a harvest */
  root: string;
  /** the last purchase: awakens the tree */
  finale: string;
  currency: Record<Currency, CurrencyMeta>;
  /** overrides of the base stats */
  base: Partial<Stats>;
  tiers: ShardTier[];
  heart: ShardTier;
  /** colour of the faint ring guides */
  ringColor: number;
  /** colour of the darkness the tree's light cuts into */
  voidColor: number;
  /** each trial passed deepens the void: shards' health and worth grow by these factors per gate */
  deepen?: { hp: number; value: number };
  /** limited light: lighting a star uses some (see lightCost); trials add more */
  light?: { base: number };
  trials?: TrialDef[];
}

/** Light a lit node uses in a tree with limited light. Curses burn none. */
export function lightCost(def: NodeDef): number {
  switch (def.kind) {
    case 'minor': return 1;
    case 'major': case 'synergy': return 2;
    case 'keystone': return 3;
    default: return 0;
  }
}

export const BRANCH_COLORS: Record<Branch, number> = {
  core: 0xfff1c9,
  force: 0xff7a3d,
  reach: 0x3fdcff,
  flow: 0x4dffa8,
  fortune: 0xffcf4a,
  ember: 0xff7a2e,
  frost: 0x9cecff,
  storm: 0x8c78ff,
  tide: 0x3fe6a8,
  gild: 0xffc94a,
  hollow: 0xff3d6e,
};

export const PRISM_COLOR = 0xc58cff;

export const BRANCH_NAMES: Record<Branch, string> = {
  core: 'Seed',
  force: 'Force',
  reach: 'Reach',
  flow: 'Flow',
  fortune: 'Fortune',
  ember: 'Ember',
  frost: 'Frost',
  storm: 'Storm',
  tide: 'Tide',
  gild: 'Gild',
  hollow: 'Hollow',
};

export const KIND_NAMES: Record<NodeKind, string> = {
  core: 'Origin',
  minor: 'Minor',
  major: 'Mechanic',
  synergy: 'Synergy',
  keystone: 'Keystone',
  curse: 'Curse',
  awaken: 'Finale',
};

export const L = (base: number, growth = 1): CostDef => ({ currency: 'lumen', base, growth });
export const P = (base: number, growth = 1): CostDef => ({ currency: 'prism', base, growth });

export type Def = Omit<NodeDef, 'req'> & { req?: NodeDef['req'] };

/** Build a tree's lookup tables from its node list. */
export function makeTree(t: Omit<TreeDef, 'nodes' | 'map' | 'children'> & { defs: Def[] }): TreeDef {
  const { defs, ...rest } = t;
  const nodes: NodeDef[] = defs.map((d) => ({ req: 'any', ...d }));
  const map = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const children: Record<string, string[]> = {};
  for (const n of nodes) children[n.id] = [];
  for (const n of nodes) for (const p of n.parents) children[p].push(n.id);
  return { ...rest, nodes, map, children };
}

export function nodeRadius(kind: NodeKind): number {
  switch (kind) {
    case 'core': return 54;
    case 'awaken': return 54;
    case 'keystone': return 40;
    case 'major': return 29;
    case 'synergy': return 27;
    case 'curse': return 26;
    case 'minor': return 23;
  }
}

/** Cross-branch hues. Mixing complementary colours would turn grey, so synergies get their own. */
const SYNERGY_COLORS: Record<string, number> = {
  'force|reach': 0xb98cff,
  'reach|flow': 0x45f0d8,
  'flow|fortune': 0xb6f060,
  'fortune|force': 0xffa142,
  'ember|frost': 0xff9fc8,
  'frost|storm': 0x8fb6ff,
  'storm|tide': 0x6fb8ff,
  'tide|gild': 0xa8f06a,
  'gild|hollow': 0xff8a5c,
  'hollow|ember': 0xff3d5a,
};

export function nodeColor(def: NodeDef): number {
  if (def.branch2) return SYNERGY_COLORS[`${def.branch}|${def.branch2}`] ?? BRANCH_COLORS[def.branch2];
  return BRANCH_COLORS[def.branch];
}
