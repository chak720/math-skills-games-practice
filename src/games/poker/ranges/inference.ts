/**
 * Range inference from public actions. Used by the bots (to estimate what
 * their opponents hold) and by the coach (to estimate what the hero's
 * opponents hold). Both see only public information.
 *
 * Preflop: each voluntary action maps to a band of the playability ordering
 * (open → top x%, flat → middle band, 3-bet → value top + suited bluffs, …),
 * scaled by the player's estimated tendencies.
 *
 * Postflop: Bayesian-style reweighting. For every live combo we compute its
 * strength on the board at that street (percentile vs all live combos, plus a
 * draw score). Each action multiplies the combo's weight by an approximate
 * likelihood P(action | combo): bets favour strong hands and draws/bluffs,
 * calls favour medium hands and draws, checks down-weight the strongest
 * hands. Bigger bets shift the value threshold up.
 */
import type { Card } from '@/shared/cards/card';
import { evaluate } from '../eval/evaluator';
import type { PlayerView, Street } from '../engine/types';
import { analyseDraws } from '../analysis/hand';
import { COMBO_A, COMBO_B, COMBO_CLASS, NUM_COMBOS, comboIndex } from './combos';
import { bandRange, isBluffCandidate, positionsFor, rfiPercent, topRange, type Position } from './preflop';

export interface Tendencies {
  vpip: number;
  pfr: number;
  threeBet: number;
  /** Share of aggressive actions among postflop bets/raises/calls. */
  aggression: number;
  /** How often aggressive lines are bluffs (0..1). */
  bluffiness: number;
  /** Propensity to call with weak hands (0..1). */
  station: number;
}

export const POPULATION: Tendencies = { vpip: 0.26, pfr: 0.19, threeBet: 0.07, aggression: 0.45, bluffiness: 0.3, station: 0.35 };

const sig = (x: number): number => 1 / (1 + Math.exp(-x));
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** Position name of `seat` in this hand. */
export function positionOf(view: Pick<PlayerView, 'order'>, seat: number): Position {
  const n = view.order.length;
  const idx = view.order.indexOf(seat);
  if (n === 2) return idx === 0 ? 'BB' : 'BTN';
  if (idx === 0) return 'SB';
  if (idx === 1) return 'BB';
  return positionsFor(n)[idx - 2];
}

const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

/** Strength in [0,1] of every live combo on a board (percentile among live combos) and a draw score. */
export function comboStrengths(board: readonly Card[], dead: Uint8Array): { hs: Float64Array; draw: Float64Array } {
  const hs = new Float64Array(NUM_COMBOS);
  const draw = new Float64Array(NUM_COMBOS);
  const scores: { k: number; s: number }[] = [];
  const seven: number[] = [...board, 0, 0];
  const bl = board.length;
  for (let k = 0; k < NUM_COMBOS; k++) {
    if (dead[COMBO_A[k]] || dead[COMBO_B[k]]) continue;
    seven[bl] = COMBO_A[k];
    seven[bl + 1] = COMBO_B[k];
    scores.push({ k, s: evaluate(seven, bl + 2) });
  }
  scores.sort((a, b) => a.s - b.s);
  // Ties share the average rank.
  let i = 0;
  while (i < scores.length) {
    let j = i;
    while (j + 1 < scores.length && scores[j + 1].s === scores[i].s) j++;
    const p = ((i + j) / 2 + 0.5) / scores.length;
    for (let t = i; t <= j; t++) hs[scores[t].k] = p;
    i = j + 1;
  }
  if (bl === 3 || bl === 4) {
    for (const { k } of scores) {
      const d = analyseDraws([COMBO_A[k], COMBO_B[k]], board);
      draw[k] = (d.flushDraw ? (d.nutFlushDraw ? 0.3 : 0.24) : 0) + (d.oesd ? 0.2 : d.gutshot ? 0.08 : 0) + (d.backdoorFlush ? 0.03 : 0);
    }
  }
  return { hs, draw };
}

