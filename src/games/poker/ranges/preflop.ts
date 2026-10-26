/**
 * Preflop hand ordering and position charts.
 *
 * ORDER ranks the 169 classes by "playability": all-in equity vs one random
 * hand and vs three random hands (Monte Carlo, 60k/40k trials per class with
 * this app's evaluator), plus realisation adjustments — suited and connected
 * hands realise more of their equity postflop, offsuit weak-kicker hands
 * less, small pairs gain set value. Opening ranges are then "top X% of
 * combos" in this order, which reproduces standard 6-max 100bb charts closely
 * (UTG ≈ 15%, CO ≈ 27%, BTN ≈ 45%). It is an approximation and is labelled as
 * such wherever it is shown.
 */
import { classFromName, combosInClass, NUM_COMBOS } from './combos';

const ORDER_NAMES = 'AA KK QQ JJ TT 99 AKs 88 AQs KQs AJs 77 KJs ATs AKo QJs 66 KTs AQo A9s QTs JTs A8s 55 AJo KQo A5s K9s A7s ATo A4s A6s Q9s KJo T9s J9s A3s 44 K8s KTo A2s QJo K7s A9o Q8s K6s QTo 98s K5s T8s J8s JTo K4s 33 Q7s K9o 87s A8o K3s Q6s Q9o K2s J7s A7o Q5s 97s T7s 22 J9o Q4s 76s T9o A5o A6o Q3s J6s A4o K8o J5s T6s 86s 65s Q2s 96s A3o J4s K7o A2o 54s J3s Q8o K6o T5s 75s T4s J8o J2s K5o 85s T8o 95s T3s Q7o 98o K4o 64s T2s Q6o K3o 43s K2o 74s 94s 84s 93s J7o Q5o T7o 53s 97o 87o 92s Q4o 63s 73s 83s J6o Q3o 82s J5o T6o Q2o 42s 96o 52s 76o J4o 86o 32s 62s 72s J3o T5o J2o 65o T4o 95o 85o 75o T3o 54o T2o 94o 74o 84o 64o 93o 53o 92o 43o 63o 83o 73o 82o 52o 42o 32o 72o 62o'.split(' ');
/** Equity vs a random hand (per mille), aligned with ORDER_NAMES. */
const EQ_PERMILLE = '851 824 798 773 750 721 672 690 666 633 653 660 625 648 651 604 633 619 644 632 596 572 618 608 636 614 600 598 608 626 590 600 580 603 540 555 581 574 581 598 575 580 577 606 560 568 575 509 558 523 538 554 551 534 546 578 476 598 542 534 557 531 522 588 527 489 506 503 538 517 453 518 574 575 514 509 567 562 498 492 462 429 497 473 558 492 550 548 414 479 533 543 472 434 466 516 472 530 444 502 457 460 517 477 520 416 446 511 511 382 508 418 437 428 434 495 502 477 397 465 452 426 491 396 402 411 480 483 404 474 460 471 369 444 375 424 464 432 363 379 379 451 439 441 400 436 426 414 401 424 381 416 404 387 394 378 402 364 386 351 361 375 361 367 340 332 326 344 338'.split(' ').map(Number);

