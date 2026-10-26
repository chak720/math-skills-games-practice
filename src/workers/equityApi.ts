/** Heavy poker maths: coach analysis, equity calculator, variance simulation. */
import { analyse, type CoachInput } from '@/games/poker/coach/coach';
import { classBreakdown, multiEquity, type EqPlayer } from '@/games/poker/equity/multi';
import { Rng } from '@/shared/random/prng';
import type { Card } from '@/shared/cards/card';
import type { Ctx } from './rpc';

export const equityApi = {
  coach(input: CoachInput) {
    return analyse(input);
  },
  equity(args: { players: EqPlayer[]; board: Card[]; dead?: Card[]; iterations?: number }, ctx: Ctx) {
    return multiEquity(args.players, args.board, args.dead ?? [], args.iterations ?? 60000, undefined, (p) => ctx.progress(p));
  },
  breakdown(args: { hero: Card[]; classW: number[]; board: Card[] }) {
    return classBreakdown(args.hero, args.classW, args.board, 1200);
  },
  /**
   * Variance / downswing simulator: `players` independent paths of `hands`
   * hands, each hand's result ~ Normal(winrate/100, sd/10) bb (per-hand sd
   * from sd per 100 hands). Returns percentile bands and drawdown stats.
   */
  variance(args: { winrate: number; sd: number; hands: number; paths: number }) {
    const rng = new Rng();
    const step = Math.max(1, Math.floor(args.hands / 200));
    const points = Math.floor(args.hands / step) + 1; // checkpoints at 0, step, 2·step, …
    const cols: number[][] = Array.from({ length: points }, () => []);
    const finals: number[] = [];
    const maxDowns: number[] = [];
    const sample: number[][] = [];
    const mu = args.winrate / 100;
    const sigma = args.sd / 10;
    // Results over a block of `step` hands are Normal(step·μ, √step·σ), so simulate block by block
    // (drawdowns are measured at block resolution, which understates them very slightly).
    const blockSd = sigma * Math.sqrt(step);
    for (let p = 0; p < args.paths; p++) {
      let x = 0, peak = 0, maxDown = 0;
      const path: number[] = [0];
      cols[0].push(0);
      for (let k = 1; k < points; k++) {
        x += rng.normal(mu * step, blockSd);
        peak = Math.max(peak, x);
        maxDown = Math.max(maxDown, peak - x);
        cols[k].push(x);
        if (p < 8) path.push(x);
      }
      finals.push(x);
      maxDowns.push(maxDown);
      if (p < 8) sample.push(path);
    }
    const q = (xs: number[], f: number): number => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.floor(f * s.length))];
    };
    return {
      x: cols.map((_, i) => i * step),
      p5: cols.map((c) => q(c, 0.05)),
      p50: cols.map((c) => q(c, 0.5)),
      p95: cols.map((c) => q(c, 0.95)),
      sample,
      finals,
      maxDowns,
      pLosing: finals.filter((f) => f < 0).length / finals.length,
    };
  },
};

export type EquityApi = typeof equityApi;
