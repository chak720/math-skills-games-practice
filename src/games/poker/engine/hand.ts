/**
 * One hand of no-limit hold'em: blinds, dealing, four betting rounds, all-ins,
 * side pots, showdown order and mucking.
 *
 * Betting rules implemented:
 *  - Min bet = big blind. Min raise: the increment must be at least the
 *    largest previous bet/raise increment on this street (lastFullRaise).
 *  - An all-in for less than a full raise does not reopen betting: a player
 *    who has already acted may re-raise only if the bet has grown by at least
 *    a full raise since they last acted (this also makes several short
 *    all-ins that add up to a full raise reopen the action, per TDA rules).
 *  - A short big blind (all-in for less) still obliges others to call the
 *    full big blind.
 *  - Uncalled chips are returned before pots are built.
 *  - Showdown: the last aggressor on the river shows first, otherwise the
 *    first live player left of the button; later players show only if they
 *    can still win something, else they muck. If the hand ends with players
 *    all-in, every live hand is tabled immediately (as online).
 */
import type { Card } from '@/shared/cards/card';
import { evaluate, describe } from '../eval/evaluator';
import { awardPots, buildPots, type Pot } from './pots';
import type { ActionRecord, LegalActions, PlayerAction, PlayerView, SeatView, Street, WinnerView } from './types';

export interface CardSource {
  draw(): Card;
}

export interface HandSeat {
  seat: number;
  playerId: string;
  name: string;
  stack: number;
}

export interface HandOptions {
  handId: number;
  sb: number;
  bb: number;
  ante?: number;
  button: number;
  /** Seat count of the table (positions wrap modulo this). */
  maxSeats: number;
  seats: HandSeat[];
  deck: CardSource;
  /** Seats that always show at showdown instead of auto-mucking. */
  alwaysShow?: number[];
}

interface P {
  seat: number;
  playerId: string;
  name: string;
  stackStart: number;
  stack: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  betStreet: number;
  committed: number;
  acted: boolean;
  /** Bet level when this player last acted (for the reopen rule). */
  lastLevel: number;
  shown: Card[] | null;
  mucked: boolean;
}

export interface DealtCard {
  card: Card;
  kind: 'hole' | 'burn' | 'board';
  seat?: number;
}

export interface HandHistory {
  handId: number;
  sb: number;
  bb: number;
  ante: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  order: number[];
  players: { seat: number; playerId: string; name: string; stackStart: number; stackEnd: number; hole: Card[]; folded: boolean; shown: boolean; mucked: boolean }[];
  board: Card[];
  actions: ActionRecord[];
  pots: Pot[];
  winners: WinnerView[];
  dealt: DealtCard[];
  /** Street on which the hand ended ('river' also for showdowns). */
  endStreet: Street;
  showdown: boolean;
}

const NEXT: Record<Street, Street | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null };

export class Hand {
  readonly id: number;
  readonly sb: number;
  readonly bb: number;
  readonly ante: number;
  readonly button: number;
  readonly sbSeat: number;
  readonly bbSeat: number;
  /** Players clockwise starting left of the button. */
  private readonly ring: P[];
  private readonly deck: CardSource;
  private readonly alwaysShow: Set<number>;
  street: Street = 'preflop';
  board: Card[] = [];
  private currentBet = 0;
  private lastFullRaise: number;
  private toActIdx: number | null = null;
  private lastAggressor: P | null = null;
  readonly actions: ActionRecord[] = [];
  readonly dealt: DealtCard[] = [];
  finished = false;
  private showdownHappened = false;
  private pots: Pot[] = [];
  private winners: WinnerView[] = [];
  private endStreet: Street = 'preflop';

