import { L, P, makeTree, type Def } from '../tree';

/**
 * Tree II, the Hollow Crown: what the seed fell from. Six branches with a playstyle each, and the
 * difficulty the Bloom leaves out:
 * - limited light: every lit star uses some, so a build is a choice (unweave to change it)
 * - forks: the fourth ring of every branch is an either/or
 * - trials: rings 2–5 stay sealed until a harvest challenge is met
 * - hazards: shards that fight back (wards, thieves, dimmers, skittish ones), more with every gate
 * - curses: great power with a price, and they burn no light
 */

/** branch directions, degrees (-90 = up) */
const A = { ember: -90, frost: -30, storm: 30, tide: 90, gild: 150, hollow: 210 } as const;

const defs: Def[] = [
  {
    id: 'crown', name: 'The Hollow Crown', branch: 'core', kind: 'core', ring: 0, angle: 0,
    desc: 'What the seed fell from. Touch it to begin a harvest.',
    parents: [], maxLevel: 1, costs: [], mods: [], icon: 'crown',
  },

  // ─── Ember: fire that keeps burning ───────────────────────────────────
  {
    id: 'ember_1', name: 'Kindling', branch: 'ember', kind: 'minor', ring: 1, angle: A.ember,
    desc: 'Your lens burns hotter and can set shards alight. Burning shards take damage every second.',
    parents: ['crown'], maxLevel: 5, costs: [L(5, 1.7)], mods: [{ stat: 'damage', add: 0.5 }, { stat: 'burnChance', add: 0.07 }], icon: 'flame',
  },
  {
    id: 'ember_2a', name: 'Firebrand', branch: 'ember', kind: 'major', ring: 2, angle: A.ember - 13,
    desc: 'Burning shards take more damage from everything.',
    parents: ['ember_1'], maxLevel: 3, costs: [L(280, 2.1)], mods: [{ stat: 'burnAmp', add: 0.2 }], icon: 'flare',
  },
  {
    id: 'ember_2b', name: 'Tinder', branch: 'ember', kind: 'minor', ring: 2, angle: A.ember + 13,
    desc: 'Every pulse hits harder.',
    parents: ['ember_1'], maxLevel: 5, costs: [L(200, 1.8)], mods: [{ stat: 'damage', add: 1 }], icon: 'blade',
  },
  {
    id: 'ember_3a', name: 'Cinders', branch: 'ember', kind: 'minor', ring: 3, angle: A.ember - 20,
    desc: 'Fires burn longer.',
    parents: ['ember_2a'], maxLevel: 3, costs: [L(4800, 2.0)], mods: [{ stat: 'burnTime', add: 1 }], icon: 'clock',
  },
  {
    id: 'ember_3b', name: 'Wildfire', branch: 'ember', kind: 'major', ring: 3, angle: A.ember,
    desc: 'A burning shard that breaks sets up to three shards around it alight.',
    parents: ['ember_2a', 'ember_2b'], maxLevel: 1, costs: [L(8400)], mods: [{ stat: 'burnSpread', add: 1 }], icon: 'nova',
  },
  {
    id: 'ember_3c', name: 'Bellows', branch: 'ember', kind: 'minor', ring: 3, angle: A.ember + 20,
    desc: 'Fan the flames: burns deal more damage.',
    parents: ['ember_2b'], maxLevel: 4, costs: [L(5100, 2.0)], mods: [{ stat: 'burnDps', mul: 1.35 }], icon: 'wave',
  },
  {
    id: 'ember_c', name: 'Pyre', branch: 'ember', kind: 'curse', ring: 3, angle: A.ember + 30,
    desc: 'Burns deal two and a half times the damage.', drawback: 'Your lens pulses a quarter slower.',
    parents: ['ember_3c'], maxLevel: 1, costs: [L(10000), P(5)], mods: [{ stat: 'burnDps', mul: 2.5 }, { stat: 'pulseRate', mul: 0.75 }], icon: 'flame',
  },
  {
    id: 'ember_4a', name: 'Searing Lens', branch: 'ember', kind: 'major', ring: 4, angle: A.ember - 11, fork: 'ember',
    desc: 'Far more of your hits set shards alight.',
    parents: ['ember_3a', 'ember_3b'], maxLevel: 1, costs: [L(135000), P(8)], mods: [{ stat: 'burnChance', add: 0.3 }], icon: 'aperture',
  },
  {
    id: 'ember_4b', name: 'Slow Burn', branch: 'ember', kind: 'major', ring: 4, angle: A.ember + 11, fork: 'ember',
    desc: 'Fires burn three seconds longer and half again as hot.',
    parents: ['ember_3b', 'ember_3c'], maxLevel: 1, costs: [L(135000), P(8)], mods: [{ stat: 'burnTime', add: 3 }, { stat: 'burnDps', mul: 1.5 }], icon: 'eclipse',
  },
  {
    id: 'ember_5', name: 'Inferno', branch: 'ember', kind: 'keystone', ring: 5, angle: A.ember,
    desc: 'KEYSTONE. Every hit of your lens sets a shard alight, and burns deal double.',
    parents: ['ember_4a', 'ember_4b'], maxLevel: 1, costs: [L(900000), P(50)],
    mods: [{ stat: 'burnChance', add: 1 }, { stat: 'burnDps', mul: 2 }], icon: 'sun',
  },

  // ─── Frost: slow, freeze, shatter ─────────────────────────────────────
  {
    id: 'frost_1', name: 'Chill', branch: 'frost', kind: 'minor', ring: 1, angle: A.frost,
    desc: 'A wider, colder lens. Every hit slows a shard down, so it stays in your lens.',
    parents: ['crown'], maxLevel: 5, costs: [L(5, 1.7)], mods: [{ stat: 'radius', add: 5 }, { stat: 'chill', add: 0.07 }], icon: 'snow',
  },
  {
    id: 'frost_2a', name: 'Hoarfrost', branch: 'frost', kind: 'major', ring: 2, angle: A.frost - 13,
    desc: 'Hit a shard often enough and it freezes solid: it stops, and takes half again the damage.',
    parents: ['frost_1'], maxLevel: 3, costs: [L(280, 2.1)], mods: [{ stat: 'freeze', add: 1 }], icon: 'prism',
  },
  {
    id: 'frost_2b', name: 'Glacial Lens', branch: 'frost', kind: 'minor', ring: 2, angle: A.frost + 13,
    desc: 'A wider lens.',
    parents: ['frost_1'], maxLevel: 5, costs: [L(200, 1.8)], mods: [{ stat: 'radius', add: 6 }], icon: 'aperture',
  },
  {
    id: 'frost_3a', name: 'Permafrost', branch: 'frost', kind: 'minor', ring: 3, angle: A.frost - 20,
    desc: 'Frozen shards stay frozen longer.',
    parents: ['frost_2a'], maxLevel: 3, costs: [L(4800, 2.0)], mods: [{ stat: 'freezeTime', add: 0.8 }], icon: 'clock',
  },
  {
    id: 'frost_3b', name: 'Shatterfrost', branch: 'frost', kind: 'major', ring: 3, angle: A.frost,
    desc: 'A frozen shard that breaks bursts into ice that hits everything nearby.',
    parents: ['frost_2a', 'frost_2b'], maxLevel: 2, costs: [L(8400, 2.6)], mods: [{ stat: 'frostNova', add: 0.5 }], icon: 'shards',
  },
  {
    id: 'frost_3c', name: 'Cold Snap', branch: 'frost', kind: 'minor', ring: 3, angle: A.frost + 20,
    desc: 'Your lens pulses faster.',
    parents: ['frost_2b'], maxLevel: 5, costs: [L(5100, 2.0)], mods: [{ stat: 'pulseRate', mul: 1.1 }], icon: 'pulse',
  },
  {
    id: 'frost_c', name: 'Rime', branch: 'frost', kind: 'curse', ring: 3, angle: A.frost + 30,
    desc: 'Frozen shards take double damage.', drawback: 'Every harvest is three seconds shorter.',
    parents: ['frost_3c'], maxLevel: 1, costs: [L(10000), P(5)], mods: [{ stat: 'frozenMult', mul: 2 }, { stat: 'duration', add: -3 }], icon: 'snow',
  },
  {
    id: 'frost_4a', name: 'Deep Freeze', branch: 'frost', kind: 'major', ring: 4, angle: A.frost - 11, fork: 'frost',
    desc: 'Shards freeze two hits sooner and stay frozen two seconds longer.',
    parents: ['frost_3a', 'frost_3b'], maxLevel: 1, costs: [L(135000), P(8)], mods: [{ stat: 'freeze', add: 2 }, { stat: 'freezeTime', add: 2 }], icon: 'layers',
  },
  {
    id: 'frost_4b', name: 'Brittle Ice', branch: 'frost', kind: 'major', ring: 4, angle: A.frost + 11, fork: 'frost',
    desc: 'Frozen shards are brittle: they take far more damage.',
    parents: ['frost_3b', 'frost_3c'], maxLevel: 1, costs: [L(135000), P(8)], mods: [{ stat: 'frozenMult', add: 1 }], icon: 'crack',
  },
  {
    id: 'frost_5', name: 'Absolute Zero', branch: 'frost', kind: 'keystone', ring: 5, angle: A.frost,
    desc: 'KEYSTONE. Hits chill twice as hard, and frozen shards take double damage again.',
    parents: ['frost_4a', 'frost_4b'], maxLevel: 1, costs: [L(900000), P(50)],
    mods: [{ stat: 'chill', mul: 2 }, { stat: 'freeze', add: 1 }, { stat: 'frozenMult', mul: 2 }], icon: 'moon',
  },

  // ─── Storm: lightning from above and between ──────────────────────────
  {
    id: 'storm_1', name: 'Static', branch: 'storm', kind: 'minor', ring: 1, angle: A.storm,
    desc: 'Your lens pulses faster, and hits can leap to a nearby shard as lightning.',
    parents: ['crown'], maxLevel: 5, costs: [L(7, 1.7)], mods: [{ stat: 'pulseRate', mul: 1.08 }, { stat: 'arcChance', add: 0.07 }], icon: 'spark',
  },
  {
    id: 'storm_2a', name: 'Thunderhead', branch: 'storm', kind: 'major', ring: 2, angle: A.storm - 13,
    desc: 'Lightning strikes a shard from above every so often.',
    parents: ['storm_1'], maxLevel: 4, costs: [L(280, 2.1)], mods: [{ stat: 'strikeRate', add: 0.4 }], icon: 'bolt',
  },
  {
    id: 'storm_2b', name: 'Conductor', branch: 'storm', kind: 'minor', ring: 2, angle: A.storm + 13,
    desc: 'All damage is amplified.',
    parents: ['storm_1'], maxLevel: 5, costs: [L(220, 1.8)], mods: [{ stat: 'damageMult', mul: 1.12 }], icon: 'pulse',
  },
  {
    id: 'storm_3a', name: 'Forked Bolt', branch: 'storm', kind: 'minor', ring: 3, angle: A.storm - 20,
    desc: 'Lightning jumps to one more shard.',
    parents: ['storm_2a'], maxLevel: 3, costs: [L(5100, 2.1)], mods: [{ stat: 'arcChains', add: 1 }], icon: 'fork',
  },
  {
    id: 'storm_3b', name: 'Ball Lightning', branch: 'storm', kind: 'major', ring: 3, angle: A.storm,
    desc: 'A ball of lightning hunts shards on its own and sets off arcs.',
    parents: ['storm_2a', 'storm_2b'], maxLevel: 2, costs: [L(8400, 2.6)], mods: [{ stat: 'satellites', add: 1 }, { stat: 'satArc', add: 1 }], icon: 'comet',
  },
  {
    id: 'storm_3c', name: 'Galvanic', branch: 'storm', kind: 'minor', ring: 3, angle: A.storm + 20,
    desc: 'Pulses have a chance to land a critical hit.',
    parents: ['storm_2b'], maxLevel: 5, costs: [L(5100, 2.0)], mods: [{ stat: 'critChance', add: 0.05 }], icon: 'crosshair',
  },
  {
    id: 'storm_c', name: 'Overcharge', branch: 'storm', kind: 'curse', ring: 3, angle: A.storm + 30,
    desc: 'Lightning strikes hit three times as hard.', drawback: 'Your lens is a fifth smaller.',
    parents: ['storm_3c'], maxLevel: 1, costs: [L(10000), P(5)], mods: [{ stat: 'strikeDamage', mul: 3 }, { stat: 'radius', mul: 0.8 }], icon: 'bolt',
  },
  {
    id: 'storm_4a', name: 'Stormfront', branch: 'storm', kind: 'major', ring: 4, angle: A.storm - 11, fork: 'storm',
    desc: 'One more strike every second, and every strike arcs on.',
    parents: ['storm_3a', 'storm_3b'], maxLevel: 1, costs: [L(135000), P(8)], mods: [{ stat: 'strikeRate', add: 1 }, { stat: 'strikeArc', add: 1 }], icon: 'storm',
  },
  {
    id: 'storm_4b', name: 'Charged Air', branch: 'storm', kind: 'major', ring: 4, angle: A.storm + 11, fork: 'storm',
    desc: 'Strikes come a little more often and hit twice as hard.',
    parents: ['storm_3b', 'storm_3c'], maxLevel: 1, costs: [L(135000), P(8)], mods: [{ stat: 'strikeRate', add: 0.3 }, { stat: 'strikeDamage', add: 3 }], icon: 'flare',
  },
  {
    id: 'storm_5', name: 'Tempest', branch: 'storm', kind: 'keystone', ring: 5, angle: A.storm,
    desc: 'KEYSTONE. The sky opens: far more strikes, and lightning jumps twice more.',
    parents: ['storm_4a', 'storm_4b'], maxLevel: 1, costs: [L(900000), P(50)],
    mods: [{ stat: 'strikeRate', add: 1.5 }, { stat: 'arcChains', add: 2 }], icon: 'storm',
  },

  // ─── Tide: time, and more to break ────────────────────────────────────
  {
    id: 'tide_1', name: 'Long Dusk', branch: 'tide', kind: 'minor', ring: 1, angle: A.tide,
    desc: 'The night lasts a little longer.',
    parents: ['crown'], maxLevel: 5, costs: [L(7, 1.7)], mods: [{ stat: 'duration', add: 1.5 }], icon: 'hourglass',
  },
  {
    id: 'tide_2a', name: 'Undertow', branch: 'tide', kind: 'major', ring: 2, angle: A.tide - 13,
    desc: 'Shards are slowly drawn toward your lens.',
    parents: ['tide_1'], maxLevel: 3, costs: [L(280, 2.1)], mods: [{ stat: 'gravity', add: 1 }], icon: 'well',
  },
  {
    id: 'tide_2b', name: 'Swell', branch: 'tide', kind: 'minor', ring: 2, angle: A.tide + 13,
    desc: 'Shards crystallise faster.',
    parents: ['tide_1'], maxLevel: 5, costs: [L(200, 1.8)], mods: [{ stat: 'spawnRate', mul: 1.12 }], icon: 'sprout',
  },
  {
    id: 'tide_3a', name: 'Teeming', branch: 'tide', kind: 'minor', ring: 3, angle: A.tide - 20,
    desc: 'More shards can drift in the field at once.',
    parents: ['tide_2a'], maxLevel: 5, costs: [L(4800, 2.0)], mods: [{ stat: 'maxShards', add: 2 }], icon: 'cluster',
  },
  {
    id: 'tide_3b', name: 'Hourglass Shards', branch: 'tide', kind: 'major', ring: 3, angle: A.tide,
    desc: 'Hourglass shards appear. Breaking one adds time to the harvest.',
    parents: ['tide_2a', 'tide_2b'], maxLevel: 4, costs: [L(7200, 2.2)], mods: [{ stat: 'timeShardChance', add: 0.035 }], icon: 'clock',
  },
  {
    id: 'tide_3c', name: 'Deep Water', branch: 'tide', kind: 'minor', ring: 3, angle: A.tide + 20,
    desc: 'Hold the night even longer.',
    parents: ['tide_2b'], maxLevel: 3, costs: [L(5100, 2.1)], mods: [{ stat: 'duration', add: 2 }], icon: 'wave',
  },
  {
    id: 'tide_c', name: 'Flood', branch: 'tide', kind: 'curse', ring: 3, angle: A.tide + 30,
    desc: 'Shards pour in half again as fast, and more fit the field.', drawback: 'Hazards are twice as common, and every shard is a third tougher.',
    parents: ['tide_3c'], maxLevel: 1, costs: [L(10000), P(5)],
    mods: [{ stat: 'spawnRate', mul: 1.5 }, { stat: 'maxShards', add: 5 }, { stat: 'hazardMult', mul: 2 }, { stat: 'shardHp', mul: 1.35 }], icon: 'wave',
  },
  {
    id: 'tide_4a', name: 'Last Light', branch: 'tide', kind: 'major', ring: 4, angle: A.tide - 11, fork: 'tide',
    desc: 'When time runs out, burn on in overtime with double damage.',
    parents: ['tide_3a', 'tide_3b'], maxLevel: 2, costs: [L(135000, 2.4), P(8)], mods: [{ stat: 'overtime', add: 2 }], icon: 'eclipse',
  },
  {
    id: 'tide_4b', name: 'Riptide', branch: 'tide', kind: 'major', ring: 4, angle: A.tide + 11, fork: 'tide',
    desc: 'Shards crystallise in pairs.',
    parents: ['tide_3b', 'tide_3c'], maxLevel: 1, costs: [L(135000), P(8)], mods: [{ stat: 'cluster', add: 1 }], icon: 'spiral',
  },
  {
    id: 'tide_5', name: 'Spring Tide', branch: 'tide', kind: 'keystone', ring: 5, angle: A.tide,
    desc: 'KEYSTONE. The night stretches on and the void overflows.',
    parents: ['tide_4a', 'tide_4b'], maxLevel: 1, costs: [L(900000), P(50)],
    mods: [{ stat: 'duration', add: 6 }, { stat: 'spawnRate', mul: 1.2 }], icon: 'moon',
  },

  // ─── Gild: wealth ─────────────────────────────────────────────────────
  {
    id: 'gild_1', name: 'Gilt', branch: 'gild', kind: 'minor', ring: 1, angle: A.gild,
    desc: 'Shards release more gloam when they break.',
    parents: ['crown'], maxLevel: 5, costs: [L(8, 1.7)], mods: [{ stat: 'lumenMult', add: 0.25 }], icon: 'gem',
  },
  {
    id: 'gild_2a', name: 'Gilded Shards', branch: 'gild', kind: 'major', ring: 2, angle: A.gild - 13,
    desc: 'Rare golden shards appear, worth many times more.',
    parents: ['gild_1'], maxLevel: 5, costs: [L(280, 1.8)], mods: [{ stat: 'goldChance', add: 0.03 }], icon: 'coin',
  },
  {
    id: 'gild_2b', name: 'Momentum', branch: 'gild', kind: 'minor', ring: 2, angle: A.gild + 13,
    desc: 'Break shards in quick succession to build a combo that multiplies gloam.',
    parents: ['gild_1'], maxLevel: 5, costs: [L(220, 1.8)], mods: [{ stat: 'comboPerKill', add: 0.008 }], icon: 'rhythm',
  },
  {
    id: 'gild_3a', name: 'Lucky Facets', branch: 'gild', kind: 'minor', ring: 3, angle: A.gild - 20,
    desc: 'Golden shards are worth even more, and some hold a sigil.',
    parents: ['gild_2a'], maxLevel: 3, costs: [L(5100, 2.2)], mods: [{ stat: 'goldValue', add: 2 }, { stat: 'goldSigil', add: 0.2 }], icon: 'coin',
  },
  {
    id: 'gild_3b', name: 'Deeper Hollow', branch: 'gild', kind: 'major', ring: 3, angle: A.gild,
    desc: 'Sapphire shards rise from deeper down. They are tougher and far richer.',
    parents: ['gild_2a', 'gild_2b'], maxLevel: 1, costs: [L(9000)], mods: [{ stat: 'tier2', add: 1 }], icon: 'layers',
  },
  {
    id: 'gild_3c', name: 'Refined', branch: 'gild', kind: 'minor', ring: 3, angle: A.gild + 20,
    desc: 'Distil far more gloam from every shard.',
    parents: ['gild_2b'], maxLevel: 5, costs: [L(5100, 2.0)], mods: [{ stat: 'lumenMult', add: 0.3 }], icon: 'gem',
  },
  {
    id: 'gild_c', name: 'Avarice', branch: 'gild', kind: 'curse', ring: 3, angle: A.gild + 30,
    desc: 'Double gloam from everything.', drawback: 'Thieves take twice as much when they flee.',
    parents: ['gild_3c'], maxLevel: 1, costs: [L(10000), P(5)], mods: [{ stat: 'lumenMultX', mul: 2 }, { stat: 'thiefSteal', mul: 2 }], icon: 'coin',
  },
  {
    id: 'gild_4a', name: 'Abyssal Strata', branch: 'gild', kind: 'major', ring: 4, angle: A.gild - 11, fork: 'gild',
    desc: 'Abyssal shards surface. They are huge, stubborn and overflowing with gloam.',
    parents: ['gild_3a', 'gild_3b'], maxLevel: 1, costs: [L(150000), P(8)], mods: [{ stat: 'tier3', add: 1 }], icon: 'abyss',
  },
  {
    id: 'gild_4b', name: 'Golden Rhythm', branch: 'gild', kind: 'major', ring: 4, angle: A.gild + 11, fork: 'gild',
    desc: 'Your combo climbs higher, counts for more and fades slower.',
    parents: ['gild_3b', 'gild_3c'], maxLevel: 1, costs: [L(135000), P(8)],
    mods: [{ stat: 'comboCap', add: 15 }, { stat: 'comboWindow', add: 0.6 }, { stat: 'comboPerKill', add: 0.01 }], icon: 'rhythm',
  },
  {
    id: 'gild_5', name: 'Gilded Crown', branch: 'gild', kind: 'keystone', ring: 5, angle: A.gild,
    desc: 'KEYSTONE. Everything you break turns to gold. ×2.5 all gloam.',
    parents: ['gild_4a', 'gild_4b'], maxLevel: 1, costs: [L(900000), P(50)], mods: [{ stat: 'lumenMultX', mul: 2.5 }], icon: 'crown',
  },

  // ─── Hollow: feed on what fights back ─────────────────────────────────
  {
    id: 'hollow_1', name: 'Hunger', branch: 'hollow', kind: 'minor', ring: 1, angle: A.hollow,
    desc: 'Hazards are worth more gloam.',
    parents: ['crown'], maxLevel: 5, costs: [L(7, 1.7)], mods: [{ stat: 'hazardValue', add: 0.5 }], icon: 'fang',
  },
  {
    id: 'hollow_2a', name: 'Sigil Hunter', branch: 'hollow', kind: 'major', ring: 2, angle: A.hollow - 13,
    desc: 'Hazards drop sigils more often.',
    parents: ['hollow_1'], maxLevel: 3, costs: [L(280, 2.1)], mods: [{ stat: 'sigilChance', add: 0.15 }], icon: 'eye',
  },
  {
    id: 'hollow_2b', name: 'Wardbreaker', branch: 'hollow', kind: 'minor', ring: 2, angle: A.hollow + 13,
    desc: 'Every hit strips one more ward off a warded shard.',
    parents: ['hollow_1'], maxLevel: 2, costs: [L(240, 2.2)], mods: [{ stat: 'wardBreak', add: 1 }], icon: 'shield',
  },
  {
    id: 'hollow_3a', name: 'Patience', branch: 'hollow', kind: 'minor', ring: 3, angle: A.hollow - 20,
    desc: 'Thieves linger longer before they flee.',
    parents: ['hollow_2a'], maxLevel: 3, costs: [L(4800, 2.0)], mods: [{ stat: 'thiefTime', add: 1.5 }], icon: 'chain',
  },
  {
    id: 'hollow_3b', name: 'Hollow Point', branch: 'hollow', kind: 'major', ring: 3, angle: A.hollow,
    desc: 'Weakened shards shatter at once.',
    parents: ['hollow_2a', 'hollow_2b'], maxLevel: 3, costs: [L(7800, 2.4)], mods: [{ stat: 'execute', add: 0.07 }], icon: 'crack',
  },
  {
    id: 'hollow_3c', name: 'Dread', branch: 'hollow', kind: 'minor', ring: 3, angle: A.hollow + 20,
    desc: 'Pulses can land critical hits, and they cut deeper.',
    parents: ['hollow_2b'], maxLevel: 4, costs: [L(5100, 2.0)], mods: [{ stat: 'critChance', add: 0.04 }, { stat: 'critMult', add: 0.3 }], icon: 'crosshair',
  },
  {
    id: 'hollow_c', name: 'Hollow Heart', branch: 'hollow', kind: 'curse', ring: 3, angle: A.hollow + 30,
    desc: 'All damage doubled.', drawback: 'Time runs out a quarter faster.',
    parents: ['hollow_3c'], maxLevel: 1, costs: [L(10000), P(5)], mods: [{ stat: 'damageMult', mul: 2 }, { stat: 'timeDrain', mul: 1.25 }], icon: 'skull',
  },
  {
    id: 'hollow_4a', name: 'Bloodlust', branch: 'hollow', kind: 'major', ring: 4, angle: A.hollow - 11, fork: 'hollow',
    desc: 'Breaking a hazard sends your lens into a frenzy: half again the damage for a few seconds.',
    parents: ['hollow_3a', 'hollow_3b'], maxLevel: 2, costs: [L(135000, 2.4), P(8)], mods: [{ stat: 'bloodlust', add: 0.5 }], icon: 'fang',
  },
  {
    id: 'hollow_4b', name: 'Ward Eater', branch: 'hollow', kind: 'major', ring: 4, angle: A.hollow + 11, fork: 'hollow',
    desc: 'Wards shatter at the first hit, and hazards drop sigils more often.',
    parents: ['hollow_3b', 'hollow_3c'], maxLevel: 1, costs: [L(135000), P(8)], mods: [{ stat: 'wardBreak', add: 9 }, { stat: 'sigilChance', add: 0.2 }], icon: 'shield',
  },
  {
    id: 'hollow_5', name: 'Devourer', branch: 'hollow', kind: 'keystone', ring: 5, angle: A.hollow,
    desc: 'KEYSTONE. Hazards are worth three times as much, and every one you break adds time.',
    parents: ['hollow_4a', 'hollow_4b'], maxLevel: 1, costs: [L(900000), P(50)],
    mods: [{ stat: 'hazardValue', mul: 3 }, { stat: 'devour', add: 0.4 }], icon: 'eye',
  },

  // ─── Synergies: on the borders, they need both neighbours ─────────────
  {
    id: 'syn_ef', name: 'Thermal Shock', branch: 'ember', branch2: 'frost', kind: 'synergy', ring: 4, angle: -60,
    req: 'all', desc: 'A burning shard that freezes, or a frozen one that catches fire, cracks for six pulses of damage.',
    parents: ['ember_3c', 'frost_3a'], maxLevel: 1, costs: [L(225000), P(12)], mods: [{ stat: 'thermal', add: 6 }], icon: 'crack',
  },
  {
    id: 'syn_fs', name: 'Superconductor', branch: 'frost', branch2: 'storm', kind: 'synergy', ring: 4, angle: 0,
    req: 'all', desc: 'Lightning deals double damage to chilled and frozen shards.',
    parents: ['frost_3c', 'storm_3a'], maxLevel: 1, costs: [L(225000), P(12)], mods: [{ stat: 'supercon', add: 1 }], icon: 'chain',
  },
  {
    id: 'syn_st', name: 'Monsoon', branch: 'storm', branch2: 'tide', kind: 'synergy', ring: 4, angle: 60,
    req: 'all', desc: 'More lightning, and the storm holds the night two seconds longer.',
    parents: ['storm_3c', 'tide_3a'], maxLevel: 1, costs: [L(225000), P(12)], mods: [{ stat: 'strikeRate', add: 0.6 }, { stat: 'duration', add: 2 }], icon: 'storm',
  },
  {
    id: 'syn_tg', name: 'Golden Hour', branch: 'tide', branch2: 'gild', kind: 'synergy', ring: 4, angle: 120,
    req: 'all', desc: 'Hourglass shards give triple gloam, and golden shards add time.',
    parents: ['tide_3c', 'gild_3a'], maxLevel: 1, costs: [L(225000), P(12)], mods: [{ stat: 'goldenHour', add: 1 }], icon: 'sunset',
  },
  {
    id: 'syn_gh', name: 'Blood Money', branch: 'gild', branch2: 'hollow', kind: 'synergy', ring: 4, angle: 180,
    req: 'all', desc: 'Hazards are worth double and drop sigils more often.',
    parents: ['gild_3c', 'hollow_3a'], maxLevel: 1, costs: [L(225000), P(12)], mods: [{ stat: 'hazardValue', add: 1 }, { stat: 'sigilChance', add: 0.2 }], icon: 'coin',
  },
  {
    id: 'syn_he', name: 'Hellfire', branch: 'hollow', branch2: 'ember', kind: 'synergy', ring: 4, angle: 240,
    req: 'all', desc: 'Hazards rise already burning, and every burn deals half again as much.',
    parents: ['hollow_3c', 'ember_3a'], maxLevel: 1, costs: [L(225000), P(12)], mods: [{ stat: 'hellfire', add: 1 }, { stat: 'burnDps', mul: 1.5 }], icon: 'flame',
  },

  // ─── Finale ───────────────────────────────────────────────────────────
  {
    id: 'uncrown', name: 'Uncrown', branch: 'core', kind: 'awaken', ring: 0, angle: 0,
    req: 2, desc: 'Break the hollow crown and let the light you grew pour into it.',
    parents: ['ember_5', 'frost_5', 'storm_5', 'tide_5', 'gild_5', 'hollow_5'], maxLevel: 1, costs: [L(4e6), P(120)],
    mods: [], icon: 'crown',
  },
];

