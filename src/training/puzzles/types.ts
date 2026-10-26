/**
 * Puzzle generator contract.
 *
 * A generator draws parameters, renders a fresh wording, and answers the
 * question TWICE by independent methods (`solve` — the textbook method with
 * worked steps; `verify` — brute force, simulation-free enumeration, or a
 * different exact algorithm). The pipeline only ever ships puzzles whose two
 * answers agree.
 */
import type { Rng } from '@/shared/random/prng';
import type { Q } from '@/shared/math/rational';

export type Category = 'probability' | 'combinatorics' | 'ev' | 'logic' | 'brainteaser' | 'markov';
export type Tier = 'warmup' | 'interview' | 'hard';

export const CATEGORY_LABEL: Record<Category, string> = {
  probability: 'Probability',
  combinatorics: 'Combinatorics',
  ev: 'Expected-value games',
  logic: 'Logic',
  brainteaser: 'Brainteasers',
  markov: 'Markov chains & random walks',
};

export const TIER_LABEL: Record<Tier, string> = { warmup: 'Warm-up', interview: 'Interview', hard: 'Hard' };

export type AnswerValue =
  | { kind: 'rational'; value: Q }
  | { kind: 'integer'; value: bigint }
  | { kind: 'number'; value: number; tol: number }
  | { kind: 'choice'; options: string[]; correct: number }
  | { kind: 'set'; value: string[] };

export interface Solution {
  answer: AnswerValue;
  /** Worked, textbook-style steps. */
  steps: string[];
}

export interface Rendered {
  /** Prompt text. Blank lines separate paragraphs; lines indented 4 spaces are preformatted. */
  prompt: string;
  /** Short phrase naming what to give, e.g. "Give the probability as a fraction". */
  ask: string;
}

export interface Generator<P = unknown> {
  id: string;
  category: Category;
  title: string;
  techniques: TechniqueId[];
  tiers: Tier[];
  params(rng: Rng, tier: Tier): P;
  /** Structural signature: puzzles with equal keys are "the same puzzle in disguise". */
  structure(p: P): string;
  render(p: P, rng: Rng): Rendered;
  solve(p: P): Solution;
  /** Independent check of the answer. */
  verify(p: P): AnswerValue;
  /** Nudge → approach → near-solution. */
  hints(p: P): [string, string, string];
  /** How the answer was checked, shown to the user. */
  verifiedBy: string;
}

export type TechniqueId =
  | 'complement' | 'counting' | 'conditioning' | 'bayes' | 'linearity' | 'symmetry' | 'inclusion-exclusion' | 'stars-and-bars'
  | 'recursion' | 'first-step' | 'markov' | 'backward-induction' | 'geometric' | 'convolution' | 'hypergeometric' | 'binomial'
  | 'invariants' | 'burnside' | 'information' | 'dynamic-programming' | 'case-analysis' | 'martingale' | 'pattern-overlap' | 'number-theory';

export interface Puzzle {
  /** Fingerprint: generator + canonical parameters. */
  id: string;
  generatorId: string;
  category: Category;
  tier: Tier;
  title: string;
  techniques: TechniqueId[];
  structure: string;
  prompt: string;
  ask: string;
  answer: AnswerValue;
  steps: string[];
  hints: [string, string, string];
  verifiedBy: string;
}