export interface InferOptions {
  /** 0 = ignore postflop actions (weak reader) … 1 = full narrowing. */
  narrow?: number;
  /** Cards the observer knows are dead (own hole cards, board). */
  dead?: readonly Card[];
  /** Precomputed strengths per street (shared across opponents). */
  cache?: Map<number, { hs: Float64Array; draw: Float64Array }>;
}

/** Preflop class weights implied by `seat`'s preflop actions. */
export function preflopClassWeights(view: Pick<PlayerView, 'actions' | 'order'>, seat: number, t: Tendencies): Float64Array {
  const n = view.order.length;
  const pos = positionOf(view, seat);
  const posF = rfiPercent(pos === 'BB' ? 'SB' : pos, n) / 0.19;
  const w = new Float64Array(169).fill(1);
  const mul = (r: Float64Array): void => {
    for (let c = 0; c < 169; c++) w[c] *= r[c];
  };
  let raises = 0;
  let openerPct = 0.2;
  const soft = 0.02;
  for (const a of view.actions) {
    if (a.street !== 'preflop' || a.type.startsWith('post') || a.type === 'uncalled') continue;
    if (a.seat === seat) {
      if (a.type === 'check') {
        mul(topRange(0.12 * (t.pfr / 0.19), soft).map((x) => 1 - 0.85 * x));
      } else if (a.type === 'call') {
        if (raises === 0) {
          mul(bandRange(clamp(t.pfr * 0.5, 0.02, 0.2), clamp(t.vpip * 1.1, 0.08, 0.95), soft));
        } else if (raises === 1) {
          const top = pos === 'BB' ? clamp(openerPct * 1.25 + 0.06, 0.15, 0.7) * (0.6 + 0.4 * (t.vpip / 0.26)) : clamp(t.vpip * 0.6 + openerPct * 0.2, 0.06, 0.8);
          mul(bandRange(clamp(t.threeBet * 0.7, 0.01, 0.12), clamp(top, 0.05, 0.85), soft));
        } else if (raises === 2) mul(bandRange(0.02, clamp(t.vpip * 0.3, 0.05, 0.3), soft));
        else mul(bandRange(0.008, 0.035, 0.01));
      } else if (a.type === 'raise' || a.type === 'bet') {
        if (raises === 0) {
          const pct = clamp(t.pfr * posF, 0.03, 0.9);
          mul(topRange(pct, soft));
        } else {
          const valuePct = raises === 1 ? clamp(t.threeBet * 0.75, 0.015, 0.25) : raises === 2 ? 0.03 : 0.015;
          const v = topRange(valuePct, 0.01);
          const bluffW = clamp((raises === 1 ? 0.45 : 0.25) * (t.bluffiness / 0.3), 0, 1);
          const r = v.map((x, c) => Math.max(x, isBluffCandidate(c) ? bluffW * (raises <= 2 ? 1 : 0.3) : 0));
          mul(r);
        }
      }
    }
    if (a.type === 'raise' || a.type === 'bet') {
      if (raises === 0) openerPct = clamp(POPULATION.pfr * (rfiPercent(positionOf(view, a.seat) === 'BB' ? 'SB' : positionOf(view, a.seat), n) / 0.19), 0.05, 0.8);
      raises++;
    }
  }
  return w;
}

/**
 * Estimated combo weights (length 1326) for `seat` given everything public in
 * `view`. Combos using cards in `opts.dead` get weight 0. If the seat's cards
 * were shown, the range is exactly that combo.
 */
