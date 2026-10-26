/**
 * Blackjack table engine (US rules: dealer takes a hole card and peeks for
 * blackjack with an ace or ten up). The shoe is a committed FairDeck; the
 * dealer follows fixed house rules only. Seats see a public view: every
 * player card is dealt face up (as in shoe games), plus the dealer's upcard
 * and any revealed dealer cards.
 */
import type { Card } from '@/shared/cards/card';
import { FairDeck, type FairnessCommit, type FairnessReveal } from '@/shared/fairness/commit';
import { type BJRules, canDoubleTotal, handValue, isNatural, valueOf } from './rules';

export type BJMove = 'hit' | 'stand' | 'double' | 'split' | 'surrender';
export type HandResult = 'win' | 'lose' | 'push' | 'blackjack' | 'surrender' | 'bust';

export interface BJHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  done: boolean;
  surrendered: boolean;
  result: HandResult | null;
  net: number;
}

export interface BJSeat {
  id: string;
  name: string;
  isHuman: boolean;
  bankroll: number;
  hands: BJHand[];
  insurance: number;
  /** Insurance decision taken this round (null = not asked yet). */
  insured: boolean | null;
}

export type Phase = 'idle' | 'insurance' | 'player' | 'dealer' | 'done';

export interface BJLegal {
  hit: boolean;
  stand: boolean;
  double: boolean;
  split: boolean;
  surrender: boolean;
}

export interface BJView {
  rules: BJRules;
  me: number;
  phase: Phase;
  /** Seat slots in table order (null = empty). */
  seats: ({ id: string; name: string; isHuman: boolean; bankroll: number; insurance: number; hands: BJHand[] } | null)[];
  dealer: Card[];
  dealerUp: Card | null;
  holeRevealed: boolean;
  turn: { seat: number; hand: number } | null;
  legal: BJLegal | null;
  /** Every card seen face up since the shuffle (for counting and composition). */
  seen: Card[];
  cardsRemaining: number;
  shoeSize: number;
  roundNo: number;
}

/** What the table needs from a shoe. Production always uses a committed FairDeck. */
export interface Shoe {
  readonly info: FairnessCommit;
  readonly size: number;
  readonly remaining: number;
  readonly dealtCount: number;
  draw(): Card;
  finish(): FairnessReveal;
}
export type ShoeFactory = (clientSeed: string, nonce: number, decks: number) => Shoe;
const fairShoe: ShoeFactory = (clientSeed, nonce, decks) => new FairDeck({ clientSeed, nonce, decks });

export class BJTable {
  rules: BJRules;
  seats: (BJSeat | null)[];
  phase: Phase = 'idle';
  dealer: Card[] = [];
  holeRevealed = false;
  turn: { seat: number; hand: number } | null = null;
  seen: Card[] = [];
  roundNo = 0;
  shoeNo = 0;
  private shoe!: Shoe;
  private cutAt = 0;
  lastReveal: FairnessReveal | null = null;
  /** Card positions observed per shoe (for verification of the current shoe). */
  dealtThisShoe: Card[] = [];

  constructor(rules: BJRules, seatCount: number, private clientSeed: string, private makeShoe: ShoeFactory = fairShoe) {
    this.rules = rules;
    this.seats = new Array(seatCount).fill(null);
    this.newShoe(clientSeed);
  }

  get commit(): FairnessCommit {
    return this.shoe.info;
  }

  get cardsRemaining(): number {
    return this.shoe.remaining;
  }

  get shoeSize(): number {
    return this.shoe.size;
  }

  get needsShuffle(): boolean {
    return this.shoe.dealtCount >= this.cutAt;
  }

  /** Finish the current shoe (reveal it) and start a new committed one. */
  newShoe(clientSeed = this.clientSeed): FairnessReveal | null {
    if (this.phase !== 'idle' && this.phase !== 'done') throw new Error('round in progress');
    this.clientSeed = clientSeed;
    const prev = this.shoe ? this.shoe.finish() : null;
    if (prev) this.lastReveal = prev;
    this.shoeNo++;
    this.shoe = this.makeShoe(clientSeed, this.shoeNo, this.rules.decks);
    this.cutAt = Math.floor(this.shoe.size * this.rules.penetration);
    this.seen = [];
    this.dealtThisShoe = [];
    this.draw(false); // burn card, unseen
    return prev;
  }

  private draw(visible: boolean): Card {
    const c = this.shoe.draw();
    this.dealtThisShoe.push(c);
    if (visible) this.seen.push(c);
    return c;
  }

