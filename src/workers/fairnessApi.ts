/** Fairness lab computations (run in a worker). */
import { deriveOrder, newServerSeed } from '@/shared/fairness/commit';
import { summarisePositionCounts, type PositionTestResult } from '@/shared/fairness/chisq';
import type { Ctx } from './rpc';

export const fairnessApi = {
  /**
   * Shuffle `trials` fresh decks through the production dealing path (new
   * random server seed each time) and run the χ² position test.
   */
  positionTest(args: { trials: number; decks?: number }, ctx: Ctx): PositionTestResult {
    const n = 52;
    const counts = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const chunk = Math.max(500, Math.floor(args.trials / 40));
    for (let t = 0; t < args.trials; t++) {
      const order = deriveOrder(newServerSeed(), 'lab', t, 1);
      for (let p = 0; p < n; p++) counts[order[p]][p]++;
      if (t % chunk === chunk - 1) ctx.progress((t + 1) / args.trials);
    }
    return summarisePositionCounts(counts, args.trials);
  },
};

export type FairnessApi = typeof fairnessApi;
