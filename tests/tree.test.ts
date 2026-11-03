import { describe, expect, it } from 'vitest';
import { NODES, NODE_MAP, RING_RADII, nodeRadius } from '../src/data/tree';
import { BASE_STATS, STAT_META } from '../src/data/stats';
import { polar } from '../src/core/math';
import { defaultSettings, effectiveMotion, newGame, normalizeSettings, parseSave } from '../src/core/state';
import { buy, costAt, nodeState, statsFor, checkBuy } from '../src/systems/tree-logic';

describe('tree data integrity', () => {
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
    for (const k of Object.keys(BASE_STATS)) expect(STAT_META[k as keyof typeof STAT_META]).toBeDefined();
  });

  it('every node is reachable from the seed', () => {
    const levels: Record<string, number> = {};
    for (const n of NODES) levels[n.id] = n.maxLevel; // own everything
    const reach = new Set(['seed']);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of NODES) {
        if (reach.has(n.id)) continue;
        const ok = n.req === 'all' ? n.parents.every((p) => reach.has(p)) : n.parents.some((p) => reach.has(p));
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
});

describe('tree logic', () => {
  it('starts with ring 1 available, ring 2 as silhouettes', () => {
    const s = newGame();
    expect(nodeState(NODE_MAP.seed, s.levels)).toBe('owned');
    expect(nodeState(NODE_MAP.force_1, s.levels)).toBe('available');
    expect(nodeState(NODE_MAP.force_2a, s.levels)).toBe('silhouette');
    expect(nodeState(NODE_MAP.force_3b, s.levels)).toBe('hidden');
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
    const r = buy(NODE_MAP.force_1, s);
    expect(r.ok).toBe(true);
    expect(s.lumen).toBe(95);
    expect(s.levels.force_1).toBe(1);
    if (r.ok) expect(r.revealed).toEqual(expect.arrayContaining(['force_2a', 'force_2b']));
    expect(nodeState(NODE_MAP.force_2a, s.levels)).toBe('available');
  });

  it('refuses when poor, locked, or maxed', () => {
    const s = newGame();
    expect(checkBuy(NODE_MAP.force_1, s)).toEqual({ ok: false, reason: 'poor' });
    s.lumen = 1e9;
    expect(checkBuy(NODE_MAP.force_2a, s)).toEqual({ ok: false, reason: 'locked' });
    for (let i = 0; i < 5; i++) buy(NODE_MAP.force_1, s);
    expect(checkBuy(NODE_MAP.force_1, s)).toEqual({ ok: false, reason: 'maxed' });
    expect(nodeState(NODE_MAP.force_1, s.levels)).toBe('maxed');
  });

  it('synergy nodes need every parent', () => {
    const s = newGame();
    s.levels = { seed: 1, force_3a: 1 };
    expect(nodeState(NODE_MAP.syn_fr, s.levels)).toBe('locked');
    s.levels.reach_3a = 1;
    expect(nodeState(NODE_MAP.syn_fr, s.levels)).toBe('available');
  });

  it('awaken needs all four keystones and both currencies', () => {
    const s = newGame();
    s.lumen = 1e9; s.prism = 1e9;
    s.levels = { seed: 1, force_5: 1, reach_5: 1, flow_5: 1 };
    expect(checkBuy(NODE_MAP.awaken, s)).toEqual({ ok: false, reason: 'locked' });
    s.levels.fortune_5 = 1;
    expect(checkBuy(NODE_MAP.awaken, s)).toBeNull();
  });

  it('stats fold additive then multiplicative', () => {
    const st = statsFor({ seed: 1, force_1: 2, force_3b: 2 });
    expect(st.damage).toBe(3);
    expect(st.damageMult).toBeCloseTo(1.5625);
    const st2 = statsFor({ seed: 1, fortune_1: 4, fortune_5: 1 });
    expect(st2.lumenMult).toBeCloseTo(2);
    expect(st2.lumenMultX).toBeCloseTo(2.5);
  });
});

describe('save', () => {
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
