/**
 * Pacing for the Hollow Crown (the model is in crown-sim.ts). Every pair of branches is played
 * through with both sides of their forks, so no build may be a dead end.
 */
import { describe, expect, it } from 'vitest';
import { CROWN } from '../src/data/trees';
import type { Branch } from '../src/data/tree';
import { keystonesOwned, statsFor } from '../src/systems/tree-logic';
import { playthrough, reseed, simulateCrownRun, widePlaythrough } from './crown-sim';

const BRANCHES = CROWN.branches;
const PAIRS: [Branch, Branch][] = [];
for (let i = 0; i < BRANCHES.length; i++) for (let j = i + 1; j < BRANCHES.length; j++) PAIRS.push([BRANCHES[i], BRANCHES[j]]);

describe('the Hollow Crown: balance', () => {
  it('every pair of branches can break the crown, in hours rather than minutes', () => {
    const rows: string[] = [];
    const totals: number[] = [];
    for (const [a, b] of PAIRS) {
      for (const fork of ['a', 'b'] as const) {
        const { runs, time, milestones: m, unwoven } = playthrough([a, b], fork);
        totals.push(runs);
        const g = (k: string) => String(m[k] ?? '—').padStart(4);
        rows.push(`${(a + '+' + b + ' ' + fork).padEnd(16)} ${String(runs).padStart(4)} runs ${(time / 3600).toFixed(1).padStart(4)} h | gates ${g('gate_2')}${g('gate_3')}${g('gate_4')}${g('gate_5')} | heart ${g('heart')} | keys ${g(`${a}_5`)}${g(`${b}_5`)} | unwove ${unwoven}`);
      }
    }
    console.log(rows.join('\n'));
    const sorted = [...totals].sort((x, y) => x - y);
    console.log(`median ${sorted[sorted.length >> 1]} runs, fastest ${sorted[0]}, slowest ${sorted[sorted.length - 1]}`);
    for (const r of totals) expect(r).toBeLessThan(800); // nobody is stuck
    // the second tree is the long, hard one: the Bloom takes about 60 harvests
    const median = sorted[sorted.length >> 1];
    expect(median).toBeGreaterThan(220);
    expect(median).toBeLessThan(420);
  }, 60_000);

  it('wide builds with 0 or 1 keystones can also wake the heart and uncrown', () => {
    const r0 = widePlaythrough(['ember', 'frost', 'storm', 'tide'], 0, 'a');
    const r0b = widePlaythrough(['ember', 'storm', 'gild', 'hollow'], 0, 'b');
    const r1 = widePlaythrough(['ember', 'frost', 'storm', 'gild'], 1, 'a');
    for (const [label, r] of [['0-key (ember/frost/storm/tide)', r0], ['0-key (ember/storm/gild/hollow)', r0b], ['1-key (ember/frost/storm/gild)', r1]] as const) {
      console.log(`${label.padEnd(32)} ${String(r.runs).padStart(4)} runs  ${(r.time / 3600).toFixed(1)} h | keys ${keystonesOwned(CROWN, r.p.levels)}`);
      expect(r.p.awakened).toBe(true);
      expect(r.p.trials).toContain('heart');
      expect(r.runs).toBeLessThan(800);
    }
    expect(keystonesOwned(CROWN, r0.p.levels)).toBe(0);
    expect(keystonesOwned(CROWN, r0b.p.levels)).toBe(0);
    expect(keystonesOwned(CROWN, r1.p.levels)).toBe(1);
  }, 60_000);

  it('the first harvest affords a star', () => {
    reseed(5);
    const r = simulateCrownRun(statsFor(CROWN, { crown: 1 }), 0, false);
    const cheapest = Math.min(...CROWN.nodes.filter((n) => n.ring === 1).map((n) => n.costs[0].base));
    expect(r.lumen).toBeGreaterThanOrEqual(cheapest);
  });
});
