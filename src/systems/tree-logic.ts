import { CHILDREN, NODE_MAP, NODES, type Currency, type NodeDef } from '../data/tree';
import { computeStats, type Stats } from '../data/stats';
import type { GameState } from '../core/state';

export type NodeState = 'hidden' | 'silhouette' | 'locked' | 'available' | 'owned' | 'maxed';

export interface Wallet {
  lumen: number;
  prism: number;
}

export const level = (levels: Record<string, number>, id: string) => levels[id] ?? 0;
export const isOwned = (levels: Record<string, number>, id: string) => level(levels, id) > 0;

/** Price of the *next* level of a node, per currency. */
export function costAt(def: NodeDef, lvl: number): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {};
  for (const c of def.costs) out[c.currency] = Math.round(c.base * Math.pow(c.growth, lvl));
  return out;
}

export function nextCost(def: NodeDef, levels: Record<string, number>) {
  return costAt(def, level(levels, def.id));
}

export function canAfford(cost: Partial<Record<Currency, number>>, wallet: Wallet): boolean {
  return (cost.lumen ?? 0) <= wallet.lumen + 1e-9 && (cost.prism ?? 0) <= wallet.prism + 1e-9;
}

/** Requirements met (independent of currency). */
export function isUnlocked(def: NodeDef, levels: Record<string, number>): boolean {
  if (def.parents.length === 0) return true;
  return def.req === 'all'
    ? def.parents.every((p) => isOwned(levels, p))
    : def.parents.some((p) => isOwned(levels, p));
}

/** The player can see the node and its requirements. */
export function isRevealed(def: NodeDef, levels: Record<string, number>): boolean {
  if (isOwned(levels, def.id) || def.parents.length === 0) return true;
  return def.parents.some((p) => isOwned(levels, p));
}

export function nodeState(def: NodeDef, levels: Record<string, number>): NodeState {
  const lvl = level(levels, def.id);
  if (lvl >= def.maxLevel) return lvl > 0 && def.maxLevel > 1 ? 'maxed' : 'owned';
  if (lvl > 0) return 'owned';
  if (isUnlocked(def, levels)) return 'available';
  if (isRevealed(def, levels)) return 'locked';
  // one step past the frontier: show a mysterious silhouette
  if (def.parents.some((p) => isRevealed(NODE_MAP[p], levels))) return 'silhouette';
  return 'hidden';
}

export type BuyResult =
  | { ok: true; newLevel: number; spent: Partial<Record<Currency, number>>; revealed: string[] }
  | { ok: false; reason: 'locked' | 'maxed' | 'poor' };

export function checkBuy(def: NodeDef, state: GameState): BuyResult | null {
  const lvl = level(state.levels, def.id);
  if (lvl >= def.maxLevel) return { ok: false, reason: 'maxed' };
  if (!isUnlocked(def, state.levels)) return { ok: false, reason: 'locked' };
  if (!canAfford(costAt(def, lvl), state)) return { ok: false, reason: 'poor' };
  return null;
}

/** Mutates state. Returns which nodes became newly revealed/silhouetted. */
export function buy(def: NodeDef, state: GameState): BuyResult {
  const fail = checkBuy(def, state);
  if (fail) return fail;
  const lvl = level(state.levels, def.id);
  const cost = costAt(def, lvl);
  const before = new Map(NODES.map((n) => [n.id, nodeState(n, state.levels)]));
  state.lumen = Math.max(0, state.lumen - (cost.lumen ?? 0));
  state.prism = Math.max(0, state.prism - (cost.prism ?? 0));
  state.levels[def.id] = lvl + 1;
  const revealed: string[] = [];
  for (const n of NODES) {
    const prev = before.get(n.id)!;
    const now = nodeState(n, state.levels);
    if (prev !== now && (prev === 'hidden' || prev === 'silhouette')) revealed.push(n.id);
  }
  return { ok: true, newLevel: lvl + 1, spent: cost, revealed };
}

export function statsFor(levels: Record<string, number>): Stats {
  return computeStats(levels, (id) => NODE_MAP[id]?.mods);
}

/** Path of node ids from the seed to `id` through owned/revealed parents (for hover highlight). */
export function pathToSeed(id: string, levels: Record<string, number>): string[] {
  const path: string[] = [id];
  let cur = NODE_MAP[id];
  let guard = 0;
  while (cur && cur.parents.length && guard++ < 32) {
    const owned = cur.parents.filter((p) => isOwned(levels, p));
    const next = owned[0] ?? cur.parents[0];
    path.push(next);
    cur = NODE_MAP[next];
  }
  return path;
}

export function childrenOf(id: string): string[] {
  return CHILDREN[id] ?? [];
}

export function ownedCount(levels: Record<string, number>): number {
  return NODES.filter((n) => n.kind !== 'core' && isOwned(levels, n.id)).length;
}

/** Is there anything the player could buy right now? */
export function anyAffordable(state: GameState): boolean {
  return NODES.some((n) => checkBuy(n, state) === null);
}
