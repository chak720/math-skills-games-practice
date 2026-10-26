/**
 * Hand analysis shared by the bots and the coach: made-hand classification,
 * draws, board texture and outs. Pure functions of visible cards.
 */
import { type Card, rankOf, suitOf, RANK_NAMES, RANK_PLURALS, SUIT_NAMES } from '@/shared/cards/card';
import { Cat, categoryOf, describe, evaluate } from '../eval/evaluator';

const popcount = (x: number): number => {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
};

/** True if the rank mask contains a straight. */
function hasStraight(m: number): boolean {
  for (let top = 12; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((m & need) === need) return true;
  }
  return (m & 0b1000000001111) === 0b1000000001111;
}

/** Ranks that would complete a straight that the mask does not already contain. */
export function straightCompleters(m: number): number[] {
  if (hasStraight(m)) return [];
  const out: number[] = [];
  for (let r = 0; r < 13; r++) if (!(m & (1 << r)) && hasStraight(m | (1 << r))) out.push(r);
  return out;
}

const rankMask = (cs: readonly Card[]): number => cs.reduce((m, c) => m | (1 << rankOf(c)), 0);

export interface Draws {
  flushDraw: boolean;
  nutFlushDraw: boolean;
  backdoorFlush: boolean;
  /** Open-ended straight draw (or double gutter): 8 straight outs. */
  oesd: boolean;
  gutshot: boolean;
  /** Ranks completing a straight using at least one hole card. */
  straightRanks: number[];
  flushSuit: number | null;
  /** Overcards to the board (hole cards higher than every board card). */
  overcards: number;
}

export function analyseDraws(hole: readonly Card[], board: readonly Card[]): Draws {
  const all = [...hole, ...board];
  const res: Draws = { flushDraw: false, nutFlushDraw: false, backdoorFlush: false, oesd: false, gutshot: false, straightRanks: [], flushSuit: null, overcards: 0 };
  if (board.length === 0 || board.length >= 5) {
    if (board.length) res.overcards = hole.filter((h) => board.every((b) => rankOf(h) > rankOf(b))).length;
    return res;
  }
  for (let s = 0; s < 4; s++) {
    const n = all.filter((c) => suitOf(c) === s).length;
    const mine = hole.filter((c) => suitOf(c) === s);
    if (n === 4 && mine.length > 0) {
      res.flushDraw = true;
      res.flushSuit = s;
      // Nut flush draw: we hold the highest missing card of the suit.
      const present = new Set(all.filter((c) => suitOf(c) === s).map(rankOf));
      let topMissing = 12;
      while (present.has(topMissing) && topMissing > 0) topMissing--;
      res.nutFlushDraw = mine.some((c) => rankOf(c) > topMissing) || mine.some((c) => rankOf(c) === 12);
    }
    if (n === 3 && mine.length > 0 && board.length === 3) res.backdoorFlush = true;
  }
  const allM = rankMask(all), boardM = rankMask(board);
  const ranks = straightCompleters(allM).filter((r) => !hasStraight(boardM | (1 << r)));
  res.straightRanks = ranks;
  if (ranks.length >= 2) res.oesd = true;
  else if (ranks.length === 1) res.gutshot = true;
  res.overcards = hole.filter((h) => board.every((b) => rankOf(h) > rankOf(b))).length;
  return res;
}

export type MadeClass =
  | 'nothing' | 'overcards' | 'underpair' | 'bottom-pair' | 'middle-pair' | 'top-pair-weak' | 'top-pair-good' | 'top-pair-top'
  | 'overpair' | 'two-pair' | 'set' | 'trips' | 'straight' | 'flush' | 'full-house' | 'quads' | 'straight-flush' | 'board';

export interface Made {
  score: number;
  category: Cat;
  description: string;
  cls: MadeClass;
  /** Hero's best hand is no better than the board alone. */
  playsBoard: boolean;
}

