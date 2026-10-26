import { describe, expect, it } from 'vitest';
import { choose, derangements, hypergeomPmf, multinomial, permutations, stirling2, combinations } from './combinatorics';
import { parseAnswer, Q, q } from './rational';
import { normalCdf, normalQuantile, lnGamma } from './special';
import { wilson, Welford } from './stats';
import { Rng } from '../random/prng';
import { uniformGoodnessOfFit } from '../fairness/chisq';

describe('rationals', () => {
  it('normalises and does exact arithmetic', () => {
    expect(q(2, 4).toString()).toBe('1/2');
    expect(q(1, 3).add(q(1, 6)).toString()).toBe('1/2');
    expect(q(-3, -9).toString()).toBe('1/3');
    expect(q(5, 7).div(q(10, 21)).toString()).toBe('3/2');
    expect(q(2, 3).pow(3).toString()).toBe('8/27');
    expect(Q.fromDecimal(0.125).toString()).toBe('1/8');
    expect(q(1, 3).cmp(q(1, 2))).toBe(-1);
  });
  it('parses user answers in many formats', () => {
    expect(parseAnswer('3/8')).toBeCloseTo(0.375);
    expect(parseAnswer(' 0.375 ')).toBeCloseTo(0.375);
    expect(parseAnswer('37.5%')).toBeCloseTo(0.375);
    expect(parseAnswer('1 1/2')).toBeCloseTo(1.5);
    expect(parseAnswer('-2')).toBe(-2);
    expect(parseAnswer('1,250')).toBe(1250);
    expect(parseAnswer('.5')).toBe(0.5);
    expect(parseAnswer('abc')).toBeNull();
    expect(parseAnswer('1/0')).toBeNull();
  });
});

describe('combinatorics', () => {
  it('known values', () => {
    expect(choose(52, 5)).toBe(2598960n);
    expect(choose(5, 7)).toBe(0n);
    expect(derangements(5)).toBe(44n);
    expect(stirling2(5, 2)).toBe(15n);
    expect(multinomial([2, 2, 1])).toBe(30n); // arrangements of "AABBC"
    expect([...permutations([1, 2, 3, 4])].length).toBe(24);
    expect(new Set([...permutations([1, 2, 3, 4])].map((p) => p.join())).size).toBe(24);
    expect([...combinations(6, 3)].length).toBe(20);
  });
  it('hypergeometric pmf sums to 1', () => {
    let s = Q.ZERO;
    for (let k = 0; k <= 4; k++) s = s.add(hypergeomPmf(52, 4, 5, k));
    expect(s.eq(1)).toBe(true);
    expect(hypergeomPmf(52, 13, 5, 5).toString()).toBe('33/66640');
  });
});

describe('special functions and intervals', () => {
  it('normal cdf/quantile', () => {
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 5);
    expect(Math.exp(lnGamma(6))).toBeCloseTo(120, 8);
  });
  it('Wilson interval contains the point estimate and narrows with n', () => {
    const [a, b] = wilson(30, 100);
    expect(a).toBeLessThan(0.3);
    expect(b).toBeGreaterThan(0.3);
    const [c, d] = wilson(3000, 10000);
    expect(d - c).toBeLessThan(b - a);
  });
  it('Welford matches naive mean/sd', () => {
    const w = new Welford();
    [2, 4, 4, 4, 5, 5, 7, 9].forEach((x) => w.push(x));
    expect(w.mean).toBe(5);
    expect(w.sd).toBeCloseTo(2.13809, 4);
  });
});

describe('seeded PRNG', () => {
  it('is deterministic per seed and uniform', () => {
    expect(new Rng(42).nextUint32()).toBe(new Rng(42).nextUint32());
    expect(new Rng('a').nextUint32()).not.toBe(new Rng('b').nextUint32());
    const r = new Rng(1);
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) counts[r.int(10)]++;
    expect(uniformGoodnessOfFit(counts).pValue).toBeGreaterThan(1e-6);
    const xs = Array.from({ length: 20000 }, () => r.normal());
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(m)).toBeLessThan(0.05);
  });
});
