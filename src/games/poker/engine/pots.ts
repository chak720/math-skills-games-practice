/**
 * Side pots.
 *
 * Let the distinct total contributions of players still in the hand be
 * L1 < L2 < … < Lk. Pot j collects, from EVERY player (folded ones too),
 * min(committed, Lj) − min(committed, Lj−1), and is contested by the live
 * players whose contribution reached Lj. Folded chips are dead money: they
 * fund the pots but can't win them. Uncalled excess is returned before this
 * runs, so the top pot always has at least two eligible players unless
 * everyone else folded.
 */
export interface Contribution {
  seat: number;
  committed: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  eligible: number[];
}

export function buildPots(contribs: readonly Contribution[]): Pot[] {
  const live = contribs.filter((c) => !c.folded && c.committed > 0);
  const levels = [...new Set(live.map((c) => c.committed))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const L of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.committed, L) - prev);
    if (amount > 0) pots.push({ amount, eligible: live.filter((c) => c.committed >= L).map((c) => c.seat) });
    prev = L;
  }
  // Dead money above the highest live level (only possible if callers folded
  // after over-committing) goes to the top pot.
  const leftover = contribs.reduce((s, c) => s + Math.max(0, c.committed - prev), 0);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else pots.push({ amount: leftover, eligible: live.map((c) => c.seat) });
  }
  return pots;
}

/**
 * Splits each pot among the best scores among its eligible (non-mucked)
 * players. Odd chips go one at a time to winners in clockwise order starting
 * left of the button (`order`).
 */
export function awardPots(
  pots: readonly Pot[],
  scoreOf: (seat: number) => number | null,
  order: readonly number[],
): { seat: number; amount: number; potIndex: number }[] {
  const out: { seat: number; amount: number; potIndex: number }[] = [];
  pots.forEach((pot, potIndex) => {
    const contenders = pot.eligible.filter((s) => scoreOf(s) !== null);
    if (!contenders.length) return;
    const best = Math.max(...contenders.map((s) => scoreOf(s)!));
    const winners = contenders.filter((s) => scoreOf(s) === best).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const s of winners) {
      out.push({ seat: s, amount: share + (odd > 0 ? 1 : 0), potIndex });
      odd--;
    }
  });
  return out;
}
