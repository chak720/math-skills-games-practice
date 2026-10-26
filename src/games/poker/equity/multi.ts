/**
 * Multi-player equity where each player holds either specific cards or a
 * weighted range. Exact enumeration of boards when every player has specific
 * cards and the work is small; Monte Carlo otherwise (with standard errors).
 */
import type { Card } from '@/shared/cards/card';
import { Rng } from '@/shared/random/prng';
import { evaluate } from '../eval/evaluator';
import { COMBO_A, COMBO_B, COMBO_CLASS, NUM_COMBOS } from '../ranges/combos';

export type EqPlayer = { kind: 'hand'; cards: Card[] } | { kind: 'range'; classW: number[] };

export interface MultiResult {
  players: { equity: number; win: number; tie: number; se: number }[];
  n: number;
  exact: boolean;
  /** Number of boards (exact) or deals (MC) considered. */
  samples: number;
}

function* boards(rest: number[], need: number): Generator<number[]> {
  if (need === 0) {
    yield [];
    return;
  }
  const idx = Array.from({ length: need }, (_, i) => i);
  while (true) {
    yield idx.map((i) => rest[i]);
    let i = need - 1;
    while (i >= 0 && idx[i] === rest.length - need + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < need; j++) idx[j] = idx[j - 1] + 1;
  }
}

export function exactBoardCount(known: number, need: number): number {
  let r = 1;
  const rem = 52 - known;
  for (let i = 0; i < need; i++) r = (r * (rem - i)) / (i + 1);
  return r;
}

export function multiEquity(players: EqPlayer[], board: Card[], dead: Card[] = [], iterations = 50000, seed?: number, onProgress?: (p: number) => void): MultiResult {
  const k = players.length;
  const allHands = players.every((p) => p.kind === 'hand');
  const fixed = [...board, ...dead, ...players.flatMap((p) => (p.kind === 'hand' ? p.cards : []))];
  const need = 5 - board.length;
  if (allHands && exactBoardCount(fixed.length, need) * k <= 6e6) return exact(players as { kind: 'hand'; cards: Card[] }[], board, dead, onProgress);

  const rng = new Rng(seed);
  const deadMask = new Uint8Array(52);
  for (const c of fixed) deadMask[c] = 1;
  // Per range player: cumulative weights over combos that avoid fixed cards.
  const samplers = players.map((p) => {
    if (p.kind === 'hand') return null;
    const ids: number[] = [];
    const cdf: number[] = [];
    let t = 0;
    for (let c = 0; c < NUM_COMBOS; c++) {
      const w = p.classW[COMBO_CLASS[c]];
      if (w > 0 && !deadMask[COMBO_A[c]] && !deadMask[COMBO_B[c]]) {
        t += w;
        ids.push(c);
        cdf.push(t);
      }
    }
    return { ids, cdf, t };
  });
  if (samplers.some((s) => s && s.t <= 0)) throw new Error('A range has no hands left after removing known cards');
  const sums = new Float64Array(k), sq = new Float64Array(k), wins = new Float64Array(k), ties = new Float64Array(k);
  const used = new Uint8Array(52);
  const hole = new Int32Array(k * 2);
  const seven = new Int32Array(7);
  const deck = new Int32Array(52);
  const scores = new Int32Array(k);
  let n = 0;
  for (let it = 0; it < iterations; it++) {
    used.set(deadMask);
    let ok = true;
    for (let i = 0; i < k; i++) {
      const p = players[i];
      if (p.kind === 'hand') {
        hole[2 * i] = p.cards[0];
        hole[2 * i + 1] = p.cards[1];
        continue;
      }
      const s = samplers[i]!;
      let tries = 0, c = 0;
      do {
        const x = rng.next() * s.t;
        let lo = 0, hi = s.cdf.length - 1;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (s.cdf[m] > x) hi = m;
          else lo = m + 1;
        }
        c = s.ids[lo];
      } while ((used[COMBO_A[c]] || used[COMBO_B[c]]) && ++tries < 60);
      if (used[COMBO_A[c]] || used[COMBO_B[c]]) {
        ok = false;
        break;
      }
      used[COMBO_A[c]] = used[COMBO_B[c]] = 1;
      hole[2 * i] = COMBO_A[c];
      hole[2 * i + 1] = COMBO_B[c];
    }
    if (!ok) continue;
    let m = 0;
    for (let c = 0; c < 52; c++) if (!used[c]) deck[m++] = c;
    for (let i = 0; i < board.length; i++) seven[i] = board[i];
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(m - i);
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      seven[board.length + i] = deck[i];
    }
    let best = -1, nb = 0;
    for (let i = 0; i < k; i++) {
      seven[5] = hole[2 * i];
      seven[6] = hole[2 * i + 1];
      scores[i] = evaluate(seven);
      if (scores[i] > best) { best = scores[i]; nb = 1; } else if (scores[i] === best) nb++;
    }
    for (let i = 0; i < k; i++) {
      const x = scores[i] === best ? 1 / nb : 0;
      sums[i] += x;
      sq[i] += x * x;
      if (scores[i] === best) (nb === 1 ? wins : ties)[i]++;
    }
    n++;
    if (onProgress && it % 5000 === 4999) onProgress(it / iterations);
  }
  return {
    players: Array.from({ length: k }, (_, i) => {
      const mean = sums[i] / n;
      const v = (sq[i] - n * mean * mean) / Math.max(1, n - 1);
      return { equity: mean, win: wins[i] / n, tie: ties[i] / n, se: Math.sqrt(Math.max(0, v) / n) };
    }),
    n,
    exact: false,
    samples: n,
  };
}

