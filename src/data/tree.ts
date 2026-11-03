import type { Mod } from './stats';

export type Branch = 'core' | 'force' | 'reach' | 'flow' | 'fortune';
export type NodeKind = 'core' | 'minor' | 'major' | 'synergy' | 'keystone' | 'awaken';
export type Currency = 'lumen' | 'prism';

export type IconKey =
  | 'seed' | 'blade' | 'aperture' | 'hourglass' | 'gem' | 'pulse' | 'crosshair' | 'orbit'
  | 'bolt' | 'sprout' | 'cluster' | 'coin' | 'rhythm' | 'flare' | 'sun' | 'crack' | 'orbit2'
  | 'fork' | 'clock' | 'wave' | 'layers' | 'nova' | 'echo' | 'well' | 'eclipse' | 'prism'
  | 'spark' | 'spiral' | 'sunset' | 'shards' | 'star' | 'constellation' | 'moon' | 'crown'
  | 'heart' | 'abyss';

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
  req: 'any' | 'all';
  maxLevel: number;
  costs: CostDef[];
  mods: Mod[];
  icon: IconKey;
}

export const RING_RADII = [0, 190, 350, 520, 700, 890];

export const BRANCH_COLORS: Record<Branch, number> = {
  core: 0xfff1c9,
  force: 0xff7a3d,
  reach: 0x3fdcff,
  flow: 0x4dffa8,
  fortune: 0xffcf4a,
};

export const PRISM_COLOR = 0xc58cff;

export const BRANCH_NAMES: Record<Branch, string> = {
  core: 'Seed',
  force: 'Force',
  reach: 'Reach',
  flow: 'Flow',
  fortune: 'Fortune',
};

export const KIND_NAMES: Record<NodeKind, string> = {
  core: 'Origin',
  minor: 'Minor',
  major: 'Mechanic',
  synergy: 'Synergy',
  keystone: 'Keystone',
  awaken: 'Finale',
};

const L = (base: number, growth = 1): CostDef => ({ currency: 'lumen', base, growth });
const P = (base: number, growth = 1): CostDef => ({ currency: 'prism', base, growth });

type Def = Omit<NodeDef, 'req'> & { req?: 'any' | 'all' };

