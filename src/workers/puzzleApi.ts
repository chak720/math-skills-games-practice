/** Puzzle generation in a worker: draw parameters, solve twice, ship only verified puzzles. */
import { Rng } from '@/shared/random/prng';
import { generatePuzzle } from '@/training/puzzles/pipeline';
import { generatorById } from '@/training/puzzles/registry';
import type { Tier } from '@/training/puzzles/types';
import { toWire, type WirePuzzle } from '@/training/puzzles/wire';

export const puzzleApi = {
  generate(args: { tries: { generatorId: string; tier: Tier }[]; seed: string; seen: string[]; avoid: string[] }): WirePuzzle | null {
    const seen = new Set(args.seen);
    const avoid = new Set(args.avoid);
    const rng = new Rng(args.seed);
    for (const t of args.tries) {
      const g = generatorById(t.generatorId);
      if (!g) continue;
      const p = generatePuzzle(g, t.tier, rng, (id) => seen.has(id), avoid);
      if (p) return toWire(p);
    }
    return null;
  },
};

export type PuzzleApi = typeof puzzleApi;
