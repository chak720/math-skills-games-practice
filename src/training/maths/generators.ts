/**
 * Mental-maths question generators. Every question carries its exact answer,
 * a tolerance, and a short worked line. Generators take a difficulty level
 * (1–5) so adaptive practice can raise or lower it per skill.
 */
import { Rng } from '@/shared/random/prng';
import { gcdNum } from '@/shared/math/combinatorics';

export interface Question {
  skill: SkillId;
  prompt: string;
  answer: number;
  /** Text shown as the correct answer. */
  answerText: string;
  /** Accept |x − answer| <= abs or <= rel·|answer|. */
  tol: { abs?: number; rel?: number };
  /** Submit as soon as the typed value is correct (exact-answer questions). */
  autoSubmit: boolean;
  /** One-line method. */
  how?: string;
  /** Answer is a percentage: accept "15" or "15%" for 15%. */
  percent?: boolean;
}

export type SkillId =
  | 'add' | 'sub' | 'mul' | 'div'
  | 'dec-add' | 'dec-mul' | 'frac-add' | 'frac-mul' | 'frac-dec' | 'pct-of' | 'pct-change' | 'compound'
  | 'est-mul' | 'est-div' | 'est-sqrt' | 'est-pct'
  | 'ev-bet' | 'odds-prob' | 'breakeven' | 'pnl' | 'avg-price' | 'bps'
  | 'sq-50' | 'sq-100' | 'mul-25' | 'diff-sq' | 'mul-11' | 'mul-9s' | 'pct-swap';

export const SKILL_LABEL: Record<SkillId, string> = {
  add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division',
  'dec-add': 'Decimal add/subtract', 'dec-mul': 'Decimal multiply', 'frac-add': 'Fraction add', 'frac-mul': 'Fraction multiply', 'frac-dec': 'Fraction → decimal',
  'pct-of': 'Percent of', 'pct-change': 'Percent change', compound: 'Compounding',
  'est-mul': 'Estimate products', 'est-div': 'Estimate quotients', 'est-sqrt': 'Estimate roots', 'est-pct': 'Estimate percents',
  'ev-bet': 'Expected value', 'odds-prob': 'Odds ↔ probability', breakeven: 'Break-even odds', pnl: 'Trade P&L', 'avg-price': 'Average price', bps: 'Basis points',
  'sq-50': 'Squares near 50', 'sq-100': 'Squares near 100', 'mul-25': '× 25 and × 125', 'diff-sq': 'Difference of squares', 'mul-11': '× 11', 'mul-9s': '× 9, 99, 999', 'pct-swap': 'Percent swap',
};

/** Target response time per skill at level 3 (ms); scaled by level. */
export const TARGET_MS: Partial<Record<SkillId, number>> = { add: 3000, sub: 3500, mul: 5000, div: 5000, 'frac-dec': 5000, 'pct-of': 6000 };
export const targetMs = (s: SkillId, level: number): number => (TARGET_MS[s] ?? 9000) * (0.6 + 0.2 * level);

const fix = (x: number, d = 6): number => Number(x.toFixed(d));
export function fmtNum(x: number, maxDp = 6): string {
  const s = fix(x, maxDp).toString();
  return s.includes('e') ? x.toPrecision(6) : s;
}
const exact = (skill: SkillId, prompt: string, answer: number, how?: string): Question => ({ skill, prompt, answer: fix(answer, 9), answerText: fmtNum(answer), tol: { abs: 1e-9 }, autoSubmit: true, how });

function frac(n: number, d: number): string {
  const g = gcdNum(n, d);
  return `${n / g}/${d / g}`;
}

type Gen = (level: number, r: Rng) => Question;

