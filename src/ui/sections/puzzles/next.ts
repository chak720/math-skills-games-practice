/** Main-thread side of puzzle selection: weights come from local history, generation runs in the worker. */
import { Rng } from '@/shared/random/prng';
import { candidates, getHistory, getSeen, markSeen, orderCandidates, recentStructures, type Filter } from '@/training/puzzles/scheduler';
import { fromWire } from '@/training/puzzles/wire';
import type { Puzzle } from '@/training/puzzles/types';
import { puzzleWorker } from '@/workers/clients';

function freshSeed(): string {
  const b = new Uint32Array(4);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(8, '0')).join('');
}

export interface NextResult {
  puzzle: Puzzle | null;
  /** Why this generator came up, for the "why this puzzle?" note. */
  reason: string;
}

export async function nextPuzzle(filter: Filter): Promise<NextResult> {
  const history = getHistory();
  const seed = freshSeed();
  const order = orderCandidates(candidates(filter, history), new Rng(seed));
  if (!order.length) return { puzzle: null, reason: 'No generator matches these filters.' };
  const tries = order.slice(0, 8).map((c) => ({ generatorId: c.g.id, tier: c.tier }));
  const ids = new Set(tries.map((t) => t.generatorId));
  const seen = getSeen().filter((id) => ids.has(id.slice(0, id.indexOf(':'))));
  const w = await puzzleWorker.call('generate', { tries, seed, seen, avoid: recentStructures(history) });
  if (!w) return { puzzle: null, reason: 'Every puzzle these generators can make at this tier has been shown to you. Try another tier or category.' };
  const puzzle = fromWire(w);
  markSeen(puzzle.id);
  const top = order[0];
  const reason = top.g.id === puzzle.generatorId ? (filter.focus === 'review' ? 'Picked because one of its techniques is due for review.' : 'Picked by rotation, weighted towards techniques due for review.') : 'The first choice had no unseen puzzles left at this tier, so another generator stepped in.';
  return { puzzle, reason };
}
