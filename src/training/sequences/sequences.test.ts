import { describe, expect, it } from 'vitest';
import { Rng } from '@/shared/random/prng';
import { ambiguity, FAMILY_IDS, fits, makeSequence, nextSequence, type Tier } from './sequences';

describe('sequences', () => {
  it('every family produces unambiguous sequences whose rule reproduces the answer', () => {
    const r = new Rng(11);
    for (const f of FAMILY_IDS) {
      let made = 0;
      for (let i = 0; i < 60; i++) {
        const s = makeSequence(f, r, 3);
        if (!s) continue;
        made++;
        expect(ambiguity(s.shown, s.answer), `${f} ${s.shown}`).toBeNull();
        expect(Number.isSafeInteger(s.answer)).toBe(true);
        expect(s.working).toContain(String(s.answer));
      }
      expect(made, f).toBeGreaterThan(40);
    }
  });

  it('detects conflicting readings', () => {
    // 1, 2, 4, 8, 16, 32: geometric says 64.
    expect(ambiguity([1, 2, 4, 8, 16, 32], 63)).toMatch(/64/);
    // Fibonacci also fits an order-2 recurrence with the same prediction: no conflict.
    expect(ambiguity([1, 1, 2, 3, 5, 8], 13)).toBeNull();
    // Squares are a degree-2 polynomial.
    expect(fits([1, 4, 9, 16, 25, 36]).some((f) => f.next === 49)).toBe(true);
    // Interleaved arithmetic.
    expect(fits([1, 10, 3, 20, 5, 30]).some((f) => f.next === 7)).toBe(true);
  });

  it('rejects rules that a simpler family explains differently', () => {
    // An "alternating +2, ×1" sequence is just arithmetic in disguise; the generic arithmetic fit agrees, so fine;
    // but 2, 4, 8, 16, 32, 64 claimed as "differences double" predicts 128, same as geometric.
    expect(ambiguity([2, 4, 8, 16, 32, 64], 128)).toBeNull();
  });

  it('does not repeat and rotates families', () => {
    const r = new Rng(5);
    const seen = new Set<string>();
    let last: string | undefined;
    let same = 0;
    for (let i = 0; i < 300; i++) {
      const tier = ((i % 3) + 1) as Tier;
      const s = nextSequence(r, tier, (k) => seen.has(k), undefined, last as never);
      expect(seen.has(s.key)).toBe(false);
      seen.add(s.key);
      if (s.family === last) same++;
      last = s.family;
    }
    expect(same).toBeLessThan(40);
  });
});