const defs: Def[] = [
  // ─── Origin ────────────────────────────────────────────────────────────
  {
    id: 'seed', name: 'Seed of Light', branch: 'core', kind: 'core', ring: 0, angle: 0,
    desc: 'The first spark in the void. Click it to begin a Harvest.',
    parents: [], maxLevel: 1, costs: [], mods: [], icon: 'seed',
  },

  // ─── Ring 1 ───────────────────────────────────────────────────────────
  {
    id: 'force_1', name: 'Sharpened Light', branch: 'force', kind: 'minor', ring: 1, angle: -90,
    desc: 'Focus the lens. Every pulse burns hotter.',
    parents: ['seed'], maxLevel: 5, costs: [L(5, 1.65)], mods: [{ stat: 'damage', add: 1 }], icon: 'blade',
  },
  {
    id: 'reach_1', name: 'Wide Aperture', branch: 'reach', kind: 'minor', ring: 1, angle: 0,
    desc: 'Open the lens wider to catch more shards at once.',
    parents: ['seed'], maxLevel: 5, costs: [L(6, 1.65)], mods: [{ stat: 'radius', add: 7 }], icon: 'aperture',
  },
  {
    id: 'flow_1', name: 'Lingering Dusk', branch: 'flow', kind: 'minor', ring: 1, angle: 90,
    desc: 'The night lasts a little longer.',
    parents: ['seed'], maxLevel: 5, costs: [L(7, 1.7)], mods: [{ stat: 'duration', add: 2 }], icon: 'hourglass',
  },
  {
    id: 'fortune_1', name: 'Glimmer', branch: 'fortune', kind: 'minor', ring: 1, angle: 180,
    desc: 'Shards release more Lumen when they break.',
    parents: ['seed'], maxLevel: 5, costs: [L(8, 1.7)], mods: [{ stat: 'lumenMult', add: 0.25 }], icon: 'gem',
  },

  // ─── Ring 2 ───────────────────────────────────────────────────────────
  {
    id: 'force_2a', name: 'Rapid Pulse', branch: 'force', kind: 'minor', ring: 2, angle: -110,
    desc: 'The lens pulses faster.',
    parents: ['force_1'], maxLevel: 5, costs: [L(28, 1.65)], mods: [{ stat: 'pulseRate', mul: 1.15 }], icon: 'pulse',
  },
  {
    id: 'force_2b', name: 'Focal Point', branch: 'force', kind: 'minor', ring: 2, angle: -70,
    desc: 'Pulses have a chance to land a critical hit.',
    parents: ['force_1'], maxLevel: 5, costs: [L(32, 1.65)], mods: [{ stat: 'critChance', add: 0.06 }], icon: 'crosshair',
  },
  {
    id: 'reach_2a', name: 'Orbiting Mote', branch: 'reach', kind: 'major', ring: 2, angle: -20,
    desc: 'A mote of light circles your lens, cutting any shard it touches.',
    parents: ['reach_1'], maxLevel: 3, costs: [L(45, 2.4)], mods: [{ stat: 'satellites', add: 1 }], icon: 'orbit',
  },
  {
    id: 'reach_2b', name: 'Arc Spark', branch: 'reach', kind: 'major', ring: 2, angle: 20,
    desc: 'Hits can leap to a nearby shard as lightning.',
    parents: ['reach_1'], maxLevel: 5, costs: [L(48, 1.75)], mods: [{ stat: 'arcChance', add: 0.1 }], icon: 'bolt',
  },
  {
    id: 'flow_2a', name: 'Abundance', branch: 'flow', kind: 'minor', ring: 2, angle: 70,
    desc: 'Shards crystallise faster.',
    parents: ['flow_1'], maxLevel: 5, costs: [L(28, 1.65)], mods: [{ stat: 'spawnRate', mul: 1.15 }], icon: 'sprout',
  },
  {
    id: 'flow_2b', name: 'Crowded Void', branch: 'flow', kind: 'minor', ring: 2, angle: 110,
    desc: 'More shards can drift in the field at once.',
    parents: ['flow_1'], maxLevel: 5, costs: [L(32, 1.65)], mods: [{ stat: 'maxShards', add: 3 }], icon: 'cluster',
  },
  {
    id: 'fortune_2a', name: 'Gilded Shards', branch: 'fortune', kind: 'major', ring: 2, angle: 160,
    desc: 'Rare golden shards appear, worth many times more.',
    parents: ['fortune_1'], maxLevel: 5, costs: [L(40, 1.7)], mods: [{ stat: 'goldChance', add: 0.03 }], icon: 'coin',
  },
  {
    id: 'fortune_2b', name: 'Momentum', branch: 'fortune', kind: 'major', ring: 2, angle: 200,
    desc: 'Break shards in quick succession to build a combo that multiplies Lumen.',
    parents: ['fortune_1'], maxLevel: 5, costs: [L(42, 1.7)], mods: [{ stat: 'comboPerKill', add: 0.01 }], icon: 'rhythm',
  },

  // ─── Ring 3 ───────────────────────────────────────────────────────────
  {
    id: 'force_3a', name: 'Searing Edge', branch: 'force', kind: 'minor', ring: 3, angle: -66,
    desc: 'Critical hits cut deeper.',
    parents: ['force_2b'], maxLevel: 4, costs: [L(260, 2.1)], mods: [{ stat: 'critMult', add: 0.5 }], icon: 'flare',
  },
  {
    id: 'force_3b', name: 'Brilliance', branch: 'force', kind: 'minor', ring: 3, angle: -90,
    desc: 'All damage is amplified.',
    parents: ['force_2a', 'force_2b'], maxLevel: 5, costs: [L(300, 2.1)], mods: [{ stat: 'damageMult', mul: 1.25 }], icon: 'sun',
  },
  {
    id: 'force_3c', name: 'Shatterpoint', branch: 'force', kind: 'major', ring: 3, angle: -114,
    desc: 'Weakened shards shatter instantly.',
    parents: ['force_2a'], maxLevel: 3, costs: [L(380, 2.4)], mods: [{ stat: 'execute', add: 0.08 }], icon: 'crack',
  },
  {
    id: 'reach_3a', name: 'Twin Orbit', branch: 'reach', kind: 'minor', ring: 3, angle: -24,
    desc: 'Satellites move faster and strike harder.',
    parents: ['reach_2a'], maxLevel: 3, costs: [L(320, 2.3)],
    mods: [{ stat: 'satDamage', mul: 1.5 }, { stat: 'satSpeed', add: 0.3 }], icon: 'orbit2',
  },
  {
    id: 'reach_3b', name: 'Prismatic Lens', branch: 'reach', kind: 'minor', ring: 3, angle: 0,
    desc: 'A finer lens with a far wider focus.',
    parents: ['reach_2a', 'reach_2b'], maxLevel: 5, costs: [L(280, 2.1)], mods: [{ stat: 'radius', add: 10 }], icon: 'aperture',
  },
  {
    id: 'reach_3c', name: 'Forked Arc', branch: 'reach', kind: 'major', ring: 3, angle: 24,
    desc: 'Lightning jumps to one more shard before it fades.',
    parents: ['reach_2b'], maxLevel: 3, costs: [L(400, 2.4)], mods: [{ stat: 'arcChains', add: 1 }], icon: 'fork',
  },
  {
    id: 'flow_3a', name: 'Hourglass Shards', branch: 'flow', kind: 'major', ring: 3, angle: 66,
    desc: 'Azure hourglass shards appear. Breaking one adds time to the Harvest.',
    parents: ['flow_2a'], maxLevel: 4, costs: [L(340, 2.2)], mods: [{ stat: 'timeShardChance', add: 0.04 }], icon: 'clock',
  },
  {
    id: 'flow_3b', name: 'Deep Breath', branch: 'flow', kind: 'minor', ring: 3, angle: 90,
    desc: 'Hold the night even longer.',
    parents: ['flow_2a', 'flow_2b'], maxLevel: 5, costs: [L(260, 2.1)], mods: [{ stat: 'duration', add: 2.5 }], icon: 'hourglass',
  },
  {
    id: 'flow_3c', name: 'Tidal Surge', branch: 'flow', kind: 'major', ring: 3, angle: 114,
    desc: 'Shards crystallise in pairs.',
    parents: ['flow_2b'], maxLevel: 1, costs: [L(450)], mods: [{ stat: 'cluster', add: 1 }], icon: 'wave',
  },
  {
    id: 'fortune_3a', name: 'Refined Light', branch: 'fortune', kind: 'minor', ring: 3, angle: 156,
    desc: 'Distil far more Lumen from every shard.',
    parents: ['fortune_2a'], maxLevel: 5, costs: [L(300, 2.1)], mods: [{ stat: 'lumenMult', add: 0.3 }], icon: 'gem',
  },
  {
    id: 'fortune_3b', name: 'Deeper Void', branch: 'fortune', kind: 'major', ring: 3, angle: 180,
    desc: 'Sapphire shards rise from deeper in the void. They are tougher and far richer.',
    parents: ['fortune_2a', 'fortune_2b'], maxLevel: 1, costs: [L(400)], mods: [{ stat: 'tier2', add: 1 }], icon: 'layers',
  },
  {
    id: 'fortune_3c', name: 'Lucky Facets', branch: 'fortune', kind: 'minor', ring: 3, angle: 204,
    desc: 'Golden shards are worth even more.',
    parents: ['fortune_2b'], maxLevel: 3, costs: [L(320, 2.2)], mods: [{ stat: 'goldValue', add: 2 }], icon: 'coin',
  },

  // ─── Ring 4 ───────────────────────────────────────────────────────────
  {
    id: 'force_4a', name: 'Overload', branch: 'force', kind: 'minor', ring: 4, angle: -76,
    desc: 'Push the lens past its limits.',
    parents: ['force_3a', 'force_3b'], maxLevel: 5, costs: [L(4000, 2.2)], mods: [{ stat: 'damageMult', mul: 1.3 }], icon: 'sun',
  },
  {
    id: 'force_4b', name: 'Supernova Seeds', branch: 'force', kind: 'major', ring: 4, angle: -104,
    desc: 'Shattered shards explode and damage everything nearby. Chain reactions included.',
    parents: ['force_3b', 'force_3c'], maxLevel: 3, costs: [L(6000, 2.5)], mods: [{ stat: 'novaPower', add: 0.35 }], icon: 'nova',
  },
  {
    id: 'reach_4a', name: 'Echo Lens', branch: 'reach', kind: 'major', ring: 4, angle: -13,
    desc: 'A ghost lens trails your cursor and pulses with it.',
    parents: ['reach_3b'], maxLevel: 3, costs: [L(5500, 2.5)], mods: [{ stat: 'echoPower', add: 0.35 }], icon: 'echo',
  },
  {
    id: 'reach_4b', name: 'Gravity Well', branch: 'reach', kind: 'major', ring: 4, angle: 13,
    desc: 'Shards are slowly drawn toward your lens.',
    parents: ['reach_3b', 'reach_3c'], maxLevel: 3, costs: [L(5000, 2.4)], mods: [{ stat: 'gravity', add: 1 }], icon: 'well',
  },
  {
    id: 'flow_4a', name: 'Last Light', branch: 'flow', kind: 'major', ring: 4, angle: 77,
    desc: 'When time runs out, burn on in overtime with double damage.',
    parents: ['flow_3a', 'flow_3b'], maxLevel: 3, costs: [L(5500, 2.4)], mods: [{ stat: 'overtime', add: 1.5 }], icon: 'eclipse',
  },
  {
    id: 'flow_4b', name: 'Endless Tide', branch: 'flow', kind: 'minor', ring: 4, angle: 103,
    desc: 'The void teems with shards.',
    parents: ['flow_3b', 'flow_3c'], maxLevel: 5, costs: [L(4000, 2.2)],
    mods: [{ stat: 'spawnRate', mul: 1.1 }, { stat: 'maxShards', add: 2 }], icon: 'wave',
  },
  {
    id: 'fortune_4a', name: 'Prism Veins', branch: 'fortune', kind: 'major', ring: 4, angle: 167,
    desc: 'Iridescent prism shards appear. They drop Prism, the rarest light.',
    parents: ['fortune_3a', 'fortune_3b'], maxLevel: 5, costs: [L(6000, 2.2)], mods: [{ stat: 'prismChance', add: 0.012 }], icon: 'prism',
  },
  {
    id: 'fortune_4b', name: 'Abyssal Strata', branch: 'fortune', kind: 'major', ring: 4, angle: 193,
    desc: 'Abyssal shards surface. They are huge, stubborn and overflowing with Lumen.',
    parents: ['fortune_3b', 'fortune_3c'], maxLevel: 1, costs: [L(15000)], mods: [{ stat: 'tier3', add: 1 }], icon: 'abyss',
  },

  // ─── Synergies (diagonals, need both neighbours) ──────────────────────
  {
    id: 'syn_fr', name: 'Charged Satellites', branch: 'force', branch2: 'reach', kind: 'synergy', ring: 4, angle: -45,
    req: 'all', desc: 'Satellites can land critical hits and set off arcs.',
    parents: ['force_3a', 'reach_3a'], maxLevel: 1, costs: [L(9000)],
    mods: [{ stat: 'satCrit', add: 1 }, { stat: 'satArc', add: 1 }], icon: 'spark',
  },
  {
    id: 'syn_rw', name: 'Tidal Lens', branch: 'reach', branch2: 'flow', kind: 'synergy', ring: 4, angle: 45,
    req: 'all', desc: 'Your lens keeps growing for as long as the Harvest lasts.',
    parents: ['reach_3c', 'flow_3a'], maxLevel: 3, costs: [L(9000, 2.4)], mods: [{ stat: 'radiusGrowth', add: 0.025 }], icon: 'spiral',
  },
  {
    id: 'syn_wg', name: 'Golden Hour', branch: 'flow', branch2: 'fortune', kind: 'synergy', ring: 4, angle: 135,
    req: 'all', desc: 'Hourglass shards give triple Lumen, and golden shards add time.',
    parents: ['flow_3c', 'fortune_3a'], maxLevel: 1, costs: [L(10000)], mods: [{ stat: 'goldenHour', add: 1 }], icon: 'sunset',
  },
  {
    id: 'syn_gf', name: 'Shattered Fortune', branch: 'fortune', branch2: 'force', kind: 'synergy', ring: 4, angle: -135,
    req: 'all', desc: 'Shards destroyed by a critical hit or a shatter drop bonus Lumen.',
    parents: ['fortune_3c', 'force_3c'], maxLevel: 3, costs: [L(8500, 2.4)], mods: [{ stat: 'critLumen', add: 0.25 }], icon: 'shards',
  },

  // ─── Ring 5: keystones ────────────────────────────────────────────────
  {
    id: 'force_5', name: 'Radiant Core', branch: 'force', kind: 'keystone', ring: 5, angle: -90,
    desc: 'KEYSTONE. Your lens becomes a star. Doubles all damage.',
    parents: ['force_4a', 'force_4b'], maxLevel: 1, costs: [L(300000), P(50)],
    mods: [{ stat: 'damageMult', mul: 2 }, { stat: 'critChance', add: 0.1 }], icon: 'star',
  },
  {
    id: 'reach_5', name: 'Constellation', branch: 'reach', kind: 'keystone', ring: 5, angle: 0,
    desc: 'KEYSTONE. Two more satellites join the orbit, and lightning jumps twice as far.',
    parents: ['reach_4a', 'reach_4b'], maxLevel: 1, costs: [L(300000), P(50)],
    mods: [{ stat: 'satellites', add: 2 }, { stat: 'arcChains', add: 2 }], icon: 'constellation',
  },
  {
    id: 'flow_5', name: 'Eternal Dusk', branch: 'flow', kind: 'keystone', ring: 5, angle: 90,
    desc: 'KEYSTONE. The night stretches on and the void overflows.',
    parents: ['flow_4a', 'flow_4b'], maxLevel: 1, costs: [L(300000), P(50)],
    mods: [{ stat: 'duration', add: 8 }, { stat: 'spawnRate', mul: 1.3 }], icon: 'moon',
  },
  {
    id: 'fortune_5', name: 'Midas Bloom', branch: 'fortune', kind: 'keystone', ring: 5, angle: 180,
    desc: 'KEYSTONE. Everything you touch turns to light. ×2.5 all Lumen.',
    parents: ['fortune_4a', 'fortune_4b'], maxLevel: 1, costs: [L(300000), P(50)],
    mods: [{ stat: 'lumenMultX', mul: 2.5 }], icon: 'crown',
  },

  // ─── Ring 5: outer synergies ──────────────────────────────────────────
  {
    id: 'syn5_fr', name: 'Heartseeker', branch: 'force', branch2: 'reach', kind: 'synergy', ring: 5, angle: -45,
    desc: 'Massive heart crystals appear during long harvests. They hold a fortune in Lumen and Prism.',
    parents: ['syn_fr'], maxLevel: 1, costs: [L(60000), P(10)], mods: [{ stat: 'heart', add: 1 }], icon: 'heart',
  },
  {
    id: 'syn5_rw', name: 'Resonant Rhythm', branch: 'reach', branch2: 'flow', kind: 'synergy', ring: 5, angle: 45,
    desc: 'Your combo climbs higher and fades slower.',
    parents: ['syn_rw'], maxLevel: 3, costs: [L(45000, 2.0), P(4, 1.6)],
    mods: [{ stat: 'comboCap', add: 10 }, { stat: 'comboWindow', add: 0.4 }], icon: 'rhythm',
  },
  {
    id: 'syn5_wg', name: 'Prism Bloom', branch: 'flow', branch2: 'fortune', kind: 'synergy', ring: 5, angle: 135,
    desc: 'Prism shards release more Prism.',
    parents: ['syn_wg'], maxLevel: 2, costs: [L(50000, 2.0), P(5, 1.6)], mods: [{ stat: 'prismMult', add: 1 }], icon: 'prism',
  },
  {
    id: 'syn5_gf', name: 'Fault Lines', branch: 'fortune', branch2: 'force', kind: 'synergy', ring: 5, angle: -135,
    desc: 'Shards crack sooner, and critical hits cut deeper still.',
    parents: ['syn_gf'], maxLevel: 3, costs: [L(45000, 2.0), P(4, 1.6)],
    mods: [{ stat: 'execute', add: 0.04 }, { stat: 'critMult', add: 0.5 }], icon: 'crack',
  },

  // ─── Finale ───────────────────────────────────────────────────────────
  {
    id: 'awaken', name: 'Awaken the Seed', branch: 'core', kind: 'awaken', ring: 0, angle: 0,
    req: 'all', desc: 'Pour the light of all four keystones back into the seed and let it bloom.',
    parents: ['force_5', 'reach_5', 'flow_5', 'fortune_5'], maxLevel: 1, costs: [L(4000000), P(250)],
    mods: [], icon: 'seed',
  },
];

