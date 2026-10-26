/** Blackjack table rules (US hole-card game: the dealer peeks for blackjack). */
export interface BJRules {
  decks: number;
  /** Dealer hits soft 17. */
  h17: boolean;
  /** Double after split allowed. */
  das: boolean;
  /** Maximum hands after splitting (2 = no re-split). */
  maxHands: number;
  resplitAces: boolean;
  hitSplitAces: boolean;
  doubleOn: 'any' | '9-11' | '10-11';
  /** Late surrender (after the dealer checks for blackjack). */
  surrender: boolean;
  /** Blackjack payout: 1.5 (3:2) or 1.2 (6:5). */
  bjPays: number;
  /** Fraction of the shoe dealt before the cut card. */
  penetration: number;
}

export const DEFAULT_RULES: BJRules = {
  decks: 6, h17: false, das: true, maxHands: 4, resplitAces: false, hitSplitAces: false, doubleOn: 'any', surrender: true, bjPays: 1.5, penetration: 0.75,
};

export function describeRules(r: BJRules): string {
  return [
    `${r.decks} deck${r.decks > 1 ? 's' : ''}`,
    r.h17 ? 'H17' : 'S17',
    r.das ? 'DAS' : 'no DAS',
    r.maxHands > 2 ? `split to ${r.maxHands}` : 'no re-split',
    r.resplitAces ? 'RSA' : null,
    r.doubleOn === 'any' ? null : `double ${r.doubleOn}`,
    r.surrender ? 'late surrender' : 'no surrender',
    r.bjPays === 1.5 ? 'BJ 3:2' : 'BJ 6:5',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Blackjack value of a card integer: A = 1, T/J/Q/K = 10. */
export const valueOf = (c: number): number => {
  const r = c >> 2;
  return r === 12 ? 1 : r >= 8 ? 10 : r + 2;
};

export interface HandValue {
  total: number;
  soft: boolean;
}

/** Best total; soft if an ace counts as 11. */
export function handValue(cards: readonly number[]): HandValue {
  let t = 0, aces = 0;
  for (const c of cards) {
    const v = valueOf(c);
    t += v;
    if (v === 1) aces++;
  }
  if (aces && t + 10 <= 21) return { total: t + 10, soft: true };
  return { total: t, soft: false };
}

export const isNatural = (cards: readonly number[]): boolean => cards.length === 2 && handValue(cards).total === 21;

export function canDoubleTotal(r: BJRules, total: number): boolean {
  if (r.doubleOn === 'any') return true;
  if (r.doubleOn === '9-11') return total >= 9 && total <= 11;
  return total === 10 || total === 11;
}
