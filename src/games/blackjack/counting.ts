/**
 * Hi-Lo card counting.
 *
 * Tags: 2–6 = +1, 7–9 = 0, ten-values and aces = −1. The tags sum to zero over
 * a deck, so the running count (RC) measures how ten/ace-rich the unseen cards
 * are. Dividing by decks remaining gives the true count (TC), which is what
 * the player's edge depends on: roughly +0.5% per true count, starting from
 * the base house edge (so the edge turns positive around TC +1 to +2).
 *
 * Deviations: the "Illustrious 18" and "Fab 4" surrenders are the index plays
 * that capture most of the value of strategy changes (indices for multi-deck
 * S17, Hi-Lo; a play applies at or above the index unless stated).
 */
import type { Card } from '@/shared/cards/card';
import { valueOf } from './rules';
import type { Move } from './strategy';

export const hiLo = (c: Card): number => {
  const v = valueOf(c);
  return v >= 2 && v <= 6 ? 1 : v >= 7 && v <= 9 ? 0 : -1;
};

export const runningCount = (seen: readonly Card[]): number => seen.reduce((a, c) => a + hiLo(c), 0);

/** Decks remaining: exact, and the half-deck estimate a player makes from the discard tray. */
export function decksRemaining(cardsRemaining: number): { exact: number; estimate: number } {
  const exact = cardsRemaining / 52;
  return { exact, estimate: Math.max(0.5, Math.round(exact * 2) / 2) };
}

export function trueCount(rc: number, cardsRemaining: number, mode: 'exact' | 'estimate' = 'estimate'): number {
  const d = decksRemaining(cardsRemaining);
  return rc / (mode === 'exact' ? Math.max(0.25, d.exact) : d.estimate);
}

/** Rough player edge at a true count: base edge + 0.5% per TC. */
export const edgeAt = (tc: number, baseEdge: number): number => baseEdge + 0.005 * tc;

export interface Deviation {
  id: string;
  label: string;
  /** Hard total (or 'pair-10' / 'insurance'). */
  hand: number | 'pair-10' | 'insurance';
  up: number;
  index: number;
  /** 'ge': apply at TC >= index; 'lt': apply when TC < index. */
  when: 'ge' | 'lt';
  move: Move | 'insure';
  /** What basic strategy does instead. */
  basic: Move | 'no insurance';
}

export const DEVIATIONS: Deviation[] = [
  { id: 'ins', label: 'Insurance', hand: 'insurance', up: 1, index: 3, when: 'ge', move: 'insure', basic: 'no insurance' },
  { id: '16v10', label: '16 vs 10', hand: 16, up: 10, index: 0, when: 'ge', move: 'stand', basic: 'hit' },
  { id: '15v10', label: '15 vs 10', hand: 15, up: 10, index: 4, when: 'ge', move: 'stand', basic: 'hit' },
  { id: 'TTv5', label: '10,10 vs 5', hand: 'pair-10', up: 5, index: 5, when: 'ge', move: 'split', basic: 'stand' },
  { id: 'TTv6', label: '10,10 vs 6', hand: 'pair-10', up: 6, index: 4, when: 'ge', move: 'split', basic: 'stand' },
  { id: '10v10', label: '10 vs 10', hand: 10, up: 10, index: 4, when: 'ge', move: 'double', basic: 'hit' },
  { id: '12v3', label: '12 vs 3', hand: 12, up: 3, index: 2, when: 'ge', move: 'stand', basic: 'hit' },
  { id: '12v2', label: '12 vs 2', hand: 12, up: 2, index: 3, when: 'ge', move: 'stand', basic: 'hit' },
  { id: '11vA', label: '11 vs A', hand: 11, up: 1, index: 1, when: 'ge', move: 'double', basic: 'hit' },
  { id: '9v2', label: '9 vs 2', hand: 9, up: 2, index: 1, when: 'ge', move: 'double', basic: 'hit' },
  { id: '10vA', label: '10 vs A', hand: 10, up: 1, index: 4, when: 'ge', move: 'double', basic: 'hit' },
  { id: '9v7', label: '9 vs 7', hand: 9, up: 7, index: 3, when: 'ge', move: 'double', basic: 'hit' },
  { id: '16v9', label: '16 vs 9', hand: 16, up: 9, index: 5, when: 'ge', move: 'stand', basic: 'hit' },
  { id: '13v2', label: '13 vs 2', hand: 13, up: 2, index: -1, when: 'lt', move: 'hit', basic: 'stand' },
  { id: '12v4', label: '12 vs 4', hand: 12, up: 4, index: 0, when: 'lt', move: 'hit', basic: 'stand' },
  { id: '12v5', label: '12 vs 5', hand: 12, up: 5, index: -2, when: 'lt', move: 'hit', basic: 'stand' },
  { id: '12v6', label: '12 vs 6', hand: 12, up: 6, index: -1, when: 'lt', move: 'hit', basic: 'stand' },
  { id: '13v3', label: '13 vs 3', hand: 13, up: 3, index: -2, when: 'lt', move: 'hit', basic: 'stand' },
  // Fab 4 surrenders (late surrender games)
  { id: 'S14v10', label: '14 vs 10 surrender', hand: 14, up: 10, index: 3, when: 'ge', move: 'surrender', basic: 'hit' },
  { id: 'S15v10', label: '15 vs 10 surrender', hand: 15, up: 10, index: 0, when: 'ge', move: 'surrender', basic: 'hit' },
  { id: 'S15v9', label: '15 vs 9 surrender', hand: 15, up: 9, index: 2, when: 'ge', move: 'surrender', basic: 'hit' },
  { id: 'S15vA', label: '15 vs A surrender', hand: 15, up: 1, index: 1, when: 'ge', move: 'surrender', basic: 'hit' },
];

/**
 * The index play for a situation, if one applies at this true count.
 * `hardTotal` is null for soft hands (no I18 soft deviations).
 */
export function deviationFor(opts: { hardTotal: number | null; pairOf: number | null; up: number; tc: number; canDouble: boolean; canSplit: boolean; canSurrender: boolean }): Deviation | null {
  const applies = (d: Deviation): boolean => (d.when === 'ge' ? opts.tc >= d.index : opts.tc < d.index);
  for (const d of DEVIATIONS) {
    if (d.up !== opts.up || d.hand === 'insurance') continue;
    if (d.hand === 'pair-10') {
      if (opts.pairOf === 10 && opts.canSplit && applies(d)) return d;
      continue;
    }
    if (opts.hardTotal !== d.hand || opts.pairOf === 8) continue;
    if (d.move === 'surrender' && !opts.canSurrender) continue;
    if (d.move === 'double' && !opts.canDouble) continue;
    if (applies(d)) return d;
  }
  return null;
}

export const insuranceByCount = (tc: number): boolean => tc >= 3;
