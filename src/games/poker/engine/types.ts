/**
 * Public types of the poker engine. `PlayerView` is the ONLY thing a bot (or
 * the UI) is ever given: it is built fresh for each request from public
 * information plus the viewer's own hole cards. Bots import nothing else from
 * the engine — enforced by an import-boundary test.
 */
import type { Card } from '@/shared/cards/card';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';
/** Engine-generated entries: blinds/antes and uncalled chips returned. */
export type PostType = 'post-sb' | 'post-bb' | 'post-ante' | 'uncalled';

/** What a player submits. For bet/raise `to` is the new total street bet. */
export interface PlayerAction {
  type: ActionType;
  to?: number;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call (capped by stack). */
  callAmount: number;
  canRaise: boolean;
  /** 'bet' when nobody has bet this street, else 'raise'. */
  raiseKind: 'bet' | 'raise';
  /** Minimum legal raise-to (or all-in if less). */
  minTo: number;
  /** All-in raise-to. */
  maxTo: number;
}

/** One entry of the public action log. */
export interface ActionRecord {
  street: Street;
  seat: number;
  type: ActionType | PostType;
  /** Chips moved into the pot by this action. */
  amount: number;
  /** Player's total street bet after the action. */
  to: number;
  allIn: boolean;
  /** Pot (all chips committed) after the action. */
  potAfter: number;
  /** For raises: the raise increment over the previous bet level. */
  raiseBy?: number;
}

export interface SeatView {
  seat: number;
  playerId: string;
  name: string;
  stack: number;
  /** Chips committed on the current street. */
  betStreet: number;
  /** Chips committed in total this hand. */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** Dealt into this hand. */
  inHand: boolean;
  /** Cards shown face up (all-in run-outs, showdown, voluntary shows); otherwise null. */
  shown: Card[] | null;
  /** Mucked at showdown (cards stay hidden). */
  mucked: boolean;
}

export interface PotView {
  amount: number;
  eligible: number[];
}

export interface WinnerView {
  seat: number;
  amount: number;
  potIndex: number;
  /** Description of the winning hand when shown, e.g. "Two pair, Kings and Sevens". */
  hand: string | null;
}

export interface PlayerView {
  handId: number;
  /** The viewer's seat (or -1 for a pure spectator view). */
  me: number;
  /** Viewer's own hole cards only. */
  hole: Card[] | null;
  board: Card[];
  street: Street;
  button: number;
  sbSeat: number;
  bbSeat: number;
  sb: number;
  bb: number;
  ante: number;
  seats: SeatView[];
  /** Total chips in the middle including current-street bets. */
  pot: number;
  currentBet: number;
  toAct: number | null;
  /** Present only when the viewer is the player to act. */
  legal: LegalActions | null;
  actions: ActionRecord[];
  handOver: boolean;
  pots: PotView[] | null;
  winners: WinnerView[] | null;
  /** Seat order clockwise starting left of the button (SB first except heads-up). */
  order: number[];
}