export function inferRange(view: PlayerView, seat: number, t: Tendencies, opts: InferOptions = {}): Float64Array {
  const out = new Float64Array(NUM_COMBOS);
  const sv = view.seats.find((s) => s.seat === seat);
  if (sv?.shown) {
    out[comboIndex(sv.shown[0], sv.shown[1])] = 1;
    return out;
  }
  const dead = new Uint8Array(52);
  for (const c of opts.dead ?? []) dead[c] = 1;
  for (const c of view.board) dead[c] = 1;
  for (const s of view.seats) if (s.shown && s.seat !== seat) for (const c of s.shown) dead[c] = 1;

  const cw = preflopClassWeights(view, seat, t);
  for (let k = 0; k < NUM_COMBOS; k++) if (!dead[COMBO_A[k]] && !dead[COMBO_B[k]]) out[k] = cw[COMBO_CLASS[k]];

  const narrow = opts.narrow ?? 1;
  if (narrow <= 0 || view.board.length < 3) return out;

  // Pot before each action, per street, to size bets.
  let potBefore = 0;
  let streetBet = 0;
  let lastStreet: Street = 'preflop';
  for (const a of view.actions) {
    if (a.street !== lastStreet) {
      lastStreet = a.street;
      streetBet = 0;
    }
    const before = potBefore;
    potBefore = a.potAfter;
    if (a.street === 'preflop' || a.seat !== seat) {
      if (a.type === 'bet' || a.type === 'raise') streetBet = a.to;
      continue;
    }
    const bl = BOARD_LEN[a.street];
    const board = view.board.slice(0, bl);
    if (board.length < bl) continue;
    let cs = opts.cache?.get(bl);
    if (!cs) {
      const deadAll = new Uint8Array(52);
      for (let c = 0; c < 52; c++) deadAll[c] = dead[c];
      cs = comboStrengths(board, deadAll);
      opts.cache?.set(bl, cs);
    }
    const { hs, draw } = cs;
    const facing = a.type === 'call' || (a.type === 'raise' && streetBet > 0);
    const sizeFrac = clamp((a.amount - (a.type === 'raise' ? streetBet : 0)) / Math.max(1, before), 0.1, 3);
    const callFrac = clamp((streetBet) / Math.max(1, before - streetBet), 0.1, 3);
    for (let k = 0; k < NUM_COMBOS; k++) {
      if (out[k] <= 0) continue;
      const h = hs[k], d = a.street === 'river' ? 0 : draw[k];
      let like = 1;
      if (a.type === 'bet' || a.type === 'raise') {
        const tv = 0.62 + 0.1 * Math.min(sizeFrac, 1.5) + (a.type === 'raise' ? 0.08 : 0) - 0.15 * t.aggression;
        const value = sig((h - tv) / 0.06);
        const bluff = t.bluffiness * (d > 0 ? 0.5 + d : 0.16 * (1 - h)) * (1 - value);
        like = value + bluff;
      } else if (a.type === 'call') {
        const tc = 0.38 + 0.15 * Math.min(callFrac, 1.5) - 0.18 * t.station;
        const strongRaises = 0.5 * sig((h - 0.94) / 0.025);
        like = sig((h - tc) / 0.08) * (1 - strongRaises) + d * 1.6 + 0.04;
      } else if (a.type === 'check' && !facing) {
        const wouldBet = sig((h - 0.78) / 0.06) * clamp(0.5 + t.aggression, 0.4, 1);
        like = 1 - 0.75 * wouldBet;
      }
      out[k] *= narrow * like + (1 - narrow);
    }
    if (a.type === 'bet' || a.type === 'raise') streetBet = a.to;
    // Renormalise to max 1 to avoid underflow over several streets.
    let mx = 0;
    for (let k = 0; k < NUM_COMBOS; k++) mx = Math.max(mx, out[k]);
    if (mx > 0) for (let k = 0; k < NUM_COMBOS; k++) out[k] /= mx;
  }
  return out;
}

/** Normalised weight-sum of a combo-weight range (for display as % of hands). */
export function rangeSize(w: ArrayLike<number>): number {
  let s = 0;
  for (let k = 0; k < NUM_COMBOS; k++) s += w[k];
  return s;
}
