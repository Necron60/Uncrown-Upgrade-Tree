import { describe, expect, it } from 'vitest';
import { lightCost, nodeRadius, type TreeDef } from '../src/data/tree';
import { BLOOM, CROWN, TREES } from '../src/data/trees';
import { BASE_STATS, STAT_META, type StatKey } from '../src/data/stats';
import { polar } from '../src/core/math';
import { LEGACY_TIPS, defaultSettings, effectiveMotion, newGame, normalizeSettings, parseSave } from '../src/core/state';
import {
  buy, costAt, nodeState, statsFor, checkBuy, needed, lightCap, lightUsed, unweave, unweaveBlock, currentTrial, trialMet,
} from '../src/systems/tree-logic';

const NODE_MAP = BLOOM.map;

describe.each(Object.values(TREES).map((t) => [t.name, t] as [string, TreeDef]))('%s: data integrity', (_name, tree) => {
  const NODES = tree.nodes;
  const NODE_MAP = tree.map;
  const RING_RADII = tree.rings;
  it('has unique ids and valid parents', () => {
    const ids = new Set<string>();
    for (const n of NODES) {
      expect(ids.has(n.id), `duplicate ${n.id}`).toBe(false);
      ids.add(n.id);
    }
    for (const n of NODES) for (const p of n.parents) expect(NODE_MAP[p], `${n.id} → ${p}`).toBeDefined();
  });

  it('only references real stats', () => {
    for (const n of NODES) for (const m of n.mods) expect(STAT_META[m.stat], `${n.id}.${m.stat}`).toBeDefined();
    for (const k of Object.keys(BASE_STATS)) expect(STAT_META[k as StatKey]).toBeDefined();
  });

  it('every node is reachable from the seed', () => {
    const levels: Record<string, number> = {};
    for (const n of NODES) levels[n.id] = n.maxLevel; // own everything
    const reach = new Set([tree.root]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of NODES) {
        if (reach.has(n.id)) continue;
        const ok = n.parents.filter((p) => reach.has(p)).length >= needed(n);
        if (ok) { reach.add(n.id); grew = true; }
      }
    }
    expect([...reach].length).toBe(NODES.length);
  });

  it('nodes do not overlap on screen', () => {
    const placed = NODES.filter((n) => n.kind !== 'awaken').map((n) => ({ n, ...polar(RING_RADII[n.ring], n.angle) }));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const min = nodeRadius(a.n.kind) + nodeRadius(b.n.kind) + 24;
        expect(d, `${a.n.id} ↔ ${b.n.id}`).toBeGreaterThan(min);
      }
    }
  });

  it('every non-root node has at least one cost', () => {
    for (const n of NODES) if (n.kind !== 'core') expect(n.costs.length, n.id).toBeGreaterThan(0);
  });

  it('has one root, one finale and real keystones', () => {
    expect(NODES.filter((n) => n.kind === 'core').map((n) => n.id)).toEqual([tree.root]);
    expect(NODE_MAP[tree.finale].kind).toBe('awaken');
    for (const k of tree.keystones) expect(NODE_MAP[k].kind).toBe('keystone');
  });

  it('forks come in pairs on the same ring, and only on trees with limited light', () => {
    const forks = new Map<string, string[]>();
    for (const n of NODES) if (n.fork) forks.set(n.fork, [...(forks.get(n.fork) ?? []), n.id]);
    for (const [f, ids] of forks) {
      expect(ids.length, f).toBe(2);
      expect(new Set(ids.map((id) => NODE_MAP[id].ring)).size, f).toBe(1);
      expect(tree.light, f).toBeDefined();
    }
  });
});

