/**
 * Session-level table: seats, stacks, button movement, rebuys and the fair
 * deck for each hand. The table is the only place a FairDeck is created for
 * poker: one fresh committed seed per hand.
 */
import { FairDeck, type FairnessCommit, type FairnessReveal } from '@/shared/fairness/commit';
import { CryptoSource, uniformInt } from '@/shared/fairness/rng';
import { Hand, type HandHistory } from './hand';

export interface Occupant {
  playerId: string;
  name: string;
  stack: number;
  isHuman: boolean;
  sittingOut: boolean;
}

export interface TableConfig {
  maxSeats: number;
  sb: number;
  bb: number;
  ante: number;
  startingStack: number;
}

export interface HandRecord {
  history: HandHistory;
  reveal: FairnessReveal;
}

export class Table {
  readonly config: TableConfig;
  seats: (Occupant | null)[];
  button = -1;
  handNo = 0;
  private hand: Hand | null = null;
  private deck: FairDeck | null = null;

  constructor(config: TableConfig) {
    this.config = config;
    this.seats = new Array(config.maxSeats).fill(null);
  }

  sit(seat: number, o: Omit<Occupant, 'sittingOut'> & { sittingOut?: boolean }): void {
    if (this.seats[seat]) throw new Error(`seat ${seat} taken`);
    this.seats[seat] = { sittingOut: false, ...o };
  }

  leave(seat: number): Occupant | null {
    const o = this.seats[seat];
    this.seats[seat] = null;
    return o;
  }

  /** Seats that will be dealt into the next hand. */
  activeSeats(): number[] {
    return this.seats.flatMap((o, i) => (o && !o.sittingOut && o.stack > 0 ? [i] : []));
  }

  get current(): Hand | null {
    return this.hand;
  }

  get commit(): FairnessCommit | null {
    return this.deck?.info ?? null;
  }

  /** Moving button: next active seat clockwise. The first button is chosen at random. */
  private advanceButton(active: number[]): number {
    if (this.button < 0) return active[uniformInt(new CryptoSource(), active.length)];
    for (let k = 1; k <= this.config.maxSeats; k++) {
      const s = (this.button + k) % this.config.maxSeats;
      if (active.includes(s)) return s;
    }
    return active[0];
  }

  startHand(clientSeed: string, alwaysShow: number[] = []): Hand {
    if (this.hand && !this.hand.finished) throw new Error('hand in progress');
    const active = this.activeSeats();
    if (active.length < 2) throw new Error('need two players with chips');
    this.button = this.advanceButton(active);
    this.handNo++;
    this.deck = new FairDeck({ clientSeed, nonce: this.handNo });
    const deck = this.deck;
    this.hand = new Hand({
      handId: this.handNo,
      sb: this.config.sb,
      bb: this.config.bb,
      ante: this.config.ante,
      button: this.button,
      maxSeats: this.config.maxSeats,
      seats: active.map((s) => ({ seat: s, playerId: this.seats[s]!.playerId, name: this.seats[s]!.name, stack: this.seats[s]!.stack })),
      deck: { draw: () => deck.draw() },
      alwaysShow,
    });
    return this.hand;
  }

  /** Settle a finished hand: write stacks back and reveal the deck. */
  settle(): HandRecord {
    const h = this.hand;
    if (!h || !h.finished || !this.deck) throw new Error('no finished hand');
    for (const [seat, stack] of h.stacks()) if (this.seats[seat]) this.seats[seat]!.stack = stack;
    return { history: h.history(), reveal: this.deck.finish() };
  }

  rebuy(seat: number, amount = this.config.startingStack): void {
    const o = this.seats[seat];
    if (!o) return;
    o.stack = Math.max(o.stack, amount);
  }
}