  constructor(o: HandOptions) {
    if (o.seats.length < 2) throw new Error('need at least two players');
    this.id = o.handId;
    this.sb = o.sb;
    this.bb = o.bb;
    this.ante = o.ante ?? 0;
    this.button = o.button;
    this.deck = o.deck;
    this.alwaysShow = new Set(o.alwaysShow ?? []);
    this.lastFullRaise = o.bb;
    const M = o.maxSeats;
    const dist = (s: number): number => (s - o.button - 1 + 2 * M) % M;
    this.ring = [...o.seats]
      .sort((a, b) => dist(a.seat) - dist(b.seat))
      .map((s) => ({
        seat: s.seat, playerId: s.playerId, name: s.name, stackStart: s.stack, stack: s.stack, hole: [],
        folded: false, allIn: false, betStreet: 0, committed: 0, acted: false, lastLevel: 0, shown: null, mucked: false,
      }));
    const n = this.ring.length;
    const hu = n === 2;
    // Heads-up the button posts the small blind and acts first preflop.
    const sbIdx = hu ? 1 : 0;
    const bbIdx = hu ? 0 : 1;
    this.sbSeat = this.ring[sbIdx].seat;
    this.bbSeat = this.ring[bbIdx].seat;

    if (this.ante > 0) for (const p of this.ring) this.post(p, this.ante, 'post-ante', false);
    this.post(this.ring[sbIdx], this.sb, 'post-sb', true);
    this.post(this.ring[bbIdx], this.bb, 'post-bb', true);
    this.currentBet = Math.max(this.bb, ...this.ring.map((p) => p.betStreet));

    // Deal two rounds starting left of the button.
    for (let r = 0; r < 2; r++)
      for (const p of this.ring) {
        const c = this.deck.draw();
        p.hole.push(c);
        this.dealt.push({ card: c, kind: 'hole', seat: p.seat });
      }

    const firstIdx = hu ? 1 : 2 % n;
    this.toActIdx = this.findActor(firstIdx, true);
    if (this.toActIdx === null) this.endStreet_();
  }

  // ---------------------------------------------------------------- helpers

  private get potTotal(): number {
    return this.ring.reduce((s, p) => s + p.committed, 0);
  }

  private post(p: P, amount: number, type: ActionRecord['type'], street: boolean): void {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.committed += a;
    if (street) p.betStreet += a;
    if (p.stack === 0) p.allIn = true;
    this.actions.push({ street: 'preflop', seat: p.seat, type, amount: a, to: p.betStreet, allIn: p.allIn, potAfter: this.potTotal });
  }

  private needsToAct(p: P): boolean {
    if (p.folded || p.allIn) return false;
    if (p.betStreet < this.currentBet) return true;
    if (p.acted) return false;
    // Unacted with nothing to call: only worth asking if someone could respond.
    return this.ring.some((q) => q !== p && !q.folded && !q.allIn);
  }

  /** First index at or after `start` (or strictly after when !inclusive) that must act. */
  private findActor(start: number, inclusive: boolean): number | null {
    const n = this.ring.length;
    for (let k = inclusive ? 0 : 1; k <= n; k++) {
      const i = (start + k) % n;
      if (this.needsToAct(this.ring[i])) return i;
    }
    return null;
  }

  private liveCount(): number {
    return this.ring.filter((p) => !p.folded).length;
  }

  private bySeat(seat: number): P {
    const p = this.ring.find((x) => x.seat === seat);
    if (!p) throw new Error(`seat ${seat} not in hand`);
    return p;
  }

  // ---------------------------------------------------------------- queries

  get toAct(): number | null {
    return this.toActIdx === null ? null : this.ring[this.toActIdx].seat;
  }

  get order(): number[] {
    return this.ring.map((p) => p.seat);
  }

  legal(seat: number): LegalActions | null {
    if (this.finished || this.toAct !== seat) return null;
    const p = this.bySeat(seat);
    const toCall = Math.max(0, this.currentBet - p.betStreet);
    const callAmount = Math.min(toCall, p.stack);
    const othersCanAct = this.ring.some((q) => q !== p && !q.folded && !q.allIn);
    const reopened = !p.acted || this.currentBet - p.lastLevel >= this.lastFullRaise;
    const maxTo = p.betStreet + p.stack;
    const canRaise = othersCanAct && reopened && maxTo > this.currentBet;
    const minFull = this.currentBet === 0 ? this.bb : this.currentBet + this.lastFullRaise;
    return {
      canFold: toCall > 0,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount,
      canRaise,
      raiseKind: this.currentBet === 0 ? 'bet' : 'raise',
      minTo: Math.min(minFull, maxTo),
      maxTo,
    };
  }

  // ---------------------------------------------------------------- actions