describe('tree logic', () => {
  it('starts with ring 1 available, ring 2 as silhouettes', () => {
    const s = newGame();
    expect(nodeState(BLOOM, NODE_MAP.seed, s)).toBe('owned');
    expect(nodeState(BLOOM, NODE_MAP.force_1, s)).toBe('available');
    expect(nodeState(BLOOM, NODE_MAP.force_2a, s)).toBe('silhouette');
    expect(nodeState(BLOOM, NODE_MAP.force_3b, s)).toBe('hidden');
  });

  it('costs grow geometrically', () => {
    const d = NODE_MAP.force_1;
    expect(costAt(d, 0).lumen).toBe(5);
    expect(costAt(d, 1).lumen).toBe(Math.round(5 * 1.65));
    expect(costAt(d, 3).lumen).toBe(Math.round(5 * 1.65 ** 3));
  });

  it('buying deducts currency, levels up and reveals children', () => {
    const s = newGame();
    s.lumen = 100;
    const r = buy(BLOOM, NODE_MAP.force_1, s);
    expect(r.ok).toBe(true);
    expect(s.lumen).toBe(95);
    expect(s.levels.force_1).toBe(1);
    if (r.ok) expect(r.revealed).toEqual(expect.arrayContaining(['force_2a', 'force_2b']));
    expect(nodeState(BLOOM, NODE_MAP.force_2a, s)).toBe('available');
  });

  it('refuses when poor, locked, or maxed', () => {
    const s = newGame();
    expect(checkBuy(BLOOM, NODE_MAP.force_1, s)).toEqual({ ok: false, reason: 'poor' });
    s.lumen = 1e9;
    expect(checkBuy(BLOOM, NODE_MAP.force_2a, s)).toEqual({ ok: false, reason: 'locked' });
    for (let i = 0; i < 5; i++) buy(BLOOM, NODE_MAP.force_1, s);
    expect(checkBuy(BLOOM, NODE_MAP.force_1, s)).toEqual({ ok: false, reason: 'maxed' });
    expect(nodeState(BLOOM, NODE_MAP.force_1, s)).toBe('maxed');
  });

  it('synergy nodes need every parent', () => {
    const s = newGame();
    s.levels = { seed: 1, force_3a: 1 };
    expect(nodeState(BLOOM, NODE_MAP.syn_fr, s)).toBe('locked');
    s.levels.reach_3a = 1;
    expect(nodeState(BLOOM, NODE_MAP.syn_fr, s)).toBe('available');
  });

  it('awaken needs all four keystones and both currencies', () => {
    const s = newGame();
    s.lumen = 1e9; s.prism = 1e9;
    s.levels = { seed: 1, force_5: 1, reach_5: 1, flow_5: 1 };
    expect(checkBuy(BLOOM, NODE_MAP.awaken, s)).toEqual({ ok: false, reason: 'locked' });
    s.levels.fortune_5 = 1;
    expect(checkBuy(BLOOM, NODE_MAP.awaken, s)).toBeNull();
  });

  it('stats fold additive then multiplicative', () => {
    const st = statsFor(BLOOM, { seed: 1, force_1: 2, force_3b: 2 });
    expect(st.damage).toBe(3);
    expect(st.damageMult).toBeCloseTo(1.5625);
    const st2 = statsFor(BLOOM, { seed: 1, fortune_1: 4, fortune_5: 1 });
    expect(st2.lumenMult).toBeCloseTo(2);
    expect(st2.lumenMultX).toBeCloseTo(2.5);
  });
});

