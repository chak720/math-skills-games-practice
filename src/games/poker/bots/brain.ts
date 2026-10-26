/**
 * A bot's mind. It sees exactly what a human at the table would: its own
 * PlayerView (its two cards, the board, stacks, bets, the public action log,
 * cards shown at showdown) and the public record of past hands. It never
 * receives the deck or anyone's hidden cards — this module cannot even import
 * the engine (see bots.boundary.test.ts).
 *
 * Decision outline
 *  Preflop: position charts scaled by personality and mood; reacts to opens,
 *    3-bets and limps; uses opponents' observed fold-to-3-bet; push/fold when
 *    short.
 *  Postflop: equity vs the opponents' *inferred ranges* (Monte Carlo), pot
 *    odds, implied odds, fold equity from observed tendencies, the bettor's
 *    table image, board texture. Personality and realistic mistakes bend the
 *    choice; sizing follows a style (balanced for regs, strength tells for
 *    weak players).
 *  Humanisation: think time from decision difficulty and size, tilt after bad
 *    beats/big losses, confidence after wins, occasional chat.
 */
import type { Card } from '@/shared/cards/card';
import { Rng } from '@/shared/random/prng';
import type { PlayerAction, PlayerView, SeatView } from '../engine/types';
import { classOf } from '../ranges/combos';
import { handPercentile, isBluffCandidate, rfiPercent, vs3Bet, vsOpen } from '../ranges/preflop';
import { inferRange, positionOf } from '../ranges/inference';
import { equityMC } from '../equity/equity';
import { analyseDraws, boardTexture, madeHand, MADE_STRENGTH, type MadeClass } from '../analysis/hand';
import { extractStats, StatsTracker } from '../analysis/stats';
import { applyDifficulty, personalityFor, type Archetype, type Difficulty, type Personality } from './personality';
import { chatLine, thinkTime, type ChatEvent } from './humanize';
import { legalize } from './legalize';

export interface BotSpec {
  botId: string;
  playerId: string;
  name: string;
  archetype: Archetype;
  difficulty: Difficulty;
  seed: string;
}

export interface BotDecision {
  action: PlayerAction;
  thinkMs: number;
  /** Short internal rationale (shown only in debug tooling, never at the table). */
  reason: string;
}

interface Choice {
  action: PlayerAction;
  reason: string;
  kind: 'trivial' | 'routine' | 'decision';
  difficulty: number;
  strength: number;
}

interface HandMemo {
  handId: number;
  hadDraw: boolean;
  bigEq: number | null;
  bluffed: boolean;
}

const sig = (x: number): number => 1 / (1 + Math.exp(-x));
const prevStreet = (s: PlayerView['street']): PlayerView['street'] => (s === 'river' ? 'turn' : s === 'turn' ? 'flop' : 'preflop');
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const TOP_PAIRISH: MadeClass[] = ['top-pair-weak', 'top-pair-good', 'top-pair-top', 'overpair'];

export class BotBrain {
  readonly spec: BotSpec;
  readonly base: Personality;
  readonly stats = new StatsTracker();
  private rng: Rng;
  tilt = 0;
  confidence = 0;
  private memo: HandMemo = { handId: -1, hadDraw: false, bigEq: null, bluffed: false };

  constructor(spec: BotSpec) {
    this.spec = spec;
    this.base = applyDifficulty(personalityFor(spec.archetype, spec.playerId), spec.difficulty);
    this.rng = new Rng(spec.seed);
  }

  /** Personality bent by current mood. */
  get personality(): Personality {
    const b = this.base, t = this.tilt, c = this.confidence;
    const cocky = b.winReaction === 'cocky' ? c : 0;
    const tight = b.winReaction === 'tighten' ? c : 0;
    return {
      ...b,
      looseness: b.looseness * (1 + 0.6 * t + 0.25 * cocky - 0.2 * tight),
      aggression: Math.min(0.97, b.aggression + 0.25 * t + 0.1 * cocky),
      bluffFreq: Math.min(0.9, b.bluffFreq + 0.25 * t + 0.05 * cocky),
      threeBet: b.threeBet * (1 + 0.8 * t),
      callAdj: b.callAdj - 0.06 * t + 0.02 * tight,
      foldToPressure: b.foldToPressure * (1 - 0.5 * t),
    };
  }