  act(seat: number, a: PlayerAction): void {
    const L = this.legal(seat);
    if (!L) throw new Error(`seat ${seat} cannot act now`);
    const p = this.bySeat(seat);
    const before = this.currentBet;
    let amount = 0;
    let raiseBy: number | undefined;
    switch (a.type) {
      case 'fold':
        if (!L.canFold) throw new Error('cannot fold when checking is free');
        p.folded = true;
        break;
      case 'check':
        if (!L.canCheck) throw new Error('cannot check facing a bet');
        break;
      case 'call':
        if (!L.canCall) throw new Error('nothing to call');
        amount = L.callAmount;
        break;
      case 'bet':
      case 'raise': {
        if (!L.canRaise) throw new Error('raising is not allowed');
        const to = a.to ?? L.minTo;
        if (!Number.isInteger(to)) throw new Error('bet must be a whole number of chips');
        if (to > L.maxTo) throw new Error(`cannot bet more than stack (${L.maxTo})`);
        if (to < L.minTo) throw new Error(`minimum is ${L.minTo}`);
        if (to <= this.currentBet) throw new Error('raise must exceed the current bet');
        amount = to - p.betStreet;
        raiseBy = to - before;
        // A bet or raise at least as big as the previous increment becomes the
        // new reference size; a short all-in leaves it unchanged.
        if (raiseBy >= this.lastFullRaise) this.lastFullRaise = raiseBy;
        this.currentBet = to;
        this.lastAggressor = p;
        break;
      }
    }
    p.stack -= amount;
    p.betStreet += amount;
    p.committed += amount;
    if (p.stack === 0 && !p.folded) p.allIn = true;
    p.acted = true;
    p.lastLevel = this.currentBet;
    const type = a.type === 'raise' && before === 0 ? 'bet' : a.type === 'bet' && before > 0 ? 'raise' : a.type;
    this.actions.push({ street: this.street, seat, type, amount, to: p.betStreet, allIn: p.allIn, potAfter: this.potTotal, raiseBy });

    if (this.liveCount() === 1) return this.finishUncontested();
    const next = this.findActor(this.toActIdx!, false);
    this.toActIdx = next;
    if (next === null) this.endStreet_();
  }

  /** Return chips a single player put in that nobody else matched. */
  private returnUncalled(): void {
    const sorted = [...this.ring].sort((a, b) => b.committed - a.committed);
    const top = sorted[0];
    const second = sorted[1]?.committed ?? 0;
    const excess = top.committed - second;
    if (excess > 0) {
      top.committed -= excess;
      top.betStreet = Math.max(0, top.betStreet - excess);
      top.stack += excess;
      if (top.stack > 0) top.allIn = false;
      this.actions.push({ street: this.street, seat: top.seat, type: 'uncalled', amount: -excess, to: top.betStreet, allIn: false, potAfter: this.potTotal });
    }
  }

  private dealBoard(k: number): void {
    const burn = this.deck.draw();
    this.dealt.push({ card: burn, kind: 'burn' });
    for (let i = 0; i < k; i++) {
      const c = this.deck.draw();
      this.board.push(c);
      this.dealt.push({ card: c, kind: 'board' });
    }
  }

  private endStreet_(): void {
    this.returnUncalled();
    for (const p of this.ring) {
      p.betStreet = 0;
      p.acted = false;
      p.lastLevel = 0;
    }
    this.currentBet = 0;
    this.lastFullRaise = this.bb;
    const canAct = this.ring.filter((p) => !p.folded && !p.allIn).length;
    const next = NEXT[this.street];
    if (next === null) return this.showdown();
    if (canAct <= 1) {
      // No more betting possible: table every live hand and run the board out.
      for (const p of this.ring) if (!p.folded) p.shown = [...p.hole];
      let s: Street | null = next;
      while (s) {
        this.street = s;
        this.dealBoard(s === 'flop' ? 3 : 1);
        s = NEXT[s];
      }
      return this.showdown();
    }
    this.street = next;
    this.lastAggressor = null;
    this.dealBoard(next === 'flop' ? 3 : 1);
    this.toActIdx = this.findActor(0, true);
    if (this.toActIdx === null) this.endStreet_();
  }

  private finishUncontested(): void {
    this.returnUncalled();
    const w = this.ring.find((p) => !p.folded)!;
    const amount = this.potTotal;
    this.pots = [{ amount, eligible: [w.seat] }];
    w.stack += amount;
    this.winners = [{ seat: w.seat, amount, potIndex: 0, hand: null }];
    this.endStreet = this.street;
    this.finish();
  }

