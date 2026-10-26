/**
 * Number sequences with exactly one sensible next term.
 *
 * A generator draws a rule from a family and shows its first terms. Before a
 * sequence is used, `ambiguity` fits every generic family it knows
 * (arithmetic, geometric, polynomials, linear recurrences, affine recurrences,
 * interleavings, alternating operations) to the shown terms. If any of them fits
 * with at least two terms to spare and predicts a different next term, the
 * sequence is rejected: the rule would not be the single clear one.
 */
import type { Rng } from '@/shared/random/prng';

export type Tier = 1 | 2 | 3;

export interface Sequence {
  family: FamilyId;
  shown: number[];
  answer: number;
  rule: string;
  /** Short explanation of how to get the next term. */
  working: string;
  tier: Tier;
  /** Stable key for anti-repetition. */
  key: string;
}

export type FamilyId =
  | 'arith' | 'geom' | 'square' | 'quad' | 'fib' | 'affine' | 'alt-ops' | 'interleave' | 'diff-geom' | 'primes'
  | 'cubic' | 'times-n' | 'trib' | 'digit-sum' | 'sign-alt';

export const FAMILY_LABEL: Record<FamilyId, string> = {
  arith: 'Constant difference',
  geom: 'Constant ratio',
  square: 'Squares and cubes',
  quad: 'Growing differences',
  fib: 'Add the previous two',
  affine: 'Multiply then add',
  'alt-ops': 'Alternating operations',
  interleave: 'Two interleaved sequences',
  'diff-geom': 'Differences grow geometrically',
  primes: 'Primes',
  cubic: 'Cubic (third differences)',
  'times-n': 'Multiply by a growing factor',
  trib: 'Add the previous three',
  'digit-sum': 'Add the digit sum',
  'sign-alt': 'Alternating correction',
};

const SAFE = 5e8;
const LEN = 6;
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113];
const digitSum = (n: number): number => [...String(Math.abs(n))].reduce((s, c) => s + Number(c), 0);
const sgn = (x: number): string => (x < 0 ? `− ${-x}` : `+ ${x}`);

interface Draft {
  terms: number[]; // shown + next
  rule: string;
  working: (shown: number[], next: number) => string;
}

type Maker = (r: Rng) => Draft;