  sit(i: number, s: Omit<BJSeat, 'hands' | 'insurance' | 'insured'>): void {
    this.seats[i] = { ...s, hands: [], insurance: 0, insured: null };
  }

  leave(i: number): void {
    this.seats[i] = null;
  }

  // ------------------------------------------------------------ round flow

  startRound(bets: Record<number, number>, clientSeed = this.clientSeed): void {
    if (this.phase !== 'idle' && this.phase !== 'done') throw new Error('round in progress');
    if (this.needsShuffle) this.newShoe(clientSeed);
    this.roundNo++;
    this.dealer = [];
    this.holeRevealed = false;
    this.turn = null;
    const playing: number[] = [];
    this.seats.forEach((s, i) => {
      if (!s) return;
      s.hands = [];
      s.insurance = 0;
      s.insured = null;
      const b = bets[i] ?? 0;
      if (b > 0) {
        s.hands = [{ cards: [], bet: b, doubled: false, fromSplit: false, splitAces: false, done: false, surrendered: false, result: null, net: 0 }];
        playing.push(i);
      }
    });
    if (!playing.length) throw new Error('no bets');
    for (let k = 0; k < 2; k++) {
      for (const i of playing) this.seats[i]!.hands[0].cards.push(this.draw(true));
      this.dealer.push(this.draw(k === 0)); // hole card stays hidden
    }
    for (const i of playing) {
      const h = this.seats[i]!.hands[0];
      if (isNatural(h.cards)) h.done = true;
    }
    const up = valueOf(this.dealer[0]);
    if (up === 1) this.phase = 'insurance';
    else this.afterInsurance();
  }

  get upValue(): number {
    return valueOf(this.dealer[0]);
  }

  /** Players who still have to answer the insurance question. */
  insurancePending(): number[] {
    return this.seats.flatMap((s, i) => (s && s.hands.length && s.insured === null ? [i] : []));
  }

  decideInsurance(seat: number, take: boolean): void {
    if (this.phase !== 'insurance') throw new Error('insurance not offered');
    const s = this.seats[seat]!;
    s.insured = take;
    s.insurance = take ? s.hands[0].bet / 2 : 0;
    if (this.insurancePending().length === 0) this.afterInsurance();
  }

  private afterInsurance(): void {
    const up = this.upValue;
    if ((up === 1 || up === 10) && isNatural(this.dealer)) {
      this.revealHole();
      this.settle();
      return;
    }
    this.phase = 'player';
    this.turn = null;
    this.advance();
  }

  private revealHole(): void {
    if (!this.holeRevealed) {
      this.holeRevealed = true;
      this.seen.push(this.dealer[1]);
    }
  }

  /** Move `turn` to the next hand that needs a decision. */
  private advance(): void {
    let si = this.turn?.seat ?? -1;
    let hi = this.turn ? this.turn.hand : -1;
    while (true) {
      const s = si >= 0 ? this.seats[si] : null;
      if (s && hi + 1 < s.hands.length) {
        hi++;
      } else {
        si++;
        hi = 0;
        while (si < this.seats.length && !(this.seats[si]?.hands.length)) si++;
        if (si >= this.seats.length) {
          this.turn = null;
          this.phase = 'dealer';
          this.revealHole();
          return;
        }
      }
      const h = this.seats[si]!.hands[hi];
      if (h.cards.length === 1) {
        // Second card for a split hand arrives when its turn comes.
        h.cards.push(this.draw(true));
        if (h.splitAces && !(this.rules.resplitAces && valueOf(h.cards[1]) === 1 && this.seats[si]!.hands.length < this.rules.maxHands) && !this.rules.hitSplitAces) h.done = true;
        if (handValue(h.cards).total === 21) h.done = true;
      }
      if (!h.done) {
        this.turn = { seat: si, hand: hi };
        return;
      }
    }
  }

  legal(seat: number): BJLegal | null {
    if (this.phase !== 'player' || !this.turn || this.turn.seat !== seat) return null;
    const s = this.seats[seat]!;
    const h = s.hands[this.turn.hand];
    const two = h.cards.length === 2;
    const v = handValue(h.cards);
    const pair = two && valueOf(h.cards[0]) === valueOf(h.cards[1]);
    const aces = pair && valueOf(h.cards[0]) === 1;
    const splitAcesLocked = h.splitAces && !this.rules.hitSplitAces;
    return {
      hit: !splitAcesLocked,
      stand: true,
      double: two && !splitAcesLocked && canDoubleTotal(this.rules, v.total) && (!h.fromSplit || this.rules.das),
      split: pair && s.hands.length < this.rules.maxHands && (!h.fromSplit || !aces || this.rules.resplitAces),
      surrender: this.rules.surrender && two && !h.fromSplit && s.hands.length === 1,
    };
  }