const GENS: Record<SkillId, Gen> = {
  add: (L, r) => {
    const [a, b] = [[2, 99, 2, 99], [10, 999, 10, 99], [100, 999, 100, 999], [1000, 9999, 100, 999], [1000, 9999, 1000, 9999]][L - 1].reduce<number[][]>((acc, x, i) => (i % 2 ? (acc[acc.length - 1].push(x), acc) : [...acc, [x]]), []).map(([lo, hi]) => r.range(lo, hi));
    return exact('add', `${a} + ${b}`, a + b);
  },
  sub: (L, r) => {
    const hi = [99, 999, 999, 9999, 9999][L - 1];
    let a = r.range(10, hi), b = r.range(2, Math.max(9, Math.floor(hi * (L >= 3 ? 1 : 0.6))));
    if (L < 5 && b > a) [a, b] = [b, a];
    return exact('sub', `${a} − ${b}`, a - b);
  },
  mul: (L, r) => {
    const [a, b] = [[r.range(2, 12), r.range(2, 12)], [r.range(11, 99), r.range(3, 9)], [r.range(11, 99), r.range(11, 99)], [r.range(101, 999), r.range(3, 9)], [r.range(101, 999), r.range(11, 99)]][L - 1];
    return exact('mul', `${a} × ${b}`, a * b, `split into tens and units: ${a} × ${b}`);
  },
  div: (L, r) => {
    const [q, d] = [[r.range(2, 12), r.range(2, 12)], [r.range(11, 99), r.range(3, 9)], [r.range(101, 999), r.range(3, 9)], [r.range(11, 99), r.range(11, 49)], [r.range(101, 999), r.range(11, 99)]][L - 1];
    return exact('div', `${q * d} ÷ ${d}`, q);
  },
  'dec-add': (L, r) => {
    const dp = L <= 2 ? 1 : 2;
    const a = r.range(1, 10 ** (1 + L)) / 10 ** dp, b = r.range(1, 10 ** (L)) / 10 ** (dp + (L >= 4 ? 1 : 0));
    return r.chance(0.5) ? exact('dec-add', `${fmtNum(a)} + ${fmtNum(b)}`, a + b) : exact('dec-add', `${fmtNum(a + b)} − ${fmtNum(b)}`, a);
  },
  'dec-mul': (L, r) => {
    const a = r.range(2, L >= 3 ? 99 : 9) / 10 ** r.range(1, Math.min(2, L));
    const b = r.range(2, 9) / 10 ** r.range(0, Math.min(3, L));
    return exact('dec-mul', `${fmtNum(a)} × ${fmtNum(b)}`, a * b, 'multiply the integers, then count decimal places');
  },
  'frac-add': (L, r) => {
    const ds = [2, 3, 4, 5, 6, 8, 10, 12].slice(0, 3 + L);
    const d1 = r.pick(ds), d2 = r.pick(ds);
    const n1 = r.range(1, d1 - 1), n2 = r.range(1, d2 - 1);
    const sub = L >= 3 && r.chance(0.4);
    const num = n1 * d2 + (sub ? -1 : 1) * n2 * d1, den = d1 * d2;
    return { skill: 'frac-add', prompt: `${n1}/${d1} ${sub ? '−' : '+'} ${n2}/${d2}`, answer: num / den, answerText: `${frac(num, den)} ≈ ${fmtNum(num / den, 4)}`, tol: { abs: 0.0005 }, autoSubmit: false, how: `common denominator ${den}` };
  },
  'frac-mul': (L, r) => {
    const n1 = r.range(1, 9), d1 = r.range(n1 + 1, 12), n2 = r.range(1, 9), d2 = r.range(2, 12);
    const div = L >= 3 && r.chance(0.5);
    const num = div ? n1 * d2 : n1 * n2, den = div ? d1 * n2 : d1 * d2;
    return { skill: 'frac-mul', prompt: `${n1}/${d1} ${div ? '÷' : '×'} ${n2}/${d2}`, answer: num / den, answerText: `${frac(num, den)} ≈ ${fmtNum(num / den, 4)}`, tol: { abs: 0.0005 }, autoSubmit: false, how: div ? 'multiply by the reciprocal' : 'cancel first, then multiply' };
  },
  'frac-dec': (L, r) => {
    const dens = [[2, 4, 5, 8, 10], [3, 6, 8, 16, 20], [7, 9, 11, 12, 16], [7, 13, 15, 16, 32], [7, 17, 19, 23, 32]][L - 1];
    const d = r.pick(dens), n = r.range(1, d - 1);
    const val = n / d;
    const terminating = [2, 4, 5, 8, 10, 16, 20, 32].includes(d / gcdNum(n, d));
    return { skill: 'frac-dec', prompt: `${n}/${d} as a decimal`, answer: val, answerText: terminating ? fmtNum(val, 8) : `${frac(n, d)} ≈ ${fmtNum(val, 4)}`, tol: { abs: terminating ? 1e-9 : 0.0006 }, autoSubmit: terminating, how: d === 7 ? '1/7 = 0.142857 and the multiples cycle the same digits' : d === 16 || d === 32 ? 'halve 1/8 = 0.125 repeatedly' : `long division by ${d}` };
  },
  'pct-of': (L, r) => {
    const p = r.pick([[10, 20, 25, 50], [5, 15, 30, 75], [12, 35, 45, 60, 80], [12.5, 17.5, 2.5, 37.5, 62.5], [7, 13, 23, 0.5, 1.25]][L - 1]);
    const base = r.range(2, 40) * (L >= 4 ? 8 : 4) * (L >= 3 ? 10 : 1);
    return exact('pct-of', `${p}% of ${base}`, (p * base) / 100);
  },
  'pct-change': (L, r) => {
    const a = r.range(2, 20) * (L >= 3 ? 25 : 10);
    const pct = r.pick([[10, 20, 25, 50, -10, -20, -50], [5, 15, 30, 40, -5, -25], [12.5, 8, 35, -15, -40], [2.5, 7.5, 17.5, -12.5, -37.5], [1.5, 3.2, 6.4, -2.4]][L - 1]);
    const b = fix(a * (1 + pct / 100), 6);
    return { skill: 'pct-change', prompt: `From ${fmtNum(a)} to ${fmtNum(b)}: % change?`, answer: pct, answerText: `${pct > 0 ? '+' : ''}${pct}%`, tol: { abs: 1e-6 }, autoSubmit: true, percent: true, how: '(new − old) / old × 100' };
  },
  compound: (L, r) => {
    const rate = r.pick([5, 10, 4, 8, 3, 6, 12]);
    const n = r.range(2, 2 + L);
    const v = (1 + rate / 100) ** n;
    return { skill: 'compound', prompt: `100 grows ${rate}% a year for ${n} years: value?`, answer: 100 * v, answerText: fmtNum(100 * v, 2), tol: { rel: 0.005 }, autoSubmit: false, how: `(1 + r)^n ≈ 1 + nr + n(n−1)r²/2 = ${fmtNum(100 * (1 + n * rate / 100 + (n * (n - 1) / 2) * (rate / 100) ** 2), 2)}` };
  },
  'est-mul': (L, r) => {
    const a = r.range(105, 990) / 10 * (L >= 3 ? 10 : 1), b = r.range(105, 990) / 10;
    return { skill: 'est-mul', prompt: `≈ ${fmtNum(a)} × ${fmtNum(b)}`, answer: a * b, answerText: fmtNum(a * b, 1), tol: { rel: [0.1, 0.07, 0.05, 0.04, 0.03][L - 1] }, autoSubmit: false, how: 'round to friendly numbers and correct for the rounding' };
  },
  'est-div': (L, r) => {
    const a = r.range(1000, 99999) / (L >= 3 ? 10 : 1), b = r.range(110, 990) / 10;
    return { skill: 'est-div', prompt: `≈ ${fmtNum(a)} ÷ ${fmtNum(b)}`, answer: a / b, answerText: fmtNum(a / b, 2), tol: { rel: [0.1, 0.07, 0.05, 0.04, 0.03][L - 1] }, autoSubmit: false };
  },
  'est-sqrt': (L, r) => {
    const x = r.range(20, [400, 2000, 10000, 50000, 200000][L - 1]);
    return { skill: 'est-sqrt', prompt: `≈ √${x}`, answer: Math.sqrt(x), answerText: fmtNum(Math.sqrt(x), 3), tol: { rel: [0.05, 0.04, 0.03, 0.02, 0.015][L - 1] }, autoSubmit: false, how: '√(a² + d) ≈ a + d/(2a)' };
  },
  'est-pct': (L, r) => {
    const p = r.range(3, 97) + (L >= 3 ? r.range(1, 9) / 10 : 0), base = r.range(1000, 99999);
    return { skill: 'est-pct', prompt: `≈ ${fmtNum(p)}% of ${base.toLocaleString()}`, answer: (p * base) / 100, answerText: fmtNum((p * base) / 100, 1), tol: { rel: [0.08, 0.06, 0.05, 0.04, 0.03][L - 1] }, autoSubmit: false };
  },
  'ev-bet': (L, r) => {
    const p = r.pick([0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.75, 1 / 3, 1 / 6]);
    const win = r.range(2, 20) * (L >= 3 ? 5 : 1), lose = r.range(1, 10) * (L >= 3 ? 5 : 1);
    const ev = p * win - (1 - p) * lose;
    const pTxt = p === 1 / 3 ? '1/3' : p === 1 / 6 ? '1/6' : fmtNum(p);
    return { skill: 'ev-bet', prompt: `Win $${win} with probability ${pTxt}, else lose $${lose}. EV?`, answer: ev, answerText: fmtNum(ev, 3), tol: { abs: 0.01 }, autoSubmit: false, how: 'EV = p·W − (1 − p)·L' };
  },
  'odds-prob': (L, r) => {
    const against = r.range(1, 9), to = r.pick([1, 1, 2, 3]);
    if (gcdNum(against, to) !== 1 || against === to) return GENS['odds-prob'](L, r);
    const pr = to / (against + to);
    return { skill: 'odds-prob', prompt: `Odds ${against} to ${to} against: probability (%)?`, answer: pr * 100, answerText: `${fmtNum(pr * 100, 2)}%`, tol: { abs: 0.06 }, autoSubmit: false, percent: true, how: `p = ${to} / (${against} + ${to})` };
  },
  breakeven: (_L, r) => {
    const pays = r.pick([1.5, 2, 2.5, 3, 4, 5, 7, 9, 0.5]);
    const p = 1 / (1 + pays);
    return { skill: 'breakeven', prompt: `A bet pays ${pays} to 1. Break-even win probability (%)?`, answer: p * 100, answerText: `${fmtNum(p * 100, 2)}%`, tol: { abs: 0.06 }, autoSubmit: false, percent: true, how: 'p·payout = (1 − p) ⇒ p = 1 / (1 + payout)' };
  },
  pnl: (L, r) => {
    const qty = r.range(1, 20) * (L >= 3 ? 50 : 100);
    const buy = r.range(1000, 9999) / 100;
    const move = r.range(-60, 60) / 100 || 0.05;
    const sell = fix(buy + move, 2);
    const short = L >= 2 && r.chance(0.35);
    const pnl = (short ? buy - sell : sell - buy) * qty;
    return exact('pnl', short ? `Sell short ${qty} at ${buy.toFixed(2)}, buy back at ${sell.toFixed(2)}. P&L?` : `Buy ${qty} at ${buy.toFixed(2)}, sell at ${sell.toFixed(2)}. P&L?`, fix(pnl, 2), 'quantity × price change');
  },
  'avg-price': (_L, r) => {
    const q1 = r.range(1, 9) * 100, q2 = r.range(1, 9) * 100;
    const p1 = r.range(4000, 6000) / 100, p2 = fix(p1 + r.range(-50, 50) / 100, 2);
    const avg = (q1 * p1 + q2 * p2) / (q1 + q2);
    return { skill: 'avg-price', prompt: `Buy ${q1} at ${p1.toFixed(2)} and ${q2} at ${p2.toFixed(2)}. Average price?`, answer: avg, answerText: fmtNum(avg, 4), tol: { abs: 0.005 }, autoSubmit: false, how: 'weighted by quantity: p1 + (p2 − p1)·q2/(q1 + q2)' };
  },
  bps: (_L, r) => {
    const b = r.pick([1, 5, 10, 25, 35, 50, 75, 120, 2.5]);
    const notional = r.pick([1, 2, 5, 10, 25, 40, 100]) * 1_000_000;
    return exact('bps', `${b} bp of ${(notional / 1e6).toLocaleString()} million`, (b / 10000) * notional, '1 bp = 0.01% = 1/10,000');
  },
  'sq-50': (L, r) => {
    const d = r.range(-9, 9) * (L >= 4 ? 1 : 1) || 3;
    const x = 50 + d;
    return exact('sq-50', `${x}²`, x * x, `(50 + d)² = 2500 + 100d + d², d = ${d}`);
  },
  'sq-100': (L, r) => {
    const d = r.range(-12, 12) || 4;
    const base = L >= 4 ? 1000 : 100;
    const x = base + d;
    return exact('sq-100', `${x}²`, x * x, base === 100 ? `(100 + d)² = 10000 + 200d + d²` : `(1000 + d)² = 1,000,000 + 2000d + d²`);
  },
  'mul-25': (L, r) => {
    const big = L >= 3 && r.chance(0.5);
    const m = big ? 125 : 25;
    const x = big ? r.range(2, 40) * 8 / r.pick([1, 2]) : r.range(2, 99) * (L >= 2 ? 1 : 4);
    return exact('mul-25', `${m} × ${x}`, m * x, big ? '× 125 = × 1000 ÷ 8' : '× 25 = × 100 ÷ 4');
  },
  'diff-sq': (L, r) => {
    const mid = r.pick(L >= 3 ? [30, 40, 50, 60, 70, 80, 90, 100, 200] : [20, 30, 40, 50, 60, 100]);
    const d = r.range(1, L >= 3 ? 9 : 5);
    return exact('diff-sq', `${mid - d} × ${mid + d}`, mid * mid - d * d, `(m − d)(m + d) = m² − d² = ${mid * mid} − ${d * d}`);
  },
  'mul-11': (L, r) => {
    const x = r.range(L >= 3 ? 100 : 12, L >= 3 ? 999 : 99);
    return exact('mul-11', `${x} × 11`, x * 11, 'write the outer digits, add neighbouring digits in between (carry as needed)');
  },
  'mul-9s': (L, r) => {
    const n = r.pick(L >= 3 ? [99, 999, 9, 99] : [9, 99]);
    const x = r.range(12, L >= 3 ? 999 : 99);
    return exact('mul-9s', `${x} × ${n}`, x * n, `x × (${n + 1} − 1) = ${x * (n + 1)} − ${x}`);
  },
  'pct-swap': (_L, r) => {
    const a = r.pick([4, 8, 12, 16, 20, 25, 50, 75]), b = r.pick([25, 50, 12.5, 2, 4, 5, 20]);
    return exact('pct-swap', `${b}% of ${a}`, (a * b) / 100, `x% of y = y% of x: ${a}% of ${b}`);
  },
};

export function generate(skill: SkillId, level: number, rng: Rng): Question {
  return GENS[skill](Math.max(1, Math.min(5, Math.round(level))), rng);
}

/** Is the typed value correct? */
export function isCorrect(q: Question, x: number | null): boolean {
  if (x === null || !Number.isFinite(x)) return false;
  const diff = Math.abs(x - q.answer);
  if (q.tol.abs !== undefined && diff <= q.tol.abs + 1e-9) return true;
  if (q.tol.rel !== undefined && diff <= q.tol.rel * Math.abs(q.answer)) return true;
  return false;
}

export const ALL_SKILLS = Object.keys(GENS) as SkillId[];