  /** Prior strength (in hands) for opponent stats: slower learners trust priors longer. */
  private get priorK(): number {
    return 14 / this.base.adaptRate;
  }

  decide(view: PlayerView): BotDecision {
    const L = view.legal;
    if (!L || !view.hole) throw new Error('decide() called when not to act');
    if (this.memo.handId !== view.handId) this.memo = { handId: view.handId, hadDraw: false, bigEq: null, bluffed: false };
    const p = this.personality;
    const c = view.street === 'preflop' ? this.preflop(view, p) : this.postflop(view, p);
    const action = legalize(L, c.action);
    const me = this.meSeat(view);
    const invested = action.type === 'call' ? L.callAmount : action.type === 'bet' || action.type === 'raise' ? (action.to ?? 0) - me.betStreet : 0;
    const bigness = clamp(invested / Math.max(1, me.stack + me.betStreet), 0, 1);
    const thinkMs = thinkTime(p, { kind: c.kind, difficulty: c.difficulty, bigness, strength: c.strength, aggressive: action.type === 'bet' || action.type === 'raise', tilt: this.tilt }, this.rng);
    return { action, thinkMs, reason: c.reason };
  }

  private meSeat(view: PlayerView): SeatView {
    return view.seats.find((s) => s.seat === view.me)!;
  }

  // ------------------------------------------------------------------ preflop

