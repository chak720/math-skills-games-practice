/**
 * Statistical uniformity tests for shuffles.
 *
 * Position test: shuffle an n-card deck T times and count how often card c
 * lands in position p. Under a uniform shuffle each cell is Multinomial with
 * probability 1/n, expected E = T/n. Pearson's statistic
 *     X² = Σ_c Σ_p (O_cp − E)² / E
 * on the n×n table has (n−1)² degrees of freedom (each row and each column
 * sums to T, which removes 2n−1 constraints from n² cells). We report the
 * upper-tail p-value from the χ² distribution.
 */
import { chiSquaredSurvival } from '../math/special';

export interface PositionTestResult {
  n: number;
  trials: number;
  counts: number[][]; // counts[card][position]
  stat: number;
  df: number;
  pValue: number;
  /** Largest |standardised residual| (O−E)/√E over all cells. */
  maxAbsResidual: number;
}

export function positionTest(n: number, trials: number, shuffleOnce: () => readonly number[]): PositionTestResult {
  const counts = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let t = 0; t < trials; t++) {
    const order = shuffleOnce();
    for (let p = 0; p < n; p++) counts[order[p]][p]++;
  }
  return summarisePositionCounts(counts, trials);
}

export function summarisePositionCounts(counts: number[][], trials: number): PositionTestResult {
  const n = counts.length;
  const E = trials / n;
  let stat = 0;
  let maxAbsResidual = 0;
  for (let c = 0; c < n; c++)
    for (let p = 0; p < n; p++) {
      const d = counts[c][p] - E;
      stat += (d * d) / E;
      maxAbsResidual = Math.max(maxAbsResidual, Math.abs(d) / Math.sqrt(E));
    }
  const df = (n - 1) * (n - 1);
  return { n, trials, counts, stat, df, pValue: chiSquaredSurvival(stat, df), maxAbsResidual };
}

/** Plain goodness-of-fit against equal cell probabilities (df = k − 1). */
export function uniformGoodnessOfFit(counts: readonly number[]): { stat: number; df: number; pValue: number } {
  const total = counts.reduce((a, b) => a + b, 0);
  const E = total / counts.length;
  const stat = counts.reduce((s, o) => s + ((o - E) * (o - E)) / E, 0);
  const df = counts.length - 1;
  return { stat, df, pValue: chiSquaredSurvival(stat, df) };
}