  private showdown(): void {
    this.endStreet = 'river';
    this.showdownHappened = true;
    this.street = 'river';
    this.pots = buildPots(this.ring.map((p) => ({ seat: p.seat, committed: p.committed, folded: p.folded })));
    const live = this.ring.filter((p) => !p.folded);
    const score = new Map<number, number>(live.map((p) => [p.seat, evaluate([...p.hole, ...this.board])]));

    // Showdown order: river aggressor first, else first live player left of the button.
    const startIdx = this.lastAggressor && !this.lastAggressor.folded ? this.ring.indexOf(this.lastAggressor) : this.ring.findIndex((p) => !p.folded);
    const seq: P[] = [];
    for (let k = 0; k < this.ring.length; k++) {
      const p = this.ring[(startIdx + k) % this.ring.length];
      if (!p.folded) seq.push(p);
    }
    const bestShown = new Map<number, number>();
    for (const p of seq) {
      const s = score.get(p.seat)!;
      const myPots = this.pots.map((pot, i) => (pot.eligible.includes(p.seat) ? i : -1)).filter((i) => i >= 0);
      const canWin = myPots.some((i) => !bestShown.has(i) || s >= bestShown.get(i)!);
      if (p.shown || canWin || this.alwaysShow.has(p.seat)) {
        p.shown = [...p.hole];
        for (const i of myPots) bestShown.set(i, Math.max(bestShown.get(i) ?? -1, s));
      } else {
        p.mucked = true;
      }
    }
    const awards = awardPots(this.pots, (seat) => (this.bySeat(seat).mucked ? null : score.get(seat) ?? null), this.order);
    for (const a of awards) this.bySeat(a.seat).stack += a.amount;
    this.winners = awards.map((a) => ({ ...a, hand: describe(score.get(a.seat)!) }));
    this.finish();
  }

  private finish(): void {
    this.finished = true;
    this.toActIdx = null;
  }

  /** After the hand: a player may voluntarily show their cards. */
  show(seat: number): void {
    if (!this.finished) throw new Error('hand still running');
    const p = this.bySeat(seat);
    if (p.folded) throw new Error('folded hands cannot be shown');
    p.shown = [...p.hole];
    p.mucked = false;
  }

  // ---------------------------------------------------------------- views

  /**
   * Build a fresh view for `seat` (-1 for spectator). Contains only public
   * information plus that seat's own hole cards. Nothing in the returned
   * object references engine internals.
   */
  viewFor(seat: number): PlayerView {
    const seats: SeatView[] = this.ring.map((p) => ({
      seat: p.seat, playerId: p.playerId, name: p.name, stack: p.stack, betStreet: p.betStreet, committed: p.committed,
      folded: p.folded, allIn: p.allIn, inHand: true, shown: p.shown ? [...p.shown] : null, mucked: p.mucked,
    }));
    const me = this.ring.find((p) => p.seat === seat);
    return {
      handId: this.id,
      me: me ? seat : -1,
      hole: me ? [...me.hole] : null,
      board: [...this.board],
      street: this.street,
      button: this.button,
      sbSeat: this.sbSeat,
      bbSeat: this.bbSeat,
      sb: this.sb,
      bb: this.bb,
      ante: this.ante,
      seats,
      pot: this.potTotal,
      currentBet: this.currentBet,
      toAct: this.toAct,
      legal: me ? this.legal(seat) : null,
      actions: this.actions.map((a) => ({ ...a })),
      handOver: this.finished,
      pots: this.finished ? this.pots.map((p) => ({ amount: p.amount, eligible: [...p.eligible] })) : null,
      winners: this.finished ? this.winners.map((w) => ({ ...w })) : null,
      order: this.order,
    };
  }

  /** Final stacks by seat (only meaningful once finished). */
  stacks(): Map<number, number> {
    return new Map(this.ring.map((p) => [p.seat, p.stack]));
  }

  /** Complete record including every hole card. Only available after the hand. */
  history(): HandHistory {
    if (!this.finished) throw new Error('hand still running');
    return {
      handId: this.id, sb: this.sb, bb: this.bb, ante: this.ante, button: this.button, sbSeat: this.sbSeat, bbSeat: this.bbSeat,
      order: this.order,
      players: this.ring.map((p) => ({
        seat: p.seat, playerId: p.playerId, name: p.name, stackStart: p.stackStart, stackEnd: p.stack, hole: [...p.hole],
        folded: p.folded, shown: !!p.shown, mucked: p.mucked,
      })),
      board: [...this.board],
      actions: this.actions.map((a) => ({ ...a })),
      pots: this.pots.map((p) => ({ amount: p.amount, eligible: [...p.eligible] })),
      winners: this.winners.map((w) => ({ ...w })),
      dealt: this.dealt.map((d) => ({ ...d })),
      endStreet: this.endStreet,
      showdown: this.showdownHappened,
    };
  }
}
