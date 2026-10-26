/**
 * Equity of a hand against one or more opponents' weighted ranges.
 *
 * Monte Carlo: each trial samples a combo for every opponent from its
 * weights (rejecting card collisions), completes the board uniformly from the
 * remaining deck, and scores hero 1 for a win, 1/k for a k-way tie, 0 for a
 * loss. The estimate is the sample mean; we report its standard error and a
 * 95% normal interval (n is large, so the CLT applies).
 *
 * Exact enumeration is used when the number of runouts × combos is small.
 */
import type { Card } from '@/shared/cards/card';
import { Rng } from '@/shared/random/prng';
import { evaluate } from '../eval/evaluator';
import { COMBO_A, COMBO_B, NUM_COMBOS } from '../ranges/combos';

export interface EquityResult {
  equity: number;
  win: number;
  tie: number;
  n: number;
  se: number;
  ci: [number, number];
  exact: boolean;
}

/** Cumulative sampler over combos compatible with dead cards. */
class ComboSampler {
  readonly ids: Int32Array;
  readonly cdf: Float64Array;
  readonly total: number;
  constructor(weights: ArrayLike<number>, dead: Uint8Array) {
    const ids: number[] = [];
    const cum: number[] = [];
    let t = 0;
    for (let k = 0; k < NUM_COMBOS; k++) {
      const w = weights[k];
      if (w > 0 && !dead[COMBO_A[k]] && !dead[COMBO_B[k]]) {
        t += w;
        ids.push(k);
        cum.push(t);
      }
    }
    this.ids = Int32Array.from(ids);
    this.cdf = Float64Array.from(cum);
    this.total = t;
  }
  sample(rng: Rng): number {
    const x = rng.next() * this.total;
    let lo = 0, hi = this.cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cdf[mid] > x) hi = mid;
      else lo = mid + 1;
    }
    return this.ids[lo];
  }
}

export function equityMC(
  hero: readonly Card[],
  board: readonly Card[],
  opponents: readonly ArrayLike<number>[],
  iterations: number,
  rng: Rng = new Rng(),
): EquityResult {
  const dead = new Uint8Array(52);
  for (const c of [...hero, ...board]) dead[c] = 1;
  const samplers = opponents.map((w) => new ComboSampler(w, dead));
  if (samplers.some((s) => s.total <= 0)) return { equity: 1, win: 1, tie: 0, n: 0, se: 0, ci: [1, 1], exact: true };
  const need = 5 - board.length;
  const seven = new Int32Array(7);
  for (let i = 0; i < board.length; i++) seven[i] = board[i];
  const used = new Uint8Array(52);
  const oppCards = new Int32Array(opponents.length * 2);
  let sum = 0, sumSq = 0, wins = 0, ties = 0, n = 0;
  const deckBuf = new Int32Array(52);
  for (let it = 0; it < iterations; it++) {
    used.set(dead);
    // Sample opponents' hands without collisions.
    let ok = true;
    for (let o = 0; o < samplers.length; o++) {
      let tries = 0, k: number;
      do {
        k = samplers[o].sample(rng);
        tries++;
      } while ((used[COMBO_A[k]] || used[COMBO_B[k]]) && tries < 50);
      if (used[COMBO_A[k]] || used[COMBO_B[k]]) { ok = false; break; }
      used[COMBO_A[k]] = 1;
      used[COMBO_B[k]] = 1;
      oppCards[2 * o] = COMBO_A[k];
      oppCards[2 * o + 1] = COMBO_B[k];
    }
    if (!ok) continue;
    let m = 0;
    for (let c = 0; c < 52; c++) if (!used[c]) deckBuf[m++] = c;
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(m - i);
      const t = deckBuf[i]; deckBuf[i] = deckBuf[j]; deckBuf[j] = t;
      seven[board.length + i] = deckBuf[i];
    }
    seven[5] = hero[0];
    seven[6] = hero[1];
    const me = evaluate(seven);
    let best = -1, nBest = 0;
    for (let o = 0; o < samplers.length; o++) {
      seven[5] = oppCards[2 * o];
      seven[6] = oppCards[2 * o + 1];
      const v = evaluate(seven);
      if (v > best) { best = v; nBest = 1; } else if (v === best) nBest++;
    }
    let x = 0;
    if (me > best) { x = 1; wins++; } else if (me === best) { x = 1 / (nBest + 1); ties++; }
    sum += x;
    sumSq += x * x;
    n++;
  }
  const mean = n ? sum / n : 0;
  const variance = n > 1 ? (sumSq - n * mean * mean) / (n - 1) : 0;
  const se = n ? Math.sqrt(Math.max(0, variance) / n) : 0;
  return { equity: mean, win: n ? wins / n : 0, tie: n ? ties / n : 0, n, se, ci: [Math.max(0, mean - 1.96 * se), Math.min(1, mean + 1.96 * se)], exact: false };
}

