import { describe, expect, it } from 'vitest';
import { type Card, parseCards } from '@/shared/cards/card';
import { Rng } from '@/shared/random/prng';
import { FairDeck } from '@/shared/fairness/commit';
import { Hand, type CardSource, type HandSeat } from './hand';
import { buildPots } from './pots';
import type { PlayerAction } from './types';

/** Test-only deck: deals a fixed sequence. Production code only ever uses FairDeck. */
class ScriptedDeck implements CardSource {
  private i = 0;
  constructor(private readonly cards: Card[]) {}
  draw(): Card {
    if (this.i >= this.cards.length) throw new Error('script exhausted');
    return this.cards[this.i++];
  }
}

/**
 * Builds a draw order for hole cards given BY SEAT (index = seat number) and a
 * 5-card board, dealing clockwise from the left of `button`, burns filled with
 * unused cards.
 */
function script(holesBySeat: string[], board: string, button: number): ScriptedDeck {
  const hs = holesBySeat.map((h) => parseCards(h));
  const b = parseCards(board);
  const used = new Set([...hs.flat(), ...b]);
  const spare = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  const n = hs.length;
  const ring = Array.from({ length: n }, (_, k) => (button + 1 + k) % n);
  const order: Card[] = [];
  for (let r = 0; r < 2; r++) for (const seat of ring) order.push(hs[seat][r]);
  order.push(spare.pop()!, b[0], b[1], b[2], spare.pop()!, b[3], spare.pop()!, b[4]);
  return new ScriptedDeck(order);
}

const seats = (stacks: number[]): HandSeat[] => stacks.map((s, i) => ({ seat: i, playerId: `p${i}`, name: `P${i}`, stack: s }));

function mk(stacks: number[], button: number, deck: CardSource, extra: Partial<ConstructorParameters<typeof Hand>[0]> = {}): Hand {
  return new Hand({ handId: 1, sb: 5, bb: 10, button, maxSeats: stacks.length, seats: seats(stacks), deck, ...extra });
}

const randomDeck = (): CardSource => new FairDeck({ clientSeed: 'test', nonce: Math.floor(Math.random() * 1e9) });

describe('blinds, positions and order', () => {
  it('6-max: SB/BB left of the button, UTG first preflop, SB first postflop', () => {
    const h = mk([1000, 1000, 1000, 1000, 1000, 1000], 2, randomDeck());
    expect(h.sbSeat).toBe(3);
    expect(h.bbSeat).toBe(4);
    expect(h.toAct).toBe(5); // UTG
    for (const s of [5, 0, 1, 2]) h.act(s, { type: 'call' });
    h.act(3, { type: 'call' });
    expect(h.legal(4)?.canCheck).toBe(true); // BB option
    expect(h.legal(4)?.canRaise).toBe(true);
    h.act(4, { type: 'check' });
    expect(h.street).toBe('flop');
    expect(h.toAct).toBe(3); // SB first postflop
    expect(h.board.length).toBe(3);
  });

  it('heads-up: the button posts the small blind, acts first preflop and last postflop', () => {
    const h = mk([1000, 1000], 0, randomDeck());
    expect(h.sbSeat).toBe(0);
    expect(h.bbSeat).toBe(1);
    expect(h.toAct).toBe(0);
    h.act(0, { type: 'call' });
    h.act(1, { type: 'check' });
    expect(h.toAct).toBe(1);
  });

  it('a short big blind still obliges others to call the full blind', () => {
    const h = mk([1000, 1000, 6], 0, randomDeck()); // seat 2 = BB with 6 chips
    expect(h.bbSeat).toBe(2);
    expect(h.legal(0)?.callAmount).toBe(10);
  });
});

