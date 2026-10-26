/** JSON-safe form of a Puzzle (rationals and bigints as strings) for workers and localStorage. */
import { Q } from '@/shared/math/rational';
import type { AnswerValue, Puzzle } from './types';

export type WireAnswer =
  | { kind: 'rational'; n: string; d: string }
  | { kind: 'integer'; value: string }
  | Extract<AnswerValue, { kind: 'number' | 'choice' | 'set' }>;

export type WirePuzzle = Omit<Puzzle, 'answer'> & { answer: WireAnswer };

export function answerToWire(a: AnswerValue): WireAnswer {
  if (a.kind === 'rational') return { kind: 'rational', n: a.value.n.toString(), d: a.value.d.toString() };
  if (a.kind === 'integer') return { kind: 'integer', value: a.value.toString() };
  return a;
}

export function answerFromWire(a: WireAnswer): AnswerValue {
  if (a.kind === 'rational') return { kind: 'rational', value: new Q(BigInt(a.n), BigInt(a.d)) };
  if (a.kind === 'integer') return { kind: 'integer', value: BigInt(a.value) };
  return a;
}

export const toWire = (p: Puzzle): WirePuzzle => ({ ...p, answer: answerToWire(p.answer) });
export const fromWire = (p: WirePuzzle): Puzzle => ({ ...p, answer: answerFromWire(p.answer) });
