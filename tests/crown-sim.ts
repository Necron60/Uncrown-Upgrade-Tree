/**
 * Pacing model for the Hollow Crown. Like the Bloom's, it approximates a harvest with real Stats and
 * real costs, and adds what makes this tree harder: hazards, limited light, trials and the Hollow
 * Heart. A "reasonable player" commits to two branches, keeps light for the path to both keystones,
 * and buys the cheapest thing that fits. Every pair of branches is played through, so no build may
 * be a dead end and none may be far quicker than the rest.
 */
import { CROWN } from '../src/data/trees';
import { lightCost, type Branch, type NodeDef } from '../src/data/tree';
import { newProgress, type TreeProgress } from '../src/core/state';
import {
  buy, checkBuy, currentTrial, isOwned, level, lightCap, lightUsed, nextCost, spentOn, statsFor, trialMet, trialProgress, unweave, unweaveBlock,
} from '../src/systems/tree-logic';
import type { Stats } from '../src/data/stats';
import { HAZARD_RULES } from '../src/data/hazards';

const AREA = 1440 * 780;
const SKILL = 2.2;
const HAZ = ['warded', 'thief', 'dimmer', 'skittish'] as const;
const HZ = { warded: { hp: 1, value: 2 }, thief: { hp: 2, value: 3 }, dimmer: { hp: 2.5, value: 3 }, skittish: { hp: 0.8, value: 4 } };

export let seed = 1;
export const reseed = (s: number) => { seed = s; };
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

interface S {
  hp: number; max: number; tier: number; type: string; r: number; value: number; bonus: number; hazard: boolean;
  wards: number; fuse: number; burn: number; chill: number; frost: number; frozen: number;
}

