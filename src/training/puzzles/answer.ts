/** Answer formatting and checking for puzzles. */
import { parseAnswer, Q } from '@/shared/math/rational';
import type { AnswerValue } from './types';

export function answerText(a: AnswerValue): string {
  switch (a.kind) {
    case 'rational':
      if (a.value.isInteger()) return a.value.toString();
      // Fractions with huge denominators are unreadable; show the decimal and the size instead.
      if (a.value.toString().length > 24) return `≈ ${a.value.toNumber().toPrecision(6)} (exact fraction has a ${a.value.d.toString().length}-digit denominator)`;
      return `${a.value.toString()} ≈ ${a.value.toNumber().toPrecision(5)}`;
    case 'integer':
      return a.value.toLocaleString();
    case 'number':
      return Number(a.value.toPrecision(6)).toString();
    case 'choice':
      return a.options[a.correct];
    case 'set':
      return a.value.length ? a.value.join(', ') : 'none of them';
  }
}

/** Parse "3/8", "0.375", "37.5%", "1 1/2" into an exact rational when possible. */
export function parseRational(s: string): Q | null {
  const t = s.trim().replace(/,/g, '');
  const frac = t.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[2]) === 0 ? null : new Q(BigInt(frac[1]), BigInt(frac[2]));
  const int = t.match(/^-?\d+$/);
  if (int) return new Q(BigInt(t));
  return null;
}

export function checkAnswer(a: AnswerValue, input: string | number): { correct: boolean; note?: string } {
  if (a.kind === 'choice') return { correct: Number(input) === a.correct };
  const s = String(input).trim();
  if (a.kind === 'set') {
    const got = s.toUpperCase().replace(/[^A-Z]/g, '').split('').sort().join('');
    const want = [...a.value].map((x) => x.toUpperCase()).sort().join('');
    if (/^none|nobody|no one$/i.test(s)) return { correct: want === '' };
    return { correct: got === want };
  }
  if (a.kind === 'integer') {
    const t = s.replace(/[,\s]/g, '');
    return { correct: /^-?\d+$/.test(t) && BigInt(t) === a.value };
  }
  const exact = parseRational(s);
  if (a.kind === 'rational') {
    if (exact) return { correct: exact.eq(a.value) };
    const x = parseAnswer(s);
    if (x === null) return { correct: false, note: 'Enter a number, a fraction like 3/8, or a percentage.' };
    const v = a.value.toNumber();
    const ok = Math.abs(x - v) <= Math.max(5e-4, 1e-3 * Math.abs(v));
    return { correct: ok, note: ok && !a.value.isInteger() ? `Exact answer: ${a.value.toString()}.` : undefined };
  }
  const x = parseAnswer(s);
  if (x === null) return { correct: false, note: 'Enter a number.' };
  return { correct: Math.abs(x - a.value) <= a.tol };
}

export function sameAnswer(x: AnswerValue, y: AnswerValue): boolean {
  if (x.kind === 'rational' && y.kind === 'rational') return x.value.eq(y.value);
  if (x.kind === 'integer' && y.kind === 'integer') return x.value === y.value;
  if (x.kind === 'integer' && y.kind === 'rational') return y.value.isInteger() && y.value.n === x.value;
  if (x.kind === 'rational' && y.kind === 'integer') return x.value.isInteger() && x.value.n === y.value;
  if (x.kind === 'number' && y.kind === 'number') return Math.abs(x.value - y.value) <= Math.min(x.tol, y.tol) / 10;
  if (x.kind === 'number' && y.kind === 'rational') return Math.abs(x.value - y.value.toNumber()) <= x.tol / 10;
  if (x.kind === 'choice' && y.kind === 'choice') return x.options[x.correct] === y.options[y.correct];
  if (x.kind === 'set' && y.kind === 'set') return [...x.value].sort().join() === [...y.value].sort().join();
  return false;
}
