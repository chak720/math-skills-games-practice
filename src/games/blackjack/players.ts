/**
 * Other players at the blackjack table. They decide from the public view
 * only (their cards, everyone's face-up cards, the dealer's upcard). Some play
 * perfect basic strategy; others make the classic mistakes. Their play changes
 * which cards come out, exactly like real tablemates.
 */
import { Rng } from '@/shared/random/prng';
import type { BJLegal, BJMove, BJView } from './engine';
import { handValue, valueOf } from './rules';
import { chartMove, type Chart } from './strategy';
import { deviationFor, runningCount, trueCount } from './counting';

export type BJStyle = 'basic' | 'no-split-8s' | 'insurance' | 'mimic' | 'never-bust' | 'hunch' | 'counter';

export const STYLE_LABEL: Record<BJStyle, string> = {
  basic: 'Basic strategy player',
  'no-split-8s': 'Never splits 8s',
  insurance: 'Always insures',
  mimic: 'Plays like the dealer',
  'never-bust': 'Never busts',
  hunch: 'Plays hunches',
  counter: 'Card counter',
};

export interface BJBotSpec {
  id: string;
  name: string;
  style: BJStyle;
  thinkMs: number;
  chattiness: number;
}

const NAMES = ['Marisol', 'Dev', 'Hank', 'Priya', 'Otto', 'Lena', 'Jules', 'Kofi', 'Rosa', 'Tariq', 'Wen', 'Bea', 'Gus', 'Ines'];
const STYLES: BJStyle[] = ['basic', 'basic', 'no-split-8s', 'insurance', 'mimic', 'never-bust', 'hunch', 'counter'];

export function randomBot(rng: Rng, taken: Set<string>): BJBotSpec {
  const free = NAMES.filter((n) => !taken.has(n));
  const name = rng.pick(free.length ? free : NAMES);
  return { id: `bj-${name}-${rng.int(1e6)}`, name, style: rng.pick(STYLES), thinkMs: rng.uniform(700, 2200), chattiness: rng.uniform(0.02, 0.12) };
}

export function botMove(bot: BJBotSpec, view: BJView, chart: Chart, rng: Rng): { move: BJMove; thinkMs: number } {
  const L = view.legal!;
  const seat = view.seats[view.me]!;
  const hand = seat.hands[view.turn!.hand];
  const values = hand.cards.map(valueOf);
  const v = handValue(hand.cards);
  const up = valueOf(view.dealerUp!);
  const basic = chartMove(chart, { values, up, canDouble: L.double, canSplit: L.split, canSurrender: L.surrender }).move;
  let move: BJMove = basic;
  switch (bot.style) {
    case 'no-split-8s':
      if (values.length === 2 && values[0] === 8 && values[1] === 8) move = up >= 7 || up === 1 ? 'hit' : 'stand';
      if (v.total === 16 && up === 10 && rng.chance(0.6)) move = 'stand';
      break;
    case 'mimic':
      move = v.total < 17 ? 'hit' : 'stand';
      break;
    case 'never-bust':
      move = v.total >= 12 && !v.soft ? 'stand' : v.total < 12 ? 'hit' : v.total < 18 ? 'hit' : 'stand';
      break;
    case 'hunch':
      if (rng.chance(0.2)) move = rng.pick((['hit', 'stand', 'double'] as BJMove[]).filter((m) => L[m]));
      break;
    case 'counter': {
      const tc = trueCount(runningCount(view.seen), view.cardsRemaining);
      const dev = deviationFor({ hardTotal: v.soft ? null : v.total, pairOf: values.length === 2 && values[0] === values[1] ? values[0] : null, up, tc, canDouble: L.double, canSplit: L.split, canSurrender: L.surrender });
      if (dev && dev.move !== 'insure') move = dev.move as BJMove;
      break;
    }
    default:
      break;
  }
  if (!L[move]) move = L.hit && v.total < 17 ? 'hit' : 'stand';
  const stiff = v.total >= 12 && v.total <= 16 && !v.soft;
  const thinkMs = bot.thinkMs * rng.logNormal(1, 0.35) * (stiff ? 1.5 : move === 'double' || move === 'split' ? 1.3 : 0.8);
  return { move, thinkMs };
}

export function botInsurance(bot: BJBotSpec, view: BJView, rng: Rng): boolean {
  if (bot.style === 'insurance') return true;
  if (bot.style === 'counter') return trueCount(runningCount(view.seen), view.cardsRemaining) >= 3;
  if (bot.style === 'hunch') return rng.chance(0.25);
  return false;
}

export function botBet(bot: BJBotSpec, view: BJView, rng: Rng, minBet: number): number {
  if (bot.style === 'counter') {
    const tc = trueCount(runningCount(view.seen), view.cardsRemaining);
    return minBet * Math.max(1, Math.min(8, Math.floor(tc)));
  }
  return minBet * rng.pick([1, 1, 1, 2, 2, 3, 5]);
}

const CHAT: Record<string, string[]> = {
  bust: ['ugh', 'every time', 'of course'],
  blackjack: ['nice', 'finally', "let's go"],
  dealerBJ: ['wow', 'dealer always has it', 'unreal'],
  dealerBust: ['yes!', 'thank you dealer', 'nice'],
  split: ['here goes', 'double trouble'],
};

export function botChat(bot: BJBotSpec, event: keyof typeof CHAT, rng: Rng): string | null {
  return rng.chance(bot.chattiness) ? rng.pick(CHAT[event]) : null;
}

export type { BJLegal };
