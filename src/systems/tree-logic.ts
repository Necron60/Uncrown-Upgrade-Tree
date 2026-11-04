import { lightCost, type Currency, type NodeDef, type TreeDef, type TrialDef } from '../data/tree';
import { computeStats, type Stats } from '../data/stats';
import type { TreeProgress } from '../core/state';

/**
 * gated: its ring is sealed until a trial is passed · sealed: the other side of its fork is lit
 */
export type NodeState = 'hidden' | 'silhouette' | 'locked' | 'gated' | 'sealed' | 'available' | 'owned' | 'maxed';

export interface Wallet {
  lumen: number;
  prism: number;
}

export type Cost = Partial<Record<Currency, number>>;

export const level = (levels: Record<string, number>, id: string) => levels[id] ?? 0;
export const isOwned = (levels: Record<string, number>, id: string) => level(levels, id) > 0;

/** Price of the *next* level of a node, per currency. */
export function costAt(def: NodeDef, lvl: number): Cost {
  const out: Cost = {};
  for (const c of def.costs) out[c.currency] = Math.round(c.base * Math.pow(c.growth, lvl));
  return out;
}

export function nextCost(def: NodeDef, levels: Record<string, number>) {
  return costAt(def, level(levels, def.id));
}

export function canAfford(cost: Cost, wallet: Wallet): boolean {
  return (cost.lumen ?? 0) <= wallet.lumen + 1e-9 && (cost.prism ?? 0) <= wallet.prism + 1e-9;
}

/** How many parents a node needs grown. */
export function needed(def: NodeDef): number {
  if (def.parents.length === 0) return 0;
  if (def.req === 'all') return def.parents.length;
  if (def.req === 'any') return 1;
  return Math.min(def.req, def.parents.length);
}

/** Requirements met (independent of currency, gates and forks). */
export function isUnlocked(def: NodeDef, levels: Record<string, number>): boolean {
  return def.parents.filter((p) => isOwned(levels, p)).length >= needed(def);
}

/** The player can see the node and its requirements. */
export function isRevealed(def: NodeDef, levels: Record<string, number>): boolean {
  if (isOwned(levels, def.id) || def.parents.length === 0) return true;
  return def.parents.some((p) => isOwned(levels, p));
}

/** The trial that still seals this node's ring, if any. */
export function gateOf(tree: TreeDef, def: NodeDef, p: TreeProgress): TrialDef | null {
  if (!tree.trials || def.kind === 'core') return null;
  const ring = def.kind === 'awaken' ? 0 : def.ring;
  return tree.trials.find((t) => t.ring === ring && !p.trials.includes(t.id)) ?? null;
}

/** The lit node on the other side of this node's fork, if any. */
export function sealedBy(tree: TreeDef, def: NodeDef, levels: Record<string, number>): NodeDef | null {
  if (!def.fork) return null;
  return tree.nodes.find((n) => n !== def && n.fork === def.fork && isOwned(levels, n.id)) ?? null;
}

export function forkSiblings(tree: TreeDef, def: NodeDef): NodeDef[] {
  return def.fork ? tree.nodes.filter((n) => n !== def && n.fork === def.fork) : [];
}

export function nodeState(tree: TreeDef, def: NodeDef, p: TreeProgress): NodeState {
  const levels = p.levels;
  const lvl = level(levels, def.id);
  if (lvl >= def.maxLevel) return lvl > 0 && def.maxLevel > 1 ? 'maxed' : 'owned';
  if (lvl > 0) return 'owned';
  if (!isRevealed(def, levels)) {
    // one step past the frontier: show a mysterious silhouette
    return def.parents.some((id) => isRevealed(tree.map[id], levels)) ? 'silhouette' : 'hidden';
  }
  if (sealedBy(tree, def, levels)) return 'sealed';
  if (gateOf(tree, def, p)) return 'gated';
  return isUnlocked(def, levels) ? 'available' : 'locked';
}

// ───────────────────────────────────────────── light
export const hasLight = (tree: TreeDef) => !!tree.light;