describe('the Hollow Crown', () => {
  const C = CROWN.map;
  const rich = () => {
    const g = newGame();
    g.crown.lumen = 1e12;
    g.crown.prism = 1e6;
    return g.crown;
  };

  it('starts with six light and ring 1 open', () => {
    const p = rich();
    expect(lightCap(CROWN, p)).toBe(6);
    expect(lightUsed(CROWN, p.levels)).toBe(0);
    for (const b of CROWN.branches) expect(nodeState(CROWN, C[`${b}_1`], p)).toBe('available');
  });

  it('runs out of light', () => {
    const p = rich();
    for (const b of CROWN.branches) expect(buy(CROWN, C[`${b}_1`], p).ok).toBe(true);
    expect(lightUsed(CROWN, p.levels)).toBe(6);
    // levels of a lit star cost no more light
    expect(buy(CROWN, C.ember_1, p).ok).toBe(true);
    p.trials.push('gate_2');
    expect(lightCap(CROWN, p)).toBe(6 + CROWN.trials![0].light);
    expect(buy(CROWN, C.ember_2a, p).ok).toBe(true); // a mechanic: 2 light
    const minors = ['ember_2b', 'frost_2b', 'storm_2b', 'tide_2b', 'gild_2b'];
    let i = 0;
    while (lightUsed(CROWN, p.levels) < lightCap(CROWN, p)) expect(buy(CROWN, C[minors[i++]], p).ok).toBe(true);
    expect(checkBuy(CROWN, C[minors[i]], p)).toEqual({ ok: false, reason: 'dark' });
    // the finale and curses burn no light, so a full tree never blocks them on light
    p.trials = CROWN.trials!.map((t) => t.id);
    p.levels.ember_5 = 1;
    p.levels.storm_5 = 1;
    expect(checkBuy(CROWN, C.uncrown, p)).toBeNull();
  });

  it('seals rings behind trials', () => {
    const p = rich();
    buy(CROWN, C.ember_1, p);
    expect(nodeState(CROWN, C.ember_2a, p)).toBe('gated');
    expect(checkBuy(CROWN, C.ember_2a, p)).toEqual({ ok: false, reason: 'gated' });
    expect(currentTrial(CROWN, p)?.id).toBe('gate_2');
    p.trials.push('gate_2');
    expect(nodeState(CROWN, C.ember_2a, p)).toBe('available');
    expect(currentTrial(CROWN, p)?.id).toBe('gate_3');
  });

  it('measures trials', () => {
    const [gather, hazards] = CROWN.trials!;
    const boss = CROWN.trials!.find((t) => t.goal.kind === 'boss')!;
    const run = { lumen: 0, kills: 0, hazards: 0, boss: 0 };
    expect(trialMet(gather, { ...run, lumen: gather.goal.n })).toBe(true);
    expect(trialMet(gather, { ...run, lumen: gather.goal.n - 1 })).toBe(false);
    expect(trialMet(hazards, { ...run, hazards: hazards.goal.n })).toBe(true);
    expect(trialMet(hazards, { ...run, kills: 999 })).toBe(false);
    expect(trialMet(boss, { ...run, boss: 1 })).toBe(true);
    expect(CROWN.trials!.at(-1)).toBe(boss); // the Hollow Heart is the last trial
  });

  it('forks seal the other side, and unweaving reopens it', () => {
    const p = rich();
    p.trials = CROWN.trials!.map((t) => t.id);
    p.levels = { crown: 1, ember_1: 1, ember_2a: 1, ember_2b: 1, ember_3b: 1, ember_3a: 1 };
    expect(buy(CROWN, C.ember_4a, p).ok).toBe(true);
    expect(nodeState(CROWN, C.ember_4b, p)).toBe('sealed');
    expect(checkBuy(CROWN, C.ember_4b, p)).toEqual({ ok: false, reason: 'sealed' });
    expect(unweave(CROWN, C.ember_4a, p).ok).toBe(true);
    expect(nodeState(CROWN, C.ember_4b, p)).toBe('available');
  });

  it('unweaving gives back three quarters, and only from the outside in', () => {
    const p = rich();
    p.trials.push('gate_2');
    buy(CROWN, C.ember_1, p);
    buy(CROWN, C.ember_1, p);
    buy(CROWN, C.ember_2a, p);
    const block = unweaveBlock(CROWN, C.ember_1, p);
    expect(block).toBe(C.ember_2a); // Firebrand grows from it
    const before = p.lumen;
    const r = unweave(CROWN, C.ember_2a, p);
    expect(r.ok).toBe(true);
    expect(p.lumen - before).toBe(Math.floor(costAt(C.ember_2a, 0).lumen! * 0.75));
    const r1 = unweave(CROWN, C.ember_1, p);
    expect(r1.ok).toBe(true);
    expect(p.levels.ember_1).toBeUndefined();
    expect(lightUsed(CROWN, p.levels)).toBe(0);
    expect(unweave(CROWN, C.crown, p).ok).toBe(false);
    expect(unweave(BLOOM, NODE_MAP.force_1, newGame()).ok).toBe(false); // the Bloom has no unweaving
  });

  it('curses burn no light, keystones three', () => {
    expect(CROWN.nodes.filter((n) => n.kind === 'curse').every((n) => lightCost(n) === 0 && !!n.drawback)).toBe(true);
    expect(lightCost(C.ember_5)).toBe(3);
  });

  it('the finale needs two keystones and the Hollow Heart broken', () => {
    const p = rich();
    p.trials = CROWN.trials!.filter((t) => t.goal.kind !== 'boss').map((t) => t.id);
    p.levels = { crown: 1, ember_5: 1, storm_5: 1 };
    expect(checkBuy(CROWN, C.uncrown, p)).toEqual({ ok: false, reason: 'gated' });
    p.trials.push('heart');
    expect(checkBuy(CROWN, C.uncrown, p)).toBeNull();
    p.levels = { crown: 1, ember_5: 1 };
    expect(checkBuy(CROWN, C.uncrown, p)).toEqual({ ok: false, reason: 'locked' });
  });

  it('its base stats are its own', () => {
    expect(statsFor(CROWN, { crown: 1 }).radius).toBe(52);
    expect(statsFor(BLOOM, { seed: 1 }).radius).toBe(BASE_STATS.radius);
  });
});

