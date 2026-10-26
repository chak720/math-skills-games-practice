/**
 * Choosing the next puzzle.
 *
 *  - Never repeat: every puzzle shown is fingerprinted (generator + canonical
 *    parameters) and stored; the pipeline rejects seen fingerprints.
 *  - Novelty: structures from the last few puzzles are avoided, so the next one
 *    is not the same problem with new numbers.
 *  - Rotation: categories and generators used recently are down-weighted.
 *  - Spaced repetition by technique: techniques you miss or needed hints for
 *    come back sooner; techniques you nail drift away.
 *  - Adaptive tier: a per-category level moves up with clean solves and down
 *    with misses.
 */
import { load, save, update } from '@/shared/storage/store';
import { priority, getDeck, recordReview } from '@/shared/srs/srs';
import { recordAttempt } from '@/shared/stats/activity';
import type { Rng } from '@/shared/random/prng';
import { ALL_GENERATORS } from './registry';
import type { Category, Generator, Puzzle, TechniqueId, Tier } from './types';

export const SEEN_KEY = 'puzzles.seen';
export const HISTORY_KEY = 'puzzles.history';
export const LEVELS_KEY = 'puzzles.levels';
const MAX_SEEN = 40_000;
const MAX_HISTORY = 1_500;
const NOVELTY_WINDOW = 6;

export type TierChoice = Tier | 'adaptive';
export type Focus = 'mixed' | 'review';

export interface Filter {
  category: Category | 'any';
  tier: TierChoice;
  focus: Focus;
  /** Practise one technique only. */
  technique?: TechniqueId;
}

export interface PuzzleAttempt {
  id: string;
  generatorId: string;
  category: Category;
  tier: Tier;
  title: string;
  techniques: TechniqueId[];
  structure: string;
  t: number;
  correct: boolean;
  /** Wrong submissions before the final one. */
  misses: number;
  hintsUsed: number;
  revealed: boolean;
  ms: number;
  interviewer: boolean;
  /** Interviewer-mode self-assessment of the spoken/written explanation. */
  explained?: 'clear' | 'partial' | 'missed';
}

// ------------------------------------------------------------------ storage

export const getSeen = (): string[] => load<string[]>(SEEN_KEY, []);
export function markSeen(id: string): void {
  update<string[]>(SEEN_KEY, [], (xs) => (xs.includes(id) ? xs : [...xs, id].slice(-MAX_SEEN)));
}
export const getHistory = (): PuzzleAttempt[] => load<PuzzleAttempt[]>(HISTORY_KEY, []);
export const getLevels = (): Partial<Record<Category, number>> => load<Partial<Record<Category, number>>>(LEVELS_KEY, {});

// ------------------------------------------------------------------ tier

const TIER_ORDER: Tier[] = ['warmup', 'interview', 'hard'];
export const levelTier = (level: number): Tier => TIER_ORDER[Math.max(0, Math.min(2, Math.floor(level)))];
const START_LEVEL = 0.7;

/** The supported tier nearest to the wanted one, preferring easier on ties. */
export function fitTier(g: Generator<unknown>, want: Tier): Tier {
  if (g.tiers.includes(want)) return want;
  const w = TIER_ORDER.indexOf(want);
  return [...g.tiers].sort((a, b) => Math.abs(TIER_ORDER.indexOf(a) - w) - Math.abs(TIER_ORDER.indexOf(b) - w) || TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b))[0];
}

export function tierFor(g: Generator<unknown>, choice: TierChoice): Tier {
  return fitTier(g, choice === 'adaptive' ? levelTier(getLevels()[g.category] ?? START_LEVEL) : choice);
}

// ------------------------------------------------------------------ choice

export interface Candidate {
  g: Generator<unknown>;
  tier: Tier;
  weight: number;
}

/** Weights for every eligible generator given the history. Exposed for tests and the "why this puzzle" note. */
export function candidates(filter: Filter, history: PuzzleAttempt[] = getHistory(), now = Date.now()): Candidate[] {
  const deck = getDeck('puzzles');
  const recent = history.slice(-8).reverse();
  const tried = new Set(history.map((h) => h.generatorId));
  const pool = ALL_GENERATORS.filter((g) => filter.category === 'any' || g.category === filter.category)
    .filter((g) => filter.tier === 'adaptive' || g.tiers.includes(filter.tier))
    .filter((g) => !filter.technique || g.techniques.includes(filter.technique));
  return pool.map((g) => {
    let w = 1;
    // Rotation: the same generator soon again is unlikely; the same category less so.
    const gi = recent.findIndex((h) => h.generatorId === g.id);
    if (gi >= 0) w *= gi < 2 ? 0.05 : gi < 5 ? 0.3 : 0.7;
    if (filter.category === 'any') {
      const ci = recent.findIndex((h) => h.category === g.category);
      if (ci === 0) w *= 0.35;
      else if (ci === 1) w *= 0.7;
    }
    if (!tried.has(g.id)) w *= 1.4;
    if (filter.focus === 'review') {
      // Review: only techniques you have met, weakest and overdue first (even if a miss is not due yet).
      const need = Math.max(...g.techniques.map((t) => {
        const c = deck[t];
        return c ? (c.due <= now ? 2 : 1) * (0.2 + 1 - c.acc + 0.1 * c.lapses) : 0.15;
      }));
      w *= need ** 2;
    } else {
      // Mixed: SM-2 priority, which also introduces unseen techniques.
      w *= 0.5 + Math.max(...g.techniques.map((t) => priority(deck[t], now)));
    }
    return { g, tier: tierFor(g, filter.tier), weight: w };
  });
}

