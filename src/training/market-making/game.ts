/**
 * The market-making game. Each round you post a two-way price (bid < ask, width
 * capped). Counterparties arrive and trade one lot against your quote:
 *
 *  - Noise traders buy or sell at random; they trade less often against wide quotes.
 *  - Informed traders know some of the hidden parts (on hard, all of them) and
 *    only trade when your price is wrong relative to what they know.
 *  - Arbitrageurs know exactly what you could know (the public fair value) and
 *    pick off any quote that does not straddle it.
 *
 * Then one more part is revealed. At the end the contract settles and your
 * position is marked at the settlement value.
 */
import { Rng } from '@/shared/random/prng';
import { fair, insiderFair, makeContract, settlement, type Contract, type ContractKind } from './contracts';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type CounterpartyKind = 'noise' | 'informed' | 'arb';

export const COUNTERPARTY_LABEL: Record<CounterpartyKind, string> = { noise: 'Noise trader', informed: 'Informed trader', arb: 'Arbitrageur' };

export interface Trade {
  round: number;
  who: CounterpartyKind;
  /** +1: they bought from you (you sold at your ask). −1: they sold to you at your bid. */
  side: 1 | -1;
  price: number;
  /** Public fair value when the trade happened. */
  fairAt: number;
}

export interface RoundLog {
  round: number;
  bid: number;
  ask: number;
  fair: number;
  sd: number;
  trades: Trade[];
  positionAfter: number;
  /** Mark-to-fair P&L after the round (before the next reveal). */
  markPnl: number;
}

export interface GameState {
  seed: string;
  difficulty: Difficulty;
  contract: Contract;
  maxWidth: number;
  posLimit: number;
  round: number;
  revealed: number;
  cash: number;
  position: number;
  log: RoundLog[];
  done: boolean;
}

const ARRIVALS: Record<Difficulty, { n: number; mix: [number, number, number] }> = {
  easy: { n: 3, mix: [0.7, 0.15, 0.15] },
  normal: { n: 4, mix: [0.5, 0.3, 0.2] },
  hard: { n: 5, mix: [0.4, 0.35, 0.25] },
};
const WIDTH_FACTOR: Record<Difficulty, number> = { easy: 1, normal: 0.7, hard: 0.5 };
const KINDS: Record<Difficulty, ContractKind[]> = { easy: ['dice-sum', 'coins'], normal: ['dice-sum', 'card-sum', 'coins', 'dice-max'], hard: ['card-sum', 'dice-max', 'dice-sum'] };

const half = (x: number): number => Math.round(x * 2) / 2;

export function newGame(seed: string, difficulty: Difficulty, kind?: ContractKind): GameState {
  const r = new Rng(`${seed}:contract`);
  const contract = makeContract(kind ?? r.pick(KINDS[difficulty]), r);
  const sd0 = fair(contract, 0).sd;
  return { seed, difficulty, contract, maxWidth: Math.max(1, half(WIDTH_FACTOR[difficulty] * sd0)), posLimit: 10, round: 0, revealed: 0, cash: 0, position: 0, log: [], done: false };
}

export function validateQuote(g: GameState, bid: number, ask: number): string | null {
  if (!Number.isFinite(bid) || !Number.isFinite(ask)) return 'Enter a bid and an ask.';
  if (bid >= ask) return 'Your bid must be below your ask.';
  if (ask - bid > g.maxWidth + 1e-9) return `Your spread is ${ask - bid}; the maximum here is ${g.maxWidth}.`;
  return null;
}

