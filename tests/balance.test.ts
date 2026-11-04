/**
 * Headless pacing model. It approximates a Harvest with real Stats and real tree costs,
 * and has a "reasonable player" buy the cheapest affordable node after each run.
 * It isn't exact physics. The point is to catch walls, dead zones, and runaway growth.
 */
import { describe, expect, it } from 'vitest';
import { BLOOM } from '../src/data/trees';
import { newGame } from '../src/core/state';
import { buy, checkBuy, nextCost, statsFor } from '../src/systems/tree-logic';
import type { Stats } from '../src/data/stats';

const TIERS = [
  { hp: 3, value: 1, r: 20 },
  { hp: 22, value: 6, r: 26 },
  { hp: 110, value: 16, r: 33 },
];
const HEART = { hp: 2400, value: 600, r: 58 };
const AREA = 1440 * 780;
const SKILL = 2.2; // how much better than random the player positions the lens

const NODES = BLOOM.nodes;
const NODE_MAP = BLOOM.map;

let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

interface SimShard { hp: number; max: number; tier: number; type: string; r: number; value: number }

export function simulateRun(st: Stats) {
  const dt = 0.05;
  let remaining = st.duration;
  let overtime = 0, inOT = false, otUsed = false;
  let t = 0, spawnAcc = 0, pulseAcc = 0, satAcc = 0;
  let shards: SimShard[] = [];
  let lumen = 0, prism = 0, kills = 0, sinceHeart = 0, timeBonuses = 0;
  const killTimes: number[] = [];
  const pickTier = () => {
    const r = rnd();
    if (st.tier3 > 0) return r < 0.22 ? 2 : r < 0.54 ? 1 : 0;
    if (st.tier2 > 0) return r < 0.32 ? 1 : 0;
    return 0;
  };
  const spawn = () => {
    if (shards.length >= Math.round(st.maxShards)) return;
    let type = 'normal';
    if (st.heart > 0 && sinceHeart >= 100 && remaining > 4 && !shards.some((s) => s.type === 'heart')) { type = 'heart'; sinceHeart = 0; }
    else if (rnd() < st.prismChance) type = 'prism';
    else if (rnd() < st.timeShardChance) type = 'time';
    else if (rnd() < st.goldChance) type = 'gold';
    const tier = pickTier();
    const d = type === 'heart' ? HEART : TIERS[tier];
    const hp = d.hp * (type === 'prism' ? 1.5 : type === 'gold' ? 1.2 : 1);
    shards.push({ hp, max: hp, tier, type, r: d.r, value: d.value });
  };
  const kill = (s: SimShard, crit: boolean, executed: boolean, depth: number) => {
    s.hp = -1e9;
    kills++; sinceHeart++;
    killTimes.push(t);
    const recent = killTimes.filter((k) => t - k < st.comboWindow).length;
    const combo = st.comboPerKill > 0 ? Math.min(recent, Math.round(st.comboCap)) : 0;
    let typeMult = 1;
    if (s.type === 'gold') typeMult = st.goldValue;
    if (s.type === 'time' && st.goldenHour > 0) typeMult = 3;
    const cb = crit || executed ? 1 + st.critLumen : 1;
    lumen += s.value * st.lumenMult * st.lumenMultX * typeMult * (1 + combo * st.comboPerKill) * cb;
    if (s.type === 'prism') prism += Math.round(st.prismMult);
    if (s.type === 'heart') prism += 3 * Math.round(st.prismMult);
    let add = s.type === 'time' ? st.timeShardBonus : s.type === 'gold' && st.goldenHour > 0 ? 0.3 : 0;
    add *= Math.pow(0.93, timeBonuses);
    if (add >= 0.05 && !inOT) { remaining += add; timeBonuses++; }
    if (st.novaPower > 0 && depth < 3) {
      const amount = st.novaPower * Math.max(s.max * 0.6, pulseDmg() * 3);
      const frac = Math.min(1, (Math.PI * (100 + s.r) ** 2 / AREA) * 1.6);
      for (const o of shards) if (o.hp > 0 && rnd() < frac) hit(o, amount, false, depth + 1);
    }
  };
  const pulseDmg = () => st.damage * st.damageMult * (inOT ? 2 : 1);
  const hit = (s: SimShard, amount: number, canCrit: boolean, depth = 0) => {
    if (s.hp <= 0) return;
    let crit = false;
    if (canCrit && rnd() < st.critChance) { crit = true; amount *= st.critMult; }
    s.hp -= amount;
    if (s.hp <= 0) kill(s, crit, false, depth);
    else if (st.execute > 0 && s.type !== 'heart' && s.hp <= s.max * st.execute) kill(s, crit, true, depth);
  };
  const targets = (R: number) => {
    const alive = shards.filter((s) => s.hp > 0);
    const n = alive.length;
    const cover = Math.PI * (R + 22) ** 2 / AREA;
    const k = Math.min(n, Math.round(Math.max(n > 0 ? 1 : 0, n * cover * SKILL * (1 + st.gravity * 0.35))));
    // the player focuses: stay on the most-damaged shards until they break
    return alive.sort((a, b) => a.hp / a.max - b.hp / b.max).slice(0, k);
  };

  for (let i = 0; i < Math.min(st.maxShards, 6); i++) spawn();
  while (t < 300) {
    t += dt;
    if (inOT) { overtime -= dt; if (overtime <= 0) break; }
    else {
      remaining -= dt;
      if (remaining <= 0) {
        if (st.overtime > 0 && !otUsed) { otUsed = true; inOT = true; overtime = st.overtime; }
        else break;
      }
    }
    spawnAcc += st.spawnRate * dt;
    while (spawnAcc >= 1) { spawnAcc -= 1; spawn(); for (let c = 0; c < Math.round(st.cluster); c++) spawn(); }
    const R = st.radius * (1 + st.radiusGrowth * t);
    pulseAcc += dt;
    while (pulseAcc >= 1 / st.pulseRate) {
      pulseAcc -= 1 / st.pulseRate;
      const tg = targets(R);
      for (const s of tg) {
        hit(s, pulseDmg(), true);
        if (st.arcChance > 0 && rnd() < st.arcChance) {
          for (let j = 0; j < Math.round(st.arcChains); j++) {
            const others = shards.filter((o) => o.hp > 0);
            if (!others.length) break;
            hit(others[Math.floor(rnd() * others.length)], pulseDmg() * 0.6, true);
          }
        }
      }
      if (st.echoPower > 0) for (const s of targets(R * 0.85).slice(0, Math.ceil(tg.length * 0.7))) hit(s, pulseDmg() * st.echoPower, true);
    }
    // seeker motes hunt independently of the lens: ~2.4 hits/s each whenever any shard is up
    if (st.satellites > 0) {
      satAcc += dt * Math.round(st.satellites) * 2.4 * st.satSpeed * (shards.length > 0 ? 1 : 0);
      while (satAcc >= 1) {
        satAcc -= 1;
        const alive = shards.filter((s) => s.hp > 0);
        if (alive.length) hit(alive.sort((a, b) => a.hp - b.hp)[0], pulseDmg() * 0.8 * st.satDamage, st.satCrit > 0);
      }
    }
    shards = shards.filter((s) => s.hp > 0);
  }
  return { lumen, prism, kills, duration: t };
}