export const ORDER: readonly number[] = ORDER_NAMES.map(classFromName);
/** Equity of each class vs one random hand, indexed by class. */
export const EQ_VS_RANDOM = new Float64Array(169);
/** Cumulative combo fraction at which each class enters the ordering, by class. */
export const RANK_PCT = new Float64Array(169);
{
  let cum = 0;
  ORDER.forEach((cls, i) => {
    cum += combosInClass(cls);
    RANK_PCT[cls] = cum / NUM_COMBOS;
    EQ_VS_RANDOM[cls] = EQ_PERMILLE[i] / 1000;
  });
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * Class weights for the top `pct` of hands. `soft` > 0 blurs the boundary
 * (a hand right at the edge is played some of the time) — real players and
 * mixed strategies are not hard lookup tables.
 */
export function topRange(pct: number, soft = 0): Float64Array {
  const w = new Float64Array(169);
  for (let c = 0; c < 169; c++) {
    const enter = RANK_PCT[c] - combosInClass(c) / NUM_COMBOS / 2;
    w[c] = soft > 0 ? sigmoid((pct - enter) / soft) : enter <= pct ? 1 : 0;
  }
  return w;
}

/** Weights for the band of hands between the top lo% and top hi%. */
export function bandRange(lo: number, hi: number, soft = 0): Float64Array {
  const a = topRange(hi, soft), b = topRange(lo, soft);
  return a.map((x, i) => Math.max(0, x - b[i]));
}

// ---------------------------------------------------------------- positions

export type Position = 'UTG' | 'UTG+1' | 'MP' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

/** Names for seats in action order (UTG first … BB last) for n players. */
export function positionsFor(n: number): Position[] {
  if (n === 2) return ['BTN', 'BB']; // heads-up: button is also the small blind
  const late: Position[] = ['BTN', 'SB', 'BB'];
  const early: Position[] = ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'];
  // Non-blind, non-button seats take the latest names (…, HJ, CO); in games of
  // six or fewer the first seat to act is still called UTG.
  const pre = early.slice(early.length - (n - 3));
  if (pre.length && n <= 6) pre[0] = 'UTG';
  return [...pre, ...late];
}

/** Seats from the button counting backwards (BTN 0, CO 1, HJ 2, …); blinds −1/−2. */
const DIST: Record<Position, number> = { BTN: 0, CO: 1, HJ: 2, LJ: 3, MP: 4, 'UTG+1': 5, UTG: 6, SB: -1, BB: -2 };

/** Raise-first-in percentage by position for an n-handed table (100bb). */
export function rfiPercent(pos: Position, n: number): number {
  if (n === 2) return pos === 'BTN' ? 0.8 : 0;
  if (pos === 'SB') return n === 3 ? 0.45 : 0.38;
  if (pos === 'BB') return 0;
  // Distance from the button decides; in ≤6-handed games "UTG" plays like LJ.
  const d = pos === 'UTG' && n <= 6 ? n - 3 : DIST[pos];
  return [0.45, 0.27, 0.19, 0.15, 0.13, 0.115, 0.1][Math.min(6, d)];
}

/**
 * Approximate continuing ranges facing a single open of size ~2.5bb from a
 * player whose opening range is `openerPct`. Returns percentages of all
 * hands: 3-bet (value + bluffs) and flat call.
 */
export function vsOpen(hero: Position, openerPct: number, ip: boolean): { threeBet: number; call: number } {
  if (hero === 'BB') return { threeBet: Math.min(0.14, openerPct * 0.22), call: Math.min(0.5, openerPct * 1.25 + 0.06) };
  if (hero === 'SB') return { threeBet: Math.min(0.13, openerPct * 0.3), call: Math.min(0.06, openerPct * 0.1) };
  return { threeBet: Math.min(0.11, openerPct * 0.22), call: Math.min(0.16, openerPct * (ip ? 0.5 : 0.25)) };
}

/** Facing a 3-bet after opening: 4-bet and call percentages (of all hands). */
export function vs3Bet(openPct: number, ip: boolean): { fourBet: number; call: number } {
  return { fourBet: Math.min(0.05, openPct * 0.12), call: Math.min(0.14, openPct * (ip ? 0.42 : 0.32)) };
}

/** Classes that make good 3-bet/4-bet bluffs: suited wheel aces, suited connectors/broadways. */
export function isBluffCandidate(cls: number): boolean {
  const r = Math.floor(cls / 13), c = cls % 13;
  if (r >= c) return false; // not suited
  const hi = 12 - r, lo = 12 - c;
  if (hi === 12 && lo <= 3) return true; // A5s-A2s
  if (hi - lo === 1 && lo >= 3 && lo <= 8) return true; // 54s..T9s
  if (hi === 11 && lo >= 7 && lo <= 9) return true; // K9s-KJs
  return false;
}

/** Percentile of a class in the ordering, e.g. 0.031 for top 3.1%. */
export const handPercentile = (cls: number): number => RANK_PCT[cls];
