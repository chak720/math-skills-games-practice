/**
 * The coach: analyses a decision from the HERO's view only (own cards, public
 * actions, opponents' public tendencies). It never sees opponents' cards.
 *
 * Postflop EV model (stated wherever shown):
 *  - EV(fold) = 0 (chips already in the pot are sunk).
 *  - EV(call) = e·(P + c) − c, where P = pot including the bet faced and c the
 *    call. This counts only the current street: it is exact on the river and an
 *    approximation earlier (future bets can add implied or reverse-implied odds).
 *  - EV(bet/raise to R) = F·P + (1 − F)·[e_c·(P + a + k) − a], where a = chips we
 *    add, k = chips a caller adds, F = fold probability, e_c = our equity against
 *    the continuing part of their range. Opponents continue with the strongest
 *    share of their range equal to their minimum-defence frequency P/(P + a),
 *    stretched for calling stations.
 *  - EV(check) ≈ e·P·ρ with a realisation factor ρ (0.9 in position, 0.8 out).
 */
import type { Card } from '@/shared/cards/card';
import { cardToString } from '@/shared/cards/card';
import { Rng } from '@/shared/random/prng';
import type { PlayerView } from '../engine/types';
import { analyseDraws, boardTexture, drawSummary, findOuts, madeHand, type Out } from '../analysis/hand';
import { equityMC } from '../equity/equity';
import { classOf, className, COMBO_A, COMBO_B, NUM_COMBOS } from '../ranges/combos';
import { comboStrengths, inferRange, positionOf, POPULATION, type Tendencies } from '../ranges/inference';
import { handPercentile, rfiPercent, vs3Bet, vsOpen, EQ_VS_RANDOM } from '../ranges/preflop';
import { evaluate } from '../eval/evaluator';

export type CoachAction = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface EvOption {
  action: CoachAction;
  to?: number;
  label: string;
  /** EV in chips relative to folding now. */
  ev: number;
  detail: string;
}

export interface MathStep {
  title: string;
  lines: string[];
}

export interface RangeSummary {
  seat: number;
  name: string;
  /** Share of all hands their estimated range covers. */
  pct: number;
  /** Most likely holdings, e.g. "AKs, QQ, A5s". */
  top: string;
  basis: string;
}

export interface CoachAnalysis {
  handId: number;
  street: PlayerView['street'];
  actionsSeen: number;
  hand: string;
  made: string;
  draws: string;
  texture: string;
  outs: Out[];
  hit: null | {
    outs: number;
    unseen: number;
    next: number;
    byRiver: number | null;
    rule2: number;
    rule4: number | null;
  };
  equity: { value: number; lo: number; hi: number; n: number; exact: boolean };
  ranges: RangeSummary[];
  pot: number;
  toCall: number;
  potOdds: number | null;
  impliedNeeded: number | null;
  options: EvOption[];
  recommendation: { action: CoachAction; to?: number; label: string; closeness: 'clear' | 'close' | 'coin-flip'; reasons: string[] };
  preflop: null | { position: string; cls: string; percentile: number; chart: string };
  maths: MathStep[];
  bb: number;
}

export interface CoachInput {
  view: PlayerView;
  /** Opponents' tendencies from the hero's HUD (public information). */
  tendencies: Record<number, Tendencies>;
  /** Opponents' observed fold-to-c-bet rates, if known. */
  foldToCbet?: Record<number, number>;
  names: Record<number, string>;
  iterations?: number;
  seed?: number;
}

const pct = (x: number, d = 1): string => `${(x * 100).toFixed(d)}%`;
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