export const NODES: NodeDef[] = defs.map((d) => ({ req: 'any', ...d }));
export const NODE_MAP: Record<string, NodeDef> = Object.fromEntries(NODES.map((n) => [n.id, n]));

/** child lists, derived once */
export const CHILDREN: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const n of NODES) out[n.id] = [];
  for (const n of NODES) for (const p of n.parents) out[p].push(n.id);
  return out;
})();

export const KEYSTONES = ['force_5', 'reach_5', 'flow_5', 'fortune_5'] as const;

export function nodeRadius(kind: NodeKind): number {
  switch (kind) {
    case 'core': return 54;
    case 'awaken': return 54;
    case 'keystone': return 40;
    case 'major': return 29;
    case 'synergy': return 27;
    case 'minor': return 23;
  }
}

/** Cross-branch hues. Mixing complementary colours would turn grey, so synergies get their own. */
const SYNERGY_COLORS: Record<string, number> = {
  'force|reach': 0xb98cff,
  'reach|flow': 0x45f0d8,
  'flow|fortune': 0xb6f060,
  'fortune|force': 0xffa142,
};

export function nodeColor(def: NodeDef): number {
  if (def.branch2) return SYNERGY_COLORS[`${def.branch}|${def.branch2}`] ?? BRANCH_COLORS[def.branch2];
  return BRANCH_COLORS[def.branch];
}
