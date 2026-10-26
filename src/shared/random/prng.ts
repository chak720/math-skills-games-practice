/**
 * Seedable PRNG for everything that is NOT dealing cards: bot decisions,
 * Monte Carlo simulations, puzzle parameters. xoshiro128** (Blackman & Vigna)
 * seeded via SplitMix32. Seedability makes puzzles reproducible from their
 * fingerprint and simulations repeatable in tests.
 */
import { cryptoRandomBytes } from '../fairness/rng';

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** FNV-1a 32-bit hash of a string; used to turn string seeds into numbers. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spare: number | null = null;

  constructor(seed?: number | string) {
    const s = seed === undefined ? new DataView(cryptoRandomBytes(4).buffer).getUint32(0) : typeof seed === 'string' ? hashString(seed) : seed;
    const sm = splitmix32(s);
    this.a = sm(); this.b = sm(); this.c = sm(); this.d = sm();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  nextUint32(): number {
    const result = Math.imul(((Math.imul(this.b, 5) << 7) | (Math.imul(this.b, 5) >>> 25)), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a; this.d ^= this.b; this.b ^= this.c; this.a ^= this.d;
    this.c ^= t;
    this.d = (this.d << 11) | (this.d >>> 21);
    return result;
  }

  /** Uniform float in [0, 1) with 32 bits of precision. */
  next(): number {
    return this.nextUint32() / 0x100000000;
  }

  /** Unbiased integer in [0, n). */
  int(n: number): number {
    if (n <= 1) return 0;
    const limit = Math.floor(0x100000000 / n) * n;
    let x = this.nextUint32();
    while (x >= limit) x = this.nextUint32();
    return x % n;
  }

  /** Integer in [lo, hi] inclusive. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  uniform(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Weighted pick; weights need not be normalised. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  sample<T>(arr: readonly T[], k: number): T[] {
    return this.shuffle([...arr]).slice(0, k);
  }

  /** Standard normal via Marsaglia polar method. */
  normal(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return mean + sd * v;
    }
    let u: number, v: number, s: number;
    do {
      u = 2 * this.next() - 1;
      v = 2 * this.next() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return mean + sd * u * m;
  }

  /** Log-normal with given median and log-space sigma: median * exp(N(0, sigma)). */
  logNormal(median: number, sigma: number): number {
    return median * Math.exp(this.normal(0, sigma));
  }
}
