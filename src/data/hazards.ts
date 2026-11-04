/**
 * The Hollow Crown's hazards: how common they are, how thick their wards, how hard a dimmer dims.
 * Shared by the harvest and by its pacing model (tests/crown-sim.ts), so the two cannot drift apart.
 */
export const HAZARD_RULES = {
  /** share of shards that rise as hazards: more with every gate passed (depth) */
  chance: (depth: number, mult: number) => Math.min(0.5, (0.07 + 0.035 * depth) * mult),
  /** wards on a warded shard */
  wards: (depth: number) => Math.min(8, 4 + depth),
  /** each dimmer alive shrinks the lens by this factor, down to dimMin */
  dimPer: 0.7,
  dimMin: 0.4,
  /** share of the Hollow Heart's health a hazard broken while it is up takes */
  heartCrack: 0.008,
};