export function analyse(input: CoachInput): CoachAnalysis {
  const { view } = input;
  const rng = new Rng(input.seed ?? 1234567);
  const hole = view.hole!;
  const board = view.board;
  const bb = view.bb;
  const L = view.legal;
  const me = view.seats.find((s) => s.seat === view.me)!;
  const opps = view.seats.filter((s) => s.seat !== view.me && !s.folded);
  const dead: Card[] = [...hole, ...board];
  const cache = new Map();
  const tOf = (seat: number): Tendencies => input.tendencies[seat] ?? POPULATION;
  const ranges = opps.map((o) => inferRange(view, o.seat, tOf(o.seat), { narrow: 1, dead, cache }));
  const iters = input.iterations ?? 12000;
  const eqRes = equityMC(hole, board, ranges, iters, rng);
  const eq = eqRes.equity;
  const pot = view.pot;
  const toCall = L?.callAmount ?? 0;
  const made = madeHand(hole, board);
  const draws = analyseDraws(hole, board);
  const tex = board.length >= 3 ? boardTexture(board) : null;
  const handName = `${cardToString(hole[0])} ${cardToString(hole[1])} (${className(classOf(hole[0], hole[1]))})`;
  const maths: MathStep[] = [];
  const reasons: string[] = [];

  // --- range summaries
  const rangeSummaries: RangeSummary[] = opps.map((o, i) => summariseRange(view, o.seat, input.names[o.seat] ?? o.name, ranges[i], tOf(o.seat)));

  // --- outs and hit odds (flop/turn)
  let outs: Out[] = [];
  let hit: CoachAnalysis['hit'] = null;
  if (board.length === 3 || board.length === 4) {
    // Probability that at least one opponent still beats us after card c:
    // 1 − Π_i (1 − share_i), share_i = weighted share of opponent i's range ahead of us.
    const heroScoreAfter = (c: Card, s: number): number => {
      const nb = [...board, c];
      let pNone = 1;
      for (const w of ranges) {
        let beat = 0, tot = 0;
        for (let k = 0; k < NUM_COMBOS; k++) {
          if (!(w[k] > 0) || COMBO_A[k] === c || COMBO_B[k] === c) continue;
          tot += w[k];
          if (evaluate([COMBO_A[k], COMBO_B[k], ...nb]) > s) beat += w[k];
        }
        if (tot) pNone *= 1 - beat / tot;
      }
      return 1 - pNone;
    };
    outs = findOuts(hole, board, heroScoreAfter);
    const live = outs.filter((o) => o.kind !== 'counterfeit');
    const clean = outs.filter((o) => o.kind === 'clean').length;
    const n = live.length;
    const unseen = 52 - 2 - board.length;
    const next = n / unseen;
    const byRiver = board.length === 3 ? 1 - ((unseen - n) * (unseen - n - 1)) / (unseen * (unseen - 1)) : null;
    hit = { outs: n, unseen, next, byRiver, rule2: Math.min(1, 0.02 * n), rule4: board.length === 3 ? Math.min(1, 0.04 * n) : null };
    if (n > 0) {
      const lines = [
        `Unseen cards: 52 − 2 (yours) − ${board.length} (board) = ${unseen}. Opponents' cards are unknown, so they count as unseen.`,
        `Outs that improve you: ${n} (${clean} clean${n - clean ? `, ${n - clean} dirty` : ''})${outs.length > n ? `; ${outs.length - n} counterfeit card${outs.length - n > 1 ? 's' : ''} excluded` : ''}.`,
        `Next card: P = ${n}/${unseen} = ${pct(next)}. Rule of 2: ${n} × 2% = ${pct(hit.rule2, 0)}.`,
      ];
      if (byRiver !== null) {
        lines.push(
          `By the river (both cards to come): P = 1 − P(miss twice) = 1 − (${unseen - n}/${unseen}) × (${unseen - n - 1}/${unseen - 1}) = ${pct(byRiver)}.`,
          `Rule of 4: ${n} × 4% = ${pct(hit.rule4!, 0)}${n > 8 ? `; it overstates with many outs because it double counts hitting on both cards. Corrected rule: 4n − (n − 8) = ${4 * n - (n - 8)}%.` : '.'}`,
          `Note: "by the river" only applies if you will see both cards for this price. Facing more bets on the turn, use the one-card number.`,
        );
      }
      maths.push({ title: 'Outs and hitting odds', lines });
    }
  }

  // --- pot odds
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : null;
  let impliedNeeded: number | null = null;
  if (potOdds !== null) {
    const lines = [
      `You call ${chips(toCall, bb)} to win the ${chips(pot, bb)} already in the middle (including their bet).`,
      `Price: ${(pot / toCall).toFixed(2)} : 1. Break-even equity = call / (pot + call) = ${chips(toCall, bb)} / ${chips(pot + toCall, bb)} = ${pct(potOdds)}.`,
    ];
    if (hit && hit.outs > 0 && board.length < 5 && hit.next < potOdds) {
      // Implied odds: winnings W needed when we hit so that p(P + c + W) − c ≥ 0  ⇒  W ≥ c/p − (P + c)
      impliedNeeded = toCall / hit.next - (pot + toCall);
      lines.push(
        `Drawing on the next card only (${pct(hit.next)} < ${pct(potOdds)}), the direct price is not enough. Implied odds: you need to win W more when you hit, with p·(P + c + W) − c ≥ 0 ⇒ W ≥ c/p − (P + c) = ${chips(Math.max(0, impliedNeeded), bb)}.`,
      );
    }
    maths.push({ title: 'Pot odds', lines });
  }

  // --- equity vs ranges
  maths.push({
    title: 'Equity against their likely range',
    lines: [
      `Estimated ranges from the actions so far (never their actual cards): ${rangeSummaries.map((r) => `${r.name} ≈ ${pct(r.pct, 0)} of hands (${r.basis})`).join('; ')}.`,
      `Monte Carlo: ${eqRes.n.toLocaleString()} deals sampled from those ranges and the unknown board cards. Equity = ${pct(eq)} ± ${pct(1.96 * eqRes.se)} (95% interval ${pct(eqRes.ci[0])}–${pct(eqRes.ci[1])}).`,
      `Standard error = √(Var/n): with n = ${eqRes.n.toLocaleString()} the estimate is precise to about ±${(1.96 * eqRes.se * 100).toFixed(1)} points; the range estimate itself is the bigger uncertainty.`,
    ],
  });

  // --- options and EVs
  const options: EvOption[] = [];
  const positionIP = actsLastPostflop(view);
  let preflop: CoachAnalysis['preflop'] = null;

  if (view.street === 'preflop') {
    const pf = preflopAdvice(view, hole);
    preflop = pf.info;
    reasons.push(...pf.reasons);
    // Rough preflop EVs: realised equity vs their continuing range.
    const rho = positionIP ? 0.9 : 0.75;
    if (L?.canFold) options.push({ action: 'fold', label: 'Fold', ev: 0, detail: 'Nothing more invested' });
    if (L?.canCheck) options.push({ action: 'check', label: 'Check', ev: eq * pot * rho, detail: `≈ equity × pot × realisation (${rho})` });
    if (L?.canCall) options.push({ action: 'call', label: `Call ${chips(toCall, bb)}`, ev: eq * rho * (pot + toCall) - toCall, detail: `≈ ${pct(eq)} × ${rho} × ${chips(pot + toCall, bb)} − ${chips(toCall, bb)} (realised equity, rough)` });
    const rec = pf.action;
    const recOpt: EvOption | undefined = options.find((o) => o.action === rec);
    const recommendation = {
      action: rec,
      to: pf.to,
      label: pf.label,
      closeness: pf.close ? ('close' as const) : ('clear' as const),
      reasons,
    };
    if (!recOpt && (rec === 'raise' || rec === 'bet')) options.push({ action: rec, to: pf.to, label: pf.label, ev: NaN, detail: 'Chart play (preflop raise EV depends on fold equity and post-flop play; not estimated)' });
    maths.push({ title: 'Preflop reasoning', lines: pf.maths });
    return finish({ recommendation });
  }

  // Postflop: fold/call/raise or check/bet with EVs.
  const strengths = comboStrengths(board, (() => { const d = new Uint8Array(52); for (const c of dead) d[c] = 1; return d; })());
  const station = opps.length ? opps.reduce((a, o) => a + tOf(o.seat).station, 0) / opps.length : 0.35;
  const evAggressive = (to: number): { ev: number; F: number; eC: number; detail: string } => {
    const add = to - me.betStreet;
    const cur = view.currentBet;
    // Each opponent continues with the strongest share = MDF, stretched for stations.
    const potBefore = pot;
    const mdf = clamp((potBefore / (potBefore + (to - cur))) * (1 + 0.8 * (station - 0.35)), 0.12, 0.97);
    const contRanges = ranges.map((w) => topShare(w, strengths.hs, strengths.draw, mdf));
    const Fall = Math.pow(1 - mdf, opps.length);
    const eC = equityMC(hole, board, contRanges, Math.round(iters / 2), rng).equity;
    // Chips a caller adds to match `to` (capped by their stack), averaged over opponents.
    const k = opps.reduce((acc, o) => acc + Math.max(0, Math.min(to - o.betStreet, o.stack)), 0) / Math.max(1, opps.length);
    const ev = Fall * pot + (1 - Fall) * (eC * (pot + add + k) - add);
    return { ev, F: Fall, eC, detail: `F = ${pct(Fall, 0)} fold, e_c = ${pct(eC, 0)} when called: ${pct(Fall, 0)} × ${chips(pot, bb)} + ${pct(1 - Fall, 0)} × (${pct(eC, 0)} × ${chips(pot + add + k, bb)} − ${chips(add, bb)})` };
  };

  if (L && toCall > 0) {
    options.push({ action: 'fold', label: 'Fold', ev: 0, detail: 'Chips already in the pot are sunk: EV 0 by definition' });
    const evCall = eq * (pot + toCall) - toCall;
    options.push({ action: 'call', label: `Call ${chips(toCall, bb)}`, ev: evCall, detail: `${pct(eq)} × ${chips(pot + toCall, bb)} − ${chips(toCall, bb)}` });
    if (L.canRaise) {
      const sizes = [Math.round(view.currentBet * 2.8 + 0.3 * (pot - view.currentBet)), L.maxTo].filter((x, i, a) => x >= L.minTo && x <= L.maxTo && a.indexOf(x) === i);
      for (const to of sizes) {
        const r = evAggressive(to);
        options.push({ action: 'raise', to, label: to === L.maxTo ? `All-in ${chips(to, bb)}` : `Raise to ${chips(to, bb)}`, ev: r.ev, detail: r.detail });
      }
    }
  } else if (L) {
    const rho = positionIP ? 0.9 : 0.8;
    options.push({ action: 'check', label: 'Check', ev: eq * pot * rho, detail: `${pct(eq)} × ${chips(pot, bb)} × realisation ${rho} (${positionIP ? 'in' : 'out of'} position)` });
    if (L.canRaise) {
      const fr = [0.33, 0.66, 1];
      for (const f of fr) {
        const to = clamp(Math.round(f * pot), L.minTo, L.maxTo);
        if (options.some((o) => o.to === to)) continue;
        const r = evAggressive(to);
        options.push({ action: 'bet', to, label: `Bet ${Math.round(f * 100)}% pot (${chips(to, bb)})`, ev: r.ev, detail: r.detail });
      }
    }
  }

  // Recommendation: best EV; honest about closeness.
  const sorted = [...options].sort((a, b) => b.ev - a.ev);
  const best = sorted[0];
  const second = sorted[1];
  const gap = second ? (best.ev - second.ev) / Math.max(pot, bb) : 1;
  const closeness: 'clear' | 'close' | 'coin-flip' = gap < 0.03 ? 'coin-flip' : gap < 0.1 ? 'close' : 'clear';
  if (potOdds !== null) reasons.push(`You need ${pct(potOdds, 0)} equity to call; you have about ${pct(eq, 0)} against their likely range.`);
  else reasons.push(`Your equity against their likely range is about ${pct(eq, 0)}.`);
  reasons.push(positionIP ? 'You are in position: you act last on later streets and realise more of your equity.' : 'You are out of position: you act first on later streets, so marginal hands realise less equity.');
  if (tex) reasons.push(`Board: ${tex.summary}.`);
  const spr = Math.min(me.stack, Math.max(...opps.map((o) => o.stack), 0)) / Math.max(1, pot);
  reasons.push(`Stack-to-pot ratio ${spr.toFixed(1)}${spr < 2 ? ': low, top pair-type hands are usually committed' : spr > 8 ? ': deep, prefer strong hands for big pots' : ''}.`);
  for (const o of opps) {
    const t = tOf(o.seat);
    if (t.bluffiness > 0.45) reasons.push(`${input.names[o.seat] ?? o.name} has been caught bluffing: call down a little lighter.`);
    if (t.station > 0.6) reasons.push(`${input.names[o.seat] ?? o.name} calls a lot: value-bet thinner, bluff less.`);
    if (t.aggression > 0.65) reasons.push(`${input.names[o.seat] ?? o.name} is very aggressive postflop: their bets are less often strong.`);
  }
  if (hit?.outs && board.length < 5) reasons.push(`Drawing: ${hit.outs} outs (${pct(hit.next, 0)} next card${hit.byRiver !== null ? `, ${pct(hit.byRiver, 0)} by the river` : ''}).`);
  if (closeness !== 'clear') reasons.unshift(closeness === 'coin-flip' ? 'This is a close spot: the top options are within about 3% of the pot of each other, so either is fine.' : 'Fairly close: the best option is only slightly ahead.');

  maths.push({
    title: 'Expected value of each option',
    lines: [
      ...options.map((o) => `${o.label}: EV = ${o.detail} = ${signedChips(o.ev, bb)}`),
      toCall > 0
        ? 'EV(call) counts this street only: exact on the river, an approximation earlier (implied and reverse-implied odds come from future betting).'
        : 'EV(check) uses a realisation factor because you may not see a showdown for free; bets assume opponents continue with their strongest hands at their minimum-defence frequency.',
    ],
  });

  return finish({ recommendation: { action: best.action, to: best.to, label: best.label, closeness, reasons } });

  function finish(extra: { recommendation: CoachAnalysis['recommendation'] }): CoachAnalysis {
    return {
      handId: view.handId,
      street: view.street,
      actionsSeen: view.actions.length,
      hand: handName,
      made: board.length ? made.description : 'Preflop',
      draws: drawSummary(draws),
      texture: tex?.summary ?? '',
      outs,
      hit,
      equity: { value: eq, lo: eqRes.ci[0], hi: eqRes.ci[1], n: eqRes.n, exact: false },
      ranges: rangeSummaries,
      pot,
      toCall,
      potOdds,
      impliedNeeded,
      options,
      preflop,
      maths,
      bb,
      ...extra,
    };
  }
}