  private preflop(view: PlayerView, p: Personality): Choice {
    const L = view.legal!;
    const hole = view.hole!;
    const bb = view.bb;
    const n = view.order.length;
    const me = this.meSeat(view);
    const pos = positionOf(view, view.me);
    const cls = classOf(hole[0], hole[1]);
    const pct = handPercentile(cls);
    const strength = 1 - pct;
    const r = this.rng;

    let raises = 0, limpers = 0, callersAfter = 0;
    let opener: number | null = null, lastRaiseTo = bb, iRaised = false;
    for (const a of view.actions) {
      if (a.street !== 'preflop' || a.type.startsWith('post') || a.type === 'uncalled') continue;
      if (a.type === 'raise' || a.type === 'bet') {
        raises++;
        if (raises === 1) opener = a.seat;
        if (a.seat === view.me) iRaised = true;
        lastRaiseTo = a.to;
        callersAfter = 0;
      } else if (a.type === 'call') {
        if (raises === 0) limpers++;
        else callersAfter++;
      }
    }
    const others = view.seats.filter((s) => s.seat !== view.me && !s.folded);
    const effChips = Math.min(me.stack + me.betStreet, Math.max(...others.map((s) => s.stack + s.betStreet)));
    const effBB = effChips / bb;
    const fold = (reason: string, trivial = true): Choice => ({ action: L.canCheck ? { type: 'check' } : { type: 'fold' }, reason, kind: trivial ? 'trivial' : 'decision', difficulty: trivial ? 0 : 0.5, strength });
    const call = (reason: string, difficulty = 0.4): Choice => ({ action: { type: 'call' }, reason, kind: 'decision', difficulty, strength });
    const raiseTo = (to: number, reason: string, difficulty = 0.3): Choice => {
      let t = to;
      if (r.chance(p.minRaiseOddly)) t = L.minTo;
      if (t >= 0.45 * L.maxTo) t = L.maxTo; // committing anyway: just shove
      return { action: { type: 'raise', to: Math.round(t) }, reason, kind: 'decision', difficulty, strength };
    };
    const near = (threshold: number): number => 1 - clamp(Math.abs(pct - threshold) / 0.05, 0, 1);

    // Short-stack push/fold.
    if (effBB <= p.shortStackBB) {
      if (raises === 0) {
        const shovePct = clamp((pos === 'BB' ? 0.25 : rfiPercent(pos, n)) * (0.9 + 3 / Math.max(1, effBB)) * p.looseness, 0.05, 0.85);
        if (pct < shovePct) return raiseTo(L.maxTo, `push/fold: top ${Math.round(shovePct * 100)}% at ${effBB.toFixed(0)}bb`, near(shovePct));
        return fold('push/fold: too weak');
      }
      const required = L.callAmount / (view.pot + L.callAmount);
      const callPct = clamp((1 - required * 1.6) * 0.32 * p.looseness, 0.025, 0.4);
      if (pct < callPct) return L.canRaise ? raiseTo(L.maxTo, 'short stack: get it in') : call('short stack: call off', near(callPct));
      return fold('short stack: fold', false);
    }

    if (raises === 0) {
      if (pos === 'BB') {
        const isoPct = 0.1 * p.looseness * (0.6 + p.aggression);
        if (pct < isoPct) return raiseTo((p.openSizeBB + 1 + limpers) * bb, 'raise limpers from the big blind');
        return { action: { type: 'check' }, reason: 'check the option', kind: 'trivial', difficulty: 0, strength };
      }
      if (limpers > 0) {
        const iso = rfiPercent(pos, n) * 0.55 * p.looseness;
        const over = rfiPercent(pos, n) * 1.3 * p.looseness;
        if (pct < iso) return raiseTo((p.openSizeBB + 1 + limpers) * bb, 'isolate the limpers');
        if (pct < over && r.chance(0.35 + p.limpFreq)) return call('over-limp for a cheap flop', 0.3);
        return fold('fold to limps');
      }
      const openPct = rfiPercent(pos, n) * p.looseness;
      if (r.chance(sig((openPct - pct) / 0.012))) {
        if (r.chance(p.limpFreq)) return call(pos === 'SB' ? 'complete the small blind' : 'open-limp', 0.25);
        const size = n === 2 ? Math.min(p.openSizeBB, 2.5) : pos === 'SB' ? Math.max(3, p.openSizeBB) : p.openSizeBB;
        return raiseTo(size * bb, `open ${pos}: inside top ${Math.round(openPct * 100)}%`, near(openPct) * 0.6);
      }
      return fold(`fold ${pos}: outside top ${Math.round(openPct * 100)}%`, pct > openPct + 0.08);
    }

    const ip = opener !== null && view.order.indexOf(view.me) > view.order.indexOf(opener) && pos !== 'SB' && pos !== 'BB';
    if (raises === 1 && opener !== null) {
      const openerSeat = view.seats.find((s) => s.seat === opener)!;
      const t = this.stats.tendencies(openerSeat.playerId, this.priorK);
      const openerPos = positionOf(view, opener);
      const openerPct = clamp(t.pfr * (rfiPercent(openerPos === 'BB' ? 'SB' : openerPos, n) / 0.19), 0.05, 0.85);
      const chart = vsOpen(pos, openerPct, ip);
      const sizeAdj = clamp(2.5 / (lastRaiseTo / bb), 0.35, 1.2);
      let tb = chart.threeBet * p.threeBet;
      let cl = chart.call * p.coldCall * p.looseness * sizeAdj;
      if (callersAfter > 0) {
        tb *= 0.7;
        cl *= 0.85;
      }
      const f3 = this.stats.foldTo3Bet(openerSeat.playerId, this.priorK);
      const bluff3 = isBluffCandidate(cls) && pct > tb && r.chance(p.bluffFreq * 0.45 * (f3 / 0.55) * (callersAfter ? 0.4 : 1));
      const size = (ip ? 3 : 3.8) * lastRaiseTo + callersAfter * lastRaiseTo;
      if (r.chance(sig((tb - pct) / 0.006)) || bluff3) return raiseTo(size * (p.sizing === 'overbets' ? 1.3 : 1), bluff3 ? '3-bet bluff with a blocker' : '3-bet for value', near(tb));
      if (r.chance(sig((tb + cl - pct) / 0.015))) return call(pos === 'BB' ? 'defend the big blind' : 'flat the open', near(tb + cl));
      return fold('fold to the open', pct > tb + cl + 0.1);
    }

    if (raises === 2) {
      if (iRaised) {
        const myOpenPct = rfiPercent(pos === 'BB' ? 'SB' : pos, n) * p.looseness;
        const chart = vs3Bet(myOpenPct, ip);
        const fb = chart.fourBet * Math.sqrt(p.threeBet);
        const cl = chart.call * clamp(1 - (p.foldTo3Bet - 0.55) * 1.5, 0.2, 2) * clamp(10 / (lastRaiseTo / bb), 0.5, 1.2);
        if (pct < fb) return raiseTo(effBB < 45 ? L.maxTo : lastRaiseTo * 2.3, '4-bet for value', near(fb));
        if (isBluffCandidate(cls) && pct < 0.4 && r.chance(p.bluffFreq * 0.12)) return raiseTo(lastRaiseTo * 2.3, '4-bet bluff', 0.7);
        if (pct < fb + cl) return call('call the 3-bet', near(fb + cl));
        return fold('fold to the 3-bet', false);
      }
      if (pct < 0.025 * p.looseness) return raiseTo(lastRaiseTo * 2.3, 'cold 4-bet');
      if (pct < 0.05 * p.looseness && me.betStreet > bb) return call('call the squeeze');
      return fold('fold to the 3-bet');
    }

    // Facing a 4-bet or more.
    if (pct < 0.02 * Math.max(1, p.looseness)) return L.canRaise ? raiseTo(L.maxTo, 'get it in') : call('call off');
    if (pct < 0.035 * Math.max(1, p.looseness) && effBB < 60) return call('call the 4-bet', 0.8);
    return fold('fold to the 4-bet', false);
  }

