import { describe, expect, it } from 'vitest';
import { type Card, parseCards } from '@/shared/cards/card';
import { verifyReveal } from '@/shared/fairness/commit';
import { BJTable, type Shoe } from './engine';
import { DEFAULT_RULES, type BJRules, valueOf, handValue } from './rules';
import { chartMove, computeChart } from './strategy';
import { runningCount, deviationFor, trueCount } from './counting';

/** Test shoe: burn card first, then the listed cards, then filler. */
function scripted(cards: string): () => Shoe {
  return () => {
    const list = [0, ...parseCards(cards.replace(/\s+/g, ' ').trim())];
    const filler = Array.from({ length: 300 }, (_, i) => (i * 7) % 52);
    const all = [...list, ...filler];
    let i = 0;
    return {
      info: { commit: 'test', clientSeed: 'x', nonce: 1, decks: 1 },
      size: all.length,
      get remaining() { return all.length - i; },
      get dealtCount() { return i; },
      draw: (): Card => all[i++],
      finish: () => ({ commit: 'test', clientSeed: 'x', nonce: 1, decks: 1, serverSeed: '', order: all, dealt: all.slice(0, i) }),
    };
  };
}

function table(cards: string, rules: Partial<BJRules> = {}): BJTable {
  const t = new BJTable({ ...DEFAULT_RULES, ...rules }, 2, 'c', scripted(cards));
  t.sit(0, { id: 'h', name: 'You', isHuman: true, bankroll: 1000 });
  return t;
}

// Deal order with one player: P1, D-up, P2, D-hole, then hits.
describe('blackjack rules', () => {
  it('a natural pays 3:2 (or 6:5) when the dealer has no blackjack', () => {
    const t = table('As 9d Kh 7c');
    t.startRound({ 0: 10 });
    expect(t.phase).toBe('dealer');
    t.finishDealer();
    expect(t.seats[0]!.hands[0].result).toBe('blackjack');
    expect(t.seats[0]!.bankroll).toBe(1015);
    const u = table('As 9d Kh 7c', { bjPays: 1.2 });
    u.startRound({ 0: 10 });
    u.finishDealer();
    expect(u.seats[0]!.bankroll).toBe(1012);
  });

  it('insurance pays 2:1 against a dealer blackjack; the hole stays hidden until then', () => {
    const t = table('Ts Ad 9h Kc');
    t.startRound({ 0: 10 });
    expect(t.phase).toBe('insurance');
    expect(t.view(0).dealer).toHaveLength(1);
    t.decideInsurance(0, true);
    expect(t.phase).toBe('done');
    // lose 10 on the hand, win 2 × 5 on insurance
    expect(t.seats[0]!.bankroll).toBe(1000);
  });

  it('late surrender returns half the bet', () => {
    const t = table('Ts Td 6h 7c');
    t.startRound({ 0: 10 });
    expect(t.legal(0)!.surrender).toBe(true);
    t.act(0, 'surrender');
    t.finishDealer();
    expect(t.seats[0]!.bankroll).toBe(995);
  });

  it('double: one card, double the stake', () => {
    // P: 5,6 = 11; dealer 6 up, 10 hole; double gets a 10 → 21; dealer 16 draws 9 → 25 bust
    const t = table('5s 6d 6h Tc Kd 9c');
    t.startRound({ 0: 10 });
    t.act(0, 'double');
    t.finishDealer();
    expect(t.seats[0]!.hands[0].bet).toBe(20);
    expect(t.seats[0]!.bankroll).toBe(1020);
  });

  it('split, then each hand is played in turn; split aces get one card each', () => {
    const t = table('8s 6d 8h Tc 3d Kd 2c 9s');
    t.startRound({ 0: 10 });
    t.act(0, 'split'); // hand 1: 8,3
    expect(t.seats[0]!.hands).toHaveLength(2);
    expect(t.legal(0)!.double).toBe(true); // DAS
    t.act(0, 'hit'); // 8,3,K = 21 → done; hand 2 gets 2
    expect(t.turn).toEqual({ seat: 0, hand: 1 });
    t.act(0, 'stand'); // 8,2 = 10 vs dealer 16 → dealer draws 9 = 25 bust
    t.finishDealer();
    expect(t.seats[0]!.hands.map((h) => h.result)).toEqual(['win', 'win']);
    const a = table('As 6d Ah Tc Kd 9c Kh'); // dealer 16 draws K and busts
    a.startRound({ 0: 10 });
    a.act(0, 'split');
    // Both aces receive one card and are finished automatically.
    expect(a.phase).toBe('dealer');
    expect(a.seats[0]!.hands.map((h) => handValue(h.cards).total)).toEqual([21, 20]);
    a.finishDealer();
    expect(a.seats[0]!.hands[0].result).toBe('win'); // 21 after split is not a blackjack: pays 1:1
    expect(a.seats[0]!.bankroll).toBe(1020);
  });

  it('dealer hits soft 17 only under H17', () => {
    const s17 = table('Ts 6d 9h Ac 2d', { h17: false });
    s17.startRound({ 0: 10 });
    s17.act(0, 'stand');
    s17.finishDealer();
    expect(s17.dealer).toHaveLength(2);
    const h17 = table('Ts 6d 9h Ac 2d', { h17: true });
    h17.startRound({ 0: 10 });
    h17.act(0, 'stand');
    h17.finishDealer();
    expect(h17.dealer.length).toBeGreaterThan(2);
  });
});