describe('save', () => {
  it('reads a save from before there were two trees', () => {
    const old = { version: 1, lumen: 50, prism: 2, levels: { seed: 1, force_1: 2 }, awakened: false,
      lifetime: { runs: 7, bestRun: 90, shardsBroken: 100, lumenEarned: 500, prismEarned: 2, playTime: 300, bestCombo: 4 }, settings: {} };
    const s = parseSave(JSON.stringify(old));
    expect(s.lumen).toBe(50);
    expect(s.runs).toBe(7);
    expect(s.bestRun).toBe(90);
    expect(s.active).toBe('bloom');
    expect(s.crown.levels).toEqual({ crown: 1 });
    expect(s.tips).toEqual([LEGACY_TIPS]);
    expect(parseSave(JSON.stringify({ ...old, lifetime: { runs: 0 } })).tips).toEqual([]);
  });

  it('round-trips the Hollow Crown', () => {
    const s = newGame();
    s.active = 'crown';
    s.crown.lumen = 9;
    s.crown.trials = ['gate_2'];
    s.crown.trialBest = { gate_3: 4 };
    s.crown.levels.ember_1 = 2;
    s.tips = ['crown-welcome', 'hz:warded'];
    const back = parseSave(JSON.stringify(s));
    expect(back.version).toBe(1); // the cloud save service only takes version 1
    expect(back.active).toBe('crown');
    expect(back.crown).toEqual(s.crown);
    expect(back.tips).toEqual(s.tips);
  });

  it('round-trips and tolerates garbage', () => {
    const s = newGame();
    s.lumen = 42; s.levels.force_1 = 3;
    const back = parseSave(JSON.stringify(s));
    expect(back.lumen).toBe(42);
    expect(back.levels.force_1).toBe(3);
    expect(parseSave('not json').lumen).toBe(0);
    expect(parseSave('{"lumen":"x","levels":{"force_1":2.7}}').levels.force_1).toBe(2);
  });
});

describe('settings', () => {
  it('migrates v0.1 settings (boolean shake, single quality switch)', () => {
    const s = normalizeSettings({ volume: 0.4, shake: false, reducedMotion: false, quality: 'low' });
    expect(s.volume).toBe(0.4);
    expect(s.shake).toBe(0);
    expect(s.bloom).toBe('off');
    expect(s.cameraFx).toBe(true); // new options get defaults
    expect(normalizeSettings({ shake: true }).shake).toBe(1);
  });

  it('rejects and clamps bad values', () => {
    const s = normalizeSettings({ volume: 7, uiScale: 0.1, bloom: 'neon', fpsCap: 47, flashes: 'lots', resolution: -1 });
    const d = defaultSettings();
    expect(s.volume).toBe(1);
    expect(s.uiScale).toBe(0.85);
    expect(s.bloom).toBe(d.bloom);
    expect(s.fpsCap).toBe(d.fpsCap);
    expect(s.flashes).toBe(d.flashes);
    expect(s.resolution).toBe(0.5);
    expect(normalizeSettings(null)).toEqual(d);
  });

  it('reduced motion overrides the individual motion options', () => {
    const s = { ...defaultSettings(), reducedMotion: true, shake: 1, flashes: 1 };
    const m = effectiveMotion(s);
    expect(m).toMatchObject({ shake: 0, cameraFx: false, ripples: false, slowmo: false, ambient: false });
    expect(m.flashes).toBeLessThanOrEqual(0.3);
    expect(effectiveMotion({ ...s, reducedMotion: false }).cameraFx).toBe(true);
  });

  it('survives a full save round-trip', () => {
    const g = newGame();
    g.settings.particles = 'low';
    g.settings.shake = 0.35;
    const back = parseSave(JSON.stringify(g));
    expect(back.settings.particles).toBe('low');
    expect(back.settings.shake).toBe(0.35);
  });
});
