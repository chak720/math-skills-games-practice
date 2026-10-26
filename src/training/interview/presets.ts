/** Interview round presets and segment scoring. */
import type { SkillId } from '@/training/maths/generators';
import type { Category, Tier } from '@/training/puzzles/types';
import type { Difficulty } from '@/training/market-making/game';
import { growth, kellyFraction } from '@/training/betting/kelly';

export type Segment =
  | { kind: 'maths'; n: number; sec: number; skills: SkillId[]; level: number }
  | { kind: 'puzzle'; category: Category | 'any'; tier: Tier; sec: number }
  | { kind: 'sequences'; n: number; sec: number; tier: 1 | 2 | 3 }
  | { kind: 'fermi'; sec: number }
  | { kind: 'market'; difficulty: Difficulty }
  | { kind: 'kelly'; n: number; sec: number };

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  segments: Segment[];
}

const QUICK: SkillId[] = ['add', 'sub', 'mul', 'div', 'frac-dec', 'pct-of', 'dec-mul'];
const TRADING: SkillId[] = ['mul', 'div', 'ev-bet', 'odds-prob', 'breakeven', 'pnl', 'pct-change', 'bps'];

export const PRESETS: Preset[] = [
  {
    id: 'screen',
    name: 'First-round screen',
    blurb: 'About 15 minutes. Quick arithmetic, one probability question, sequences and a sizing question: the shape of a typical online or phone screen.',
    segments: [
      { kind: 'maths', n: 15, sec: 180, skills: QUICK, level: 3 },
      { kind: 'puzzle', category: 'probability', tier: 'interview', sec: 360 },
      { kind: 'sequences', n: 4, sec: 120, tier: 2 },
      { kind: 'kelly', n: 2, sec: 120 },
    ],
  },
  {
    id: 'trading',
    name: 'Trading round',
    blurb: 'About 20 minutes. Trading arithmetic, an expected-value game, a live market on a hidden quantity, and an estimate.',
    segments: [
      { kind: 'maths', n: 10, sec: 150, skills: TRADING, level: 3 },
      { kind: 'puzzle', category: 'ev', tier: 'interview', sec: 360 },
      { kind: 'market', difficulty: 'normal' },
      { kind: 'fermi', sec: 240 },
    ],
  },
  {
    id: 'research',
    name: 'Research round',
    blurb: 'About 25 minutes. Three harder problems in probability, Markov chains and combinatorics, one after another.',
    segments: [
      { kind: 'puzzle', category: 'probability', tier: 'hard', sec: 540 },
      { kind: 'puzzle', category: 'markov', tier: 'interview', sec: 420 },
      { kind: 'puzzle', category: 'combinatorics', tier: 'hard', sec: 540 },
    ],
  },
  {
    id: 'full',
    name: 'Full mock',
    blurb: 'About 35 minutes. Everything: arithmetic, sequences, two puzzles, an estimate, a market and bet sizing.',
    segments: [
      { kind: 'maths', n: 15, sec: 180, skills: [...QUICK, 'pct-change', 'frac-add'], level: 3 },
      { kind: 'sequences', n: 5, sec: 150, tier: 2 },
      { kind: 'puzzle', category: 'any', tier: 'interview', sec: 360 },
      { kind: 'puzzle', category: 'any', tier: 'hard', sec: 480 },
      { kind: 'fermi', sec: 240 },
      { kind: 'market', difficulty: 'normal' },
      { kind: 'kelly', n: 3, sec: 180 },
    ],
  },
];

export const SEGMENT_LABEL: Record<Segment['kind'], string> = { maths: 'Mental maths', puzzle: 'Puzzle', sequences: 'Sequences', fermi: 'Estimation', market: 'Market making', kelly: 'Bet sizing' };

export function segmentTitle(s: Segment): string {
  switch (s.kind) {
    case 'maths':
      return `${s.n} arithmetic questions`;
    case 'puzzle':
      return `${s.category === 'any' ? 'A' : `A ${s.category === 'ev' ? 'expected-value' : s.category}`} ${s.tier === 'hard' ? 'hard ' : ''}puzzle`;
    case 'sequences':
      return `${s.n} sequences`;
    case 'fermi':
      return 'One Fermi estimate';
    case 'market':
      return 'Make a market';
    case 'kelly':
      return `${s.n} bet-sizing questions`;
  }
}

export const segmentMinutes = (s: Segment): number => (s.kind === 'market' ? 5 : Math.round(s.sec / 60));

// ------------------------------------------------------------------ scoring (0–100)

/** Arithmetic: wrong answers cost half a point, as in timed tests with negative marking. */
export const scoreMaths = (correct: number, wrong: number, n: number): number => Math.round(Math.max(0, (100 * (correct - 0.5 * wrong)) / n));

/** Puzzle: full marks for a clean solve; each hint costs 20, each wrong submission 10; unsolved scores 0. */
export const scorePuzzle = (solved: boolean, hints: number, misses: number): number => (solved ? Math.max(10, 100 - 20 * hints - 10 * misses) : 0);

/** Fermi: 60% accuracy points (log error), 40% for the interval containing the truth. */
export const scoreFermi = (points: number, hit: boolean): number => Math.round(0.6 * points + (hit ? 40 : 0));

/** Market: 50 at zero edge, 100 if every trade earned half the maximum width against fair value, lower when picked off. */
export function scoreMarket(edge: number, trades: number, maxWidth: number): number {
  if (!trades) return 40;
  return Math.round(Math.max(0, Math.min(100, 50 + (50 * edge) / ((trades * maxWidth) / 2))));
}

/** Bet sizing: share of Kelly's expected log growth captured; for a bad bet, any stake costs. */
export function scoreKelly(p: number, b: number, f: number): number {
  const k = kellyFraction(p, b);
  if (k <= 0) return Math.round(Math.max(0, 100 - 1000 * f));
  return Math.round(100 * Math.max(0, Math.min(1, growth(f, p, b) / growth(k, p, b))));
}

export function verdict(score: number): string {
  if (score >= 80) return 'Strong: this would usually progress.';
  if (score >= 65) return 'Solid: likely to progress, with gaps to tidy up.';
  if (score >= 50) return 'Borderline: some sections would worry an interviewer.';
  return 'Not there yet: drill the weakest sections and try again.';
}
