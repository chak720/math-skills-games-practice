/** Descriptive statistics and intervals used across the app. */
import { normalQuantile } from './special';

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: readonly number[]): number => (xs.length ? sum(xs) / xs.length : 0);

export function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
}

export const stddev = (xs: readonly number[]): number => Math.sqrt(variance(xs));

export function quantile(xs: readonly number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (xs: readonly number[]): number => quantile(xs, 0.5);

/**
 * Wilson score interval for a binomial proportion. Better than the normal
 * ("Wald") interval for small n or p near 0/1.
 */
export function wilson(successes: number, n: number, conf = 0.95): [number, number] {
  if (n === 0) return [0, 1];
  const z = normalQuantile(1 - (1 - conf) / 2);
  const p = successes / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Running mean/variance (Welford), numerically stable for long simulations. */
export class Welford {
  n = 0;
  mean = 0;
  private m2 = 0;
  push(x: number): void {
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.m2 += d * (x - this.mean);
  }
  get variance(): number {
    return this.n > 1 ? this.m2 / (this.n - 1) : 0;
  }
  get sd(): number {
    return Math.sqrt(this.variance);
  }
  /** Standard error of the mean. */
  get se(): number {
    return this.n > 0 ? this.sd / Math.sqrt(this.n) : 0;
  }
  ci(conf = 0.95): [number, number] {
    const z = normalQuantile(1 - (1 - conf) / 2);
    return [this.mean - z * this.se, this.mean + z * this.se];
  }
}

/** Least-squares slope of y on x (trend detection on dashboards). */
export function slope(ys: readonly number[], xs?: readonly number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const x = xs ?? ys.map((_, i) => i);
  const mx = mean(x), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (ys[i] - my);
    den += (x[i] - mx) * (x[i] - mx);
  }
  return den === 0 ? 0 : num / den;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
