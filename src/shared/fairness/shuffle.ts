import { type RandomSource, uniformInt } from './rng';

/**
 * In-place Fisher–Yates (Durstenfeld) shuffle.
 *
 * For i = n-1 down to 1 pick j uniform in [0, i] and swap a[i], a[j]. Each of
 * the n! permutations arises from exactly one sequence of choices
 * (n · (n-1) · ... · 2 = n! equally likely sequences), so the output is
 * uniform provided each j is uniform — which {@link uniformInt} guarantees.
 */
export function fisherYates<T>(a: T[], src: RandomSource): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = uniformInt(src, i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * The classic *wrong* shuffle (swap each position with any position). It has
 * n^n equally likely choice sequences, which cannot map evenly onto n!
 * permutations, so it is biased. Kept only so tests can prove the chi-squared
 * test is able to detect a biased shuffle.
 */
export function naiveBiasedShuffle<T>(a: T[], src: RandomSource): T[] {
  for (let i = 0; i < a.length; i++) {
    const j = uniformInt(src, a.length);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}
