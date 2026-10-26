import { describe, expect, it } from 'vitest';
import { type Card, parseCards } from '@/shared/cards/card';
import { Hand, type CardSource } from '../engine/hand';
import { analyse, judge } from './coach';

class Scripted implements CardSource {
  private i = 0;
  constructor(private readonly cs: Card[]) {}
  draw(): Card {
    return this.cs[this.i++];
  }
}
/** Heads-up hand: seat 0 = button/SB (hero), seat 1 = BB. */
function hu(hero: string, villain: string, board: string): Hand {
  const h = parseCards(hero), v = parseCards(villain), b = parseCards(board);
  const used = new Set([...h, ...v, ...b]);
  const spare = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  // Deal starts left of the button: seat 1 first.
  const order = [v[0], h[0], v[1], h[1], spare[0], b[0], b[1], b[2], spare[1], b[3], spare[2], b[4]];
  return new Hand({ handId: 1, sb: 5, bb: 10, button: 0, maxSeats: 2, seats: [{ seat: 0, playerId: 'hero', name: 'You', stack: 1000 }, { seat: 1, playerId: 'v', name: 'V', stack: 1000 }], deck: new Scripted(order) });
}

const names = { 0: 'You', 1: 'Villain' };

describe('coach', () => {
  it('counts 9 flush outs and computes exact and rule-of-thumb odds', () => {
    const h = hu('Ah Kh', '2c 2d', 'Qh 7h 3s 9c 4d');
    h.act(0, { type: 'raise', to: 25 });
    h.act(1, { type: 'call' });
    h.act(1, { type: 'bet', to: 30 }); // villain leads the flop
    const a = analyse({ view: h.viewFor(0), tendencies: {}, names, iterations: 4000 });
    const flushOuts = a.outs.filter((o) => o.description.startsWith('Flush')).length;
    expect(flushOuts).toBe(9);
    expect(a.hit!.unseen).toBe(47);
    // AK overcards are improving outs too (pair), so total outs > 9; check the formula for the count used.
    const n = a.hit!.outs;
    expect(a.hit!.next).toBeCloseTo(n / 47, 10);
    expect(a.hit!.byRiver!).toBeCloseTo(1 - ((47 - n) * (46 - n)) / (47 * 46), 10);
    expect(a.potOdds).toBeCloseTo(30 / (80 + 30), 10);
    expect(a.maths.map((m) => m.title)).toContain('Outs and hitting odds');
  });

  it('recommends folding air to a big river bet and raising the nuts', () => {
    const air = hu('4c 5d', 'Ah Kd', 'Ac Kc 9s 2h Jd');
    air.act(0, { type: 'call' });
    air.act(1, { type: 'check' });
    for (const st of [0, 1, 2]) {
      air.act(1, { type: 'check' });
      if (st < 2) air.act(0, { type: 'check' });
    }
    air.act(0, { type: 'bet', to: 20 });
    air.act(1, { type: 'raise', to: 90 });
    const a = analyse({ view: air.viewFor(0), tendencies: {}, names, iterations: 3000 });
    expect(a.recommendation.action).toBe('fold');

    const nuts = hu('Qh Th', '9c 9d', 'Ah Kh Jh 2c 3d'); // royal flush
    nuts.act(0, { type: 'call' });
    nuts.act(1, { type: 'check' });
    nuts.act(1, { type: 'bet', to: 10 });
    const b = analyse({ view: nuts.viewFor(0), tendencies: {}, names, iterations: 3000 });
    expect(['raise', 'call']).toContain(b.recommendation.action);
    expect(b.equity.value).toBeGreaterThan(0.95);
    const j = judge(b, { type: 'fold' });
    expect(j.matches).toBe(false);
    expect(j.evLost!).toBeGreaterThan(0);
  });

  it('preflop: chart-based advice by position', () => {
    const aa = hu('As Ad', '7c 2d', '2s 3s 4s 5s 6s');
    const a = analyse({ view: aa.viewFor(0), tendencies: {}, names, iterations: 1000 });
    expect(a.recommendation.action).toBe('raise');
    expect(a.preflop!.cls).toBe('AA');
    const trash = hu('7c 2d', 'As Ad', '2s 3s 4s 5s 6s');
    // Heads-up button opens ~80%: 72o is at the very bottom and should still fold.
    const b = analyse({ view: trash.viewFor(0), tendencies: {}, names, iterations: 1000 });
    expect(b.recommendation.action).toBe('fold');
  });

  it('never uses the opponents’ actual cards: same public view → same analysis', () => {
    const mk = (villain: string): ReturnType<typeof analyse> => {
      const h = hu('Ah Kh', villain, 'Qh 7h 3s 9c 4d');
      h.act(0, { type: 'raise', to: 25 });
      h.act(1, { type: 'call' });
      h.act(1, { type: 'bet', to: 30 });
      return analyse({ view: h.viewFor(0), tendencies: {}, names, iterations: 2000, seed: 5 });
    };
    const x = mk('2c 2d'), y = mk('Qc Qd');
    expect(x.equity.value).toBe(y.equity.value);
    expect(x.recommendation).toEqual(y.recommendation);
  });
});
