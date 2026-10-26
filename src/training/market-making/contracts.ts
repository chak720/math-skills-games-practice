/**
 * Contracts on hidden quantities. Each has components revealed one at a time;
 * `fair` gives the exact conditional mean and standard deviation of the
 * settlement value given which components are public.
 */
import type { Rng } from '@/shared/random/prng';

export type ContractKind = 'dice-sum' | 'card-sum' | 'coins' | 'dice-max';

export interface Contract {
  kind: ContractKind;
  /** Hidden draws, revealed in order. */
  parts: number[];
  title: string;
  description: string;
  /** Label for one component, e.g. "die". */
  unit: string;
}

export interface Fair {
  mean: number;
  sd: number;
}

const DIE = [1, 2, 3, 4, 5, 6];

export function makeContract(kind: ContractKind, r: Rng): Contract {
  switch (kind) {
    case 'dice-sum': {
      const n = r.range(4, 6);
      return { kind, parts: Array.from({ length: n }, () => r.range(1, 6)), title: `Sum of ${n} dice`, description: `${n} fair dice are rolled in secret. The contract settles at their total. One die is revealed after each round of quoting.`, unit: 'die' };
    }
    case 'card-sum': {
      const n = r.range(4, 5);
      const deck = Array.from({ length: 52 }, (_, i) => Math.floor(i / 4) + 1);
      return { kind, parts: r.sample(deck, n), title: `Sum of ${n} cards`, description: `${n} cards are dealt from a shuffled 52-card deck (ace = 1, jack = 11, queen = 12, king = 13). The contract settles at their total. One card is turned over after each round.`, unit: 'card' };
    }
    case 'coins': {
      const n = 20;
      return { kind, parts: Array.from({ length: 4 }, () => Array.from({ length: n / 4 }, (): number => (r.chance(0.5) ? 1 : 0)).reduce((a, b) => a + b, 0)), title: 'Heads in 20 coin flips', description: '20 fair coins are flipped in secret, in four batches of five. The contract settles at the number of heads. One batch is revealed after each round.', unit: 'batch' };
    }
    case 'dice-max': {
      const n = r.range(3, 4);
      return { kind, parts: Array.from({ length: n }, () => r.range(1, 6)), title: `Highest of ${n} dice × 10`, description: `${n} fair dice are rolled in secret. The contract settles at 10 × the highest die. One die is revealed after each round.`, unit: 'die' };
    }
  }
}

export const settlement = (c: Contract): number => value(c.kind, c.parts);

function value(kind: ContractKind, parts: number[]): number {
  if (kind === 'dice-max') return 10 * Math.max(...parts);
  return parts.reduce((a, b) => a + b, 0);
}

/** Exact conditional mean and s.d. of the settlement given the first `revealed` parts. */
export function fair(c: Contract, revealed: number): Fair {
  const shown = c.parts.slice(0, revealed);
  const m = c.parts.length - revealed;
  switch (c.kind) {
    case 'dice-sum': {
      const s = shown.reduce((a, b) => a + b, 0);
      return { mean: s + 3.5 * m, sd: Math.sqrt((35 / 12) * m) };
    }
    case 'coins': {
      const s = shown.reduce((a, b) => a + b, 0);
      return { mean: s + 2.5 * m, sd: Math.sqrt(1.25 * m) };
    }
    case 'card-sum': {
      // Remaining deck after removing the shown cards; m more drawn without replacement.
      const counts = new Array<number>(14).fill(4);
      counts[0] = 0; // index 0 is unused: ranks run 1–13
      for (const v of shown) counts[v]--;
      const N = counts.reduce((a, b) => a + b, 0);
      let mu = 0, sq = 0;
      for (let v = 1; v <= 13; v++) {
        mu += (v * counts[v]) / N;
        sq += (v * v * counts[v]) / N;
      }
      const varOne = sq - mu * mu;
      const s = shown.reduce((a, b) => a + b, 0);
      return { mean: s + m * mu, sd: Math.sqrt(m * varOne * (m > 0 && N > 1 ? (N - m) / (N - 1) : 0)) };
    }
    case 'dice-max': {
      // Enumerate the hidden dice.
      const base = shown.length ? Math.max(...shown) : 0;
      let e = 0, e2 = 0;
      const total = 6 ** m;
      const rec = (k: number, mx: number): void => {
        if (k === m) {
          const v = 10 * Math.max(base, mx);
          e += v / total;
          e2 += (v * v) / total;
          return;
        }
        for (const d of DIE) rec(k + 1, Math.max(mx, d));
      };
      rec(0, 0);
      return { mean: e, sd: Math.sqrt(Math.max(0, e2 - e * e)) };
    }
  }
}

/** Fair value as seen by someone who also knows the next `extra` hidden parts. */
export const insiderFair = (c: Contract, revealed: number, extra: number): Fair => fair(c, Math.min(c.parts.length, revealed + extra));

export function partLabel(c: Contract, v: number): string {
  if (c.kind === 'card-sum') return ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][v];
  if (c.kind === 'coins') return `${v} H`;
  return String(v);
}