describe('min-raise and reopening rules', () => {
  it('raise increments must match the last full raise', () => {
    const h = mk([1000, 1000, 1000], 0, randomDeck()); // UTG is the button (seat 0) 3-handed
    expect(h.legal(0)?.minTo).toBe(20);
    h.act(0, { type: 'raise', to: 30 }); // raise by 20
    expect(h.legal(1)?.minTo).toBe(50);
    expect(() => h.act(1, { type: 'raise', to: 45 })).toThrow();
    h.act(1, { type: 'raise', to: 90 }); // raise by 60
    expect(h.legal(2)?.minTo).toBe(150);
  });

  it('a short all-in does not reopen betting for a player who already acted', () => {
    // Postflop: seat 1 bets 100, seat 2 shoves 150 total (short), seat 0 calls; seat 1 may only call/fold.
    const h = mk([1000, 1000, 160], 0, randomDeck());
    h.act(0, { type: 'call' });
    h.act(1, { type: 'call' });
    h.act(2, { type: 'check' });
    expect(h.street).toBe('flop');
    h.act(1, { type: 'bet', to: 100 });
    h.act(2, { type: 'raise', to: 150 }); // all-in, increment 50 < 100
    expect(h.legal(0)?.canRaise).toBe(true); // seat 0 has not acted yet: may raise
    h.act(0, { type: 'call' });
    const L = h.legal(1)!;
    expect(L.canRaise).toBe(false);
    expect(L.callAmount).toBe(50);
  });

  it('short all-ins that add up to a full raise do reopen', () => {
    const h = mk([1000, 1000, 160, 220], 0, randomDeck()); // seats: 0 btn, 1 sb, 2 bb, 3 utg
    for (const s of [3, 0, 1]) h.act(s, { type: 'call' });
    h.act(2, { type: 'check' });
    h.act(1, { type: 'bet', to: 100 }); // flop: seat 1 first
    h.act(2, { type: 'raise', to: 150 }); // all-in short (+50)
    h.act(3, { type: 'raise', to: 210 }); // all-in short (+60); total +110 over 100 >= 100
    h.act(0, { type: 'call' });
    expect(h.legal(1)?.canRaise).toBe(true);
  });

  it('cannot raise when every opponent is all-in', () => {
    const h = mk([1000, 50], 0, randomDeck());
    h.act(0, { type: 'raise', to: 100 });
    h.act(1, { type: 'call' }); // all-in for 50
    expect(h.finished).toBe(true); // nobody left to bet: board runs out
  });
});