export function madeHand(hole: readonly Card[], board: readonly Card[]): Made {
  const score = evaluate([...hole, ...board]);
  const cat = categoryOf(score);
  const res: Made = { score, category: cat, description: describe(score), cls: 'nothing', playsBoard: false };
  if (board.length >= 5 && evaluate(board) === score) {
    res.playsBoard = true;
    res.cls = 'board';
    return res;
  }
  if (!board.length) {
    res.cls = rankOf(hole[0]) === rankOf(hole[1]) ? 'overpair' : 'nothing';
    return res;
  }
  const br = board.map(rankOf).sort((a, b) => b - a);
  const hr = hole.map(rankOf).sort((a, b) => b - a);
  const boardTop = br[0];
  const boardPaired = new Set(br).size < br.length;
  switch (cat) {
    case Cat.StraightFlush: res.cls = 'straight-flush'; break;
    case Cat.Quads: res.cls = 'quads'; break;
    case Cat.FullHouse: res.cls = 'full-house'; break;
    case Cat.Flush: res.cls = 'flush'; break;
    case Cat.Straight: res.cls = 'straight'; break;
    case Cat.Trips:
      res.cls = hr[0] === hr[1] ? 'set' : 'trips';
      break;
    case Cat.TwoPair: {
      // Two pair that uses both hole cards is strong; one paired with a paired board is basically one pair.
      const pairedWithHole = hr.filter((r) => br.includes(r)).length;
      if (hr[0] === hr[1]) res.cls = hr[0] > boardTop ? 'overpair' : 'underpair';
      else if (pairedWithHole === 2) res.cls = 'two-pair';
      else if (pairedWithHole === 1 && boardPaired) {
        const pr = hr.find((r) => br.includes(r))!;
        res.cls = pr === boardTop ? (Math.max(...hr.filter((r) => r !== pr), -1) >= 10 ? 'top-pair-good' : 'top-pair-weak') : pr === br[br.length - 1] ? 'bottom-pair' : 'middle-pair';
      } else res.cls = 'board';
      break;
    }
    case Cat.Pair: {
      if (hr[0] === hr[1]) {
        res.cls = hr[0] > boardTop ? 'overpair' : 'underpair';
        if (hr[0] < boardTop && hr[0] > br[br.length - 1]) res.cls = 'middle-pair';
      } else if (hr.includes(boardTop)) {
        const kicker = hr[0] === boardTop ? hr[1] : hr[0];
        res.cls = kicker >= 11 ? 'top-pair-top' : kicker >= 8 ? 'top-pair-good' : 'top-pair-weak';
      } else if (hr.some((r) => br.includes(r))) {
        const pr = hr.find((r) => br.includes(r))!;
        res.cls = pr === br[br.length - 1] ? 'bottom-pair' : 'middle-pair';
      } else res.cls = 'board'; // paired board, we hold nothing
      break;
    }
    default:
      res.cls = hr.filter((h) => h > boardTop).length === 2 ? 'overcards' : 'nothing';
  }
  return res;
}

/** Relative strength buckets used by bots: 0 = air … 1 = nuts-ish. */
export const MADE_STRENGTH: Record<MadeClass, number> = {
  nothing: 0, overcards: 0.08, board: 0.05, underpair: 0.25, 'bottom-pair': 0.25, 'middle-pair': 0.35,
  'top-pair-weak': 0.5, 'top-pair-good': 0.58, 'top-pair-top': 0.65, overpair: 0.7, 'two-pair': 0.8, set: 0.9, trips: 0.82,
  straight: 0.88, flush: 0.92, 'full-house': 0.97, quads: 0.99, 'straight-flush': 1,
};

export interface Texture {
  paired: boolean;
  monotone: boolean;
  twoTone: boolean;
  rainbow: boolean;
  /** Max cards of one suit on board. */
  maxSuit: number;
  /** Number of distinct ranks that would make a straight with two hole cards. */
  straighty: boolean;
  highRank: number;
  /** 0 (bone dry) … 1 (soaking wet). */
  wetness: number;
  summary: string;
}

