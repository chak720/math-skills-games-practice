/**
 * Per-hand public statistics (VPIP, PFR, 3-bet, c-bet, fold-to-c-bet, WTSD,
 * W$SD, aggression) extracted from a finished hand's PUBLIC record. Used by
 * bots to model opponents, and by the player's optional HUD. Hole cards are
 * only used when they were shown.
 */
import type { PlayerView } from '../engine/types';
import { comboIndex } from '../ranges/combos';
import { comboStrengths, POPULATION, type Tendencies } from '../ranges/inference';

export interface HandStatLine {
  playerId: string;
  seat: number;
  vpip: number;
  pfr: number;
  threeBetOpp: number;
  threeBet: number;
  foldTo3BetOpp: number;
  foldTo3Bet: number;
  cbetOpp: number;
  cbet: number;
  foldToCbetOpp: number;
  foldToCbet: number;
  postAggr: number;
  postCalls: number;
  sawFlop: number;
  wtsd: number;
  wsd: number;
  /** Showed a weak hand after making the last aggressive action. */
  caughtBluff: number;
  /** Showed a very strong hand after making the last aggressive action. */
  showedStrong: number;
  netChips: number;
}

export function extractStats(v: PlayerView): HandStatLine[] {
  const lines = new Map<number, HandStatLine>();
  for (const s of v.seats)
    lines.set(s.seat, {
      playerId: s.playerId, seat: s.seat, vpip: 0, pfr: 0, threeBetOpp: 0, threeBet: 0, foldTo3BetOpp: 0, foldTo3Bet: 0, cbetOpp: 0, cbet: 0,
      foldToCbetOpp: 0, foldToCbet: 0, postAggr: 0, postCalls: 0, sawFlop: 0, wtsd: 0, wsd: 0, caughtBluff: 0, showedStrong: 0, netChips: 0,
    });
  let raises = 0;
  let opener: number | null = null;
  let pfa: number | null = null;
  const actedAt3BetOpp = new Set<number>();
  const foldedPre = new Set<number>();
  let flopBet = false;
  let cbetMade = false;
  let pfaActedFlop = false;
  const facedCbet = new Set<number>();
  let lastAggressor: number | null = null;

  for (const a of v.actions) {
    if (a.type.startsWith('post') || a.type === 'uncalled') continue;
    const L = lines.get(a.seat)!;
    if (a.street === 'preflop') {
      if (a.type === 'call' || a.type === 'raise' || a.type === 'bet') L.vpip = 1;
      if (a.type === 'raise' || a.type === 'bet') L.pfr = 1;
      if (raises === 1 && a.seat !== opener && !actedAt3BetOpp.has(a.seat)) {
        actedAt3BetOpp.add(a.seat);
        L.threeBetOpp = 1;
        if (a.type === 'raise') L.threeBet = 1;
      }
      if (raises === 2 && a.seat === opener && !L.foldTo3BetOpp) {
        L.foldTo3BetOpp = 1;
        if (a.type === 'fold') L.foldTo3Bet = 1;
      }
      if (a.type === 'fold') foldedPre.add(a.seat);
      if (a.type === 'raise' || a.type === 'bet') {
        if (raises === 0) opener = a.seat;
        raises++;
        pfa = a.seat;
        lastAggressor = a.seat;
      }
      continue;
    }
    // postflop
    if (a.type === 'bet' || a.type === 'raise') {
      L.postAggr++;
      lastAggressor = a.seat;
    }
    if (a.type === 'call') L.postCalls++;
    if (a.street === 'flop') {
      if (a.seat === pfa && !pfaActedFlop) {
        pfaActedFlop = true;
        if (!flopBet) {
          L.cbetOpp = 1;
          if (a.type === 'bet') {
            L.cbet = 1;
            cbetMade = true;
          }
        }
      } else if (cbetMade && a.seat !== pfa && !facedCbet.has(a.seat)) {
        facedCbet.add(a.seat);
        L.foldToCbetOpp = 1;
        if (a.type === 'fold') L.foldToCbet = 1;
      }
      if (a.type === 'bet' || a.type === 'raise') flopBet = true;
    }
  }
  const sawFlop = v.board.length >= 3;
  const live = v.seats.filter((s) => !s.folded);
  const showdown = v.handOver && live.length >= 2;
  // Shown hands (showdown or voluntary) are judged on the full board.
  const strengths = v.board.length === 5 && v.seats.some((s) => s.shown) ? comboStrengths(v.board, new Uint8Array(52)).hs : null;
  for (const s of v.seats) {
    const L = lines.get(s.seat)!;
    L.sawFlop = sawFlop && !foldedPre.has(s.seat) ? 1 : 0;
    const won = (v.winners ?? []).filter((w) => w.seat === s.seat).reduce((x, w) => x + w.amount, 0);
    L.netChips = won - s.committed;
    if (L.sawFlop && showdown && !s.folded) {
      L.wtsd = 1;
      L.wsd = won > 0 ? 1 : 0;
    }
    if (strengths && s.shown && lastAggressor === s.seat) {
      const hs = strengths[comboIndex(s.shown[0], s.shown[1])];
      if (hs < 0.45) L.caughtBluff = 1;
      if (hs > 0.88) L.showedStrong = 1;
    }
  }
  return [...lines.values()];
}