/** Post a quote for the current round, let counterparties trade, then reveal the next part. */
export function quote(g: GameState, bid: number, ask: number): GameState {
  if (g.done) return g;
  const err = validateQuote(g, bid, ask);
  if (err) throw new Error(err);
  const r = new Rng(`${g.seed}:flow:${g.round}`);
  const f = fair(g.contract, g.revealed);
  const truth = settlement(g.contract);
  const spec = ARRIVALS[g.difficulty];
  let cash = g.cash, position = g.position;
  const trades: Trade[] = [];
  const width = ask - bid;
  for (let k = 0; k < spec.n; k++) {
    const who = r.weighted<CounterpartyKind>(['noise', 'informed', 'arb'], spec.mix);
    let side: 0 | 1 | -1 = 0;
    if (who === 'noise') {
      const keen = 0.85 * Math.max(0.15, 1 - width / (g.maxWidth * 1.6));
      if (r.chance(keen)) side = r.chance(0.5) ? 1 : -1;
    } else {
      const est = who === 'arb' ? f.mean : g.difficulty === 'hard' && r.chance(0.5) ? truth : insiderFair(g.contract, g.revealed, 1).mean;
      const edge = who === 'arb' ? 1e-9 : 0.25;
      if (ask < est - edge) side = 1;
      else if (bid > est + edge) side = -1;
    }
    if (side === 0) continue;
    // Respect the position limit: you are not filled beyond it.
    if (side === 1 && position - 1 < -g.posLimit) continue;
    if (side === -1 && position + 1 > g.posLimit) continue;
    const price = side === 1 ? ask : bid;
    position -= side;
    cash += side * price;
    trades.push({ round: g.round, who, side, price, fairAt: f.mean });
  }
  const entry: RoundLog = { round: g.round, bid, ask, fair: f.mean, sd: f.sd, trades, positionAfter: position, markPnl: cash + position * f.mean };
  const revealed = g.revealed + 1;
  const done = revealed >= g.contract.parts.length;
  return { ...g, round: g.round + 1, revealed, cash, position, log: [...g.log, entry], done };
}

export interface Review {
  settlement: number;
  pnl: number;
  /** Σ over trades of (price − fair)·side: what your quotes earned against the public fair value. */
  edge: number;
  /** P&L from the inventory you held while fair value moved. */
  inventory: number;
  byWho: Record<CounterpartyKind, { n: number; pnl: number }>;
  notes: string[];
}

export function review(g: GameState): Review {
  const v = settlement(g.contract);
  const trades = g.log.flatMap((l) => l.trades);
  const byWho: Review['byWho'] = { noise: { n: 0, pnl: 0 }, informed: { n: 0, pnl: 0 }, arb: { n: 0, pnl: 0 } };
  let edge = 0;
  for (const t of trades) {
    byWho[t.who].n++;
    byWho[t.who].pnl += t.side * (t.price - v);
    edge += t.side * (t.price - t.fairAt);
  }
  const pnl = g.cash + g.position * v;
  const notes: string[] = [];
  for (const l of g.log) {
    const mid = (l.bid + l.ask) / 2;
    const off = mid - l.fair;
    if (l.ask < l.fair || l.bid > l.fair) notes.push(`Round ${l.round + 1}: your quote ${l.bid} / ${l.ask} did not contain the fair value ${round2(l.fair)}, so an arbitrageur could ${l.ask < l.fair ? 'buy cheaply from you' : 'sell to you above value'}.`);
    else if (Math.abs(off) > 0.5 * l.sd && l.sd > 0) notes.push(`Round ${l.round + 1}: your mid ${mid} was ${Math.abs(round2(off))} ${off > 0 ? 'above' : 'below'} fair (${round2(l.fair)}).`);
  }
  const heavy = g.log.find((l) => Math.abs(l.positionAfter) >= 5);
  if (heavy) notes.push(`From round ${heavy.round + 1} you held ${heavy.positionAfter > 0 ? '+' : ''}${heavy.positionAfter} lots. Skew your quotes (lower both when long, raise both when short) to work inventory off.`);
  if (byWho.informed.n >= 2 && byWho.informed.pnl < 0) notes.push(`Informed traders took ${round2(-byWho.informed.pnl)} from you. When someone lifts your offer, it is evidence the value is higher: move your next quote up.`);
  if (!notes.length) notes.push('Clean round: your quotes straddled fair value throughout.');
  return { settlement: v, pnl, edge, inventory: pnl - edge, byWho, notes };
}

export const round2 = (x: number): number => Math.round(x * 100) / 100;
