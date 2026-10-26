/** The Kelly game: a run of bet offers with known odds; you choose the stake, Kelly plays alongside on the same outcomes. */
import type { Rng } from '@/shared/random/prng';
import { edge, growth, kellyFraction } from './kelly';

export interface Offer {
  text: string;
  p: number;
  /** Net payout per unit staked on a win. */
  b: number;
}

const FRAC = (n: number, d: number) => n / d;

/** Offers with exactly known probabilities; a mix of good, marginal and bad bets. */
export function makeOffer(r: Rng): Offer {
  const kind = r.int(7);
  switch (kind) {
    case 0: {
      const pct = r.pick([51, 52, 55, 58, 60, 65, 70, 45]);
      const b = r.pick([1, 1, 1, 0.9, 1.2]);
      return { text: `A coin is known to land heads ${pct}% of the time. Heads pays ${fmtOdds(b)}.`, p: pct / 100, b };
    }
    case 1: {
      const b = r.pick([4, 5, 6, 7]);
      return { text: `Roll a fair die: a six pays ${fmtOdds(b)}.`, p: FRAC(1, 6), b };
    }
    case 2: {
      const [what, n] = r.pick([['a heart', 13], ['a face card (J, Q, K)', 12], ['an ace', 4], ['red', 26]] as [string, number][]);
      const fair = (52 - n) / n;
      const b = Math.round(fair * r.pick([0.8, 0.9, 1.1, 1.25, 1.5]) * 4) / 4;
      return { text: `Draw one card from a shuffled deck: ${what} pays ${fmtOdds(b)}.`, p: n / 52, b };
    }
    case 3: {
      const coins = r.pick([2, 3]);
      const p = 1 / 2 ** coins;
      const b = r.pick(coins === 2 ? [2, 3, 4, 5] : [5, 6, 8, 10]);
      return { text: `Flip ${coins} fair coins: all heads pays ${fmtOdds(b)}.`, p, b };
    }
    case 4: {
      const t = r.pick([7, 8, 9, 10, 11]);
      const ways = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
      let w = 0;
      for (let s = t; s <= 12; s++) w += ways[s];
      const p = w / 36;
      const b = Math.round(((1 - p) / p) * r.pick([0.85, 1.1, 1.3, 1.6]) * 4) / 4;
      return { text: `Roll two fair dice: a total of ${t} or more pays ${fmtOdds(b)}.`, p, b };
    }
    case 5: {
      const red = r.range(3, 7), blue = r.range(3, 7);
      const p = red / (red + blue);
      const b = Math.round(((1 - p) / p) * r.pick([0.9, 1.15, 1.4]) * 4) / 4;
      return { text: `An urn has ${red} red and ${blue} blue balls. Drawing red pays ${fmtOdds(b)}.`, p, b };
    }
    default: {
      const p = r.pick([0.3, 0.4, 0.5, 0.6]);
      const b = r.pick([2, 1.5, 1.2, 3]);
      return { text: `A trade wins ${b} for every 1 risked with probability ${Math.round(p * 100)}%, otherwise loses the stake.`, p, b };
    }
  }
}

export function fmtOdds(b: number): string {
  if (Number.isInteger(b)) return `${b} to 1`;
  const x = b * 4;
  if (Number.isInteger(x)) {
    const g = gcd(x, 4);
    return `${x / g} to ${4 / g}`;
  }
  return `${b.toFixed(2)} to 1`;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export interface Round {
  offer: Offer;
  /** Your stake as a fraction of bankroll. */
  f: number;
  won: boolean;
  kelly: number;
  /** Expected log growth you gave up relative to Kelly. */
  lost: number;
}

export interface Bankrolls {
  you: number;
  kelly: number;
  half: number;
  flat: number;
}

export const START = 1000;

export function settle(rolls: Bankrolls, o: Offer, f: number, won: boolean): Bankrolls {
  const k = kellyFraction(o.p, o.b);
  const move = (w: number, frac: number) => w * (won ? 1 + o.b * frac : 1 - frac);
  return { you: move(rolls.you, f), kelly: move(rolls.kelly, k), half: move(rolls.half, k / 2), flat: move(rolls.flat, edge(o.p, o.b) > 0 ? 0.1 : 0) };
}

export function roundFor(o: Offer, f: number, won: boolean): Round {
  const k = kellyFraction(o.p, o.b);
  return { offer: o, f, won, kelly: k, lost: growth(k, o.p, o.b) - growth(f, o.p, o.b) };
}

/** Skill score: your total expected log growth as a percentage of Kelly's (can be negative). */
export function skillScore(rounds: Round[]): number {
  const gk = rounds.reduce((s, r) => s + growth(r.kelly, r.offer.p, r.offer.b), 0);
  const gy = rounds.reduce((s, r) => s + growth(r.f, r.offer.p, r.offer.b), 0);
  if (gk <= 0) return 100;
  return Math.max(-200, Math.round((100 * gy) / gk));
}
