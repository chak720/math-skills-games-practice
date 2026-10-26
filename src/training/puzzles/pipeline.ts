/**
 * Puzzle pipeline: parameters → two independent answers → (only if they agree)
 * a Puzzle with a fingerprint. The fingerprint ignores wording-only fields
 * ("ctx", "device"), so the same numbers told as a different story still
 * count as already seen.
 */
import { sha256Hex } from '@/shared/fairness/sha256';
import type { Rng } from '@/shared/random/prng';
import { answerText, sameAnswer } from './answer';
import type { Generator, Puzzle, Tier } from './types';

const WORDING_ONLY = new Set(['ctx', 'device', 'names', 'flavour']);

function canonical(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  const o = x as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => !WORDING_ONLY.has(k))
    .sort()
    .map((k) => `${k}:${canonical(o[k])}`)
    .join(',')}}`;
}

export const fingerprint = (g: Generator<unknown>, p: unknown): string => `${g.id}:${sha256Hex(canonical(p)).slice(0, 12)}`;

export class VerificationError extends Error {}

export function buildPuzzle<P>(g: Generator<P>, p: P, tier: Tier, rng: Rng): Puzzle {
  const sol = g.solve(p);
  const ver = g.verify(p);
  if (!sameAnswer(sol.answer, ver)) throw new VerificationError(`${g.id}: solver ${answerText(sol.answer)} ≠ verifier ${answerText(ver)} for ${JSON.stringify(p)}`);
  const r = g.render(p, rng);
  return {
    id: fingerprint(g as Generator<unknown>, p),
    generatorId: g.id,
    category: g.category,
    tier,
    title: g.title,
    techniques: g.techniques,
    structure: g.structure(p),
    prompt: r.prompt,
    ask: r.ask,
    answer: sol.answer,
    steps: sol.steps,
    hints: g.hints(p),
    verifiedBy: g.verifiedBy,
  };
}

/** Draw parameters until we get an unseen, verified puzzle (or give up). */
export function generatePuzzle<P>(g: Generator<P>, tier: Tier, rng: Rng, isSeen: (id: string) => boolean, avoidStructures: Set<string> = new Set(), tries = 60): Puzzle | null {
  for (let t = 0; t < tries; t++) {
    const p = g.params(rng, tier);
    if (isSeen(fingerprint(g as Generator<unknown>, p))) continue;
    if (t < tries / 2 && avoidStructures.has(g.structure(p))) continue;
    try {
      return buildPuzzle(g, p, tier, rng);
    } catch (e) {
      if (e instanceof VerificationError) {
        console.error(e.message); // never ship it; try other parameters
        continue;
      }
      throw e;
    }
  }
  return null;
}