export const CROWN = makeTree({
  id: 'crown',
  numeral: 'II',
  name: 'The Hollow Crown',
  blurb: 'What the seed fell from. Six branches, too little light, and a void that fights back.',
  defs,
  rings: [0, 215, 400, 590, 790, 1000],
  branches: ['ember', 'frost', 'storm', 'tide', 'gild', 'hollow'],
  keystones: ['ember_5', 'frost_5', 'storm_5', 'tide_5', 'gild_5', 'hollow_5'],
  root: 'crown',
  finale: 'uncrown',
  currency: { lumen: { name: 'gloam', color: 0xd6ccff }, prism: { name: 'sigils', color: 0xff5f7e } },
  base: { radius: 52 },
  tiers: [
    { hp: 4, value: 1, r: 20, sides: 3, color: 0xcdbfff },
    { hp: 34, value: 7, r: 26, sides: 4, color: 0x8f9cff },
    { hp: 180, value: 20, r: 33, sides: 5, color: 0xff7ab8 },
  ],
  heart: { hp: 200000, value: 30000, r: 74, sides: 6, color: 0xff3d63 },
  ringColor: 0xb08cff,
  voidColor: 0x050109,
  deepen: { hp: 1.6, value: 2.3 },
  light: { base: 6 },
  trials: [
    { id: 'gate_2', ring: 2, name: 'The First Gate', goal: { kind: 'gather', n: 60 }, text: 'Gather 60 gloam in one harvest', light: 4 },
    { id: 'gate_3', ring: 3, name: 'The Second Gate', goal: { kind: 'hazards', n: 7 }, text: 'Break 7 hazards in one harvest', light: 4 },
    { id: 'gate_4', ring: 4, name: 'The Third Gate', goal: { kind: 'gather', n: 1250 }, text: 'Gather 1.25K gloam in one harvest', light: 5 },
    { id: 'gate_5', ring: 5, name: 'The Fourth Gate', goal: { kind: 'gather', n: 4000 }, text: 'Gather 4K gloam in one harvest', light: 5 },
    { id: 'heart', ring: 0, name: 'The Hollow Heart', goal: { kind: 'boss', n: 1 }, text: 'Shatter the Hollow Heart', light: 0 },
  ],
});