const FAMILIES: Record<FamilyId, { tier: Tier; make: Maker }> = {
  arith: {
    tier: 1,
    make(r) {
      const a = r.range(-20, 60), d = r.pick([-1, 1]) * r.range(2, 19);
      return { terms: Array.from({ length: LEN + 1 }, (_, i) => a + i * d), rule: d > 0 ? `Add ${d} each time.` : `Subtract ${-d} each time.`, working: (s, n) => `${s.at(-1)} ${sgn(d)} = ${n}` };
    },
  },
  geom: {
    tier: 1,
    make(r) {
      const ratio = r.pick([2, 3, -2, 4, 5, -3]);
      const a = r.range(1, 9) * r.pick([1, 1, -1]);
      return { terms: Array.from({ length: LEN + 1 }, (_, i) => a * ratio ** i), rule: `Multiply by ${ratio} each time.`, working: (s, n) => `${s.at(-1)} × ${ratio < 0 ? `(${ratio})` : ratio} = ${n}` };
    },
  },
  square: {
    tier: 1,
    make(r) {
      const pow = r.pick([2, 2, 3]), k = r.range(1, pow === 2 ? 9 : 4), c = r.pick([0, 0, 1, -1, 2, -2, 3]);
      const t = Array.from({ length: LEN + 1 }, (_, i) => (i + k) ** pow + c);
      const name = pow === 2 ? 'squares' : 'cubes';
      return { terms: t, rule: c ? `The ${name} ${k}${pow === 2 ? '²' : '³'}, ${k + 1}${pow === 2 ? '²' : '³'}, … ${c > 0 ? 'plus' : 'minus'} ${Math.abs(c)}.` : `The ${name} of ${k}, ${k + 1}, ${k + 2}, …`, working: (_s, n) => `${k + LEN}${pow === 2 ? '²' : '³'}${c ? ` ${sgn(c)}` : ''} = ${n}` };
    },
  },
  quad: {
    tier: 1,
    make(r) {
      const a = r.range(-5, 30), d0 = r.range(-3, 8), e = r.pick([1, 2, 3, -1, 4]);
      const t = [a];
      for (let i = 1; i <= LEN; i++) t.push(t[i - 1] + d0 + (i - 1) * e);
      return { terms: t, rule: `The differences go up by ${e} each time (${d0}, ${d0 + e}, ${d0 + 2 * e}, …).`, working: (s, n) => `next difference ${d0 + (LEN - 1) * e}: ${s.at(-1)} ${sgn(d0 + (LEN - 1) * e)} = ${n}` };
    },
  },
  fib: {
    tier: 2,
    make(r) {
      const t = [r.range(1, 9), r.range(1, 12)];
      while (t.length <= LEN) t.push(t.at(-1)! + t.at(-2)!);
      return { terms: t, rule: 'Each term is the sum of the previous two.', working: (s, n) => `${s.at(-2)} + ${s.at(-1)} = ${n}` };
    },
  },
  affine: {
    tier: 2,
    make(r) {
      const m = r.pick([2, 3, 2, -2]), c = r.pick([1, -1, 2, -3, 3, 5, -2]);
      const t = [r.range(1, 6)];
      while (t.length <= LEN) t.push(t.at(-1)! * m + c);
      return { terms: t, rule: `Multiply by ${m}, then ${c > 0 ? 'add' : 'subtract'} ${Math.abs(c)}.`, working: (s, n) => `${s.at(-1)} × ${m < 0 ? `(${m})` : m} ${sgn(c)} = ${n}` };
    },
  },
  'alt-ops': {
    tier: 2,
    make(r) {
      const add = r.pick([1, 2, 3, 4, 5, -1, -2]), mul = r.pick([2, 3]);
      const addFirst = r.chance(0.5);
      const t = [r.range(1, 7)];
      for (let i = 1; i <= LEN; i++) t.push((i % 2 === 1) === addFirst ? t.at(-1)! + add : t.at(-1)! * mul);
      const first = addFirst ? `${add > 0 ? 'add' : 'subtract'} ${Math.abs(add)}` : `multiply by ${mul}`;
      const second = addFirst ? `multiply by ${mul}` : `${add > 0 ? 'add' : 'subtract'} ${Math.abs(add)}`;
      return { terms: t, rule: `Alternately ${first} and ${second}.`, working: (s, n) => `${s.at(-1)} ${(LEN % 2 === 1) === addFirst ? sgn(add) : `× ${mul}`} = ${n}` };
    },
  },
  interleave: {
    tier: 2,
    make(r) {
      const a = r.range(1, 30), d = r.pick([2, 3, 4, 5, 7, -2, -3]), b = r.range(1, 40), e = r.pick([1, 3, 5, 6, 10, -1, -4]);
      const t = Array.from({ length: LEN + 1 }, (_, i) => (i % 2 === 0 ? a + (i / 2) * d : b + ((i - 1) / 2) * e));
      return { terms: t, rule: `Two sequences take turns: ${a}, ${a + d}, ${a + 2 * d}, … (step ${d}) and ${b}, ${b + e}, ${b + 2 * e}, … (step ${e}).`, working: (s, n) => `continue the first sequence: ${s.at(-2)} ${sgn(d)} = ${n}` };
    },
  },
  'diff-geom': {
    tier: 2,
    make(r) {
      const ratio = r.pick([2, 3]), d0 = r.range(1, 5) * r.pick([1, 1, -1]);
      const t = [r.range(-5, 20)];
      for (let i = 0; i < LEN; i++) t.push(t.at(-1)! + d0 * ratio ** i);
      return { terms: t, rule: `The differences multiply by ${ratio} each time (${d0}, ${d0 * ratio}, ${d0 * ratio * ratio}, …).`, working: (s, n) => `next difference ${d0 * ratio ** (LEN - 1)}: ${s.at(-1)} ${sgn(d0 * ratio ** (LEN - 1))} = ${n}` };
    },
  },
  primes: {
    tier: 2,
    make(r) {
      const start = r.range(0, PRIMES.length - LEN - 2), op = r.pick(['plain', 'plus', 'double'] as const), k = r.range(1, 4);
      const ps = PRIMES.slice(start, start + LEN + 1);
      const f = (p: number): number => (op === 'plain' ? p : op === 'plus' ? p + k : 2 * p);
      return {
        terms: ps.map(f),
        rule: op === 'plain' ? 'Consecutive prime numbers.' : op === 'plus' ? `Consecutive primes plus ${k}.` : 'Twice the consecutive primes.',
        working: (_s, n) => `the next prime is ${ps.at(-1)}${op === 'plain' ? '' : op === 'plus' ? `, plus ${k} = ${n}` : `, doubled = ${n}`}`,
      };
    },
  },
  cubic: {
    tier: 3,
    make(r) {
      const c3 = r.pick([1, 1, 2]), c2 = r.range(-3, 3), c1 = r.range(-5, 5), c0 = r.range(-10, 10);
      const f = (n: number): number => c3 * n ** 3 + c2 * n * n + c1 * n + c0;
      const t = Array.from({ length: LEN + 1 }, (_, i) => f(i + 1));
      return {
        terms: t,
        rule: `A cubic: the third differences are all ${6 * c3}.`,
        working: (s, n) => {
          const d1 = difference(s), d2 = difference(d1);
          return `differences ${d1.join(', ')}; second differences ${d2.join(', ')} grow by ${6 * c3}, so the next second difference is ${d2.at(-1)! + 6 * c3}, the next difference ${d1.at(-1)! + d2.at(-1)! + 6 * c3}, and the next term ${n}`;
        },
      };
    },
  },
  'times-n': {
    tier: 3,
    make(r) {
      const k = r.range(1, 3), c = r.pick([0, 0, 1, -1]);
      const t = [r.range(1, 4)];
      for (let i = 0; i < LEN; i++) t.push(t.at(-1)! * (k + i) + c);
      return { terms: t, rule: `Multiply by ${k}, then ${k + 1}, then ${k + 2}, …${c ? ` and ${c > 0 ? 'add' : 'subtract'} 1 each time` : ''}.`, working: (s, n) => `${s.at(-1)} × ${k + LEN - 1}${c ? ` ${sgn(c)}` : ''} = ${n}` };
    },
  },
  trib: {
    tier: 3,
    make(r) {
      const t = [r.range(0, 4), r.range(1, 5), r.range(1, 6)];
      while (t.length <= LEN + 1) t.push(t.at(-1)! + t.at(-2)! + t.at(-3)!);
      return { terms: t.slice(0, LEN + 1), rule: 'Each term is the sum of the previous three.', working: (s, n) => `${s.at(-3)} + ${s.at(-2)} + ${s.at(-1)} = ${n}` };
    },
  },
  'digit-sum': {
    tier: 3,
    make(r) {
      const t = [r.range(10, 99)];
      while (t.length <= LEN) t.push(t.at(-1)! + digitSum(t.at(-1)!));
      return { terms: t, rule: 'Add the sum of the digits of the previous term.', working: (s, n) => `${s.at(-1)} + ${digitSum(s.at(-1)!)} = ${n}` };
    },
  },
  'sign-alt': {
    tier: 3,
    make(r) {
      const k = r.range(1, 5), off = r.range(1, 6), base = r.pick(['square', 'linear'] as const), d = r.range(2, 6);
      const f = (i: number): number => (base === 'square' ? (i + off) ** 2 : d * (i + off)) + (i % 2 === 0 ? k : -k);
      return { terms: Array.from({ length: LEN + 1 }, (_, i) => f(i)), rule: `${base === 'square' ? `The squares of ${off}, ${off + 1}, …` : `Multiples of ${d}`}, alternately plus and minus ${k}.`, working: (_s, n) => `${base === 'square' ? `${LEN + off}²` : `${d} × ${LEN + off}`} ${LEN % 2 === 0 ? '+' : '−'} ${k} = ${n}` };
    },
  },
};

