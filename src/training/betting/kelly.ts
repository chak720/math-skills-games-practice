/** Kelly sizing, growth, path simulation and risk of ruin. */
import type { Rng } from '@/shared/random/prng';
import { quantile } from '@/shared/math/stats';

/** Optimal fraction for a bet that wins b per unit staked with probability p (loses the stake otherwise). */
export const kellyFraction = (p: number, b: number): number => Math.max(0, p - (1 - p) / b);

/** Expected log growth per bet when staking fraction f. −∞ if a loss would wipe you out. */
export function growth(f: number, p: number, b: number): number {
  if (f <= 0) return 0;
  if (f >= 1) return -Infinity;
  return p * Math.log1p(b * f) + (1 - p) * Math.log1p(-f);
}

/** Edge per unit staked: p·b − (1 − p). */
export const edge = (p: number, b: number): number => p * b - (1 - p);

/**
 * Probability that wealth ever falls to a fraction x of its starting value when betting c × Kelly,
 * in the continuous (small-edge) limit: x^(2/c − 1). For c ≥ 2 it is 1.
 */
export const drawdownProb = (x: number, c: number): number => (c >= 2 ? 1 : x ** (2 / c - 1));

/** Classic bankroll risk of ruin with drift μ and s.d. σ per unit time, starting bankroll B: exp(−2μB/σ²). */
export function riskOfRuin(mu: number, sigma: number, bankroll: number): number {
  if (mu <= 0) return 1;
  return Math.min(1, Math.exp((-2 * mu * bankroll) / (sigma * sigma)));
}

/** Bankroll needed for a target risk of ruin. */
export const bankrollFor = (mu: number, sigma: number, ror: number): number => (mu <= 0 ? Infinity : (-Math.log(ror) * sigma * sigma) / (2 * mu));

export interface SimResult {
  steps: number[];
  /** log10 wealth quantiles per checkpoint. */
  q05: number[];
  q25: number[];
  q50: number[];
  q75: number[];
  q95: number[];
  finalLog10: number[];
  pBelowStart: number;
  pHalved: number;
  pRuin: number;
  meanGrowth: number;
}

/** Simulate `paths` bankrolls staking fraction f of current wealth each bet. Ruin = below 1% of start. */
export function simulate(p: number, b: number, f: number, bets: number, paths: number, rng: Rng, checkpoints = 60): SimResult {
  const every = Math.max(1, Math.floor(bets / checkpoints));
  const steps: number[] = [];
  for (let s = 0; s <= bets; s += every) steps.push(s);
  if (steps.at(-1) !== bets) steps.push(bets);
  const snaps: Float64Array[] = steps.map(() => new Float64Array(paths));
  const final = new Float64Array(paths);
  let halved = 0, ruined = 0;
  const up = Math.log1p(b * f), down = f < 1 ? Math.log1p(-f) : -Infinity;
  for (let i = 0; i < paths; i++) {
    let lw = 0, wasHalved = false;
    let k = 0;
    for (let s = 0; s <= bets; s++) {
      if (s === steps[k]) snaps[k++][i] = lw / Math.LN10;
      if (s === bets) break;
      lw += rng.next() < p ? up : down;
      if (lw < Math.log(0.5) && !wasHalved) wasHalved = true;
      if (lw === -Infinity) {
        for (; k < steps.length; k++) snaps[k][i] = -Infinity;
        break;
      }
    }
    final[i] = lw / Math.LN10;
    if (wasHalved) halved++;
    if (lw < Math.log(0.01)) ruined++;
  }
  // Sort each checkpoint once; ruined paths sit at a floor of 10⁻⁶.
  const sorted = snaps.map((a) => Array.from(a, (x) => (x === -Infinity ? -6 : x)).sort((x, y) => x - y));
  const at = (q: number) => sorted.map((xs) => quantile(xs, q));
  const finite = Array.from(final, (x) => (x === -Infinity ? -6 : x));
  return {
    steps,
    q05: at(0.05),
    q25: at(0.25),
    q50: at(0.5),
    q75: at(0.75),
    q95: at(0.95),
    finalLog10: finite,
    pBelowStart: finite.filter((x) => x < 0).length / paths,
    pHalved: halved / paths,
    pRuin: ruined / paths,
    meanGrowth: (finite.reduce((s, x) => s + x, 0) / paths) * Math.LN10 / bets,
  };
}