export function simulateCrownRun(st: Stats, depth: number, boss: boolean, wounds = 0) {
  const dt = 0.05;
  let remaining = st.duration, overtime = 0, inOT = false, otUsed = false;
  let t = 0, spawnAcc = 0, pulseAcc = 0, satAcc = 0, strikeAcc = 0, frenzy = 0, bossT = boss ? 2.6 : -1;
  let shards: S[] = [];
  let lumen = 0, prism = 0, kills = 0, hazards = 0, bossKills = 0, stolen = 0, timeBonuses = 0;
  const killTimes: number[] = [];
  let heartDown = false;
  const hazardChance = HAZARD_RULES.chance(depth, st.hazardMult);
  const pickTier = () => {
    const r = rnd();
    if (st.tier3 > 0) return r < 0.22 ? 2 : r < 0.54 ? 1 : 0;
    if (st.tier2 > 0) return r < 0.32 ? 1 : 0;
    return 0;
  };
  const make = (type: string): S => {
    const tier = type === 'boss' ? 0 : pickTier();
    const d = type === 'boss' ? CROWN.heart : CROWN.tiers[tier];
    const deep = type === 'boss' ? { hp: 1, value: 1 } : { hp: CROWN.deepen!.hp ** depth, value: CROWN.deepen!.value ** depth };
    const hz = (HZ as Record<string, { hp: number; value: number }>)[type];
    const hp = d.hp * deep.hp * (type === 'boss' ? 1 : st.shardHp) * (hz?.hp ?? (type === 'gold' ? 1.2 : 1));
    return {
      hp, max: hp, tier, type, r: d.r, value: d.value * deep.value, bonus: hz?.value ?? 1, hazard: !!hz,
      wards: type === 'warded' ? HAZARD_RULES.wards(depth) : 0, fuse: type === 'thief' ? st.thiefTime : 0,
      burn: hz && st.hellfire > 0 ? st.burnTime * 2 : 0, chill: 0, frost: 0, frozen: 0,
    };
  };
  const spawn = (force?: string) => {
    if (!force && shards.length >= Math.round(st.maxShards)) return;
    let type = force ?? 'normal';
    if (!force) {
      if (rnd() < hazardChance) type = HAZ[Math.floor(rnd() * Math.min(4, depth + 1))];
      else if (rnd() < st.timeShardChance) type = 'time';
      else if (rnd() < st.goldChance) type = 'gold';
    }
    shards.push(make(type));
  };
  const pulseDmg = () => st.damage * st.damageMult * (inOT ? 2 : 1);
  const addTime = (a: number) => {
    a *= Math.pow(0.93, timeBonuses);
    if (a >= 0.05 && !inOT) { remaining += a; timeBonuses++; }
  };
  const kill = (s: S, crit: boolean, executed: boolean, depthN: number) => {
    s.hp = -1e9;
    kills++;
    killTimes.push(t);
    if (s.hazard) hazards++;
    if (s.type === 'boss') bossKills++;
    const recent = killTimes.filter((k) => t - k < st.comboWindow).length;
    const combo = st.comboPerKill > 0 ? Math.min(recent, Math.round(st.comboCap)) : 0;
    let typeMult = 1;
    if (s.type === 'gold') typeMult = st.goldValue;
    if (s.type === 'time' && st.goldenHour > 0) typeMult = 3;
    if (s.hazard) typeMult = s.bonus * st.hazardValue;
    const cb = crit || executed ? 1 + st.critLumen : 1;
    lumen += s.value * st.lumenMult * st.lumenMultX * typeMult * (1 + combo * st.comboPerKill) * cb;
    if (s.hazard) {
      // every hazard broken cracks the Hollow Heart
      const heart = shards.find((x) => x.type === 'boss' && x.hp > 0);
      if (heart) {
        heart.hp -= heart.max * HAZARD_RULES.heartCrack;
        if (heart.hp <= 0) kill(heart, false, false, 0);
      }
      prism += Math.floor(st.sigilChance) + (rnd() < st.sigilChance % 1 ? 1 : 0);
      if (st.bloodlust > 0) frenzy = 4;
      if (st.devour > 0) addTime(st.devour);
    }
    if (s.type === 'boss') {
      prism += 20;
      // without its heart, everything left in the void shatters, and the night ends
      for (const o of shards) if (o.hp > 0 && o !== s) kill(o, false, false, 3);
      heartDown = true;
    }
    if (s.type === 'gold' && st.goldSigil > 0 && rnd() < st.goldSigil) prism += 1;
    if (s.type === 'time') addTime(st.timeShardBonus);
    if (s.type === 'gold' && st.goldenHour > 0) addTime(0.3);
    const near = (R: number) => Math.min(1, (Math.PI * (R + s.r) ** 2 / AREA) * 1.6);
    if (s.burn > 0 && st.burnSpread > 0) {
      let lit = 0;
      for (const o of shards) if (lit < 3 && o.hp > 0 && rnd() < near(120)) { o.burn = Math.max(o.burn, st.burnTime); lit++; }
    }
    if (s.frozen > 0 && st.frostNova > 0 && depthN < 3) {
      const amount = st.frostNova * Math.max(s.max * 0.6, pulseDmg() * 3);
      for (const o of shards) if (o.hp > 0 && rnd() < near(110)) hit(o, amount, false, { dot: true, depth: depthN + 1 });
    }
  };
  const hit = (s: S, amount: number, canCrit: boolean, o: { lens?: boolean; lightning?: boolean; dot?: boolean; depth?: number } = {}) => {
    if (s.hp <= 0) return;
    if (s.wards > 0 && !o.dot) { s.wards = Math.max(0, s.wards - Math.max(1, Math.round(st.wardBreak))); return; }
    let m = 1;
    if (s.burn > 0) m *= 1 + st.burnAmp;
    if (s.frozen > 0) m *= st.frozenMult;
    if (frenzy > 0) m *= 1 + st.bloodlust;
    if (o.lightning && st.supercon > 0 && (s.chill > 0.05 || s.frozen > 0)) m *= 2;
    amount *= m;
    let crit = false;
    if (canCrit && rnd() < st.critChance) { crit = true; amount *= st.critMult; }
    s.hp -= amount;
    if (s.hp <= 0) return kill(s, crit, false, o.depth ?? 0);
    if (st.execute > 0 && s.type !== 'boss' && s.hp <= s.max * st.execute) return kill(s, crit, true, o.depth ?? 0);
    if (o.dot) return;
    if (st.chill > 0) s.chill = Math.min(0.85, s.chill + st.chill);
    if (st.freeze > 0 && s.frozen <= 0 && s.type !== 'boss' && ++s.frost >= Math.max(2, 7 - Math.round(st.freeze))) {
      s.frost = 0;
      s.frozen = st.freezeTime;
      if (s.burn > 0 && st.thermal > 0) hit(s, st.thermal * pulseDmg(), false, { dot: true });
    }
    if (o.lens && st.burnChance > 0 && rnd() < st.burnChance) {
      if (s.burn <= 0 && s.frozen > 0 && st.thermal > 0) hit(s, st.thermal * pulseDmg(), false, { dot: true });
      s.burn = Math.max(s.burn, st.burnTime);
    }
  };
  const alive = () => shards.filter((s) => s.hp > 0);
  const targets = (R: number) => {
    const a = alive().filter((s) => s.type !== 'boss' && (s.type !== 'skittish' || rnd() < 0.4));
    const n = a.length;
    const avgChill = n ? a.reduce((x, s) => x + (s.frozen > 0 ? 0.85 : s.chill), 0) / n : 0;
    const cover = Math.PI * (R + 22) ** 2 / AREA;
    const k = Math.min(n, Math.round(Math.max(n > 0 ? 1 : 0, n * cover * SKILL * (1 + st.gravity * 0.35) * (1 + Math.min(0.5, avgChill)))));
    // the player goes for thieves first, then whatever is closest to breaking
    const pri = (s: S) => (s.type === 'thief' ? -2 : s.hazard ? -0.5 : 0) + s.hp / s.max;
    const out = a.sort((x, y) => pri(x) - pri(y)).slice(0, k);
    const b = shards.find((s) => s.type === 'boss' && s.hp > 0);
    if (b) out.push(b); // the Hollow Heart is too big to miss
    return out;
  };

  for (let i = 0; i < Math.min(st.maxShards, 6); i++) spawn();
  while (t < 400 && !heartDown) {
    t += dt;
    if (inOT) { overtime -= dt; if (overtime <= 0) break; }
    else {
      remaining -= dt * st.timeDrain;
      if (remaining <= 0) {
        if (st.overtime > 0 && !otUsed) { otUsed = true; inOT = true; overtime = st.overtime; }
        else break;
      }
    }
    frenzy = Math.max(0, frenzy - dt);
    if (bossT > 0 && (bossT -= dt) <= 0) {
      spawn('boss');
      const b = shards[shards.length - 1];
      b.hp = b.max * (1 - wounds);
    }
    spawnAcc += st.spawnRate * dt;
    while (spawnAcc >= 1) { spawnAcc -= 1; spawn(); for (let c = 0; c < Math.round(st.cluster); c++) spawn(); }
    if (shards.some((s) => s.type === 'boss' && s.hp > 0) && rnd() < dt / 3.2) spawn('warded');
    const dimmers = shards.filter((s) => s.type === 'dimmer' && s.hp > 0).length;
    const R = st.radius * (1 + st.radiusGrowth * t) * Math.max(HAZARD_RULES.dimMin, Math.pow(HAZARD_RULES.dimPer, dimmers));
    pulseAcc += dt;
    while (pulseAcc >= 1 / st.pulseRate) {
      pulseAcc -= 1 / st.pulseRate;
      for (const s of targets(R)) {
        hit(s, pulseDmg(), true, { lens: true });
        if (st.arcChance > 0 && rnd() < st.arcChance) {
          for (let j = 0; j < Math.round(st.arcChains); j++) {
            const a = alive();
            if (!a.length) break;
            hit(a[Math.floor(rnd() * a.length)], pulseDmg() * 0.6, true, { lightning: true });
          }
        }
      }
    }
    if (st.strikeRate > 0) {
      strikeAcc += st.strikeRate * dt;
      while (strikeAcc >= 1) {
        strikeAcc -= 1;
        const a = alive();
        if (!a.length) continue;
        const s = a[Math.floor(rnd() * a.length)];
        hit(s, st.strikeDamage * pulseDmg(), true, { lightning: true });
        if (st.strikeArc > 0) {
          const b = alive();
          if (b.length) hit(b[Math.floor(rnd() * b.length)], pulseDmg() * 0.6, true, { lightning: true });
        }
      }
    }
    if (st.satellites > 0) {
      satAcc += dt * Math.round(st.satellites) * 2.4 * st.satSpeed * (shards.length > 0 ? 1 : 0);
      while (satAcc >= 1) {
        satAcc -= 1;
        const a = alive();
        if (!a.length) continue;
        const s = a.sort((x, y) => x.hp - y.hp)[0];
        hit(s, pulseDmg() * 0.8 * st.satDamage, st.satCrit > 0);
        if (st.satArc > 0 && st.arcChance > 0 && rnd() < st.arcChance) {
          const b = alive();
          if (b.length) hit(b[Math.floor(rnd() * b.length)], pulseDmg() * 0.6, true, { lightning: true });
        }
      }
    }
    for (const s of shards) {
      if (s.hp <= 0) continue;
      if (s.frozen > 0) s.frozen -= dt;
      s.chill = Math.max(0, s.chill - dt * 0.3);
      if (s.burn > 0) {
        s.burn -= dt;
        hit(s, st.burnDps * pulseDmg() * dt, false, { dot: true });
      }
      if (s.type === 'thief' && s.hp > 0 && (s.fuse -= dt) <= 0) {
        s.hp = -1e9; // fled
        const take = Math.floor(lumen * st.thiefSteal);
        lumen -= take;
        stolen += take;
      }
    }
    shards = shards.filter((s) => s.hp > 0);
  }
  const b = shards.find((x) => x.type === 'boss');
  const bossFrac = bossKills ? 1 : b ? 1 - b.hp / b.max : 0;
  return { lumen: Math.floor(lumen), prism, kills, hazards, boss: bossKills, bossFrac, stolen, duration: t };
}