/** Light available in a tree with limited light: the base plus every trial passed. */
export function lightCap(tree: TreeDef, p: TreeProgress): number {
  if (!tree.light) return Infinity;
  let cap = tree.light.base;
  for (const t of tree.trials ?? []) if (p.trials.includes(t.id)) cap += t.light;
  return cap;
}

export function lightUsed(tree: TreeDef, levels: Record<string, number>): number {
  if (!tree.light) return 0;
  let used = 0;
  for (const n of tree.nodes) if (isOwned(levels, n.id)) used += lightCost(n);
  return used;
}

// ───────────────────────────────────────────── buying
export type DenyReason = 'locked' | 'maxed' | 'poor' | 'gated' | 'sealed' | 'dark';

export type BuyResult =
  | { ok: true; newLevel: number; spent: Cost; revealed: string[] }
  | { ok: false; reason: DenyReason };

export function checkBuy(tree: TreeDef, def: NodeDef, p: TreeProgress): Extract<BuyResult, { ok: false }> | null {
  const lvl = level(p.levels, def.id);
  if (lvl >= def.maxLevel) return { ok: false, reason: 'maxed' };
  if (lvl === 0) {
    if (sealedBy(tree, def, p.levels)) return { ok: false, reason: 'sealed' };
    if (gateOf(tree, def, p)) return { ok: false, reason: 'gated' };
    if (!isUnlocked(def, p.levels)) return { ok: false, reason: 'locked' };
    if (lightUsed(tree, p.levels) + lightCost(def) > lightCap(tree, p)) return { ok: false, reason: 'dark' };
  }
  if (!canAfford(costAt(def, lvl), p)) return { ok: false, reason: 'poor' };
  return null;
}

/** Nodes whose state moved out of hidden/silhouette between two snapshots. */
function newlyRevealed(tree: TreeDef, before: Map<string, NodeState>, p: TreeProgress): string[] {
  const out: string[] = [];
  for (const n of tree.nodes) {
    const prev = before.get(n.id)!;
    const now = nodeState(tree, n, p);
    if (prev !== now && (prev === 'hidden' || prev === 'silhouette')) out.push(n.id);
  }
  return out;
}

const snapshot = (tree: TreeDef, p: TreeProgress) => new Map(tree.nodes.map((n) => [n.id, nodeState(tree, n, p)]));

/** Mutates progress. Returns which nodes became newly revealed/silhouetted. */
export function buy(tree: TreeDef, def: NodeDef, p: TreeProgress): BuyResult {
  const fail = checkBuy(tree, def, p);
  if (fail) return fail;
  const lvl = level(p.levels, def.id);
  const cost = costAt(def, lvl);
  const before = snapshot(tree, p);
  p.lumen = Math.max(0, p.lumen - (cost.lumen ?? 0));
  p.prism = Math.max(0, p.prism - (cost.prism ?? 0));
  p.levels[def.id] = lvl + 1;
  return { ok: true, newLevel: lvl + 1, spent: cost, revealed: newlyRevealed(tree, before, p) };
}

// ───────────────────────────────────────────── unweaving
/** Share of what a node cost that unweaving it gives back. */
export const UNWEAVE_REFUND = 0.75;

/**
 * Can a lit node be unwoven (made dark again, for a partial refund)? Only where light is limited,
 * and only if every lit node that grew from it still has what it needs without it.
 */
export function unweaveBlock(tree: TreeDef, def: NodeDef, p: TreeProgress): 'unlit' | 'fixed' | NodeDef | null {
  if (!tree.light || def.kind === 'core' || def.kind === 'awaken') return 'fixed';
  if (!isOwned(p.levels, def.id)) return 'unlit';
  const without = { ...p.levels, [def.id]: 0 };
  for (const c of tree.children[def.id] ?? []) {
    if (isOwned(p.levels, c) && !isUnlocked(tree.map[c], without)) return tree.map[c];
  }
  return null;
}

