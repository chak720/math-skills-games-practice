import { describe as suite, expect, it } from 'vitest';
import { parseCards } from '@/shared/cards/card';
import { bestFive, categoryOf, compareHands, describe, evaluate } from './evaluator';
import { Rng } from '@/shared/random/prng';
import { cardsToString } from '@/shared/cards/card';

const ev = (s: string): number => evaluate(parseCards(s));

/** Independent, deliberately naive reference: returns [category, ...tiebreak ranks]. */
function naive5(cards: number[]): number[] {
  const ranks = cards.map((c) => c >> 2).sort((a, b) => b - a);
  const suits = cards.map((c) => c & 3);
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq.join() === '12,3,2,1,0') straightHigh = 3;
  }
  const counts = new Map<number, number>();
  ranks.forEach((r) => counts.set(r, (counts.get(r) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const byGroup = groups.map((g) => g[0]);
  if (flush && straightHigh >= 0) return [8, straightHigh];
  if (shape === '41') return [7, ...byGroup];
  if (shape === '32') return [6, ...byGroup];
  if (flush) return [5, ...ranks];
  if (straightHigh >= 0) return [4, straightHigh];
  if (shape === '311') return [3, ...byGroup];
  if (shape === '221') return [2, ...byGroup];
  if (shape === '2111') return [1, ...byGroup];
  return [0, ...ranks];
}
function cmpArr(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? -1) !== (b[i] ?? -1)) return (a[i] ?? -1) - (b[i] ?? -1);
  return 0;
}
function naive7(cards: number[]): number[] {
  let best: number[] = [-1];
  for (let a = 0; a < cards.length; a++)
    for (let b = a + 1; b < cards.length; b++) {
      const five = cards.filter((_, i) => i !== a && i !== b);
      const v = naive5(five);
      if (cmpArr(v, best) > 0) best = v;
    }
  return best;
}

suite('evaluator: exhaustive 5-card check', () => {
  it('all 2,598,960 hands give the textbook category counts and 7,462 classes', () => {
    const counts = new Array(9).fill(0);
    const distinct = new Set<number>();
    const h = [0, 0, 0, 0, 0];
    for (let a = 0; a < 52; a++)
      for (let b = a + 1; b < 52; b++)
        for (let c = b + 1; c < 52; c++)
          for (let d = c + 1; d < 52; d++)
            for (let e = d + 1; e < 52; e++) {
              h[0] = a; h[1] = b; h[2] = c; h[3] = d; h[4] = e;
              const s = evaluate(h, 5);
              counts[s >> 20]++;
              distinct.add(s);
            }
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
    expect(distinct.size).toBe(7462);
  });
});

suite('evaluator: 7-card cross-check against a naive best-of-21', () => {
  it('agrees on category and on ordering for 20,000 random pairs', () => {
    const rng = new Rng(2024);
    for (let t = 0; t < 20000; t++) {
      const deck = rng.sample(Array.from({ length: 52 }, (_, i) => i), 14);
      const a = deck.slice(0, 7), b = deck.slice(7);
      const fa = evaluate(a), fb = evaluate(b);
      const na = naive7(a), nb = naive7(b);
      expect(categoryOf(fa), cardsToString(a)).toBe(na[0]);
      expect(Math.sign(fa - fb), `${cardsToString(a)} vs ${cardsToString(b)}`).toBe(Math.sign(cmpArr(na, nb)));
    }
  });
});