export const FAMILY_IDS = Object.keys(FAMILIES) as FamilyId[];
export const familiesForTier = (t: Tier): FamilyId[] => FAMILY_IDS.filter((f) => FAMILIES[f].tier <= t && (t === 1 || FAMILIES[f].tier >= t - 1));

// ------------------------------------------------------------------ ambiguity check

interface Fit {
  name: string;
  next: number;
}

const eq = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const isInt = (x: number): boolean => Number.isFinite(x) && Math.abs(x - Math.round(x)) < 1e-9;

/** Generic families fitted to the shown terms; each needs at least two spare terms to count. */
export function fits(s: number[]): Fit[] {
  const out: Fit[] = [];
  const n = s.length;
  // Polynomials of degree 1–4 via finite differences (degree d uses d+1 terms; need d+3 ≤ n).
  for (let deg = 1; deg <= 4 && deg + 3 <= n; deg++) {
    const rows: number[][] = [s];
    for (let k = 0; k < deg; k++) rows.push(rows.at(-1)!.slice(1).map((x, i) => x - rows.at(-1)![i]));
    const last = rows[deg];
    if (last.every((x) => eq(x, last[0]))) {
      let next = last[0];
      for (let k = deg - 1; k >= 0; k--) next = rows[k].at(-1)! + next;
      out.push({ name: `degree-${deg} polynomial`, next });
    }
  }
  // Geometric with rational ratio.
  if (s.every((x) => x !== 0)) {
    const r0 = s[1] / s[0];
    if (s.every((x, i) => i === 0 || eq(x, s[i - 1] * r0)) && isInt(s.at(-1)! * r0)) out.push({ name: 'geometric', next: s.at(-1)! * r0 });
  }
  // Affine first order a_n = m·a_{n−1} + c (2 params; needs 3 + 2 terms).
  if (n >= 5 && s[1] !== s[0]) {
    const m = (s[2] - s[1]) / (s[1] - s[0]);
    const c = s[1] - m * s[0];
    if (s.every((x, i) => i === 0 || eq(x, m * s[i - 1] + c))) out.push({ name: 'affine recurrence', next: m * s.at(-1)! + c });
  }
  // Second-order linear a_n = p·a_{n−1} + q·a_{n−2} (2 params; solve from terms 0–3, check the rest).
  if (n >= 6) {
    const det = s[1] * s[1] - s[0] * s[2];
    if (det !== 0) {
      const p = (s[2] * s[1] - s[0] * s[3]) / det;
      const q = (s[1] * s[3] - s[2] * s[2]) / det;
      if (s.every((x, i) => i < 2 || eq(x, p * s[i - 1] + q * s[i - 2]))) out.push({ name: 'linear recurrence (order 2)', next: p * s.at(-1)! + q * s.at(-2)! });
    }
  }
  // Second-order with a constant: a_n = a_{n−1} + a_{n−2} + c.
  if (n >= 5) {
    const c = s[2] - s[1] - s[0];
    if (s.every((x, i) => i < 2 || eq(x, s[i - 1] + s[i - 2] + c))) out.push({ name: 'sum of previous two plus constant', next: s.at(-1)! + s.at(-2)! + c });
  }
  // Interleaved: even and odd positions each arithmetic or each geometric (needs ≥ 3 of each).
  if (n >= 6) {
    const ev = s.filter((_, i) => i % 2 === 0), od = s.filter((_, i) => i % 2 === 1);
    const arith = (xs: number[]) => xs.every((x, i) => i < 2 || eq(x - xs[i - 1], xs[1] - xs[0]));
    const nextIdx = n % 2 === 0 ? ev : od;
    if (arith(ev) && arith(od)) out.push({ name: 'interleaved arithmetic', next: nextIdx.at(-1)! + nextIdx[1] - nextIdx[0] });
  }
  // Alternating two operations: the pairs (step 1, step 2) repeat; each step is +x or ×y.
  if (n >= 6) {
    const stepFits = (from: number, to: number, op: { add?: number; mul?: number }) => (op.add !== undefined ? eq(to, from + op.add) : eq(to, from * op.mul!));
    const cand = (i: number) => [{ add: s[i + 1] - s[i] }, ...(s[i] !== 0 ? [{ mul: s[i + 1] / s[i] }] : [])];
    for (const o1 of cand(0))
      for (const o2 of cand(1)) {
        const ops = [o1, o2];
        if (s.every((x, i) => i === 0 || stepFits(s[i - 1], x, ops[(i - 1) % 2]))) {
          const op = ops[(n - 1) % 2];
          const next = op.add !== undefined ? s.at(-1)! + op.add : s.at(-1)! * op.mul!;
          if (isInt(next)) out.push({ name: 'alternating operations', next });
        }
      }
  }
  return out;
}