describe('fair shoe', () => {
  it('a real shoe verifies against every card dealt from it', async () => {
    const t = new BJTable({ ...DEFAULT_RULES, decks: 2, penetration: 0.5 }, 3, 'client');
    t.sit(0, { id: 'a', name: 'A', isHuman: false, bankroll: 1e6 });
    t.sit(2, { id: 'b', name: 'B', isHuman: false, bankroll: 1e6 });
    const chart = computeChart(t.rules);
    let shoes = 0;
    for (let r = 0; r < 300 && shoes < 2; r++) {
      const before = t.shoeNo;
      t.startRound({ 0: 1, 2: 1 });
      if (t.shoeNo !== before) {
        const rev = t.lastReveal!;
        expect((await verifyReveal(rev)).ok).toBe(true);
        shoes++;
      }
      if (t.phase === 'insurance') for (const s of t.insurancePending()) t.decideInsurance(s, false);
      while (t.phase === 'player') {
        const seat = t.turn!.seat;
        const v = t.view(seat);
        const h = v.seats[seat]!.hands[v.turn!.hand];
        const L = v.legal!;
        const m = chartMove(chart, { values: h.cards.map(valueOf), up: valueOf(v.dealerUp!), canDouble: L.double, canSplit: L.split, canSurrender: L.surrender }).move;
        t.act(seat, L[m] ? m : 'stand');
      }
      if (t.phase === 'dealer') t.finishDealer();
    }
    expect(shoes).toBeGreaterThan(0);
  });
});

describe('basic strategy house edge (simulation)', () => {
  it('6D S17 DAS LS: basic strategy loses about 0.4% of initial bets', () => {
    const rules: BJRules = { ...DEFAULT_RULES };
    const t = new BJTable(rules, 1, 'sim');
    t.sit(0, { id: 'a', name: 'A', isHuman: false, bankroll: 0 });
    const chart = computeChart(rules);
    const N = 120000;
    let sum = 0, sumSq = 0;
    for (let r = 0; r < N; r++) {
      const b0 = t.seats[0]!.bankroll;
      t.startRound({ 0: 1 });
      if (t.phase === 'insurance') t.decideInsurance(0, false);
      while (t.phase === 'player') {
        const v = t.view(0);
        const h = v.seats[0]!.hands[v.turn!.hand];
        const L = v.legal!;
        const m = chartMove(chart, { values: h.cards.map(valueOf), up: valueOf(v.dealerUp!), canDouble: L.double, canSplit: L.split, canSurrender: L.surrender }).move;
        t.act(0, L[m] ? m : 'hit');
      }
      if (t.phase === 'dealer') t.finishDealer();
      const x = t.seats[0]!.bankroll - b0;
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / N;
    const se = Math.sqrt((sumSq / N - mean * mean) / N);
    expect(mean).toBeGreaterThan(-0.0045 - 4 * se);
    expect(mean).toBeLessThan(-0.0045 + 4 * se);
  }, 120_000);
});

describe('counting', () => {
  it('Hi-Lo running count is balanced over a full deck', () => {
    expect(runningCount(Array.from({ length: 52 }, (_, i) => i))).toBe(0);
    expect(runningCount(parseCards('2c 3d 4h 5s 6c 7d Ts Ah'))).toBe(3);
    expect(trueCount(6, 156)).toBe(2);
  });
  it('index plays fire at the right counts', () => {
    const base = { pairOf: null, canDouble: true, canSplit: false, canSurrender: false };
    expect(deviationFor({ ...base, hardTotal: 16, up: 10, tc: 0.2 })?.move).toBe('stand');
    expect(deviationFor({ ...base, hardTotal: 16, up: 10, tc: -0.5 })).toBeNull();
    expect(deviationFor({ ...base, hardTotal: 12, up: 4, tc: -1 })?.move).toBe('hit');
    expect(deviationFor({ ...base, hardTotal: null, pairOf: 10, canSplit: true, up: 6, tc: 4.5 })?.move).toBe('split');
    expect(deviationFor({ ...base, hardTotal: 15, up: 10, tc: 1, canSurrender: true })?.move).toBe('surrender');
  });
});
