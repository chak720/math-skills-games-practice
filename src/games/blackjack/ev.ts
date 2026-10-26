/**
 * Exact composition-dependent blackjack EVs.
 *
 * The shoe is a vector of counts n[1..10] (index 1 = ace, 10 = all ten-value
 * cards). Probabilities of draws are exact for that composition (sampling
 * without replacement).
 *
 * Dealer: we enumerate the dealer's draws recursively, memoising on the
 * multiset drawn, and return the distribution of final totals {17..21, bust}.
 * In a peek game, by the time a player acts the dealer is known NOT to have
 * blackjack, so for an ace or ten upcard we condition the hole card: e.g.
 * with an ace up, P(hole = r) = n_r / (N − n_10) for r ≠ 10.
 *
 * Player:
 *   stand(T) = P(bust) + P(D < T) − P(D > T)
 *   hit(H)   = Σ_r p_r · max(stand(H+r), hit(H+r))         (−1 if bust)
 *   double   = 2 · Σ_r p_r · stand(H+r)
 *   surrender = −½
 *   split(c) ≈ 2 · EV(one hand starting with c), with the second c removed
 *              from the shoe, doubling allowed if DAS, split aces one card
 *              only (unless hit split aces), re-splits ignored — a standard
 *              approximation, stated in the UI.
 * "exact" mode recomputes the dealer distribution for every composition the
 * player's draws lead to; "fixed" mode reuses one dealer distribution, which is
 * how total-dependent basic strategy charts are usually derived.
 */
import { type BJRules, canDoubleTotal } from './rules';

export type Counts = Int32Array; // length 11, indices 1..10 used

export function shoeCounts(decks: number): Counts {
  const n = new Int32Array(11);
  for (let r = 1; r <= 9; r++) n[r] = 4 * decks;
  n[10] = 16 * decks;
  return n;
}

const total = (n: Counts): number => {
  let t = 0;
  for (let r = 1; r <= 10; r++) t += n[r];
  return t;
};

/** Distribution over dealer finals: [17, 18, 19, 20, 21, bust]. */
export type DealerDist = Float64Array;

export function dealerDist(up: number, n: Counts, rules: BJRules, conditionNoBJ = true): DealerDist {
  const memo = new Map<number, DealerDist>();
  const work = Int32Array.from(n);
  // key: multiset drawn (base 16 per rank, 10 ranks → < 2^40)
  const draw = (sum: number, soft: boolean, key: number): DealerDist => {
    const best = soft && sum + 10 <= 21 ? sum + 10 : sum;
    if (best > 21) return BUST;
    if (best >= 17) {
      const soft17 = best === 17 && soft && sum + 10 === 17;
      if (!(soft17 && rules.h17)) return FINAL[best - 17];
    }
    const hit = memo.get(key);
    if (hit) return hit;
    const out = new Float64Array(6);
    const N = total(work);
    for (let r = 1; r <= 10; r++) {
      const c = work[r];
      if (!c) continue;
      const p = c / N;
      work[r]--;
      const d = draw(sum + r, soft || r === 1, key + MULT[r]);
      work[r]++;
      for (let i = 0; i < 6; i++) out[i] += p * d[i];
    }
    memo.set(key, out);
    return out;
  };
  // Hole card, conditioned on no blackjack when the dealer peeked.
  const out = new Float64Array(6);
  const N = total(work);
  const bjRank = up === 1 ? 10 : up === 10 ? 1 : 0;
  const excl = conditionNoBJ && bjRank ? work[bjRank] : 0;
  for (let r = 1; r <= 10; r++) {
    const c = work[r];
    if (!c || (conditionNoBJ && r === bjRank)) continue;
    const p = c / (N - excl);
    work[r]--;
    const d = draw(up + r, up === 1 || r === 1, MULT[r]);
    work[r]++;
    for (let i = 0; i < 6; i++) out[i] += p * d[i];
  }
  return out;
}

const MULT = Array.from({ length: 11 }, (_, r) => 16 ** (r - 1));
const FINAL = [0, 1, 2, 3, 4].map((i) => {
  const d = new Float64Array(6);
  d[i] = 1;
  return d;
});
const BUST = (() => {
  const d = new Float64Array(6);
  d[5] = 1;
  return d;
})();

/** P(dealer has blackjack) given the upcard and composition (before the peek). */
export function dealerBJProb(up: number, n: Counts): number {
  const N = total(n);
  if (up === 1) return n[10] / N;
  if (up === 10) return n[1] / N;
  return 0;
}

export function standEV(t: number, d: DealerDist): number {
  if (t > 21) return -1;
  let ev = d[5];
  for (let i = 0; i < 5; i++) {
    const dt = 17 + i;
    if (dt < t) ev += d[i];
    else if (dt > t) ev -= d[i];
  }
  return ev;
}

export interface Allowed {
  double: boolean;
  split: boolean;
  surrender: boolean;
}

export interface EVs {
  stand: number;
  hit: number;
  double: number | null;
  split: number | null;
  surrender: number | null;
  /** EV per unit of insurance stake (insurance costs half the bet). */
  insurance: number | null;
  dealerBJ: number;
  dealer: DealerDist;
}

interface Ctx {
  rules: BJRules;
  up: number;
  exact: boolean;
  fixedDealer: DealerDist | null;
  dealerMemo: Map<string, DealerDist>;
  hitMemo: Map<string, number>;
}

