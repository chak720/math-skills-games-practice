/** Blackjack maths in a worker: exact EVs, the computed chart, house-edge simulation. */
import { BJTable } from '@/games/blackjack/engine';
import { computeEVs, type Allowed } from '@/games/blackjack/ev';
import type { BJRules } from '@/games/blackjack/rules';
import { valueOf } from '@/games/blackjack/rules';
import { chartMove, computeChart } from '@/games/blackjack/strategy';
import type { Ctx } from './rpc';

export const bjApi = {
  evs(args: { values: number[]; up: number; counts: number[]; rules: BJRules; allowed: Allowed }) {
    const e = computeEVs(args.values, args.up, Int32Array.from(args.counts), args.rules, args.allowed, 'exact');
    return { stand: e.stand, hit: e.hit, double: e.double, split: e.split, surrender: e.surrender, insurance: e.insurance, dealerBust: e.dealer[5], dealer: Array.from(e.dealer) };
  },
  chart(args: { rules: BJRules }) {
    return computeChart(args.rules);
  },
  /** Basic-strategy house edge by simulation: mean result per initial bet with standard error. */
  houseEdge(args: { rules: BJRules; rounds: number }, ctx: Ctx) {
    const t = new BJTable(args.rules, 1, `sim-${Date.now()}`);
    t.sit(0, { id: 's', name: 'S', isHuman: false, bankroll: 0 });
    const chart = computeChart(args.rules);
    let sum = 0, sq = 0;
    for (let r = 0; r < args.rounds; r++) {
      const b0 = t.seats[0]!.bankroll;
      t.startRound({ 0: 1 });
      if (t.phase === 'insurance') t.decideInsurance(0, false);
      while (t.phase === 'player') {
        const v = t.view(0);
        const h = v.seats[0]!.hands[v.turn!.hand];
        const L = v.legal!;
        const m = chartMove(chart, { values: h.cards.map(valueOf), up: valueOf(v.dealerUp!), canDouble: L.double, canSplit: L.split, canSurrender: L.surrender }).move;
        t.act(0, L[m] ? m : 'hit');
      }
      if (t.phase === 'dealer') t.finishDealer();
      const x = t.seats[0]!.bankroll - b0;
      sum += x;
      sq += x * x;
      if (r % 20000 === 19999) ctx.progress((r + 1) / args.rounds);
    }
    const mean = sum / args.rounds;
    return { mean, se: Math.sqrt((sq / args.rounds - mean * mean) / args.rounds), sd: Math.sqrt(sq / args.rounds - mean * mean), n: args.rounds };
  },
};

export type BjApi = typeof bjApi;