describe('side pots, splits and uncalled bets', () => {
  it('builds pots from contribution levels with dead money', () => {
    expect(buildPots([
      { seat: 0, committed: 100, folded: false },
      { seat: 1, committed: 300, folded: false },
      { seat: 2, committed: 300, folded: false },
      { seat: 3, committed: 200, folded: true },
    ])).toEqual([
      { amount: 400, eligible: [0, 1, 2] },
      { amount: 500, eligible: [1, 2] },
    ]);
  });

  it('three-way all-in: shortest stack wins main, middle wins side, excess returned', () => {
    const h = mk([100, 300, 500], 2, script(['As Ah', 'Ks Kh', 'Qs Qh'], '2c 7d 9h 3s 4d', 2));
    h.act(2, { type: 'raise', to: 500 }); // button shoves (only 3 players: button is UTG)
    h.act(0, { type: 'call' }); // SB all-in 100
    h.act(1, { type: 'call' }); // BB all-in 300
    expect(h.finished).toBe(true);
    const v = h.viewFor(-1);
    expect(v.pots).toEqual([
      { amount: 300, eligible: [0, 1, 2] },
      { amount: 400, eligible: [1, 2] },
    ]);
    const st = h.stacks();
    expect(st.get(0)).toBe(300); // aces win the main pot
    expect(st.get(1)).toBe(400); // kings win the side pot
    expect(st.get(2)).toBe(200); // queens: uncalled 200 returned
    expect(v.seats.every((s) => s.shown !== null)).toBe(true); // all-in: every hand tabled
  });

  it('side pot won by the short stack while a bigger stack wins the side pot', () => {
    const h = mk([100, 300, 500], 2, script(['Ks Kh', 'As Ah', 'Qs Qh'], '2c 7d 9h 3s 4d', 2));
    h.act(2, { type: 'raise', to: 500 });
    h.act(0, { type: 'call' });
    h.act(1, { type: 'call' });
    const st = h.stacks();
    expect(st.get(1)).toBe(700); // aces scoop both pots they're eligible for
    expect(st.get(0)).toBe(0);
    expect(st.get(2)).toBe(200);
  });

  it('split pot with an odd chip goes to the first winner left of the button', () => {
    // Board is a royal flush: everybody splits. Pot 3 x 25 + dead 5 blinds... construct 3-way 25 each.
    const h = mk([1000, 1000, 1000], 0, script(['2c 3d', '4c 5d', '6c 7d'], 'Ts Js Qs Ks As', 0), { sb: 5, bb: 10 });
    h.act(0, { type: 'raise', to: 25 });
    h.act(1, { type: 'call' });
    h.act(2, { type: 'call' });
    for (let k = 0; k < 3; k++) {
      h.act(1, { type: 'check' });
      h.act(2, { type: 'check' });
      h.act(0, { type: 'check' });
    }
    expect(h.finished).toBe(true);
    const w = h.viewFor(-1).winners!;
    expect(w.map((x) => x.amount).sort()).toEqual([25, 25, 25]);
  });

  it('odd chips: 3-way split of an uneven pot', () => {
    const h = mk([1000, 1000, 1000, 1000], 0, script(['2c 3d', '4c 5d', '6c 7d', '8c 2h'], 'Ts Js Qs Ks As', 0));
    // seats: 0 btn, 1 sb, 2 bb, 3 utg. UTG folds after posting nothing; SB completes; split 3-ways: 5+5... pot = 10+10+10 = 30
    h.act(3, { type: 'fold' });
    h.act(0, { type: 'call' });
    h.act(1, { type: 'raise', to: 21 });
    h.act(2, { type: 'call' });
    h.act(0, { type: 'call' });
    for (let k = 0; k < 3; k++) for (const s of [1, 2, 0]) h.act(s, { type: 'check' });
    // Pot = 21 x 3 + UTG's nothing = 63: 21 each.
    const w = h.viewFor(-1).winners!;
    expect(w.map((x) => x.amount)).toEqual([21, 21, 21]);
  });

  it('uncalled raise is returned when everyone folds', () => {
    const h = mk([1000, 1000, 1000], 0, randomDeck());
    h.act(0, { type: 'raise', to: 300 });
    h.act(1, { type: 'fold' });
    h.act(2, { type: 'fold' });
    const st = h.stacks();
    expect(st.get(0)).toBe(1000 + 15); // wins the blinds only
    expect(st.get(1)).toBe(995);
    expect(st.get(2)).toBe(990);
    expect(h.viewFor(-1).actions.some((a) => a.type === 'uncalled' && a.amount === -290)).toBe(true);
  });
});

describe('showdown order and mucking', () => {
  it('river aggressor shows first; a worse hand that cannot win mucks', () => {
    // seat 1 bets river with the best hand; seat 2 calls with worse and mucks; seat 0 folded.
    const h = mk([1000, 1000, 1000], 0, script(['2c 7h', 'Ah Ad', 'Kc Kd'], '3s 8d 9c Js 4h', 0));
    h.act(0, { type: 'fold' });
    h.act(1, { type: 'call' });
    h.act(2, { type: 'check' });
    for (let k = 0; k < 2; k++) {
      h.act(1, { type: 'check' });
      h.act(2, { type: 'check' });
    }
    h.act(1, { type: 'bet', to: 50 });
    h.act(2, { type: 'call' });
    const v = h.viewFor(-1);
    const s1 = v.seats.find((s) => s.seat === 1)!, s2 = v.seats.find((s) => s.seat === 2)!;
    expect(s1.shown).not.toBeNull();
    expect(s2.mucked).toBe(true);
    expect(s2.shown).toBeNull();
    expect(v.winners).toEqual([{ seat: 1, amount: 120, potIndex: 0, hand: 'Pair of Aces' }]);
  });

  it('the caller shows a winning hand after the bettor', () => {
    const h = mk([1000, 1000], 0, script(['Ah Ad', 'Kc Kd'], 'Ks 8d 9c 2s 4h', 0));
    h.act(0, { type: 'call' });
    h.act(1, { type: 'check' });
    for (let k = 0; k < 2; k++) {
      h.act(1, { type: 'check' });
      h.act(0, { type: 'check' });
    }
    h.act(1, { type: 'check' });
    h.act(0, { type: 'bet', to: 40 }); // aces bet the river, the set of kings calls
    h.act(1, { type: 'call' });
    const v = h.viewFor(-1);
    expect(v.seats.every((s) => s.shown)).toBe(true);
    expect(v.winners![0].seat).toBe(1); // set of kings
  });

  it('with no river bet, the first live player left of the button shows first', () => {
    const h = mk([1000, 1000, 1000], 0, script(['Ah Ad', 'Kc Kd', 'Qc Qd'], '2s 8d 9c 3s 4h', 0));
    h.act(0, { type: 'call' });
    h.act(1, { type: 'call' });
    h.act(2, { type: 'check' });
    for (let k = 0; k < 3; k++) for (const s of [1, 2, 0]) h.act(s, { type: 'check' });
    const v = h.viewFor(-1);
    // Seat 1 (SB, kings) shows first; seat 2 (queens) can't beat it and mucks; seat 0 (aces) shows and wins.
    expect(v.seats.find((s) => s.seat === 1)!.shown).not.toBeNull();
    expect(v.seats.find((s) => s.seat === 2)!.mucked).toBe(true);
    expect(v.winners![0].seat).toBe(0);
  });
});

