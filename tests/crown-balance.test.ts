/**
 * Pacing for the Hollow Crown (the model is in crown-sim.ts). Every pair of branches is played
 * through with both sides of their forks, so no build may be a dead end.
 */
import { describe, expect, it } from 'vitest';
import { CROWN } from '../src/data/trees';
import type { Branch } from '../src/data/tree';
import { statsFor } from '../src/systems/tree-logic';
import { playthrough, reseed, simulateCrownRun } from './crown-sim';

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
    for (const r of totals) expect(r).toBeLessThan(600); // nobody is stuck
    // the second tree is the long one: the Bloom takes about 60 harvests
    const median = sorted[sorted.length >> 1];
    expect(median).toBeGreaterThan(150);
    expect(median).toBeLessThan(350);
  });

  it('the first harvest affords a star', () => {
    reseed(5);
    const r = simulateCrownRun(statsFor(CROWN, { crown: 1 }), 0, false);
    const cheapest = Math.min(...CROWN.nodes.filter((n) => n.ring === 1).map((n) => n.costs[0].base));
    expect(r.lumen).toBeGreaterThanOrEqual(cheapest);
  });
});
