/** Every number that drives a Harvest run. Upgrades modify these. */
export interface Stats {
  damage: number;
  damageMult: number;
  pulseRate: number; // lens pulses per second
  radius: number;
  radiusGrowth: number; // fraction of radius gained per second of a run
  critChance: number;
  critMult: number;
  execute: number; // shards below this fraction of max HP shatter instantly
  duration: number;
  spawnRate: number;
  maxShards: number;
  cluster: number;
  lumenMult: number;
  lumenMultX: number;
  goldChance: number;
  goldValue: number;
  comboPerKill: number;
  comboCap: number;
  comboWindow: number;
  tier2: number;
  tier3: number;
  prismChance: number;
  prismMult: number;
  timeShardChance: number;
  timeShardBonus: number;
  satellites: number;
  satDamage: number;
  satSpeed: number;
  satCrit: number;
  satArc: number;
  arcChance: number;
  arcChains: number;
  novaPower: number;
  echoPower: number;
  gravity: number;
  overtime: number;
  goldenHour: number;
  critLumen: number;
  heart: number;
}

export type StatKey = keyof Stats;

export const BASE_STATS: Stats = {
  damage: 1,
  damageMult: 1,
  pulseRate: 2,
  radius: 56,
  radiusGrowth: 0,
  critChance: 0,
  critMult: 2,
  execute: 0,
  duration: 12,
  spawnRate: 2.4,
  maxShards: 12,
  cluster: 0,
  lumenMult: 1,
  lumenMultX: 1,
  goldChance: 0,
  goldValue: 6,
  comboPerKill: 0,
  comboCap: 20,
  comboWindow: 1.6,
  tier2: 0,
  tier3: 0,
  prismChance: 0,
  prismMult: 1,
  timeShardChance: 0,
  timeShardBonus: 0.5,
  satellites: 0,
  satDamage: 1,
  satSpeed: 1,
  satCrit: 0,
  satArc: 0,
  arcChance: 0,
  arcChains: 1,
  novaPower: 0,
  echoPower: 0,
  gravity: 0,
  overtime: 0,
  goldenHour: 0,
  critLumen: 0,
  heart: 0,
};

/** A per-level modifier. Final stat = (base + Σadd·L) · Π(mul^L). */
export interface Mod {
  stat: StatKey;
  add?: number;
  mul?: number;
}

type StatFormat = 'int' | 'num' | 'pct' | 'x' | 'sec' | 'px' | 'rate' | 'flag' | 'pctps';

export const STAT_META: Record<StatKey, { label: string; format: StatFormat }> = {
  damage: { label: 'Lens damage', format: 'num' },
  damageMult: { label: 'Damage multiplier', format: 'x' },
  pulseRate: { label: 'Pulses per second', format: 'rate' },
  radius: { label: 'Lens radius', format: 'px' },
  radiusGrowth: { label: 'Lens growth', format: 'pctps' },
  critChance: { label: 'Critical chance', format: 'pct' },
  critMult: { label: 'Critical damage', format: 'x' },
  execute: { label: 'Shatter threshold', format: 'pct' },
  duration: { label: 'Harvest duration', format: 'sec' },
  spawnRate: { label: 'Shards per second', format: 'rate' },
  maxShards: { label: 'Max shards', format: 'int' },
  cluster: { label: 'Extra shards per spawn', format: 'int' },
  lumenMult: { label: 'Lumen gain', format: 'x' },
  lumenMultX: { label: 'Lumen multiplier', format: 'x' },
  goldChance: { label: 'Gold shard chance', format: 'pct' },
  goldValue: { label: 'Gold shard value', format: 'x' },
  comboPerKill: { label: 'Lumen per combo stack', format: 'pct' },
  comboCap: { label: 'Max combo', format: 'int' },
  comboWindow: { label: 'Combo window', format: 'sec' },
  tier2: { label: 'Sapphire shards', format: 'flag' },
  tier3: { label: 'Abyssal shards', format: 'flag' },
  prismChance: { label: 'Prism shard chance', format: 'pct' },
  prismMult: { label: 'Prism per shard', format: 'int' },
  timeShardChance: { label: 'Hourglass shard chance', format: 'pct' },
  timeShardBonus: { label: 'Time per hourglass', format: 'sec' },
  satellites: { label: 'Seeker motes', format: 'int' },
  satDamage: { label: 'Mote damage', format: 'x' },
  satSpeed: { label: 'Mote speed', format: 'x' },
  satCrit: { label: 'Motes can crit', format: 'flag' },
  satArc: { label: 'Motes set off arcs', format: 'flag' },
  arcChance: { label: 'Arc chance', format: 'pct' },
  arcChains: { label: 'Arc jumps', format: 'int' },
  novaPower: { label: 'Nova power', format: 'pct' },
  echoPower: { label: 'Echo lens power', format: 'pct' },
  gravity: { label: 'Gravity pull', format: 'int' },
  overtime: { label: 'Last Light', format: 'sec' },
  goldenHour: { label: 'Golden Hour', format: 'flag' },
  critLumen: { label: 'Bonus lumen on crit kill', format: 'pct' },
  heart: { label: 'Heart crystals', format: 'flag' },
};

export function formatStat(key: StatKey, v: number): string {
  const f = STAT_META[key].format;
  const trim = (n: number, d: number) => parseFloat(n.toFixed(d)).toString();
  switch (f) {
    case 'int': return Math.round(v).toString();
    case 'num': return trim(v, 1);
    case 'pct': return `${trim(v * 100, 1)}%`;
    case 'pctps': return `${trim(v * 100, 1)}%/s`;
    case 'x': return `×${trim(v, 2)}`;
    case 'sec': return `${trim(v, 1)}s`;
    case 'px': return `${Math.round(v)}`;
    case 'rate': return trim(v, 2);
    case 'flag': return v > 0 ? 'Yes' : 'No';
  }
}

/** Fold node levels into a Stats object. */
export function computeStats(
  levels: Record<string, number>,
  modsFor: (id: string) => readonly Mod[] | undefined,
): Stats {
  const add: Partial<Record<StatKey, number>> = {};
  const mul: Partial<Record<StatKey, number>> = {};
  for (const id in levels) {
    const lvl = levels[id];
    if (!lvl) continue;
    const mods = modsFor(id);
    if (!mods) continue;
    for (const m of mods) {
      if (m.add !== undefined) add[m.stat] = (add[m.stat] ?? 0) + m.add * lvl;
      if (m.mul !== undefined) mul[m.stat] = (mul[m.stat] ?? 1) * Math.pow(m.mul, lvl);
    }
  }
  const out = { ...BASE_STATS };
  for (const k of Object.keys(out) as StatKey[]) {
    out[k] = (BASE_STATS[k] + (add[k] ?? 0)) * (mul[k] ?? 1);
  }
  return out;
}