/** Returns a description of a conflicting simple rule, or null if the intended answer is the only reading. */
export function ambiguity(shown: number[], answer: number): string | null {
  for (const f of fits(shown)) if (!eq(f.next, answer)) return `${f.name} predicts ${f.next}`;
  return null;
}

/**
 * Even when the next term agrees, a sequence like 27, 36, 45, … is "add 9", not "add the digit sum".
 * Reject draws where a strictly simpler family explains the shown terms, so the stated rule is the natural one.
 */
const SIMPLE_OWNERS: Record<string, FamilyId[]> = {
  'degree-1 polynomial': ['arith'],
  geometric: ['geom'],
  'degree-2 polynomial': ['square', 'quad', 'arith'],
};
function simplerReading(family: FamilyId, shown: number[]): boolean {
  return fits(shown).some((f) => SIMPLE_OWNERS[f.name] && !SIMPLE_OWNERS[f.name].includes(family));
}

// ------------------------------------------------------------------ generation

export function makeSequence(family: FamilyId, r: Rng, tier: Tier): Sequence | null {
  for (let tries = 0; tries < 40; tries++) {
    const d = FAMILIES[family].make(r);
    const shown = d.terms.slice(0, LEN);
    const answer = d.terms[LEN];
    if (d.terms.some((x) => !Number.isSafeInteger(x) || Math.abs(x) > SAFE)) continue;
    if (new Set(shown).size < 4) continue; // too degenerate to read
    if (ambiguity(shown, answer)) continue;
    if (simplerReading(family, shown)) continue;
    return { family, shown, answer, rule: d.rule, working: d.working(shown, answer), tier, key: `${family}:${shown.join(',')}` };
  }
  return null;
}

export function nextSequence(r: Rng, tier: Tier, seen: (key: string) => boolean, weights?: Partial<Record<FamilyId, number>>, avoid?: FamilyId): Sequence {
  const fams = familiesForTier(tier);
  for (let tries = 0; tries < 200; tries++) {
    const ws = fams.map((f) => (f === avoid ? 0.15 : 1) * (weights?.[f] ?? 1));
    const f = r.weighted(fams, ws);
    const s = makeSequence(f, r, tier);
    if (s && !seen(s.key)) return s;
  }
  throw new Error('could not generate an unseen sequence');
}

export function difference(xs: number[]): number[] {
  return xs.slice(1).map((x, i) => x - xs[i]);
}