/** Generators in the order to try them: weighted sampling without replacement. */
export function orderCandidates(cs: Candidate[], rng: Rng): Candidate[] {
  const left = [...cs];
  const out: Candidate[] = [];
  while (left.length) {
    const i = rng.weighted(left.map((_, k) => k), left.map((c) => c.weight));
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

export const recentStructures = (history: PuzzleAttempt[] = getHistory()): string[] => history.slice(-NOVELTY_WINDOW).map((h) => h.structure);

// ------------------------------------------------------------------ results

/** SM-2 quality from how the attempt went. */
export function quality(a: Pick<PuzzleAttempt, 'correct' | 'misses' | 'hintsUsed' | 'revealed' | 'ms'>, targetMs = 6 * 60_000): number {
  if (a.revealed || !a.correct) return 1;
  let qv = a.hintsUsed === 0 ? (a.ms < targetMs ? 5 : 4) : a.hintsUsed === 1 ? 3 : 2;
  if (a.misses > 0) qv = Math.max(2, qv - 1);
  return qv;
}

const TARGET_MS: Record<Tier, number> = { warmup: 3 * 60_000, interview: 6 * 60_000, hard: 12 * 60_000 };

export function recordResult(p: Puzzle, r: Omit<PuzzleAttempt, 'id' | 'generatorId' | 'category' | 'tier' | 'title' | 'techniques' | 'structure' | 't'>, now = Date.now()): PuzzleAttempt {
  const attempt: PuzzleAttempt = { id: p.id, generatorId: p.generatorId, category: p.category, tier: p.tier, title: p.title, techniques: p.techniques, structure: p.structure, t: now, ...r };
  update<PuzzleAttempt[]>(HISTORY_KEY, [], (xs) => [...xs, attempt].slice(-MAX_HISTORY));
  const qv = quality(attempt, TARGET_MS[p.tier]);
  for (const t of p.techniques) recordReview('puzzles', t, qv, now);
  // Level: clean solves at (or above) your tier move you up; misses move you down.
  const levels = getLevels();
  const lv = levels[p.category] ?? START_LEVEL;
  const atLevel = TIER_ORDER.indexOf(p.tier) >= Math.floor(lv);
  const delta = qv >= 4 ? (atLevel ? 0.35 : 0.1) : qv === 3 ? 0.1 : qv === 2 ? -0.1 : -0.3;
  save(LEVELS_KEY, { ...levels, [p.category]: Math.max(0, Math.min(2.99, lv + delta)) });
  recordAttempt({ section: 'puzzles', skill: `puzzles:${p.category}`, correct: attempt.correct && !attempt.revealed && attempt.hintsUsed === 0, ms: attempt.ms, score: qv, t: now });
  return attempt;
}

/** Attach the interviewer-mode self-assessment to the attempt it belongs to. */
export function annotateExplanation(id: string, t: number, explained: PuzzleAttempt['explained']): void {
  update<PuzzleAttempt[]>(HISTORY_KEY, [], (xs) => xs.map((x) => (x.id === id && x.t === t ? { ...x, explained } : x)));
}

// ------------------------------------------------------------------ summaries

export interface TechniqueSummary {
  id: TechniqueId;
  n: number;
  clean: number;
  due: boolean;
  acc: number;
}

export function techniqueSummary(history: PuzzleAttempt[] = getHistory(), now = Date.now()): TechniqueSummary[] {
  const deck = getDeck('puzzles');
  const by = new Map<TechniqueId, { n: number; clean: number }>();
  for (const h of history)
    for (const t of h.techniques) {
      const s = by.get(t) ?? { n: 0, clean: 0 };
      s.n++;
      if (h.correct && !h.revealed && h.hintsUsed === 0 && h.misses === 0) s.clean++;
      by.set(t, s);
    }
  return [...by.entries()].map(([id, s]) => ({ id, ...s, due: (deck[id]?.due ?? 0) <= now, acc: deck[id]?.acc ?? 0.5 }));
}