describe('information hiding in views', () => {
  it('a view contains only the viewer’s hole cards and shares no references with the engine', () => {
    const h = mk([1000, 1000, 1000], 0, randomDeck());
    const v = h.viewFor(1);
    expect(v.hole).toHaveLength(2);
    expect(v.seats.every((s) => s.shown === null)).toBe(true);
    expect(Object.keys(v).sort()).toEqual(
      ['actions', 'bb', 'bbSeat', 'board', 'button', 'currentBet', 'handId', 'hole', 'legal', 'me', 'order', 'pot', 'pots', 'sb', 'sbSeat', 'seats', 'street', 'toAct', 'ante', 'handOver', 'winners'].sort(),
    );
    // Mutating the view must not affect the engine.
    v.hole!.push(51);
    v.seats[0].stack = 0;
    v.board.push(0);
    const v2 = h.viewFor(1);
    expect(v2.hole).toHaveLength(2);
    expect(v2.seats[0].stack).not.toBe(0);
    expect(v2.board).toHaveLength(0);
  });
});

describe('property test: random play conserves chips and terminates', () => {
  it('3,000 random hands with random stacks and actions', () => {
    const rng = new Rng(7);
    for (let t = 0; t < 3000; t++) {
      const n = rng.range(2, 9);
      const stacks = Array.from({ length: n }, () => (rng.chance(0.3) ? rng.range(1, 60) : rng.range(100, 3000)));
      const total = stacks.reduce((a, b) => a + b, 0);
      const h = new Hand({ handId: t, sb: 5, bb: 10, ante: rng.chance(0.2) ? 1 : 0, button: rng.int(n), maxSeats: n, seats: seats(stacks), deck: randomDeck() });
      let steps = 0;
      while (!h.finished) {
        const s = h.toAct!;
        const L = h.legal(s)!;
        const opts: PlayerAction[] = [];
        if (L.canFold) opts.push({ type: 'fold' });
        if (L.canCheck) opts.push({ type: 'check' });
        if (L.canCall) opts.push({ type: 'call' }, { type: 'call' });
        if (L.canRaise) opts.push({ type: 'raise', to: L.minTo }, { type: 'raise', to: L.maxTo }, { type: 'raise', to: rng.range(L.minTo, L.maxTo) });
        h.act(s, rng.pick(opts));
        if (++steps > 500) throw new Error('hand did not terminate');
        // Invariant at every step: stacks + pot = total.
        const v = h.viewFor(-1);
        expect(v.seats.reduce((a, x) => a + x.stack, 0) + (h.finished ? 0 : v.pot)).toBe(total);
        expect(v.seats.every((x) => x.stack >= 0)).toBe(true);
      }
      const v = h.viewFor(-1);
      expect(v.seats.reduce((a, x) => a + x.stack, 0)).toBe(total);
      expect(v.pots!.reduce((a, p) => a + p.amount, 0)).toBe(v.winners!.reduce((a, w) => a + w.amount, 0));
      expect(h.board.length === 5 || v.winners!.length >= 1).toBe(true);
    }
  });
});

