/**
 * Cards are small integers: card = rank * 4 + suit.
 *   rank 0..12  ->  2,3,4,5,6,7,8,9,T,J,Q,K,A
 *   suit 0..3   ->  c,d,h,s
 * Integer cards keep the evaluator and simulations allocation-free.
 */
export type Card = number;
export type Suit = 0 | 1 | 2 | 3;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;
export const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
export const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'] as const;
export const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'] as const;

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): Suit => (c & 3) as Suit;
export const makeCard = (rank: number, suit: number): Card => rank * 4 + suit;

export const FULL_DECK: readonly Card[] = Object.freeze(Array.from({ length: 52 }, (_, i) => i));

export function cardToString(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

export function cardsToString(cs: readonly Card[], sep = ' '): string {
  return cs.map(cardToString).join(sep);
}

export function parseCard(s: string): Card {
  const t = s.trim();
  if (t.length !== 2) throw new Error(`bad card "${s}"`);
  const r = RANK_CHARS.indexOf(t[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(t[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`bad card "${s}"`);
  return makeCard(r, su);
}

/** Parses "AsKd", "As Kd", "as,kd". */
export function parseCards(s: string): Card[] {
  const compact = s.replace(/[\s,]+/g, '');
  if (compact.length % 2 !== 0) throw new Error(`bad card list "${s}"`);
  const out: Card[] = [];
  for (let i = 0; i < compact.length; i += 2) out.push(parseCard(compact.slice(i, i + 2)));
  if (new Set(out).size !== out.length) throw new Error(`duplicate card in "${s}"`);
  return out;
}

/** Blackjack value of a card: A = 1 (soft handling elsewhere), T-K = 10. */
export function bjValue(c: Card): number {
  const r = rankOf(c);
  if (r === 12) return 1;
  if (r >= 8) return 10;
  return r + 2;
}
