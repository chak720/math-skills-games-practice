import { describe, expect, it } from 'vitest';
import { equityApi } from './equityApi';

describe('variance simulator', () => {
  it('final results have the right mean and spread', () => {
    const r = equityApi.variance({ winrate: 5, sd: 90, hands: 20000, paths: 2000 });
    const mean = r.finals.reduce((a, b) => a + b, 0) / r.finals.length;
    const sd = Math.sqrt(r.finals.reduce((a, b) => a + (b - mean) ** 2, 0) / r.finals.length);
    // Expected: mean 5 × 200 = 1000 bb, s.d. 90 × √200 ≈ 1273 bb.
    expect(Math.abs(mean - 1000)).toBeLessThan(4 * (1273 / Math.sqrt(2000)));
    expect(Math.abs(sd / 1273 - 1)).toBeLessThan(0.06);
    expect(r.pLosing).toBeGreaterThan(0.15);
    expect(r.pLosing).toBeLessThan(0.28); // Φ(−1000/1273) ≈ 0.216
  });
});