  // ------------------------------------------------------------------ postflop

  private postflop(view: PlayerView, p: Personality): Choice {
    const L = view.legal!;
    const hole = view.hole!;
    const board = view.board;
    const r = this.rng;
    const me = this.meSeat(view);
    const opps = view.seats.filter((s) => s.seat !== view.me && !s.folded);
    const made = madeHand(hole, board);
    const draws = analyseDraws(hole, board);
    const tex = boardTexture(board);
    const hasDraw = view.street !== 'river' && (draws.flushDraw || draws.oesd || draws.gutshot);
    if (draws.flushDraw || draws.oesd) this.memo.hadDraw = true;

    const dead: Card[] = [...hole, ...board];
    const cache = new Map();
    const ranges = opps.map((o) => inferRange(view, o.seat, this.stats.tendencies(o.playerId, this.priorK), { narrow: p.readSkill, dead, cache }));
    const iters = Math.round(220 + 650 * p.readSkill);
    const eq = equityMC(hole, board, ranges, iters, r).equity;
    // Weaker players think in "hand categories" more than in equity.
    const naive = clamp(MADE_STRENGTH[made.cls] + (draws.flushDraw ? 0.12 : 0) + (draws.oesd ? 0.1 : 0), 0, 1);
    let perceived = eq * (0.5 + 0.5 * p.readSkill) + naive * (0.5 - 0.5 * p.readSkill);
    if (TOP_PAIRISH.includes(made.cls) && r.chance(p.overvalueTopPair)) perceived = Math.max(perceived, 0.64 + 0.12 * r.next());

    const pot = view.pot;
    const toCall = L.callAmount;
    const others = Math.max(0, ...opps.map((s) => s.stack + s.betStreet));
    const effStack = Math.min(me.stack + me.betStreet, others);
    const spr = effStack / Math.max(1, pot);
    const multi = opps.length;
    let pfa: number | null = null;
    for (const a of view.actions) if (a.street === 'preflop' && (a.type === 'raise' || a.type === 'bet')) pfa = a.seat;
    const streetActs = view.actions.filter((a) => a.street === view.street);
    const lastAggr = [...streetActs].reverse().find((a) => a.type === 'bet' || a.type === 'raise');

    const betSize = (kind: 'value' | 'bluff' | 'semi'): number => {
      let frac: number;
      switch (p.sizing) {
        case 'balanced':
          frac = view.street === 'flop' ? (tex.wetness < 0.35 ? 0.33 : 0.66) : view.street === 'turn' ? 0.66 : 0.75;
          if (view.street === 'river' && r.chance(p.archetype === 'lag' ? 0.2 : 0.1)) frac = 1.25;
          frac += r.uniform(-0.05, 0.05);
          break;
        case 'tells':
          frac = kind === 'value' ? (perceived > 0.8 ? r.uniform(0.9, 1.2) : r.uniform(0.5, 0.65)) : r.uniform(0.25, 0.4);
          break;
        case 'overbets':
          frac = r.uniform(0.8, 1.5);
          break;
        case 'steady':
          frac = r.uniform(0.55, 0.65);
          break;
        default:
          frac = r.uniform(0.33, 0.45);
      }
      let to = view.currentBet + frac * pot;
      if (to >= 0.6 * L.maxTo) to = L.maxTo;
      return Math.max(L.minTo, Math.round(to));
    };
    const raiseSize = (kind: 'value' | 'bluff' | 'semi'): number => {
      let to: number;
      if (p.sizing === 'tells' && kind === 'value' && perceived > 0.85 && spr < 4) to = L.maxTo;
      else if (r.chance(p.minRaiseOddly)) to = L.minTo;
      else to = view.currentBet * (p.sizing === 'overbets' ? 3.5 : 2.8) + 0.3 * (pot - view.currentBet);
      if (to >= 0.55 * L.maxTo) to = L.maxTo;
      return Math.max(L.minTo, Math.round(to));
    };
    const strength = perceived;
    const pick = (action: PlayerAction, reason: string, kind: Choice['kind'], difficulty: number): Choice => {
      if ((action.type === 'bet' || action.type === 'raise') && perceived < 0.45) this.memo.bluffed = true;
      return { action, reason, kind, difficulty: clamp(difficulty, 0, 1), strength };
    };

    if (toCall > 0) {
      const required = toCall / (pot + toCall);
      const sizeFrac = toCall / Math.max(1, pot - toCall);
      const implied = (draws.flushDraw || draws.oesd) && view.street !== 'river' && spr > 3 ? 0.03 + 0.05 * p.readSkill : 0;
      const chase = hasDraw && r.chance(p.chaseDraws) ? 0.18 : 0;
      const bettor = lastAggr ? view.seats.find((s) => s.seat === lastAggr.seat) : undefined;
      const tb = bettor ? this.stats.tendencies(bettor.playerId, this.priorK) : null;
      // Table image: call lighter against players caught bluffing.
      const imageAdj = tb ? (tb.bluffiness - 0.3) * 0.18 * (0.3 + p.readSkill) : 0;
      const pressure = p.foldToPressure * Math.max(0, sizeFrac - 0.66) * 0.12;
      const commitFear = toCall > 0.5 * me.stack && p.archetype !== 'station' && p.archetype !== 'maniac' ? 0.04 : 0;
      // Equity realisation: out of position, and with streets to come, a
      // marginal hand realises less than its raw equity (it gets bet off it).
      const ipNow = this.actsLast(view);
      const realise = view.street === 'river' ? 1 : view.street === 'turn' ? (ipNow ? 0.95 : 0.86) : ipNow ? 0.9 : 0.78;
      const realiseAdj = p.archetype === 'station' || p.archetype === 'beginner' ? 1 : realise;
      const threshold = required / realiseAdj + p.callAdj - implied - chase - imageAdj + pressure + commitFear;
      const valueRaiseT = 0.8 - 0.14 * p.aggression + 0.04 * (multi - 1);
      const diff = 1 - clamp(Math.abs(perceived - threshold) / 0.15, 0, 1);
      if (toCall > 0.3 * (me.stack + me.betStreet)) this.memo.bigEq = eq;
      if (L.canRaise && perceived >= valueRaiseT && r.chance(0.3 + 0.6 * p.aggression - (perceived > 0.9 ? p.slowplayFreq * 0.5 : 0)))
        return pick({ type: 'raise', to: raiseSize('value') }, `raise for value (eq ${(eq * 100).toFixed(0)}%)`, 'decision', 0.3);
      if (L.canRaise && (draws.flushDraw || draws.oesd) && view.street !== 'river' && multi === 1 && r.chance(p.semiBluffFreq * 0.35))
        return pick({ type: 'raise', to: raiseSize('semi') }, 'semi-bluff raise', 'decision', 0.6);
      if (perceived >= threshold) return pick({ type: 'call' }, `call: ${(eq * 100).toFixed(0)}% vs ${(required * 100).toFixed(0)}% needed`, 'decision', diff);
      if (L.canRaise && view.street === 'river' && multi === 1 && r.chance(p.bluffFreq * 0.08))
        return pick({ type: 'raise', to: raiseSize('bluff') }, 'river bluff-raise', 'decision', 0.8);
      return pick({ type: 'fold' }, `fold: ${(eq * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}% needed`, diff < 0.2 && perceived < 0.2 ? 'routine' : 'decision', diff);
    }

    // Checked to us (or first to act).
    const valueT = 0.57 + 0.07 * (multi - 1) - 0.07 * p.aggression;
    if (perceived >= valueT) {
      if (perceived > 0.85 && view.street !== 'river' && r.chance(p.slowplayFreq)) return pick({ type: 'check' }, 'slow-play a monster', 'decision', 0.4);
      if (view.street === 'river' && perceived < 0.85 && r.chance(p.missValue)) return pick({ type: 'check' }, 'check back (missed value)', 'routine', 0.3);
      if (r.chance(0.5 + 0.5 * p.aggression)) return pick({ type: 'bet', to: betSize('value') }, `value bet (eq ${(eq * 100).toFixed(0)}%)`, 'decision', 0.3);
      return pick({ type: 'check' }, 'pot control', 'routine', 0.35);
    }
    const foldEq = opps.reduce((acc, o) => acc * clamp(this.stats.foldToCbet(o.playerId, this.priorK) * (1 - 0.4 * this.stats.tendencies(o.playerId, this.priorK).station), 0.05, 0.9), 1);
    const noBetYet = !lastAggr;
    const cbetSpot = pfa === view.me && view.street === 'flop' && noBetYet;
    let prob = cbetSpot
      ? p.cbetFreq * (0.55 + 0.6 * foldEq) * (multi === 1 ? 1 : multi === 2 ? 0.45 : 0.2) * (tex.wetness > 0.55 ? 0.85 : 1.1)
      : p.bluffFreq * (0.35 + 0.8 * foldEq) * (multi === 1 ? 1 : 0.3);
    if (hasDraw && (draws.flushDraw || draws.oesd)) prob += p.semiBluffFreq * 0.4 * (multi === 1 ? 1 : 0.5);
    // Stabs: checked to in position, or a delayed bet after the flop checked through.
    const checkedThrough = view.street !== 'flop' && !view.actions.some((a) => a.street === prevStreet(view.street) && (a.type === 'bet' || a.type === 'raise'));
    if (!cbetSpot && noBetYet && this.actsLast(view)) prob += p.aggression * 0.3 * (0.3 + foldEq) * (multi === 1 ? 1 : 0.35);
    if (!cbetSpot && noBetYet && checkedThrough) prob += p.aggression * 0.15 * (multi === 1 ? 1 : 0.4);
    if (view.street === 'river' && this.memo.hadDraw && made.category <= 1) prob *= 1.4; // busted draws bluff
    if (['middle-pair', 'bottom-pair', 'underpair', 'top-pair-weak'].includes(made.cls)) prob *= 0.35; // showdown value
    if (r.chance(clamp(prob, 0, 0.95)))
      return pick({ type: 'bet', to: betSize(hasDraw ? 'semi' : 'bluff') }, cbetSpot ? 'continuation bet' : hasDraw ? 'semi-bluff' : 'bluff', 'decision', 0.5);
    return pick({ type: 'check' }, 'check', perceived < 0.25 ? 'trivial' : 'routine', 0.2);
  }

