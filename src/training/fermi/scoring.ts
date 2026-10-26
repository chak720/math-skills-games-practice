/** Parsing quantities and scoring Fermi estimates in log space. */
import { wilson } from '@/shared/math/stats';

const WORDS: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12, quadrillion: 1e15,
};

/** "3.5e6", "3.5 million", "3.5m", "2k", "1.2bn", "40,000", "3×10^6", "3*10^6" → number; null if unreadable or not positive. */
export function parseQuantity(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ');
  if (!s) return null;
  const sci = s.match(/^(\d*\.?\d+)\s*(?:[x×*])\s*10\s*\^\s*(-?\d+)$/);
  if (sci) return pos(Number(sci[1]) * 10 ** Number(sci[2]));
  const pow = s.match(/^10\s*\^\s*(-?\d+)$/);
  if (pow) return pos(10 ** Number(pow[1]));
  const m = s.match(/^(\d*\.?\d+(?:e[+-]?\d+)?)\s*([a-z]+)?$/);
  if (!m) return null;
  const base = Number(m[1]);
  if (!m[2]) return pos(base);
  const mult = WORDS[m[2]];
  return mult ? pos(base * mult) : null;
}
const pos = (x: number): number | null => (Number.isFinite(x) && x > 0 ? x : null);

/** Human-friendly rendering: 3.6 million, 41,000, 2.5 × 10¹⁸. */
export function fmtQuantity(x: number): string {
  if (!Number.isFinite(x)) return '–';
  const a = Math.abs(x);
  const sig = (v: number) => Number(v.toPrecision(3)).toLocaleString('en-GB');
  if (a >= 1e15 || (a > 0 && a < 1e-3)) {
    const e = Math.floor(Math.log10(a));
    const m = x / 10 ** e;
    return `${Number(m.toPrecision(3))} × 10${superscript(e)}`;
  }
  if (a >= 1e12) return `${sig(x / 1e12)} trillion`;
  if (a >= 1e9) return `${sig(x / 1e9)} billion`;
  if (a >= 1e6) return `${sig(x / 1e6)} million`;
  return sig(x);
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (n: number): string => `${n < 0 ? '⁻' : ''}${String(Math.abs(n)).split('').map((d) => SUP[Number(d)]).join('')}`;

export interface FermiScore {
  /** log10(estimate / truth): positive means too high. */
  logErr: number;
  /** 100 for exact, falling linearly to 0 at 1.5 orders of magnitude off. */
  points: number;
  within2: boolean;
  within10: boolean;
  hit: boolean;
  /** Width of the 90% interval in orders of magnitude. */
  widthOom: number;
  /** Interval score (α = 0.1) in log10 units; lower is better. */
  intervalScore: number;
}

export function score(est: number, lo: number, hi: number, truth: number): FermiScore {
  const y = Math.log10(truth), l = Math.log10(lo), u = Math.log10(hi);
  const logErr = Math.log10(est) - y;
  const alpha = 0.1;
  const is = u - l + (2 / alpha) * Math.max(0, l - y) + (2 / alpha) * Math.max(0, y - u);
  return {
    logErr,
    points: Math.round(100 * Math.max(0, 1 - Math.abs(logErr) / 1.5)),
    within2: Math.abs(logErr) <= Math.log10(2) + 1e-12,
    within10: Math.abs(logErr) <= 1 + 1e-12,
    hit: truth >= lo && truth <= hi,
    widthOom: u - l,
    intervalScore: is,
  };
}

export function describeError(logErr: number): string {
  const f = 10 ** Math.abs(logErr);
  if (f < 1.05) return 'spot on';
  return `${f < 10 ? f.toFixed(1) : Math.round(f).toLocaleString('en-GB')}× too ${logErr > 0 ? 'high' : 'low'}`;
}

export interface Calibration {
  n: number;
  hits: number;
  rate: number;
  lo: number;
  hi: number;
  /** Plain-language verdict. */
  verdict: string;
  /** Average width in orders of magnitude. */
  meanWidth: number;
}

export function calibration(rows: { hit: boolean; widthOom: number }[]): Calibration {
  const n = rows.length, hits = rows.filter((r) => r.hit).length;
  const [lo, hi] = n ? wilson(hits, n) : [0, 1];
  const meanWidth = n ? rows.reduce((s, r) => s + r.widthOom, 0) / n : 0;
  let verdict = 'Answer a few more to judge your calibration.';
  if (n >= 8) {
    if (hi < 0.9) verdict = `Overconfident: your 90% intervals catch the truth only ${Math.round((100 * hits) / n)}% of the time. Widen them.`;
    else if (lo > 0.9) verdict = 'Underconfident: your intervals are wider than they need to be. Tighten them a little.';
    else verdict = 'Well calibrated: your hit rate is consistent with 90%.';
  }
  return { n, hits, rate: n ? hits / n : 0, lo, hi, verdict, meanWidth };
}
