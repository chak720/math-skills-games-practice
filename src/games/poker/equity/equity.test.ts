import { describe, expect, it } from 'vitest';
import { parseCards } from '@/shared/cards/card';
import { Rng } from '@/shared/random/prng';
import { comboIndex, NUM_COMBOS, parseRange, toComboWeights } from '../ranges/combos';
import { equityExact, equityMC } from './equity';

const single = (s: string): Float64Array => {
  const [a, b] = parseCards(s);
  const w = new Float64Array(NUM_COMBOS);
  w[comboIndex(a, b)] = 1;
  return w;
};

describe('equity', () => {
  it('exact turn and flop equities match hand calculations', () => {
    // Nut flush draw + two overcards vs top pair on the turn: 9 hearts + 3 aces + 3 kings = 15 outs of 44.
    const r = equityExact(parseCards('Ah Kh'), parseCards('Qh 7h 2c 3d'), single('Qs Jd'));
    expect(r.equity).toBeCloseTo(15 / 44, 9);
    // AA vs KK on a dry flop: KK needs runner-runner or a K: 1 − P(no K and no straight/flush help)
    const f = equityExact(parseCards('As Ad'), parseCards('2c 7d 9h'), single('Kc Kh'));
    expect(f.equity).toBeGreaterThan(0.9);
    expect(f.equity).toBeLessThan(0.93);
  });

  it('Monte Carlo agrees with exact enumeration within its confidence interval', () => {
    const hero = parseCards('Jh Th');
    const board = parseCards('9h 8c 2h');
    const villain = toComboWeights(parseRange('99+, AJs+, AQo+'), [...hero, ...board]);
    const ex = equityExact(hero, board, villain);
    const mc = equityMC(hero, board, [villain], 40000, new Rng(3));
    expect(Math.abs(mc.equity - ex.equity)).toBeLessThan(4 * mc.se + 1e-9);
    expect(mc.ci[0]).toBeLessThan(ex.equity + 3 * mc.se);
  });

  it('preflop AcAd vs KsKh: Monte Carlo matches full enumeration of 1,712,304 boards', () => {
    const ex = equityExact(parseCards('Ac Ad'), [], single('Ks Kh'));
    expect(ex.equity).toBeGreaterThan(0.81);
    expect(ex.equity).toBeLessThan(0.83);
    const mc = equityMC(parseCards('Ac Ad'), [], [single('Ks Kh')], 60000, new Rng(4));
    expect(Math.abs(mc.equity - ex.equity)).toBeLessThan(4 * mc.se);
  });

  it('multiway: AA vs two random hands is about 73.5%', () => {
    const any = toComboWeights(parseRange('any'));
    const mc = equityMC(parseCards('Ac Ad'), [], [any, any], 60000, new Rng(5));
    expect(Math.abs(mc.equity - 0.735)).toBeLessThan(0.012);
  });
});