function chips(x: number, bb: number): string {
  const v = x / bb;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}bb`;
}
function signedChips(x: number, bb: number): string {
  if (!Number.isFinite(x)) return 'n/a';
  return `${x >= 0 ? '+' : '−'}${chips(Math.abs(x), bb)}`;
}

/** Keep the strongest `share` (by weight) of a range; draws count as strong. */
function topShare(w: Float64Array, hs: Float64Array, draw: Float64Array, share: number): Float64Array {
  const ks: number[] = [];
  let total = 0;
  for (let k = 0; k < NUM_COMBOS; k++)
    if (w[k] > 0) {
      ks.push(k);
      total += w[k];
    }
  ks.sort((a, b) => hs[b] + draw[b] * 0.8 - (hs[a] + draw[a] * 0.8));
  const out = new Float64Array(NUM_COMBOS);
  let acc = 0;
  for (const k of ks) {
    if (acc >= share * total) break;
    out[k] = w[k];
    acc += w[k];
  }
  return out;
}

function summariseRange(view: PlayerView, seat: number, name: string, w: Float64Array, t: Tendencies): RangeSummary {
  let s = 0;
  const byClass = new Map<number, number>();
  for (let k = 0; k < NUM_COMBOS; k++)
    if (w[k] > 0) {
      s += w[k];
      const c = classOf(COMBO_A[k], COMBO_B[k]);
      byClass.set(c, (byClass.get(c) ?? 0) + w[k]);
    }
  const top = [...byClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c]) => className(c)).join(', ');
  const acts = view.actions.filter((a) => a.seat === seat && !a.type.startsWith('post') && a.type !== 'uncalled').map((a) => `${a.street === 'preflop' ? '' : a.street + ' '}${a.type}`);
  const basis = `${positionOf(view, seat)}; ${acts.join(', ') || 'no action yet'}; VPIP ${Math.round(t.vpip * 100)} / PFR ${Math.round(t.pfr * 100)}`;
  return { seat, name, pct: s / NUM_COMBOS, top, basis };
}

function actsLastPostflop(view: PlayerView): boolean {
  const live = view.order.filter((seat) => {
    const s = view.seats.find((x) => x.seat === seat)!;
    return !s.folded;
  });
  return live[live.length - 1] === view.me;
}

/** Chart-based preflop advice. */
function preflopAdvice(view: PlayerView, hole: Card[]): { action: CoachAction; to?: number; label: string; close: boolean; reasons: string[]; maths: string[]; info: CoachAnalysis['preflop'] } {
  const n = view.order.length;
  const pos = positionOf(view, view.me);
  const cls = classOf(hole[0], hole[1]);
  const p = handPercentile(cls);
  const L = view.legal!;
  const bb = view.bb;
  let raises = 0, limpers = 0;
  let opener: number | null = null;
  let lastTo = bb;
  let iOpened = false;
  for (const a of view.actions) {
    if (a.street !== 'preflop' || a.type.startsWith('post') || a.type === 'uncalled') continue;
    if (a.type === 'raise' || a.type === 'bet') {
      raises++;
      if (raises === 1) opener = a.seat;
      if (a.seat === view.me) iOpened = true;
      lastTo = a.to;
    } else if (a.type === 'call' && raises === 0) limpers++;
  }
  const reasons: string[] = [];
  const maths: string[] = [`${className(cls)} is in the top ${pct(p, 1)} of starting hands by playability (equity vs a random hand ${pct(EQ_VS_RANDOM[cls], 1)}).`];
  const info = { position: pos, cls: className(cls), percentile: p, chart: '' };
  const raise = (to: number, label: string, close: boolean): ReturnType<typeof preflopAdvice> => ({ action: 'raise', to: Math.round(Math.min(L.maxTo, Math.max(L.minTo, to))), label, close, reasons, maths, info });
  const flat = (close: boolean): ReturnType<typeof preflopAdvice> => ({ action: L.canCheck ? 'check' : 'call', label: L.canCheck ? 'Check' : 'Call', close, reasons, maths, info });
  const fold = (close: boolean): ReturnType<typeof preflopAdvice> => ({ action: L.canCheck ? 'check' : 'fold', label: L.canCheck ? 'Check' : 'Fold', close, reasons, maths, info });

  if (raises === 0) {
    if (pos === 'BB') {
      info.chart = 'Big blind, no raise: check, or raise limpers with strong hands';
      return p < 0.1 ? raise((3.5 + limpers) * bb, `Raise to ${3.5 + limpers}bb`, false) : fold(false);
    }
    const r = rfiPercent(pos, n);
    info.chart = `${pos} raise-first-in range ≈ top ${pct(r, 0)}${limpers ? ` (tighter with ${limpers} limper${limpers > 1 ? 's' : ''})` : ''}`;
    const target = limpers ? r * 0.6 : r;
    maths.push(`Chart: from ${pos} at a ${n}-handed table, open about the top ${pct(r, 0)} of hands${limpers ? `; with limpers, isolate with the top ${pct(target, 0)} and raise to ${3 + limpers}bb or more` : ''}.`);
    const close = Math.abs(p - target) < 0.03;
    if (p <= target) {
      reasons.push(`${className(cls)} (top ${pct(p, 0)}) is inside the ${pos} range (top ${pct(target, 0)}).`);
      if (pos === 'BTN' || pos === 'CO') reasons.push('Late position: you will act last after the flop and can steal the blinds.');
      return raise((limpers ? 3 + limpers : pos === 'SB' ? 3 : 2.5) * bb, `Raise to ${limpers ? 3 + limpers : pos === 'SB' ? 3 : 2.5}bb`, close);
    }
    reasons.push(`${className(cls)} (top ${pct(p, 0)}) is outside the ${pos} opening range (top ${pct(target, 0)}).`);
    if (pos === 'UTG' || pos === 'UTG+1' || pos === 'MP') reasons.push('Early position: several players act after you, so ranges must be tight.');
    return fold(close);
  }
  if (raises === 1 && opener !== null) {
    const op = positionOf(view, opener);
    const openerPct = rfiPercent(op === 'BB' ? 'SB' : op, n);
    const ip = view.order.indexOf(view.me) > view.order.indexOf(opener) && pos !== 'SB' && pos !== 'BB';
    const c = vsOpen(pos, openerPct, ip);
    info.chart = `vs ${op} open: 3-bet top ${pct(c.threeBet, 0)}, call next ${pct(c.call, 0)}`;
    maths.push(`They opened from ${op} (≈ top ${pct(openerPct, 0)}). Against that, 3-bet about the top ${pct(c.threeBet, 0)} and flat roughly the next ${pct(c.call, 0)}${pos === 'BB' ? ' (the big blind defends widest because it closes the action at a discount)' : ''}.`);
    if (pos === 'BB') {
      const toCall = L.callAmount;
      const po = toCall / (view.pot + toCall);
      maths.push(`Big blind price: call ${chips(toCall, bb)} into ${chips(view.pot, bb)} → you need ${pct(po, 0)} equity before accounting for being out of position.`);
    }
    if (p <= c.threeBet) {
      reasons.push(`${className(cls)} is strong enough to 3-bet for value against a ${op} open.`);
      return raise((ip ? 3 : 3.8) * lastTo, `3-bet to ${chips((ip ? 3 : 3.8) * lastTo, bb)}`, Math.abs(p - c.threeBet) < 0.01);
    }
    if (p <= c.threeBet + c.call) {
      reasons.push(`${className(cls)} plays well enough to continue but is not a value 3-bet against this range.`);
      return flat(Math.abs(p - (c.threeBet + c.call)) < 0.03);
    }
    reasons.push(`${className(cls)} (top ${pct(p, 0)}) is too weak to continue against a ${op} open (continue ≈ top ${pct(c.threeBet + c.call, 0)}).`);
    return fold(Math.abs(p - (c.threeBet + c.call)) < 0.03);
  }
  if (raises === 2 && iOpened) {
    const myPct = rfiPercent(pos === 'BB' ? 'SB' : pos, n);
    const c = vs3Bet(myPct, false);
    info.chart = `vs 3-bet: 4-bet top ${pct(c.fourBet, 1)}, call next ${pct(c.call, 0)}`;
    maths.push(`You opened ≈ top ${pct(myPct, 0)}. Facing a 3-bet, continue with about the top ${pct(c.fourBet + c.call, 0)}: 4-bet ≈ top ${pct(c.fourBet, 1)}.`);
    if (p <= c.fourBet) return raise(lastTo * 2.3, `4-bet to ${chips(lastTo * 2.3, bb)}`, false);
    if (p <= c.fourBet + c.call) return flat(Math.abs(p - (c.fourBet + c.call)) < 0.02);
    reasons.push('Folding to 3-bets with the bottom of your opening range is standard.');
    return fold(Math.abs(p - (c.fourBet + c.call)) < 0.02);
  }
  info.chart = 'Facing heavy action: continue only with premium hands';
  maths.push('Facing a 3-bet you did not open into, or a 4-bet: continue with roughly the top 2.5–4% (QQ+, AK).');
  if (p <= 0.025) return L.canRaise ? raise(L.maxTo, 'All-in', false) : flat(false);
  if (p <= 0.04) return flat(true);
  return fold(false);
}

/** Classify the hero's actual action vs the analysis: EV lost (chips) when computable. */
export function judge(a: CoachAnalysis, act: { type: CoachAction; to?: number }): { evLost: number | null; matches: boolean; note: string } {
  const best = a.options.reduce<EvOption | null>((m, o) => (!m || o.ev > m.ev ? o : m), null);
  const sameKind = (x: CoachAction, y: CoachAction): boolean => x === y || ((x === 'bet' || x === 'raise') && (y === 'bet' || y === 'raise')) || ((x === 'check' || x === 'fold') && (y === 'check' || y === 'fold') && a.toCall === 0);
  const matches = sameKind(act.type, a.recommendation.action);
  if (a.street === 'preflop') {
    return { evLost: null, matches, note: matches ? 'Matches the chart' : `Chart: ${a.recommendation.label}` };
  }
  const mine = a.options.filter((o) => sameKind(o.action, act.type));
  const closest = mine.sort((x, y) => Math.abs((x.to ?? 0) - (act.to ?? 0)) - Math.abs((y.to ?? 0) - (act.to ?? 0)))[0];
  if (!best || !closest || !Number.isFinite(closest.ev)) return { evLost: null, matches, note: '' };
  const lost = Math.max(0, best.ev - closest.ev);
  return { evLost: lost, matches, note: matches ? 'Best option' : `${best.label} was better by about ${chips(lost, a.bb)}` };
}

