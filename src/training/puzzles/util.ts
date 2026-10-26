import { Q, q } from '@/shared/math/rational';
import type { Rng } from '@/shared/random/prng';
import type { AnswerValue } from './types';

export const R = (x: Q): AnswerValue => ({ kind: 'rational', value: x });
export const I = (x: bigint | number): AnswerValue => ({ kind: 'integer', value: BigInt(x) });
export const fq = (x: Q): string => (x.isInteger() ? x.toString() : `${x.toString()} (≈ ${x.toNumber().toFixed(4)})`);
export const num = (x: Q): string => x.toString();
export const ord = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
export const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const words = (n: number): string => NUM_WORDS[n] ?? String(n);
export const pick = <T>(r: Rng, xs: readonly T[]): T => r.pick(xs);
export const frac = (a: number, b: number): Q => q(a, b);
export { q, Q };