export function boardTexture(board: readonly Card[]): Texture {
  const suits = [0, 0, 0, 0];
  board.forEach((c) => suits[suitOf(c)]++);
  const maxSuit = Math.max(...suits);
  const ranks = board.map(rankOf);
  const paired = new Set(ranks).size < ranks.length;
  const m = rankMask(board);
  // Straight possible: some 5-window contains >= 3 board ranks.
  let straighty = false;
  for (let top = 12; top >= 3; top--) {
    const win = top === 3 ? 0b1000000001111 : 0b11111 << (top - 4);
    if (popcount(m & win) >= 3) straighty = true;
  }
  let connected = 0;
  const sr = [...new Set(ranks)].sort((a, b) => a - b);
  for (let i = 1; i < sr.length; i++) if (sr[i] - sr[i - 1] <= 2) connected++;
  const wetness = Math.min(1, (maxSuit >= 3 ? 0.45 : maxSuit === 2 ? 0.2 : 0) + (straighty ? 0.25 : 0) + connected * 0.1 - (paired ? 0.1 : 0));
  const high = Math.max(...ranks, 0);
  const parts: string[] = [];
  parts.push(wetness < 0.25 ? 'dry' : wetness < 0.55 ? 'semi-wet' : 'wet');
  if (paired) parts.push('paired');
  parts.push(maxSuit >= 3 ? (maxSuit === board.length ? 'monotone' : `${maxSuit}-flush`) : maxSuit === 2 ? 'two-tone' : 'rainbow');
  if (straighty) parts.push('straight possible');
  return {
    paired, monotone: board.length >= 3 && maxSuit === board.length, twoTone: maxSuit === 2, rainbow: maxSuit <= 1, maxSuit, straighty,
    highRank: high, wetness: Math.max(0, wetness), summary: `${RANK_NAMES[high]}-high, ${parts.join(', ')}`,
  };
}

export type OutKind = 'clean' | 'dirty' | 'counterfeit';

export interface Out {
  card: Card;
  /** Hand after this card. */
  description: string;
  kind: OutKind;
  /** Why it is dirty/counterfeit. */
  note?: string;
}

/**
 * Cards that improve hero to a better hand category using hero's own cards.
 *  - counterfeit: the card improves the board as much as us, so our hand no
 *    longer beats a hand that plays the board (we "play the board"), or it
 *    devalues the pair/two pair we hold;
 *  - dirty: we improve, but the card also completes something better for a
 *    meaningful share of the opponent's likely range (`beatenShare` > 25%).
 * `beatenShare(card)` is supplied by the caller (range-aware for the coach).
 */
export function findOuts(hole: readonly Card[], board: readonly Card[], beatenShare?: (card: Card, newScore: number) => number): Out[] {
  if (board.length < 3 || board.length >= 5) return [];
  const known = new Set([...hole, ...board]);
  const cur = evaluate([...hole, ...board]);
  const curCat = categoryOf(cur);
  const out: Out[] = [];
  for (let c = 0; c < 52; c++) {
    if (known.has(c)) continue;
    const nb = [...board, c];
    const s = evaluate([...hole, ...nb]);
    const cat = categoryOf(s);
    if (cat <= curCat) continue;
    // Must improve our category beyond what the board itself now shows.
    const boardScore = evaluate(nb);
    if (categoryOf(boardScore) >= cat) {
      out.push({ card: c, description: describe(s), kind: 'counterfeit', note: 'the board improves just as much: you would be playing the board' });
      continue;
    }
    // Pair-to-two-pair outs where the board pairs (e.g. our kicker pairs on a paired board) are weak.
    if (cat === Cat.TwoPair && categoryOf(boardScore) === Cat.Pair && curCat === Cat.Pair) {
      const pairsWithBoard = hole.some((h) => rankOf(h) === rankOf(c));
      if (!pairsWithBoard) {
        out.push({ card: c, description: describe(s), kind: 'counterfeit', note: 'the board pairs: your second pair is shared with everyone' });
        continue;
      }
    }
    const share = beatenShare?.(c, s) ?? 0;
    if (share > 0.25) out.push({ card: c, description: describe(s), kind: 'dirty', note: `still behind ${Math.round(share * 100)}% of their likely hands after this card` });
    else out.push({ card: c, description: describe(s), kind: 'clean' });
  }
  return out;
}

export function drawSummary(d: Draws): string {
  const parts: string[] = [];
  if (d.flushDraw) parts.push(`${d.nutFlushDraw ? 'nut ' : ''}flush draw (${SUIT_NAMES[d.flushSuit!]})`);
  if (d.oesd) parts.push(d.straightRanks.length > 2 ? 'wrap straight draw' : 'open-ended straight draw');
  else if (d.gutshot) parts.push(`gutshot (needs a ${RANK_NAMES[d.straightRanks[0]]})`);
  if (d.backdoorFlush) parts.push('backdoor flush draw');
  if (d.overcards === 2) parts.push('two overcards');
  return parts.join(', ');
}

export { RANK_PLURALS };
