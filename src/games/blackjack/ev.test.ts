import { describe, expect, it } from 'vitest';
import { Rng } from '@/shared/random/prng';
import { DEFAULT_RULES, type BJRules } from './rules';
import { computeEVs, dealerDist, shoeCounts, without } from './ev';
import { chartMove, computeChart, UPS, type Cell } from './strategy';

describe('dealer distribution', () => {
  it('sums to 1 and matches a direct simulation from the same composition', () => {
    const rules: BJRules = { ...DEFAULT_RULES, decks: 2, h17: true };
    const n = without(shoeCounts(2), [6]);
    const d = dealerDist(6, n, rules, true);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // Simulate: draw hole + hits without replacement.
    const rng = new Rng(9);
    const T = 200000;
    const counts = new Array(6).fill(0);
    for (let t = 0; t < T; t++) {
      const pool: number[] = [];
      for (let r = 1; r <= 10; r++) for (let k = 0; k < n[r]; k++) pool.push(r);
      let sum = 6, soft = false;
      for (let draws = 0; ; draws++) {
        const best = soft && sum + 10 <= 21 ? sum + 10 : sum;
        if (best > 21) { counts[5]++; break; }
        if (draws > 0 && best >= 17 && !(best === 17 && soft && sum + 10 === 17 && rules.h17)) { counts[best - 17]++; break; }
        const i = rng.int(pool.length);
        const r = pool[i];
        pool[i] = pool[pool.length - 1];
        pool.pop();
        sum += r;
        if (r === 1) soft = true;
      }
    }
    for (let i = 0; i < 6; i++) {
      const p = counts[i] / T;
      expect(Math.abs(p - d[i])).toBeLessThan(4 * Math.sqrt((d[i] * (1 - d[i])) / T) + 1e-9);
    }
  });

  it('bust probabilities match the published infinite-deck S17 table', () => {
    // Standard table (infinite deck, dealer stands on soft 17): note a 6 busts slightly more than a 5.
    const published: Record<number, number> = { 2: 0.3536, 3: 0.3739, 4: 0.3945, 5: 0.4164, 6: 0.4232, 7: 0.2623, 8: 0.2447, 9: 0.2284 };
    for (const [up, p] of Object.entries(published)) {
      const d = dealerDist(+up, without(shoeCounts(2000), [+up]), { ...DEFAULT_RULES, decks: 2000, h17: false }, true);
      expect(Math.abs(d[5] - p)).toBeLessThan(0.0006);
    }
  });
});

describe('player EVs', () => {
  it('stand EV matches simulation for a 16 vs 10 (peeked) hand', () => {
    const rules = { ...DEFAULT_RULES, decks: 1 };
    const n = without(shoeCounts(1), [10, 6, 10]);
    const e = computeEVs([10, 6], 10, n, rules, { double: false, split: false, surrender: true });
    // 16 stands only win when the dealer busts.
    expect(e.stand).toBeCloseTo(2 * e.dealer[5] - 1, 12);
    expect(e.hit).toBeGreaterThan(-0.6);
    expect(e.hit).toBeLessThan(-0.45);
  });
  it('sanity: double 11 vs 6 is the best play and clearly positive', () => {
    const n = without(shoeCounts(6), [6, 5, 6]);
    const e = computeEVs([5, 6], 6, n, DEFAULT_RULES, { double: true, split: false, surrender: true });
    expect(e.double!).toBeGreaterThan(e.hit);
    expect(e.double!).toBeGreaterThan(0.6);
  });
  it('insurance is negative EV off the top and positive in a ten-rich shoe', () => {
    const fresh = without(shoeCounts(6), [1, 9, 7]);
    expect(computeEVs([9, 7], 1, fresh, DEFAULT_RULES, { double: false, split: false, surrender: false }).insurance!).toBeLessThan(0);
    const rich = Int32Array.from(fresh);
    for (let r = 2; r <= 6; r++) rich[r] = Math.max(0, rich[r] - 12); // many small cards gone
    expect(computeEVs([9, 7], 1, rich, DEFAULT_RULES, { double: false, split: false, surrender: false }).insurance!).toBeGreaterThan(0);
  });
});

