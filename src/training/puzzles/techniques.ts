/** The techniques puzzles teach. Spaced repetition schedules these, not individual puzzles. */
import type { TechniqueId } from './types';

export interface Technique {
  name: string;
  /** One-line statement of the idea. */
  idea: string;
  /** When to reach for it. */
  when: string;
}

export const TECHNIQUES: Record<TechniqueId, Technique> = {
  complement: { name: 'Complement', idea: 'P(A) = 1 − P(not A); "at least one" is usually easiest as 1 − P(none).', when: '"At least", "at least one", or when the opposite event is a single simple case.' },
  counting: { name: 'Counting equally likely outcomes', idea: 'With a uniform sample space, P(A) = |A| / |Ω|; count both sides the same way (ordered or unordered).', when: 'Dice, cards and draws where every outcome is equally likely.' },
  conditioning: { name: 'Conditioning', idea: 'P(A | B) = P(A ∩ B) / P(B): shrink the sample space to the outcomes where B holds.', when: '"Given that…" statements, or when splitting on a first event simplifies things.' },
  bayes: { name: "Bayes' rule", idea: 'P(H | E) = P(E | H)P(H) / [P(E | H)P(H) + P(E | ¬H)P(¬H)]; think in natural frequencies.', when: 'Updating a prior after a noisy test or observation.' },
  linearity: { name: 'Linearity of expectation', idea: 'E[ΣXᵢ] = ΣE[Xᵢ] with no independence needed; write a count as a sum of indicators.', when: 'Expected number of things (matches, distinct values, fixed points, runs).' },
  symmetry: { name: 'Symmetry', idea: 'Exchangeable positions or players have identical distributions; use it to skip computation.', when: '"Last ball", "who wins first", random order arguments.' },
  'inclusion-exclusion': { name: 'Inclusion–exclusion', idea: '|A ∪ B ∪ C| = Σ|A| − Σ|A ∩ B| + |A ∩ B ∩ C|; alternate signs over intersections.', when: '"Divisible by a or b", derangements, "no box empty", forbidden configurations.' },
  'stars-and-bars': { name: 'Stars and bars', idea: 'Non-negative integer solutions of x₁ + … + x_k = n number C(n + k − 1, k − 1); shift lower bounds first.', when: 'Distributing identical items into distinct boxes.' },
  recursion: { name: 'Recursion', idea: 'Express the answer for size n in terms of smaller sizes; solve or compute upwards.', when: 'Problems with self-similar structure (paths, tilings, games).' },
  'first-step': { name: 'First-step analysis', idea: 'Condition on the first move: E[T] = 1 + Σ p_j E[T | start at j]; solve the linear equations.', when: 'Expected waiting times, absorption probabilities, random walks.' },
  markov: { name: 'Markov chains', idea: 'Encode the state, write transition probabilities, solve for absorption or stationary distributions.', when: 'Anything that evolves step by step with memoryless transitions.' },
  'backward-induction': { name: 'Backward induction', idea: 'Solve the last decision first, then step back: each choice compares stopping now with the value of continuing.', when: 'Optimal stopping, re-roll games, sequential games.' },
  geometric: { name: 'Geometric probability', idea: 'For uniform continuous variables, probability is area (or volume) of the favourable region over the total.', when: 'Random points, meeting times, broken sticks.' },
  convolution: { name: 'Convolution / generating functions', idea: 'The distribution of a sum is the convolution of distributions; with generating functions, multiply polynomials.', when: 'Sums of dice and other independent counts.' },
  hypergeometric: { name: 'Hypergeometric counting', idea: 'P(k successes in n draws without replacement) = C(K,k)C(N−K,n−k)/C(N,n).', when: 'Cards, urns and committees drawn without replacement.' },
  binomial: { name: 'Binomial distribution', idea: 'P(k successes in n independent trials) = C(n,k)pᵏ(1 − p)ⁿ⁻ᵏ.', when: 'Repeated independent yes/no trials.' },
  invariants: { name: 'Invariants and relabelling', idea: 'Find what does not change (or swap labels) so the messy dynamics become trivial.', when: 'Ants bouncing, chips moving, games with conserved quantities.' },
  burnside: { name: "Burnside's lemma", idea: 'Number of distinct objects up to symmetry = average number fixed by each symmetry.', when: 'Counting necklaces, colourings up to rotation or reflection.' },
  information: { name: 'Information bounds', idea: 'Each measurement with m outcomes splits possibilities at most m ways, so you need ⌈log_m(N)⌉ of them; then show it is achievable.', when: 'Weighing coins, identifying poison, twenty-questions problems.' },
  'dynamic-programming': { name: 'Dynamic programming', idea: 'Tabulate the best value for every sub-state; combine optimal sub-solutions.', when: 'Optimisation over sequences of choices (egg drops, crossings).' },
  'case-analysis': { name: 'Case analysis', idea: 'Assume each possibility in turn and derive a contradiction or a consistent world.', when: 'Knights and knaves, ordering puzzles.' },
  martingale: { name: 'Martingales and fair games', idea: 'In a fair game no stopping rule changes the expected profit (optional stopping); bounded strategies trade small frequent wins for rare large losses.', when: 'Doubling systems, gambler’s ruin, "can you beat this game?"' },
  'pattern-overlap': { name: 'Pattern overlaps', idea: 'Expected waiting time for a pattern sums 1/P(prefix) over every prefix that is also a suffix (Conway).', when: 'HH vs HT, Penney’s game, waiting for sequences.' },
  'number-theory': { name: 'Number theory', idea: 'Use divisibility, prime factorisations and counting divisors.', when: 'Trailing zeros, lockers, divisibility counts.' },
};