/** Everything spent on a node so far. */
export function spentOn(def: NodeDef, lvl: number): Cost {
  const out: Cost = {};
  for (let i = 0; i < lvl; i++) {
    const c = costAt(def, i);
    for (const k of Object.keys(c) as Currency[]) out[k] = (out[k] ?? 0) + (c[k] ?? 0);
  }
  return out;
}

export function refundOf(def: NodeDef, lvl: number): Cost {
  const s = spentOn(def, lvl);
  const out: Cost = {};
  for (const k of Object.keys(s) as Currency[]) out[k] = Math.floor((s[k] ?? 0) * UNWEAVE_REFUND);
  return out;
}

export type UnweaveResult = { ok: true; refund: Cost; hidden: string[] } | { ok: false; reason: 'unlit' | 'fixed' | 'needed'; by?: NodeDef };

/** Mutates progress: the node goes dark, three quarters of its price comes back. */
export function unweave(tree: TreeDef, def: NodeDef, p: TreeProgress): UnweaveResult {
  const block = unweaveBlock(tree, def, p);
  if (block === 'unlit' || block === 'fixed') return { ok: false, reason: block };
  if (block) return { ok: false, reason: 'needed', by: block };
  const before = snapshot(tree, p);
  const refund = refundOf(def, level(p.levels, def.id));
  p.lumen += refund.lumen ?? 0;
  p.prism += refund.prism ?? 0;
  delete p.levels[def.id];
  const hidden = tree.nodes.filter((n) => {
    const now = nodeState(tree, n, p);
    return before.get(n.id) !== now && (now === 'hidden' || now === 'silhouette');
  }).map((n) => n.id);
  return { ok: true, refund, hidden };
}

// ───────────────────────────────────────────── trials
/** The next trial to pass, or null once all are passed (or the tree has none). */
export function currentTrial(tree: TreeDef, p: TreeProgress): TrialDef | null {
  return tree.trials?.find((t) => !p.trials.includes(t.id)) ?? null;
}

export interface TrialRun {
  lumen: number;
  kills: number;
  hazards: number;
  boss: number;
}

/** How far a harvest got toward a trial, in the trial's own units. */
export function trialProgress(t: TrialDef, r: TrialRun): number {
  switch (t.goal.kind) {
    case 'gather': return r.lumen;
    case 'kills': return r.kills;
    case 'hazards': return r.hazards;
    case 'boss': return r.boss;
  }
}

export const trialMet = (t: TrialDef, r: TrialRun) => trialProgress(t, r) >= t.goal.n;

/** Trials passed so far: the void grows more hostile with every gate. */
export const depthOf = (p: TreeProgress) => p.trials.length;

// ───────────────────────────────────────────── queries
export function statsFor(tree: TreeDef, levels: Record<string, number>): Stats {
  return computeStats(levels, (id) => tree.map[id]?.mods, tree.base);
}

/** Path of node ids from the root to `id` through owned/revealed parents (for hover highlight). */
export function pathToSeed(tree: TreeDef, id: string, levels: Record<string, number>): string[] {
  const path: string[] = [id];
  let cur = tree.map[id];
  let guard = 0;
  while (cur && cur.parents.length && guard++ < 32) {
    const owned = cur.parents.filter((p) => isOwned(levels, p));
    const next = owned[0] ?? cur.parents[0];
    path.push(next);
    cur = tree.map[next];
  }
  return path;
}

export function childrenOf(tree: TreeDef, id: string): string[] {
  return tree.children[id] ?? [];
}

/** Nodes that count toward a tree's total (not the root, not the finale). */
export const countable = (tree: TreeDef) => tree.nodes.filter((n) => n.kind !== 'core' && n.kind !== 'awaken');

export function ownedCount(tree: TreeDef, levels: Record<string, number>): number {
  return countable(tree).filter((n) => isOwned(levels, n.id)).length;
}

/** Is there anything the player could buy right now? */
export function anyAffordable(tree: TreeDef, p: TreeProgress): boolean {
  return tree.nodes.some((n) => checkBuy(tree, n, p) === null);
}