  act(seat: number, move: BJMove): void {
    const L = this.legal(seat);
    if (!L || !L[move]) throw new Error(`illegal ${move}`);
    const s = this.seats[seat]!;
    const hi = this.turn!.hand;
    const h = s.hands[hi];
    switch (move) {
      case 'hit': {
        h.cards.push(this.draw(true));
        const t = handValue(h.cards).total;
        if (t >= 21) h.done = true;
        break;
      }
      case 'stand':
        h.done = true;
        break;
      case 'double':
        h.bet *= 2;
        h.doubled = true;
        h.cards.push(this.draw(true));
        h.done = true;
        break;
      case 'surrender':
        h.surrendered = true;
        h.done = true;
        break;
      case 'split': {
        const aces = valueOf(h.cards[0]) === 1;
        const second: BJHand = { cards: [h.cards[1]], bet: h.bet, doubled: false, fromSplit: true, splitAces: aces, done: false, surrendered: false, result: null, net: 0 };
        h.cards = [h.cards[0]];
        h.fromSplit = true;
        h.splitAces = aces;
        s.hands.splice(hi + 1, 0, second);
        h.cards.push(this.draw(true));
        if (aces && !this.rules.hitSplitAces && !(this.rules.resplitAces && valueOf(h.cards[1]) === 1 && s.hands.length < this.rules.maxHands)) h.done = true;
        if (handValue(h.cards).total === 21) h.done = true;
        break;
      }
    }
    if (h.done) this.advance();
  }

  /** Does the dealer need to draw (any live hand still to beat)? */
  private dealerMustPlay(): boolean {
    return this.seats.some((s) => s?.hands.some((h) => !h.surrendered && handValue(h.cards).total <= 21 && !(isNatural(h.cards) && !h.fromSplit)));
  }

  /** One dealer step: returns true if a card was drawn, false when the dealer is finished. */
  dealerStep(): boolean {
    if (this.phase !== 'dealer') return false;
    this.revealHole();
    if (!this.dealerMustPlay()) return false;
    const v = handValue(this.dealer);
    const soft17 = v.total === 17 && v.soft;
    if (v.total < 17 || (soft17 && this.rules.h17)) {
      this.dealer.push(this.draw(true));
      return true;
    }
    return false;
  }

  /** Play out the dealer and settle. */
  finishDealer(): void {
    while (this.dealerStep()) {
      /* draw */
    }
    this.settle();
  }

  private settle(): void {
    this.revealHole();
    const d = handValue(this.dealer);
    const dealerBJ = isNatural(this.dealer);
    for (const s of this.seats) {
      if (!s?.hands.length) continue;
      let roundNet = 0;
      if (s.insurance) roundNet += dealerBJ ? 2 * s.insurance : -s.insurance;
      for (const h of s.hands) {
        const v = handValue(h.cards);
        const natural = isNatural(h.cards) && !h.fromSplit;
        if (h.surrendered) [h.result, h.net] = ['surrender', -h.bet / 2];
        else if (dealerBJ) [h.result, h.net] = natural ? ['push', 0] : ['lose', -h.bet];
        else if (v.total > 21) [h.result, h.net] = ['bust', -h.bet];
        else if (natural) [h.result, h.net] = ['blackjack', h.bet * this.rules.bjPays];
        else if (d.total > 21 || v.total > d.total) [h.result, h.net] = ['win', h.bet];
        else if (v.total < d.total) [h.result, h.net] = ['lose', -h.bet];
        else [h.result, h.net] = ['push', 0];
        h.done = true;
        roundNet += h.net;
      }
      s.bankroll += roundNet;
    }
    this.phase = 'done';
    this.turn = null;
  }

  view(me: number): BJView {
    return {
      rules: this.rules,
      me,
      phase: this.phase,
      seats: this.seats.map((s) => (s ? { id: s.id, name: s.name, isHuman: s.isHuman, bankroll: s.bankroll, insurance: s.insurance, hands: s.hands.map((h) => ({ ...h, cards: [...h.cards] })) } : null)),
      dealer: this.holeRevealed ? [...this.dealer] : this.dealer.slice(0, 1),
      dealerUp: this.dealer[0] ?? null,
      holeRevealed: this.holeRevealed,
      turn: this.turn ? { ...this.turn } : null,
      legal: this.legal(me),
      seen: [...this.seen],
      cardsRemaining: this.shoe.remaining,
      shoeSize: this.shoe.size,
      roundNo: this.roundNo,
    };
  }
}