  /** Whether we are last to act on this street among players still able to act. */
  private actsLast(view: PlayerView): boolean {
    const live = view.order.filter((seat) => {
      const s = view.seats.find((x) => x.seat === seat)!;
      return !s.folded && !s.allIn;
    });
    return live[live.length - 1] === view.me;
  }

  // ------------------------------------------------------------------ after the hand

  /** Winner of an uncontested pot decides whether to show (needle with a bluff). */
  wantsToShow(view: PlayerView): boolean {
    const won = (view.winners ?? []).some((w) => w.seat === view.me);
    const uncontested = view.seats.filter((s) => !s.folded).length === 1;
    if (!won || !uncontested || !this.memo.bluffed || this.memo.handId !== view.handId) return false;
    const p = this.base;
    return this.rng.chance(p.chatStyle === 'needler' ? 0.25 : p.archetype === 'maniac' ? 0.15 : 0.02);
  }

  /**
   * Learn from a finished hand's PUBLIC record (actions, shown cards, results).
   * Updates opponent stats and mood; returns an optional chat line.
   */
  observe(view: PlayerView): string | null {
    const lines = extractStats(view);
    this.stats.add(lines);
    const mine = lines.find((l) => l.playerId === this.spec.playerId);
    this.tilt *= 0.86;
    this.confidence *= 0.9;
    if (!mine) return null;
    const p = this.base;
    const net = mine.netChips / view.bb;
    const showdown = view.seats.filter((s) => !s.folded).length >= 2;
    const events: ChatEvent[] = [];
    if (net < 0 && showdown && this.memo.handId === view.handId && (this.memo.bigEq ?? 0) >= 0.68) {
      this.tilt = Math.min(1, this.tilt + 0.45 * p.tiltProne);
      events.push('badBeat');
    } else if (net <= -40) {
      this.tilt = Math.min(1, this.tilt + 0.3 * p.tiltProne * Math.min(2, -net / 60));
      events.push('bigLoss');
    }
    if (net >= 40) {
      this.confidence = Math.min(1, this.confidence + 0.4);
      this.tilt *= 0.7;
      events.push('bigWin');
    }
    if (mine.caughtBluff) events.push('ownBluffShown');
    const others = lines.filter((l) => l.playerId !== this.spec.playerId);
    if (others.some((l) => l.caughtBluff && l.netChips > 0) && mine.vpip) events.push('sawBluff');
    const bigPot = (view.pots ?? []).reduce((a, x) => a + x.amount, 0) / view.bb;
    if (showdown && bigPot >= 30 && !(view.winners ?? []).some((w) => w.seat === view.me) && mine.vpip) events.push('niceHand');
    for (const e of events) {
      const line = chatLine(p, e, this.rng, this.tilt);
      if (line) return line;
    }
    return null;
  }

  sayOnEvent(ev: ChatEvent): string | null {
    return chatLine(this.base, ev, this.rng, this.tilt);
  }
}