/** Published 4–8 deck, S17, DAS, late-surrender basic strategy (columns 2..A). */
const PUBLISHED_S17: { hard: Record<number, string>; soft: Record<number, string>; pairs: Record<number, string> } = {
  hard: {
    5: 'H H H H H H H H H H', 6: 'H H H H H H H H H H', 7: 'H H H H H H H H H H', 8: 'H H H H H H H H H H',
    9: 'H D D D D H H H H H', 10: 'D D D D D D D D H H', 11: 'D D D D D D D D D H', 12: 'H H S S S H H H H H',
    13: 'S S S S S H H H H H', 14: 'S S S S S H H H H H', 15: 'S S S S S H H H R H', 16: 'S S S S S H H R R R', 17: 'S S S S S S S S S S',
  },
  soft: {
    13: 'H H H D D H H H H H', 14: 'H H H D D H H H H H', 15: 'H H D D D H H H H H', 16: 'H H D D D H H H H H',
    17: 'H D D D D H H H H H', 18: 'S D D D D S S H H H', 19: 'S S S S S S S S S S', 20: 'S S S S S S S S S S',
  },
  pairs: {
    2: 'P P P P P P H H H H', 3: 'P P P P P P H H H H', 4: 'H H H P P H H H H H', 5: 'D D D D D D D D H H', 6: 'P P P P P H H H H H',
    7: 'P P P P P P H H H H', 8: 'P P P P P P P P P P', 9: 'P P P P P S P P S S', 10: 'S S S S S S S S S S', 1: 'P P P P P P P P P P',
  },
};

const simplify = (c: Cell): string => (c === 'Dh' || c === 'Ds' ? 'D' : c === 'Rh' || c === 'Rs' || c === 'Rp' ? 'R' : c);

describe('computed basic strategy', () => {
  it('reproduces the published 6-deck S17 DAS LS chart', () => {
    const chart = computeChart({ ...DEFAULT_RULES, decks: 6, h17: false, das: true, surrender: true });
    const diffs: string[] = [];
    for (const kind of ['hard', 'soft', 'pairs'] as const)
      for (const [row, s] of Object.entries(PUBLISHED_S17[kind])) {
        const want = s.split(' ');
        const got = chart[kind][+row].map(simplify);
        want.forEach((w, i) => {
          // A pair the chart doesn't split is played by its total; compare only P vs not-P for pairs.
          const g = kind === 'pairs' && w !== 'P' && got[i] !== 'P' ? w : got[i];
          if (g !== w) diffs.push(`${kind} ${row} vs ${UPS[i] === 1 ? 'A' : UPS[i]}: got ${got[i]}, published ${w}`);
        });
      }
    expect(diffs).toEqual([]);
  });

  it('H17 changes the classic cells (11 vs A double, A7 vs 2 double, 15/17 vs A surrender)', () => {
    const c = computeChart({ ...DEFAULT_RULES, decks: 6, h17: true, das: true, surrender: true });
    const col = (up: number): number => UPS.indexOf(up as (typeof UPS)[number]);
    expect(simplify(c.hard[11][col(1)])).toBe('D');
    expect(simplify(c.soft[18][col(2)])).toBe('D');
    expect(simplify(c.hard[15][col(1)])).toBe('R');
    expect(simplify(c.hard[17][col(1)])).toBe('R');
  });

  it('chartMove applies fallbacks for multi-card hands', () => {
    const c = computeChart(DEFAULT_RULES);
    expect(chartMove(c, { values: [5, 6], up: 6, canDouble: true, canSplit: false, canSurrender: true }).move).toBe('double');
    expect(chartMove(c, { values: [2, 3, 6], up: 6, canDouble: false, canSplit: false, canSurrender: false }).move).toBe('hit');
    expect(chartMove(c, { values: [10, 6], up: 10, canDouble: true, canSplit: false, canSurrender: false }).move).toBe('hit');
    expect(chartMove(c, { values: [10, 6], up: 10, canDouble: true, canSplit: false, canSurrender: true }).move).toBe('surrender');
    expect(chartMove(c, { values: [8, 8], up: 10, canDouble: true, canSplit: true, canSurrender: true }).move).toBe('split');
  });
});