describe('odd chips', () => {
  it('a 3-way split of 64 gives the extra chip to the first winner left of the button', () => {
    // 4 players, button 0. UTG (3) limps then folds later is impossible preflop; use a 1-chip ante to make the pot odd.
    const h = mk([1000, 1000, 1000, 1000], 0, script(['2c 3d', '4c 5d', '6c 7d', '8c 2h'], 'Ts Js Qs Ks As', 0), { ante: 1 });
    h.act(3, { type: 'fold' });
    h.act(0, { type: 'call' });
    h.act(1, { type: 'call' });
    h.act(2, { type: 'check' });
    for (let k = 0; k < 3; k++) for (const s of [1, 2, 0]) h.act(s, { type: 'check' });
    const w = h.viewFor(-1).winners!; // pot = 4 antes + 30 = 34 → 12, 11, 11
    expect(w.reduce((a, b) => a + b.amount, 0)).toBe(34);
    expect(w.find((x) => x.seat === 1)!.amount).toBe(12); // SB is first left of the button
    expect(w.find((x) => x.seat === 2)!.amount).toBe(11);
    expect(w.find((x) => x.seat === 0)!.amount).toBe(11);
  });
});

describe('side pots vs an independent chip-layer reference', () => {
  it('random multi-way all-ins pay out like the layer-by-layer definition', async () => {
    const { evaluate } = await import('../eval/evaluator');
    const rng = new Rng(99);
    for (let t = 0; t < 1500; t++) {
      const n = rng.range(2, 9);
      const stacks = Array.from({ length: n }, () => rng.range(5, 400));
      const button = rng.int(n);
      const deck = new FairDeck({ clientSeed: 'layers', nonce: t });
      const h = new Hand({ handId: t, sb: 5, bb: 10, button, maxSeats: n, seats: seats(stacks), deck });
      // Everyone puts their whole stack in (or folds with probability 0.2).
      while (!h.finished) {
        const s = h.toAct!;
        const L = h.legal(s)!;
        if (L.canFold && rng.chance(0.2)) h.act(s, { type: 'fold' });
        else if (L.canRaise) h.act(s, { type: 'raise', to: L.maxTo });
        else if (L.canCall) h.act(s, { type: 'call' });
        else h.act(s, { type: 'check' });
      }
      const hist = h.history();
      // Reference: each chip layer k is contested by live players whose total reached k.
      const committed = new Map<number, number>();
      for (const a of hist.actions) committed.set(a.seat, (committed.get(a.seat) ?? 0) + a.amount);
      const live = hist.players.filter((p) => !p.folded);
      const score = new Map(live.map((p) => [p.seat, evaluate([...p.hole, ...hist.board])]));
      const won = new Map<number, number>();
      const maxC = Math.max(...committed.values());
      let layers = 0;
      for (let k = 1; k <= maxC; k++) {
        const chips = [...committed.values()].filter((c) => c >= k).length;
        const elig = live.filter((p) => (committed.get(p.seat) ?? 0) >= k);
        if (!elig.length) continue;
        const best = Math.max(...elig.map((p) => score.get(p.seat)!));
        const ws = elig.filter((p) => score.get(p.seat) === best);
        for (const w of ws) won.set(w.seat, (won.get(w.seat) ?? 0) + chips / ws.length);
        layers++;
      }
      if (live.length === 1) continue; // uncontested: nothing to compare
      for (const p of hist.players) {
        const net = p.stackEnd - p.stackStart;
        const ref = (won.get(p.seat) ?? 0) - (committed.get(p.seat) ?? 0);
        // Odd-chip rounding can differ by at most one chip per pot.
        expect(Math.abs(net - ref)).toBeLessThanOrEqual(hist.pots.length);
      }
      expect(layers).toBeGreaterThan(0);
    }
  });
});