export interface StatAgg {
  hands: number;
  vpip: number;
  pfr: number;
  threeBetOpp: number;
  threeBet: number;
  foldTo3BetOpp: number;
  foldTo3Bet: number;
  cbetOpp: number;
  cbet: number;
  foldToCbetOpp: number;
  foldToCbet: number;
  postAggr: number;
  postCalls: number;
  sawFlop: number;
  wtsd: number;
  wsd: number;
  /** Decaying image scores. */
  bluffImage: number;
  strongImage: number;
  netChips: number;
}

const empty = (): StatAgg => ({
  hands: 0, vpip: 0, pfr: 0, threeBetOpp: 0, threeBet: 0, foldTo3BetOpp: 0, foldTo3Bet: 0, cbetOpp: 0, cbet: 0, foldToCbetOpp: 0, foldToCbet: 0,
  postAggr: 0, postCalls: 0, sawFlop: 0, wtsd: 0, wsd: 0, bluffImage: 0, strongImage: 0, netChips: 0,
});

/** Smoothed rate: (successes + prior·k) / (opportunities + k). */
export const smooth = (x: number, n: number, prior: number, k: number): number => (x + prior * k) / (n + k);

export class StatsTracker {
  readonly data = new Map<string, StatAgg>();

  add(lines: readonly HandStatLine[]): void {
    for (const l of lines) {
      const a = this.data.get(l.playerId) ?? empty();
      a.hands++;
      a.vpip += l.vpip; a.pfr += l.pfr; a.threeBetOpp += l.threeBetOpp; a.threeBet += l.threeBet;
      a.foldTo3BetOpp += l.foldTo3BetOpp; a.foldTo3Bet += l.foldTo3Bet; a.cbetOpp += l.cbetOpp; a.cbet += l.cbet;
      a.foldToCbetOpp += l.foldToCbetOpp; a.foldToCbet += l.foldToCbet; a.postAggr += l.postAggr; a.postCalls += l.postCalls;
      a.sawFlop += l.sawFlop; a.wtsd += l.wtsd; a.wsd += l.wsd; a.netChips += l.netChips;
      // Image decays ~10% per hand the player is dealt in, so old reads fade.
      a.bluffImage = a.bluffImage * 0.9 + l.caughtBluff;
      a.strongImage = a.strongImage * 0.9 + l.showedStrong;
      this.data.set(l.playerId, a);
    }
  }

  get(id: string): StatAgg {
    return this.data.get(id) ?? empty();
  }

  /** Tendencies with Bayesian smoothing; `k` = prior strength in hands. */
  tendencies(id: string, k = 12): Tendencies {
    const a = this.get(id);
    const vpip = smooth(a.vpip, a.hands, POPULATION.vpip, k);
    const pfr = smooth(a.pfr, a.hands, POPULATION.pfr, k);
    const threeBet = smooth(a.threeBet, a.threeBetOpp, POPULATION.threeBet, k);
    const aggression = smooth(a.postAggr, a.postAggr + a.postCalls, POPULATION.aggression, k);
    const wtsd = smooth(a.wtsd, a.sawFlop, 0.28, k);
    const bluffiness = Math.max(0.05, Math.min(0.9, POPULATION.bluffiness + 0.12 * a.bluffImage - 0.05 * a.strongImage));
    const station = Math.max(0, Math.min(1, POPULATION.station + (wtsd - 0.28) * 1.6 + (vpip - pfr - 0.07) * 0.8));
    return { vpip, pfr, threeBet, aggression, bluffiness, station };
  }

  foldToCbet(id: string, k = 12): number {
    const a = this.get(id);
    return smooth(a.foldToCbet, a.foldToCbetOpp, 0.45, k);
  }

  foldTo3Bet(id: string, k = 12): number {
    const a = this.get(id);
    return smooth(a.foldTo3Bet, a.foldTo3BetOpp, 0.55, k);
  }
}

/** HUD-style percentages for display (raw, unsmoothed). */
export function hudLine(a: StatAgg): Record<string, string> {
  const pct = (x: number, n: number): string => (n ? `${Math.round((100 * x) / n)}` : '–');
  return {
    hands: String(a.hands),
    VPIP: pct(a.vpip, a.hands),
    PFR: pct(a.pfr, a.hands),
    '3B': pct(a.threeBet, a.threeBetOpp),
    F3B: pct(a.foldTo3Bet, a.foldTo3BetOpp),
    CB: pct(a.cbet, a.cbetOpp),
    FCB: pct(a.foldToCbet, a.foldToCbetOpp),
    AF: a.postCalls ? (a.postAggr / a.postCalls).toFixed(1) : a.postAggr ? '∞' : '–',
    WTSD: pct(a.wtsd, a.sawFlop),
    'W$SD': pct(a.wsd, a.wtsd),
  };
}
