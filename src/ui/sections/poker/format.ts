import { cardsToString } from '@/shared/cards/card';
import type { ActionRecord, PlayerView } from '@/games/poker/engine/types';

export function fmtAmt(chips: number, bb: number, showBB: boolean): string {
  if (!showBB) return chips.toLocaleString();
  const v = chips / bb;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} bb`;
}

/** Short label for the bubble next to a seat. */
export function actionLabel(a: ActionRecord, bb: number, showBB: boolean): string {
  const amt = (x: number): string => fmtAmt(x, bb, showBB);
  switch (a.type) {
    case 'post-sb': return `SB ${amt(a.amount)}`;
    case 'post-bb': return `BB ${amt(a.amount)}`;
    case 'post-ante': return `Ante ${amt(a.amount)}`;
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return a.allIn ? `Call ${amt(a.amount)} · all-in` : `Call ${amt(a.amount)}`;
    case 'bet': return a.allIn ? `All-in ${amt(a.to)}` : `Bet ${amt(a.to)}`;
    case 'raise': return a.allIn ? `All-in ${amt(a.to)}` : `Raise to ${amt(a.to)}`;
    case 'uncalled': return `${amt(-a.amount)} returned`;
  }
}

/** Sentence for the hand log ("You call", "Mira3bets calls"). */
export function actionSentence(a: ActionRecord, name: string, bb: number, showBB: boolean): string {
  const amt = (x: number): string => fmtAmt(x, bb, showBB);
  const you = name === 'You';
  const v = (third: string, second: string): string => `${name} ${you ? second : third}`;
  const isAre = you ? 'are' : 'is';
  switch (a.type) {
    case 'post-sb': return `${v('posts', 'post')} the small blind ${amt(a.amount)}`;
    case 'post-bb': return `${v('posts', 'post')} the big blind ${amt(a.amount)}`;
    case 'post-ante': return `${v('posts', 'post')} ante ${amt(a.amount)}`;
    case 'fold': return v('folds', 'fold');
    case 'check': return v('checks', 'check');
    case 'call': return `${v('calls', 'call')} ${amt(a.amount)}${a.allIn ? ` and ${isAre} all-in` : ''}`;
    case 'bet': return `${v('bets', 'bet')} ${amt(a.to)}${a.allIn ? ' (all-in)' : ''}`;
    case 'raise': return `${v('raises', 'raise')} to ${amt(a.to)}${a.allIn ? ' (all-in)' : ''}`;
    case 'uncalled': return `Uncalled ${amt(-a.amount)} returned to ${you ? 'you' : name}`;
  }
}

export function boardLabel(v: Pick<PlayerView, 'board'>, street: 'flop' | 'turn' | 'river'): string {
  const n = street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  return `${street[0].toUpperCase()}${street.slice(1)}: ${cardsToString(v.board.slice(0, n))}`;
}