/** Every completion of the board from the remaining deck. */
function* runouts(dead: Uint8Array, need: number): Generator<number[]> {
  const rest: number[] = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) rest.push(c);
  const idx = Array.from({ length: need }, (_, i) => i);
  if (need === 0) {
    yield [];
    return;
  }
  while (true) {
    yield idx.map((i) => rest[i]);
    let i = need - 1;
    while (i >= 0 && idx[i] === rest.length - need + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < need; j++) idx[j] = idx[j - 1] + 1;
  }
}

/** Exact equity of hero vs a weighted range by full enumeration (use when cheap). */
export function equityExact(hero: readonly Card[], board: readonly Card[], villain: ArrayLike<number>): EquityResult {
  const dead = new Uint8Array(52);
  for (const c of [...hero, ...board]) dead[c] = 1;
  let wSum = 0, eqSum = 0, winSum = 0, tieSum = 0;
  const need = 5 - board.length;
  const seven = new Int32Array(7);
  for (let k = 0; k < NUM_COMBOS; k++) {
    const w = villain[k];
    if (!(w > 0)) continue;
    const a = COMBO_A[k], b = COMBO_B[k];
    if (dead[a] || dead[b]) continue;
    dead[a] = dead[b] = 1;
    let cnt = 0, eq = 0, win = 0, tie = 0;
    for (const ro of runouts(dead, need)) {
      const full = [...board, ...ro];
      for (let i = 0; i < 5; i++) seven[i] = full[i];
      seven[5] = hero[0]; seven[6] = hero[1];
      const me = evaluate(seven);
      seven[5] = a; seven[6] = b;
      const v = evaluate(seven);
      cnt++;
      if (me > v) { eq += 1; win++; } else if (me === v) { eq += 0.5; tie++; }
    }
    dead[a] = dead[b] = 0;
    wSum += w;
    eqSum += (w * eq) / cnt;
    winSum += (w * win) / cnt;
    tieSum += (w * tie) / cnt;
  }
  const e = wSum ? eqSum / wSum : 0;
  return { equity: e, win: wSum ? winSum / wSum : 0, tie: wSum ? tieSum / wSum : 0, n: 0, se: 0, ci: [e, e], exact: true };
}

/** Rough cost (evaluations) of exact enumeration, to decide between exact and MC. */
export function exactCost(board: readonly Card[], liveCombos: number): number {
  const remaining = 52 - 2 - board.length - 2;
  const need = 5 - board.length;
  let runs = 1;
  for (let i = 0; i < need; i++) runs = (runs * (remaining - i)) / (i + 1);
  return runs * liveCombos * 2;
}

/** Convenience: exact when affordable, otherwise Monte Carlo with `iterations`. */
export function equityAuto(hero: readonly Card[], board: readonly Card[], villain: ArrayLike<number>, iterations = 20000, budget = 3e6, rng?: Rng): EquityResult {
  let live = 0;
  const dead = new Set([...hero, ...board]);
  for (let k = 0; k < NUM_COMBOS; k++) if (villain[k] > 0 && !dead.has(COMBO_A[k]) && !dead.has(COMBO_B[k])) live++;
  return exactCost(board, live) <= budget ? equityExact(hero, board, villain) : equityMC(hero, board, [villain], iterations, rng);
}