function exact(players: { kind: 'hand'; cards: Card[] }[], board: Card[], dead: Card[], onProgress?: (p: number) => void): MultiResult {
  const k = players.length;
  const used = new Set([...board, ...dead, ...players.flatMap((p) => p.cards)]);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  const need = 5 - board.length;
  const total = exactBoardCount(used.size, need);
  const eqs = new Float64Array(k), wins = new Float64Array(k), ties = new Float64Array(k);
  const seven = new Int32Array(7);
  for (let i = 0; i < board.length; i++) seven[i] = board[i];
  const scores = new Int32Array(k);
  let n = 0;
  for (const ro of boards(rest, need)) {
    for (let i = 0; i < need; i++) seven[board.length + i] = ro[i];
    let best = -1, nb = 0;
    for (let i = 0; i < k; i++) {
      seven[5] = players[i].cards[0];
      seven[6] = players[i].cards[1];
      scores[i] = evaluate(seven);
      if (scores[i] > best) { best = scores[i]; nb = 1; } else if (scores[i] === best) nb++;
    }
    for (let i = 0; i < k; i++)
      if (scores[i] === best) {
        eqs[i] += 1 / nb;
        (nb === 1 ? wins : ties)[i]++;
      }
    n++;
    if (onProgress && n % 100000 === 0) onProgress(n / total);
  }
  return { players: Array.from({ length: k }, (_, i) => ({ equity: eqs[i] / n, win: wins[i] / n, tie: ties[i] / n, se: 0 })), n, exact: true, samples: n };
}

/**
 * Hero's equity against each class of a range (for the grid heat-map):
 * Monte Carlo per class with `perClass` deals.
 */
export function classBreakdown(hero: Card[], classW: number[], board: Card[], perClass = 1500, seed?: number): { cls: number; equity: number; combos: number }[] {
  const out: { cls: number; equity: number; combos: number }[] = [];
  for (let cls = 0; cls < 169; cls++) {
    if (!(classW[cls] > 0)) continue;
    const w = new Array<number>(169).fill(0);
    w[cls] = 1;
    try {
      const r = multiEquity([{ kind: 'hand', cards: hero }, { kind: 'range', classW: w }], board, [], perClass, seed);
      const dead = new Set([...hero, ...board]);
      let combos = 0;
      for (let c = 0; c < NUM_COMBOS; c++) if (COMBO_CLASS[c] === cls && !dead.has(COMBO_A[c]) && !dead.has(COMBO_B[c])) combos++;
      out.push({ cls, equity: r.players[0].equity, combos });
    } catch {
      /* class fully blocked by known cards */
    }
  }
  return out;
}
