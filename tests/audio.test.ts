// Break sounds under load: a burst collapses to its biggest sound, and all kinds share one budget.
// The Web Audio graph is stubbed out; what is checked is which sounds would start, and when.
import { beforeEach, describe, expect, it } from 'vitest';
import { audio } from '../src/systems/audio';

const a = audio as any;
const clock = { currentTime: 0 };
let played: string[] = [];
let starts: number[] = [];
const frame = () => new Promise((r) => setTimeout(r));

a.ctx = clock;
a.play = (name: string) => played.push(name);
a.note = () => played.push('note');
const slot = a.breakSlot.bind(a);
a.breakSlot = (must?: boolean) => {
  const ok = slot(must);
  if (ok) starts.push(clock.currentTime);
  return ok;
};

beforeEach(() => {
  clock.currentTime += 10; // past every gate and window from the previous test
  played = [];
  starts = [];
});

describe('break sounds', () => {
  it('turn twenty shards breaking in one frame into one sound, the biggest', async () => {
    for (let i = 0; i < 20; i++) audio.shatter(i === 13 ? 3 : i % 2);
    await frame();
    expect(played.filter((n) => n.startsWith('pop_'))).toHaveLength(1);
    expect(played).toContain('drum_soft'); // tier 3 won, though it came 14th
  });

  it('never start more than four in any 0.3 s, whatever mix of kinds', async () => {
    const t0 = clock.currentTime;
    for (let f = 0; f < 60; f++) {
      clock.currentTime = t0 + f * 0.05;
      audio.shatter(f % 3);
      audio.special(f % 2 ? 'gold' : 'time');
      await frame();
    }
    expect(starts.length).toBeGreaterThan(10); // still lively, not silenced
    for (const t of starts) expect(starts.filter((u) => u >= t && u < t + 0.3).length).toBeLessThanOrEqual(4);
  });

  it('always let the heart crystal through, even with the budget spent', async () => {
    for (let i = 0; i < 4; i++) {
      clock.currentTime += 0.01;
      audio.special('gold');
      audio.shatter(0);
      await frame();
    }
    played = [];
    audio.special('heart');
    await frame();
    expect(played).toContain('gong_soft');
  });
});