function playthrough(verbose = false) {
  seed = 12345;
  const s = newGame();
  let runs = 0;
  let time = 0;
  const log: string[] = [];
  const milestones: Record<string, number> = {};
  while (runs < 400 && !s.levels.awaken) {
    const st = statsFor(BLOOM, s.levels);
    const r = simulateRun(st);
    runs++;
    time += r.duration + 8; // + time spent in the tree
    s.lumen += r.lumen;
    s.prism += r.prism;
    let bought = 0;
    const names: string[] = [];
    // reasonable player: always grab the cheapest thing; awaken as soon as possible
    for (;;) {
      if (checkBuy(BLOOM, NODE_MAP.awaken, s) === null) { buy(BLOOM, NODE_MAP.awaken, s); milestones.awaken = runs; break; }
      const opts = NODES.filter((n) => n.kind !== 'awaken' && checkBuy(BLOOM, n, s) === null)
        // players love new mechanics: first levels of majors/synergies/keystones feel "cheaper"
        .map((n) => {
          const c = nextCost(n, s.levels);
          const fresh = (s.levels[n.id] ?? 0) === 0 && n.kind !== 'minor';
          return { n, c: ((c.lumen ?? 0) + (c.prism ?? 0) * 2000) * (fresh ? 0.4 : 1) };
        })
        .sort((a, b) => a.c - b.c);
      if (!opts.length) break;
      buy(BLOOM, opts[0].n, s);
      bought++;
      names.push(opts[0].n.id);
      const id = opts[0].n.id;
      if (!(id in milestones)) milestones[id] = runs;
    }
    if (verbose && (runs <= 10 || runs % 5 === 0 || (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SIMALL)) {
      log.push(`run ${String(runs).padStart(3)} | ${r.duration.toFixed(1).padStart(5)}s | +${Math.round(r.lumen).toString().padStart(8)} L +${String(r.prism).padStart(3)} P | kills ${String(r.kills).padStart(4)} | bank ${Math.round(s.lumen)} L ${s.prism} P | ${names.join(',')}`);
    }
  }
  return { runs, time, log, milestones, state: s };
}

describe('balance', () => {
  it('a full playthrough completes in a sensible number of runs', () => {
    const { runs, time, log, milestones } = playthrough(true);
    console.log(log.join('\n'));
    const ks = ['reach_2a', 'fortune_3b', 'fortune_4a', 'fortune_4b', 'syn_fr', 'force_5', 'reach_5', 'flow_5', 'fortune_5', 'syn5_fr', 'awaken'];
    console.log('milestones (run #):', ks.map((k) => `${k}@${milestones[k] ?? '—'}`).join('  '));
    console.log(`TOTAL: ${runs} runs, ~${(time / 60).toFixed(1)} min`);
    expect(milestones.awaken).toBeDefined();
    expect(runs).toBeLessThan(140);
    expect(runs).toBeGreaterThan(25);
  });

  it('the first run always affords at least one node', () => {
    seed = 777;
    const st = statsFor(BLOOM, newGame().levels);
    const r = simulateRun(st);
    expect(r.lumen).toBeGreaterThanOrEqual(5);
  });
});