suite('evaluator: edge cases', () => {
  it('wheel and steel wheel', () => {
    expect(describe(ev('As 2d 3c 4h 5s Kd Qc'))).toBe('Straight, Five high');
    expect(ev('6s 2d 3c 4h 5s Kd Qc')).toBeGreaterThan(ev('As 2d 3c 4h 5s Kd Qc')); // six-high beats wheel
    expect(describe(ev('Ah 2h 3h 4h 5h Kd Qc'))).toBe('Straight flush, Five high');
    expect(describe(ev('Ah Kh Qh Jh Th 9h 2c'))).toBe('Royal flush');
    // Broadway beats a wheel on the same board
    expect(ev('Ad Kc Qh Js Ts 2c 3d')).toBeGreaterThan(ev('Ad 2c 3h 4s 5s 9c 9d'));
  });
  it('straight flush beats quads; flush outranks a straight in the same 7', () => {
    expect(ev('9h Th Jh Qh Kh Ks Kd Kc')).toBeGreaterThan(ev('Ks Kd Kc Kh 2c 3c 4c'));
    expect(describe(ev('2h 5h 7h 9h Jh Th 8c'))).toBe('Flush, Jack high');
  });
  it('counterfeited two pair: board pairs above you', () => {
    // Hero 7-6 had two pair on 7-6-2; the K-K turn/river counterfeits the sixes.
    const board = parseCards('7c 6d 2s Kc Kd');
    const hero = parseCards('7h 6h');
    const villain = parseCards('Ah 3c');
    expect(describe(evaluate([...hero, ...board]))).toBe('Two pair, Kings and Sevens');
    // Hero's sixes no longer play (counterfeited), but KK77 still beats a lone pair of kings.
    expect(compareHands(hero, villain, board)).toBeGreaterThan(0);
    // Classic counterfeit: pocket pair below a double-paired board plays the board.
    const board2 = parseCards('9s 9d 8c 8h Kc');
    const sevens = parseCards('7s 7d');
    const ace = parseCards('Ah 2c');
    expect(describe(evaluate([...sevens, ...board2]))).toBe('Two pair, Nines and Eights');
    expect(compareHands(sevens, ace, board2)).toBeLessThan(0); // A kicker beats the counterfeited sevens
  });
  it('kickers decide, and play the board means split', () => {
    const board = parseCards('Ac Kd 8h 5s 2c');
    expect(compareHands(parseCards('Ah Qs'), parseCards('As Jh'), board)).toBeGreaterThan(0);
    const broadway = parseCards('Ts Jd Qh Kc Ad');
    expect(compareHands(parseCards('2c 3c'), parseCards('4d 4h'), broadway)).toBe(0);
    // Fifth-kicker matters for flushes
    const fb = parseCards('Ah Kh 9h 4h 2c');
    expect(compareHands(parseCards('3h 5c'), parseCards('2h 7c'), fb)).toBeGreaterThan(0);
  });
  it('three pairs: best two pairs plus best kicker (which may be the third pair)', () => {
    expect(ev('Kc Kd 9h 9s 4c 4d 2s')).toBe(ev('Kc Kd 9h 9s 4c 3d 2s'));
    expect(ev('Kc Kd 9h 9s 4c 4d Qs')).toBeGreaterThan(ev('Kc Kd 9h 9s 4c 4d 2s'));
  });
  it('two trips make a full house with the higher trips', () => {
    expect(describe(ev('Jc Jd Jh 4s 4c 4d As'))).toBe('Full house, Jacks full of Fours');
  });
  it('bestFive returns the five cards that make the hand', () => {
    const b = bestFive(parseCards('Ah 2h 3h 4h 5h Kd Qc'));
    expect(evaluate(b)).toBe(ev('Ah 2h 3h 4h 5h'));
  });
  it('is fast: > 2 million 7-card evaluations per second', () => {
    const rng = new Rng(1);
    const hands = Array.from({ length: 1000 }, () => rng.sample(Array.from({ length: 52 }, (_, i) => i), 7));
    const t0 = performance.now();
    let acc = 0;
    for (let r = 0; r < 400; r++) for (const h of hands) acc += evaluate(h);
    const secs = (performance.now() - t0) / 1000;
    expect(acc).toBeGreaterThan(0);
    expect(400_000 / secs).toBeGreaterThan(2_000_000);
  });
});