// ───────────────────────────────────────────── the player
/** The stars a build needs to reach both its keystones. */
function essentials(focus: Branch[], fork: 'a' | 'b'): string[] {
  return focus.flatMap((b) => [`${b}_1`, `${b}_2b`, `${b}_3b`, `${b}_4${fork}`, `${b}_5`]);
}

/**
 * A reasonable player: lights the first ring widely while light allows, then commits to two branches,
 * unweaving what it no longer needs whenever a star on its path wants the light.
 */
export function playthrough(focus: Branch[], fork: 'a' | 'b', s0 = 99, maxRuns = 900, log?: string[]) {
  reseed(s0);
  const p: TreeProgress = newProgress('crown');
  const ess = new Set(essentials(focus, fork));
  const inFocus = (n: NodeDef) => (n.branch2 ? focus.includes(n.branch) && focus.includes(n.branch2) : focus.includes(n.branch));
  const allowed = (n: NodeDef) => n.kind !== 'awaken' && n.kind !== 'core'
    && (n.ring === 1 || inFocus(n))
    && (!n.fork || n.id.endsWith(`_4${fork}`));
  let runs = 0, time = 0, unwoven = 0;
  const milestones: Record<string, number> = {};
  /** the best a harvest came toward each trial while it was the current one */
  const plateau: Record<string, number> = {};
  /** income once both keystones and the heart are done: what the finale's price is paid with */
  const late = { runs: 0, lumen: 0, prism: 0 };
  const free = () => lightCap(CROWN, p) - lightUsed(CROWN, p.levels);
  /** make room for a star on the path: unweave what matters least (off-plan first, then the cheapest) */
  const rank = (n: NodeDef) => (n.ring === 1 ? 2 : inFocus(n) ? 1 : 0);
  const makeRoom = (need: number) => {
    while (free() < need) {
      const opts = CROWN.nodes.filter((n) => isOwned(p.levels, n.id) && !ess.has(n.id) && lightCost(n) > 0 && unweaveBlock(CROWN, n, p) === null)
        // off-plan stars first, then extras on the plan; the first ring (the economy) last of all
        .sort((a, b) => rank(a) - rank(b) || (spentOn(a, level(p.levels, a.id)).lumen ?? 0) - (spentOn(b, level(p.levels, b.id)).lumen ?? 0));
      if (!opts.length) return false;
      unweave(CROWN, opts[0], p);
      unwoven++;
    }
    return true;
  };
  while (runs < maxRuns && !p.awakened) {
    const st = statsFor(CROWN, p.levels);
    const trial = currentTrial(CROWN, p);
    const boss = !p.trials.includes('heart') && CROWN.trials!.every((t) => t.goal.kind === 'boss' || p.trials.includes(t.id));
    const r = simulateCrownRun(st, p.trials.length, boss, p.heart);
    if (boss) p.heart = Math.max(p.heart, r.bossFrac);
    runs++;
    time += r.duration + 10;
    p.lumen += r.lumen;
    p.prism += r.prism;
    if (focus.every((b) => isOwned(p.levels, `${b}_5`)) && p.trials.includes('heart')) { late.runs++; late.lumen += r.lumen; late.prism += r.prism; }
    if (trial) plateau[trial.id] = Math.max(plateau[trial.id] ?? 0, trial.goal.kind === 'boss' ? r.bossFrac : trialProgress(trial, r));
    if (trial && trialMet(trial, r)) { p.trials.push(trial.id); milestones[trial.id] = runs; }
    if (log && (runs % 10 === 0 || runs < 6)) {
      const owned = Object.entries(p.levels).filter(([k, v]) => v > 0 && k !== 'crown').map(([k, v]) => `${k}${v > 1 ? v : ''}`).join(' ');
      log.push(`run ${String(runs).padStart(3)} ${r.duration.toFixed(0).padStart(3)}s +${String(r.lumen).padStart(7)} +${r.prism}s K${r.kills} H${r.hazards}${r.stolen ? ` -${r.stolen}` : ''} | bank ${Math.round(p.lumen)} ${p.prism}s | light ${lightUsed(CROWN, p.levels)}/${lightCap(CROWN, p)} | ${trial?.id ?? '-'} | ${owned}`);
    }
    for (let guard = 0; guard < 200; guard++) {
      const fin = CROWN.map[CROWN.finale];
      if (checkBuy(CROWN, fin, p) === null) { buy(CROWN, fin, p); p.awakened = true; milestones.uncrown = runs; break; }
      // a star on the path that only wants light: make room for it
      const blocked = [...ess].map((id) => CROWN.map[id]).find((n) => checkBuy(CROWN, n, p)?.reason === 'dark'
        && (nextCost(n, p.levels).lumen ?? 0) <= p.lumen && (nextCost(n, p.levels).prism ?? 0) <= p.prism);
      if (blocked && makeRoom(lightCost(blocked))) {
        buy(CROWN, blocked, p);
        if (!(blocked.id in milestones)) milestones[blocked.id] = runs;
        continue;
      }
      const opts = CROWN.nodes.filter((n) => allowed(n) && checkBuy(CROWN, n, p) === null)
        .map((n) => {
          const c = nextCost(n, p.levels);
          const fresh = !isOwned(p.levels, n.id) && n.kind !== 'minor';
          return { n, c: ((c.lumen ?? 0) + (c.prism ?? 0) * 3000) * (fresh ? 0.4 : 1) * (ess.has(n.id) ? 0.5 : 1) };
        })
        .sort((a, b) => a.c - b.c);
      if (!opts.length) break;
      buy(CROWN, opts[0].n, p);
      if (!(opts[0].n.id in milestones)) milestones[opts[0].n.id] = runs;
    }
  }
  return { runs, time, milestones, unwoven, plateau, late, p };
}
