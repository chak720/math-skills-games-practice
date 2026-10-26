import { describe, expect, it } from 'vitest';
import { Rng } from '@/shared/random/prng';
import { BANK, breakdownValue, nextQuestion } from './bank';
import { calibration, fmtQuantity, parseQuantity, score } from './scoring';

describe('fermi', () => {
  it('parses quantities in the forms people type', () => {
    expect(parseQuantity('3.5e6')).toBe(3.5e6);
    expect(parseQuantity('3.5 million')).toBe(3.5e6);
    expect(parseQuantity('3.5m')).toBe(3.5e6);
    expect(parseQuantity('2k')).toBe(2000);
    expect(parseQuantity('1.2bn')).toBeCloseTo(1.2e9);
    expect(parseQuantity('40,000')).toBe(40000);
    expect(parseQuantity('3×10^6')).toBe(3e6);
    expect(parseQuantity('10^9')).toBe(1e9);
    expect(parseQuantity('-5')).toBeNull();
    expect(parseQuantity('lots')).toBeNull();
  });

  it('formats quantities readably', () => {
    expect(fmtQuantity(3.6e6)).toBe('3.6 million');
    expect(fmtQuantity(41800)).toBe('41,800');
    expect(fmtQuantity(5.1e18)).toBe('5.1 × 10¹⁸');
  });

  it('scores in log space with a proper interval score', () => {
    const exact = score(100, 50, 200, 100);
    expect(exact.points).toBe(100);
    expect(exact.hit).toBe(true);
    const off10 = score(1000, 500, 2000, 100);
    expect(off10.within10).toBe(true);
    expect(off10.within2).toBe(false);
    expect(off10.hit).toBe(false);
    // A miss costs (2/α)·distance outside: here log10(500/100) ≈ 0.699 → 13.98 plus width 0.602.
    expect(off10.intervalScore).toBeCloseTo(0.602 + 20 * 0.699, 2);
    expect(calibration(Array.from({ length: 20 }, (_, i) => ({ hit: i < 10, widthOom: 1 }))).verdict).toMatch(/Overconfident/);
  });

  it('bank breakdowns land within a factor of 3 of the reference value', () => {
    for (const q of BANK) {
      const v = breakdownValue(q.breakdown);
      expect(Math.abs(Math.log10(v / q.truth)), q.id).toBeLessThan(Math.log10(3));
    }
    expect(new Set(BANK.map((q) => q.id)).size).toBe(BANK.length);
  });

  it('parameterised variants are exact and do not repeat while unseen ones remain', () => {
    const r = new Rng(9);
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const q = nextQuestion(r, seen, i % 2 === 0);
      expect(seen.has(q.id)).toBe(false);
      seen.add(q.id);
      expect(Math.abs(Math.log10(breakdownValue(q.breakdown) / q.truth))).toBeLessThan(q.topic === 'computed' ? 0.01 : Math.log10(3));
    }
  });
});