function dealerFor(ctx: Ctx, n: Counts): DealerDist {
  if (!ctx.exact && ctx.fixedDealer) return ctx.fixedDealer;
  const k = n.join(',');
  let d = ctx.dealerMemo.get(k);
  if (!d) {
    d = dealerDist(ctx.up, n, ctx.rules, true);
    ctx.dealerMemo.set(k, d);
  }
  return d;
}

/** Best of hit/stand for a hand (sum = hard sum with aces as 1). */
function bestHitStand(ctx: Ctx, sum: number, soft: boolean, n: Counts): number {
  const t = soft && sum + 10 <= 21 ? sum + 10 : sum;
  if (t > 21) return -1;
  const s = standEV(t, dealerFor(ctx, n));
  if (t === 21) return s;
  return Math.max(s, hitEV(ctx, sum, soft, n));
}

function hitEV(ctx: Ctx, sum: number, soft: boolean, n: Counts): number {
  const key = `${sum}|${soft ? 1 : 0}|${n.join(',')}`;
  const m = ctx.hitMemo.get(key);
  if (m !== undefined) return m;
  const N = total(n);
  let ev = 0;
  for (let r = 1; r <= 10; r++) {
    const c = n[r];
    if (!c) continue;
    const p = c / N;
    n[r]--;
    const ns = sum + r;
    const nsoft = soft || r === 1;
    const t = nsoft && ns + 10 <= 21 ? ns + 10 : ns;
    ev += p * (t > 21 ? -1 : bestHitStand(ctx, ns, nsoft, n));
    n[r]++;
  }
  ctx.hitMemo.set(key, ev);
  return ev;
}

function doubleEV(ctx: Ctx, sum: number, soft: boolean, n: Counts): number {
  const N = total(n);
  let ev = 0;
  for (let r = 1; r <= 10; r++) {
    const c = n[r];
    if (!c) continue;
    n[r]--;
    const ns = sum + r;
    const t = (soft || r === 1) && ns + 10 <= 21 ? ns + 10 : ns;
    ev += (c / N) * (t > 21 ? -1 : standEV(t, dealerFor(ctx, n)));
    n[r]++;
  }
  return 2 * ev;
}

/** EV of one post-split hand starting with card value `c` (second card still to come). */
function splitHandEV(ctx: Ctx, c: number, n: Counts): number {
  const N = total(n);
  const r0 = ctx.rules;
  let ev = 0;
  for (let r = 1; r <= 10; r++) {
    const k = n[r];
    if (!k) continue;
    n[r]--;
    const sum = c + r;
    const soft = c === 1 || r === 1;
    const t = soft && sum + 10 <= 21 ? sum + 10 : sum;
    let v: number;
    if (c === 1 && !r0.hitSplitAces) v = standEV(t, dealerFor(ctx, n)); // one card to each split ace; 21 is not a blackjack
    else {
      v = bestHitStand(ctx, sum, soft, n);
      if (r0.das && canDoubleTotal(r0, t)) v = Math.max(v, doubleEV(ctx, sum, soft, n));
    }
    ev += (k / N) * v;
    n[r]++;
  }
  return ev;
}

/**
 * EVs (in units of the original bet) for a player hand `cards` (values 1..10)
 * against dealer upcard `up`, with `n` the composition of UNSEEN cards (shoe
 * minus every visible card, including these). Assumes the dealer has already
 * peeked when up is an ace or ten.
 */
export function computeEVs(cards: number[], up: number, n: Counts, rules: BJRules, allowed: Allowed, mode: 'exact' | 'fixed' = 'exact'): EVs {
  const work = Int32Array.from(n);
  const ctx: Ctx = { rules, up, exact: mode === 'exact', fixedDealer: null, dealerMemo: new Map(), hitMemo: new Map() };
  const dealer = dealerDist(up, work, rules, true);
  if (mode === 'fixed') ctx.fixedDealer = dealer;
  const sum = cards.reduce((a, b) => a + b, 0);
  const soft = cards.includes(1);
  const t = soft && sum + 10 <= 21 ? sum + 10 : sum;
  const stand = standEV(t, dealer);
  const hit = t >= 21 ? -1 : hitEV(ctx, sum, soft, work);
  const dbl = allowed.double ? doubleEV(ctx, sum, soft, work) : null;
  let split: number | null = null;
  if (allowed.split && cards.length === 2 && cards[0] === cards[1]) {
    const c = cards[0];
    // Remove nothing extra: `n` already excludes both of our cards. Each split
    // hand draws from the same shoe; 2 × single-hand EV (independence approx.).
    split = 2 * splitHandEV(ctx, c, work);
  }
  const N = total(work);
  const pbj = up === 1 ? work[10] / N : 0;
  return {
    stand, hit, double: dbl, split, surrender: allowed.surrender ? -0.5 : null,
    insurance: up === 1 ? pbj * 2 - (1 - pbj) : null,
    dealerBJ: up === 1 || up === 10 ? (up === 1 ? work[10] / N : work[1] / N) : 0,
    dealer,
  };
}

/** Remove card values from a composition (returns a copy). */
export function without(n: Counts, values: number[]): Counts {
  const c = Int32Array.from(n);
  for (const v of values) c[v]--;
  return c;
}
