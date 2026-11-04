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
  // ── the Hollow Crown ──
  burnChance: number; // chance a lens hit sets a shard alight
  burnDps: number; // burn damage per second, as a share of pulse damage
  burnTime: number;
  burnAmp: number; // extra damage burning shards take from everything
  burnSpread: number; // burning shards that break set their neighbours alight
  chill: number; // slow per hit (stacks, fades)
  freeze: number; // 0: no freezing; each point takes one hit off the 7 a freeze needs
  freezeTime: number;
  frozenMult: number; // damage frozen shards take
  frostNova: number; // frozen shards that break burst into ice (share of their max HP)
  strikeRate: number; // lightning strikes per second
  strikeDamage: number; // a strike's damage, in pulses
  strikeArc: number; // strikes arc on to a neighbour
  hazardMult: number; // how common hazards are
  hazardValue: number; // gloam from hazards
  sigilChance: number; // chance a hazard drops a sigil
  wardBreak: number; // wards a single hit strips
  thiefTime: number; // seconds before a thief flees
  thiefSteal: number; // share of the harvest's gloam a thief takes with it
  bloodlust: number; // damage bonus for a few seconds after breaking a hazard
  devour: number; // seconds a broken hazard adds to the harvest
  timeDrain: number; // how fast the harvest's time runs out
  thermal: number; // a burning shard freezing (or a frozen one catching fire) cracks for this many pulses
  supercon: number; // lightning doubles on chilled and frozen shards
  hellfire: number; // hazards rise already burning
  goldSigil: number; // chance a golden shard holds a sigil
  shardHp: number; // how tough every shard is
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
  burnChance: 0,
  burnDps: 0.5,
  burnTime: 3,
  burnAmp: 0,
  burnSpread: 0,
  chill: 0,
  freeze: 0,
  freezeTime: 2.5,
  frozenMult: 1.5,
  frostNova: 0,
  strikeRate: 0,
  strikeDamage: 3,
  strikeArc: 0,
  hazardMult: 1,
  hazardValue: 1,
  sigilChance: 0.35,
  wardBreak: 1,
  thiefTime: 6,
  thiefSteal: 0.1,
  bloodlust: 0,
  devour: 0,
  timeDrain: 1,
  thermal: 0,
  supercon: 0,
  hellfire: 0,
  goldSigil: 0,
  shardHp: 1,
};

/** A per-level modifier. Final stat = (base + Σadd·L) · Π(mul^L). */
export interface Mod {
  stat: StatKey;
  add?: number;
  mul?: number;
}

type StatFormat = 'int' | 'num' | 'pct' | 'x' | 'sec' | 'px' | 'rate' | 'flag' | 'pctps';

/** `worse`: a higher value hurts the player (curses push these up) */
export const STAT_META: Record<StatKey, { label: string; format: StatFormat; worse?: boolean }> = {
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
  burnChance: { label: 'Ignite chance', format: 'pct' },
  burnDps: { label: 'Burn per second', format: 'pct' },
  burnTime: { label: 'Burn length', format: 'sec' },
  burnAmp: { label: 'Damage to burning shards', format: 'pct' },
  burnSpread: { label: 'Fire spreads', format: 'flag' },
  chill: { label: 'Chill per hit', format: 'pct' },
  freeze: { label: 'Freezing', format: 'int' },
  freezeTime: { label: 'Freeze length', format: 'sec' },
  frozenMult: { label: 'Damage to frozen shards', format: 'x' },
  frostNova: { label: 'Shatterfrost', format: 'pct' },
  strikeRate: { label: 'Strikes per second', format: 'rate' },
  strikeDamage: { label: 'Strike damage', format: 'x' },
  strikeArc: { label: 'Strikes arc', format: 'flag' },
  hazardMult: { label: 'Hazards', format: 'x', worse: true },
  hazardValue: { label: 'Gloam from hazards', format: 'x' },
  sigilChance: { label: 'Sigil chance', format: 'pct' },
  wardBreak: { label: 'Wards per hit', format: 'int' },
  thiefTime: { label: 'Time before a thief flees', format: 'sec' },
  thiefSteal: { label: 'A thief takes', format: 'pct', worse: true },
  bloodlust: { label: 'Bloodlust', format: 'pct' },
  devour: { label: 'Time per hazard', format: 'sec' },
  timeDrain: { label: 'Time drain', format: 'x', worse: true },
  thermal: { label: 'Thermal shock', format: 'x' },
  supercon: { label: 'Superconductor', format: 'flag' },
  hellfire: { label: 'Hellfire', format: 'flag' },
  goldSigil: { label: 'Sigils in golden shards', format: 'pct' },
  shardHp: { label: 'Shard toughness', format: 'x', worse: true },
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
  base: Partial<Stats> = {},
): Stats {
  const b: Stats = { ...BASE_STATS, ...base };
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
  const out = { ...b };
  for (const k of Object.keys(out) as StatKey[]) {
    out[k] = (b[k] + (add[k] ?? 0)) * (mul[k] ?? 1);
  }
  return out;
}
