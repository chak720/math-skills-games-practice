/** Exact combinatorics on BigInt, plus fast float versions for hot paths. */
import { Q } from './rational';

const factCache: bigint[] = [1n];
export function factorial(n: number): bigint {
  if (n < 0) throw new RangeError('negative factorial');
  for (let i = factCache.length; i <= n; i++) factCache[i] = factCache[i - 1] * BigInt(i);
  return factCache[n];
}

export function choose(n: number, k: number): bigint {
  if (k < 0 || n < 0 || k > n) return 0n;
  k = Math.min(k, n - k);
  let r = 1n;
  for (let i = 1; i <= k; i++) r = (r * BigInt(n - k + i)) / BigInt(i);
  return r;
}

/** C(n, k) as a float; exact for results below 2^53. */
export function chooseF(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

export function fallingFactorial(n: number, k: number): bigint {
  let r = 1n;
  for (let i = 0; i < k; i++) r *= BigInt(n - i);
  return r;
}

export function multinomial(counts: readonly number[]): bigint {
  const total = counts.reduce((a, b) => a + b, 0);
  return counts.reduce((acc, c) => acc / factorial(c), factorial(total));
}

/** Derangements !n via !n = (n−1)(!(n−1) + !(n−2)). */
export function derangements(n: number): bigint {
  if (n === 0) return 1n;
  if (n === 1) return 0n;
  let a = 1n, b = 0n;
  for (let i = 2; i <= n; i++) [a, b] = [b, BigInt(i - 1) * (a + b)];
  return b;
}

/** Stirling numbers of the second kind S(n, k) by the recurrence S(n,k) = k S(n−1,k) + S(n−1,k−1). */
export function stirling2(n: number, k: number): bigint {
  const S: bigint[][] = Array.from({ length: n + 1 }, () => new Array<bigint>(k + 1).fill(0n));
  S[0][0] = 1n;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= Math.min(i, k); j++) S[i][j] = BigInt(j) * S[i - 1][j] + S[i - 1][j - 1];
  return S[n][k];
}

/** Exact binomial pmf C(n,k) p^k (1−p)^(n−k). */
export function binomialPmf(n: number, k: number, p: Q): Q {
  return Q.of(choose(n, k)).mul(p.pow(k)).mul(Q.ONE.sub(p).pow(n - k));
}

/** Exact hypergeometric pmf: k successes in a draw of size n from N with K successes. */
export function hypergeomPmf(N: number, K: number, n: number, k: number): Q {
  return new Q(choose(K, k) * choose(N - K, n - k), choose(N, n));
}

export function gcdNum(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

export const lcmNum = (a: number, b: number): number => (a / gcdNum(a, b)) * b;

/** All k-subsets of [0, n) (lexicographic). Fine for small n. */
export function* combinations(n: number, k: number): Generator<number[]> {
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > n) return;
  while (true) {
    yield [...idx];
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/** All permutations of an array (Heap's algorithm). */
export function* permutations<T>(arr: readonly T[]): Generator<T[]> {
  const a = [...arr];
  const c = new Array<number>(a.length).fill(0);
  yield [...a];
  let i = 0;
  while (i < a.length) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [a[j], a[i]] = [a[i], a[j]];
      yield [...a];
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}
