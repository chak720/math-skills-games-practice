import { describe, expect, it } from 'vitest';
import { Rng } from '@/shared/random/prng';
import { bankrollFor, drawdownProb, edge, growth, kellyFraction, riskOfRuin, simulate } from './kelly';
import { makeOffer, roundFor, settle, skillScore, START } from './game';

describe('kelly', () => {
  it('fraction maximises growth', () => {
    for (const [p, b] of [[0.6, 1], [0.55, 1], [1 / 6, 7], [0.4, 2]]) {
      const k = kellyFraction(p, b);
      const g = growth(k, p, b);
      for (const d of [-0.02, -0.005, 0.005, 0.02]) if (k + d > 0 && k + d < 1) expect(growth(k + d, p, b)).toBeLessThanOrEqual(g + 1e-12);
    }
    expect(kellyFraction(0.6, 1)).toBeCloseTo(0.2);
    expect(kellyFraction(1 / 6, 4)).toBe(0); // negative edge
  });

  it('twice Kelly has (about) zero growth and half Kelly about three quarters', () => {
    const p = 0.51, b = 1, k = kellyFraction(p, b);
    expect(growth(2 * k, p, b) / growth(k, p, b)).toBeLessThan(0.02);
    expect(growth(k / 2, p, b) / growth(k, p, b)).toBeCloseTo(0.75, 1);
  });

  it('risk of ruin and bankroll requirements invert each other', () => {
    const B = bankrollFor(5, 80, 0.05);
    expect(riskOfRuin(5, 80, B)).toBeCloseTo(0.05, 6);
    expect(riskOfRuin(-1, 80, 1000)).toBe(1);
    expect(drawdownProb(0.5, 1)).toBeCloseTo(0.5);
    expect(drawdownProb(0.5, 0.5)).toBeCloseTo(0.125);
  });

  it('simulation growth matches theory', () => {
    const p = 0.55, b = 1, k = kellyFraction(p, b);
    const s = simulate(p, b, k, 1000, 2000, new Rng(4));
    expect(s.meanGrowth).toBeCloseTo(growth(k, p, b), 3);
    // Probability of ever halving at full Kelly ≈ 1/2 in the continuous limit; discrete steps shift it a little.
    expect(s.pHalved).toBeGreaterThan(0.3);
    expect(s.pHalved).toBeLessThan(0.6);
  });
});

describe('kelly game', () => {
  it('offers have exact probabilities and a mix of positive and negative edges', () => {
    const r = new Rng(1);
    const offers = Array.from({ length: 400 }, () => makeOffer(r));
    expect(offers.every((o) => o.p > 0 && o.p < 1 && o.b > 0)).toBe(true);
    expect(offers.filter((o) => edge(o.p, o.b) > 0.005).length).toBeGreaterThan(150);
    expect(offers.filter((o) => edge(o.p, o.b) < -0.005).length).toBeGreaterThan(40);
  });

  it('settles bankrolls and scores Kelly at 100', () => {
    const r = new Rng(2);
    let rolls = { you: START, kelly: START, half: START, flat: START };
    const rounds = [];
    for (let i = 0; i < 20; i++) {
      const o = makeOffer(r);
      const won = r.next() < o.p;
      const k = kellyFraction(o.p, o.b);
      rolls = settle(rolls, o, k, won);
      rounds.push(roundFor(o, k, won));
    }
    expect(rolls.you).toBeCloseTo(rolls.kelly, 6);
    expect(skillScore(rounds)).toBe(100);
  });
});
