/**
 * Fast 5–7 card hold'em evaluator built on rank bitmasks.
 *
 * For each card we update four 13-bit masks: m1 = ranks seen at least once,
 * m2 = at least twice, m3 = three times, m4 = four times, plus one mask per
 * suit. Every category then falls out of a few bit operations and a 8192-entry
 * straight table; no sorting, no allocation.
 *
 * Score layout (higher wins, equal = split):
 *   category << 20 | r1 << 16 | r2 << 12 | r3 << 8 | r4 << 4 | r5
 * where r1..r5 are the ranks (0 = deuce … 12 = ace) that decide the hand in
 * order of significance. Validated exhaustively: all C(52,5) hands produce the
 * canonical 7,462 distinct classes with the textbook category counts.
 */
import type { Card } from '@/shared/cards/card';
import { RANK_NAMES, RANK_PLURALS } from '@/shared/cards/card';

export const enum Cat {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'] as const;

/** STRAIGHT_HIGH[mask] = rank of the highest card of the best straight in mask, or -1. */
const STRAIGHT_HIGH = new Int8Array(8192).fill(-1);
for (let m = 0; m < 8192; m++) {
  for (let top = 12; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((m & need) === need) {
      STRAIGHT_HIGH[m] = top;
      break;
    }
  }
  // Wheel A-2-3-4-5: ace (bit 12) plays low, five-high straight.
  if (STRAIGHT_HIGH[m] < 0 && (m & 0b1000000001111) === 0b1000000001111) STRAIGHT_HIGH[m] = 3;
}

const POPCOUNT = new Uint8Array(8192);
for (let m = 1; m < 8192; m++) POPCOUNT[m] = POPCOUNT[m >> 1] + (m & 1);

const top = (x: number): number => 31 - Math.clz32(x);

/** Top `k` ranks of mask packed into 4-bit nibbles, most significant first. */
function topRanks(mask: number, k: number): number {
  let out = 0;
  for (let i = 0; i < k; i++) {
    if (mask) {
      const r = top(mask);
      out = (out << 4) | r;
      mask ^= 1 << r;
    } else out <<= 4;
  }
  return out;
}

export function evaluate(cards: ArrayLike<Card>, n: number = cards.length): number {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  let m1 = 0, m2 = 0, m3 = 0, m4 = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const b = 1 << (c >> 2);
    switch (c & 3) {
      case 0: s0 |= b; break;
      case 1: s1 |= b; break;
      case 2: s2 |= b; break;
      default: s3 |= b;
    }
    if (m3 & b) m4 |= b;
    else if (m2 & b) m3 |= b;
    else if (m1 & b) m2 |= b;
    else m1 |= b;
  }
  const fm = POPCOUNT[s0] >= 5 ? s0 : POPCOUNT[s1] >= 5 ? s1 : POPCOUNT[s2] >= 5 ? s2 : POPCOUNT[s3] >= 5 ? s3 : 0;
  if (fm) {
    const sf = STRAIGHT_HIGH[fm];
    if (sf >= 0) return (Cat.StraightFlush << 20) | (sf << 16);
  }
  if (m4) {
    const q = top(m4);
    return (Cat.Quads << 20) | (q << 16) | (topRanks(m1 & ~(1 << q), 1) << 12);
  }
  if (m3) {
    const t = top(m3);
    const rest = m2 & ~(1 << t);
    if (rest) return (Cat.FullHouse << 20) | (t << 16) | (top(rest) << 12);
  }
  // A flush and a full house/quads cannot coexist in 7 cards, so order is safe.
  if (fm) return (Cat.Flush << 20) | topRanks(fm, 5);
  const st = STRAIGHT_HIGH[m1];
  if (st >= 0) return (Cat.Straight << 20) | (st << 16);
  if (m3) {
    const t = top(m3);
    return (Cat.Trips << 20) | (t << 16) | (topRanks(m1 & ~(1 << t), 2) << 8);
  }
  if (POPCOUNT[m2] >= 2) {
    const p1 = top(m2);
    const p2 = top(m2 ^ (1 << p1));
    // A third pair's rank is eligible as the kicker.
    return (Cat.TwoPair << 20) | (p1 << 16) | (p2 << 12) | (topRanks(m1 & ~((1 << p1) | (1 << p2)), 1) << 8);
  }
  if (m2) {
    const p = top(m2);
    return (Cat.Pair << 20) | (p << 16) | (topRanks(m1 & ~(1 << p), 3) << 4);
  }
  return topRanks(m1, 5);
}

export const categoryOf = (score: number): Cat => (score >> 20) as Cat;
const nib = (score: number, i: number): number => (score >> (16 - 4 * i)) & 15;

/** Human-readable description, e.g. "Two pair, Kings and Sevens". */
export function describe(score: number): string {
  const c = categoryOf(score);
  const r = (i: number): string => RANK_NAMES[nib(score, i)];
  const rp = (i: number): string => RANK_PLURALS[nib(score, i)];
  switch (c) {
    case Cat.StraightFlush:
      return nib(score, 0) === 12 ? 'Royal flush' : `Straight flush, ${r(0)} high`;
    case Cat.Quads:
      return `Four of a kind, ${rp(0)}`;
    case Cat.FullHouse:
      return `Full house, ${rp(0)} full of ${rp(1)}`;
    case Cat.Flush:
      return `Flush, ${r(0)} high`;
    case Cat.Straight:
      return `Straight, ${r(0)} high`;
    case Cat.Trips:
      return `Three of a kind, ${rp(0)}`;
    case Cat.TwoPair:
      return `Two pair, ${rp(0)} and ${rp(1)}`;
    case Cat.Pair:
      return `Pair of ${rp(0)}`;
    default:
      return `High card, ${r(0)}`;
  }
}

/** Short form for tight UI: "KK77", "Flush A", etc. */
export function describeShort(score: number): string {
  const c = categoryOf(score);
  return ['High card', 'Pair', 'Two pair', 'Trips', 'Straight', 'Flush', 'Full house', 'Quads', 'Straight flush'][c];
}

/** The five cards that make the best hand (for highlighting). */
export function bestFive(cards: readonly Card[]): Card[] {
  if (cards.length <= 5) return [...cards];
  const target = evaluate(cards);
  const n = cards.length;
  const pick = [0, 1, 2, 3, 4];
  const buf = new Array<Card>(5);
  while (true) {
    for (let i = 0; i < 5; i++) buf[i] = cards[pick[i]];
    if (evaluate(buf) === target) return [...buf];
    let i = 4;
    while (i >= 0 && pick[i] === n - 5 + i) i--;
    if (i < 0) return cards.slice(0, 5);
    pick[i]++;
    for (let j = i + 1; j < 5; j++) pick[j] = pick[j - 1] + 1;
  }
}

/** Compare two holdings on a board: >0 if a wins, <0 if b wins, 0 split. */
export function compareHands(a: readonly Card[], b: readonly Card[], board: readonly Card[]): number {
  return evaluate([...a, ...board]) - evaluate([...b, ...board]);
}
