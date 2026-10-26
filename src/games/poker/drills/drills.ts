/**
 * Poker drills. Every answer is computed exactly from the cards with the
 * app's evaluator and combinatorics, never looked up from a table.
 */
import { FULL_DECK, RANK_NAMES, RANK_PLURALS, rankOf, suitOf, type Card } from '@/shared/cards/card';
import type { Rng } from '@/shared/random/prng';
import { Cat, categoryOf, describe, evaluate } from '../eval/evaluator';
import { multiEquity } from '../equity/multi';
import { classFromName, className, classRanks, combosInClass, isPairClass, isSuitedClass, liveCombos } from '../ranges/combos';
import { RANK_PCT, rfiPercent, type Position } from '../ranges/preflop';

export type DrillId = 'outs' | 'pot-odds' | 'showdown' | 'equity' | 'open' | 'combos';

export const DRILLS: { id: DrillId; title: string; blurb: string }[] = [
  { id: 'outs', title: 'Count your outs', blurb: 'How many cards complete your straight or flush?' },
  { id: 'pot-odds', title: 'Call or fold', blurb: 'Compare the price of a call with your chance to hit.' },
  { id: 'showdown', title: 'Which hand wins', blurb: 'Read the best five-card hand for each player.' },
  { id: 'equity', title: 'Estimate equity', blurb: 'Hand against hand, preflop or on the flop.' },
  { id: 'open', title: 'Open or fold', blurb: '6-max raise-first-in ranges by position.' },
  { id: 'combos', title: 'Count combos', blurb: 'Hand combinations after removing the cards you can see.' },
];

export type DrillAnswer =
  | { kind: 'int'; value: number }
  | { kind: 'choice'; options: string[]; accepted: number[] }
  | { kind: 'pct'; value: number; tol: number };

export interface DrillQ {
  drill: DrillId;
  prompt: string;
  hero?: Card[];
  board?: Card[];
  others?: { label: string; cards: Card[] }[];
  answer: DrillAnswer;
  explain: string[];
}

const deal = (r: Rng, n: number, dead: Card[] = []): Card[] => r.sample(FULL_DECK.filter((c) => !dead.includes(c)), n);
const C2 = (n: number): number => (n * (n - 1)) / 2;
const pct = (x: number, d = 1): string => `${(x * 100).toFixed(d)}%`;

// ------------------------------------------------------------------ outs

export function outsQ(r: Rng): DrillQ {
  for (;;) {
    const street = r.chance(0.6) ? 3 : 4;
    const cards = deal(r, 2 + street);
    const hero = cards.slice(0, 2), board = cards.slice(2);
    const now = categoryOf(evaluate([...hero, ...board]));
    if (now >= Cat.Straight) continue;
    const unseen = FULL_DECK.filter((c) => !cards.includes(c));
    const outs = unseen.filter((c) => categoryOf(evaluate([...hero, ...board, c])) >= Cat.Straight);
    // Only keep genuine draws that involve the hero's cards (not a straight on the board alone).
    const real = outs.filter((c) => categoryOf(evaluate([...board, c])) < Cat.Straight || board.length + 1 < 5);
    if (real.length < 4 || real.length !== outs.length) continue;
    const flushOuts = outs.filter((c) => categoryOf(evaluate([...hero, ...board, c])) === Cat.Flush || categoryOf(evaluate([...hero, ...board, c])) === Cat.StraightFlush).length;
    const left = street === 3 ? 2 : 1;
    const approx = outs.length * (left === 2 ? 4 : 2);
    const exact = left === 2 ? 1 - C2(unseen.length - outs.length) / C2(unseen.length) : outs.length / unseen.length;
    return {
      drill: 'outs',
      prompt: `How many outs do you have to make a straight or better (flush included) on the next card?`,
      hero,
      board,
      answer: { kind: 'int', value: outs.length },
      explain: [
        `${outs.length} outs: ${flushOuts ? `${flushOuts} complete a flush` : 'no flush outs'}${outs.length - flushOuts ? `, ${outs.length - flushOuts} more complete a straight` : ''} (cards that do both are counted once).`,
        `Rule of ${left === 2 ? 4 : 2}: about ${approx}% to hit by the river${left === 2 ? ' with two cards to come' : ''}; exactly ${pct(exact)}.`,
      ],
    };
  }
}

// ------------------------------------------------------------------ pot odds

export function potOddsQ(r: Rng): DrillQ {
  const pot = r.pick([30, 40, 60, 80, 100, 120, 150, 200]);
  const frac = r.pick([1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 1.5]);
  const bet = Math.round(pot * frac);
  const outs = r.pick([4, 6, 8, 9, 12, 15]);
  const flop = r.chance(0.5);
  const need = bet / (pot + 2 * bet);
  const eq = flop ? 1 - C2(47 - outs) / C2(47) : outs / 46;
  const call = eq >= need;
  const close = Math.abs(eq - need) < 0.01;
  return {
    drill: 'pot-odds',
    prompt: `The pot is ${pot}. Your opponent bets ${bet}${flop ? ' and is all in' : ''}. You have ${outs} clean outs on the ${flop ? 'flop, with two cards to come' : 'turn, with one card to come'}, and you lose if you miss. Call or fold?`,
    answer: { kind: 'choice', options: ['Call', 'Fold'], accepted: close ? [0, 1] : [call ? 0 : 1] },
    explain: [
      `Price: you call ${bet} to win ${pot + bet}, so you need ${bet}/(${pot} + 2×${bet}) = ${pct(need)} equity.`,
      `Chance to hit: ${flop ? `1 − C(${47 - outs},2)/C(47,2)` : `${outs}/46`} = ${pct(eq)} (rule of ${flop ? 4 : 2}: about ${outs * (flop ? 4 : 2)}%).`,
      close ? 'Too close to call either way without implied odds; both answers accepted.' : call ? 'Equity beats the price: call.' : 'Not enough equity for the price: fold (unless implied odds are large).',
    ],
  };
}

// ------------------------------------------------------------------ showdown

const NAMES = ['Ana', 'Ben', 'Chen'];

export function showdownQ(r: Rng): DrillQ {
  for (;;) {
    const n = r.chance(0.6) ? 2 : 3;
    const cards = deal(r, 5 + 2 * n);
    const board = cards.slice(0, 5);
    const hands = Array.from({ length: n }, (_, i) => cards.slice(5 + 2 * i, 7 + 2 * i));
    const scores = hands.map((h) => evaluate([...h, ...board]));
    const best = Math.max(...scores);
    const winners = scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
    // Prefer non-trivial spots: same category for at least two players, or a split.
    const cats = scores.map(categoryOf);
    if (new Set(cats).size === n && r.chance(0.7)) continue;
    const options = [...NAMES.slice(0, n), 'Split pot'];
    const accepted = winners.length > 1 ? [n] : [winners[0]];
    return {
      drill: 'showdown',
      prompt: 'Who wins at showdown?',
      board,
      others: hands.map((h, i) => ({ label: NAMES[i], cards: h })),
      answer: { kind: 'choice', options, accepted },
      explain: hands.map((_, i) => `${NAMES[i]}: ${describe(scores[i])}${scores[i] === best ? (winners.length > 1 ? ' (shares the pot)' : ' (wins)') : ''}.`),
    };
  }
}

// ------------------------------------------------------------------ equity

const MATCHUPS: [string, string, string][] = [
  ['pair vs two overcards', 'pair', 'overs'],
  ['overpair vs underpair', 'pair', 'pair'],
  ['dominated ace', 'AK', 'AX'],
  ['pair vs suited connectors', 'pair', 'sc'],
  ['two overs vs one over', 'overs', 'mixed'],
];

function pickPreflop(r: Rng): [Card[], Card[], string] {
  const [label, a, b] = r.pick(MATCHUPS);
  for (;;) {
    const cards = deal(r, 4);
    const h = cards.slice(0, 2), v = cards.slice(2);
    const [h1, h2] = h.map(rankOf).sort((x, y) => y - x), [v1, v2] = v.map(rankOf).sort((x, y) => y - x);
    const pair = (x: number, y: number) => x === y;
    let ok = false;
    if (a === 'pair' && b === 'overs') ok = pair(h1, h2) && v2 > h1;
    else if (a === 'pair' && b === 'pair') ok = pair(h1, h2) && pair(v1, v2) && h1 > v1;
    else if (a === 'AK') ok = h1 === 12 && v1 === 12 && h2 > v2 && v2 < 11;
    else if (a === 'pair' && b === 'sc') ok = pair(h1, h2) && v1 - v2 === 1 && suitOf(v[0]) === suitOf(v[1]) && v1 < h1 && v1 < 10;
    else ok = !pair(h1, h2) && !pair(v1, v2) && h2 > v1 && v2 < h2;
    if (ok) return [h, v, label];
  }
}

export function equityQ(r: Rng): DrillQ {
  const flop = r.chance(0.45);
  let hero: Card[], villain: Card[], board: Card[] = [], label = 'flop spot';
  if (flop) {
    const cards = deal(r, 7);
    hero = cards.slice(0, 2);
    villain = cards.slice(2, 4);
    board = cards.slice(4);
  } else [hero, villain, label] = pickPreflop(r);
  const res = multiEquity([{ kind: 'hand', cards: hero }, { kind: 'hand', cards: villain }], board, [], 30000, r.int(1e9));
  const e = res.players[0].equity;
  return {
    drill: 'equity',
    prompt: `Estimate your all-in equity against this hand${flop ? ' on the flop' : ' preflop'} (within 5 percentage points).`,
    hero,
    board,
    others: [{ label: 'Villain', cards: villain }],
    answer: { kind: 'pct', value: e, tol: 0.05 },
    explain: [
      `${res.exact ? 'Exact' : 'Simulated'} equity: ${pct(e)} (ties counted as half).`,
      flop ? 'On the flop: count outs for the trailing hand and use the rule of 4.' : `Benchmarks (${label}): pair vs two overcards ≈ 55/45; overpair vs underpair ≈ 80/20; dominated kicker ≈ 70/30; two overcards vs one ≈ 60–70%.`,
    ],
  };
}

// ------------------------------------------------------------------ open

const POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];

export function openQ(r: Rng): DrillQ {
  const pos = r.pick(POSITIONS);
  const cut = rfiPercent(pos, 6);
  // Mostly hands near the boundary, where the decision is interesting.
  let cls: number;
  for (;;) {
    cls = r.int(169);
    const d = RANK_PCT[cls] - cut;
    if (Math.abs(d) < 0.12 || r.chance(0.15)) break;
  }
  const inRange = RANK_PCT[cls] - combosInClass(cls) / 1326 / 2 <= cut;
  const close = Math.abs(RANK_PCT[cls] - cut) < 0.015;
  const hand = className(cls);
  return {
    drill: 'open',
    prompt: `6-max, 100 big blinds. Everyone folds to you on the ${pos === 'BTN' ? 'button' : pos === 'SB' ? 'small blind' : pos}. You hold ${hand}. Open-raise or fold?`,
    answer: { kind: 'choice', options: ['Raise', 'Fold'], accepted: close ? [0, 1] : [inRange ? 0 : 1] },
    explain: [`From the ${pos} a solid range opens about ${Math.round(cut * 100)}% of hands. ${hand} sits at the top ${Math.round(RANK_PCT[cls] * 100)}% of hands in this app's ordering, so it is ${close ? 'right on the edge (either is fine)' : inRange ? 'an open' : 'a fold'}.`, 'Later positions open wider because fewer players are left to act behind you, and you will have position after the flop.'],
  };
}

// ------------------------------------------------------------------ combos

export function combosQ(r: Rng): DrillQ {
  for (;;) {
    const visible = deal(r, r.pick([3, 4, 5]));
    const hero = visible.slice(0, 2), board = visible.slice(2);
    // A class that shares a rank with a visible card, so blockers matter.
    const rk = rankOf(r.pick(visible));
    const other = r.range(0, 12);
    const suited = r.chance(0.35);
    const name = rk === other ? `${'23456789TJQKA'[rk]}${'23456789TJQKA'[rk]}` : `${'23456789TJQKA'[Math.max(rk, other)]}${'23456789TJQKA'[Math.min(rk, other)]}${suited ? 's' : 'o'}`;
    const cls = classFromName(name);
    const live = liveCombos(cls, visible);
    const total = combosInClass(cls);
    const [a, b] = classRanks(cls);
    const seenA = visible.filter((c) => rankOf(c) === a).length, seenB = visible.filter((c) => rankOf(c) === b).length;
    let how: string;
    if (isPairClass(cls)) how = `${RANK_PLURALS[a]}: ${4 - seenA} left, so C(${4 - seenA},2) = ${C2(4 - seenA)}.`;
    else if (isSuitedClass(cls)) how = `Suited: one combo per suit where both the ${RANK_NAMES[a].toLowerCase()} and the ${RANK_NAMES[b].toLowerCase()} are still unseen.`;
    else how = `Offsuit: (${RANK_NAMES[a].toLowerCase()}s left) × (${RANK_NAMES[b].toLowerCase()}s left) = ${4 - seenA} × ${4 - seenB} = ${(4 - seenA) * (4 - seenB)}, minus the same-suit pairs still possible.`;
    return {
      drill: 'combos',
      prompt: `Given your hand and the board, how many combinations of ${name} can your opponent hold?`,
      hero,
      board,
      answer: { kind: 'int', value: live },
      explain: [`${name} has ${total} combinations in a full deck (pairs 6, suited 4, offsuit 12).`, how, `Answer: ${live}.`],
    };
  }
}

export const MAKERS: Record<DrillId, (r: Rng) => DrillQ> = { outs: outsQ, 'pot-odds': potOddsQ, showdown: showdownQ, equity: equityQ, open: openQ, combos: combosQ };

export function checkDrill(a: DrillAnswer, input: string | number): boolean {
  if (a.kind === 'choice') return a.accepted.includes(Number(input));
  const s = String(input).trim().replace('%', '');
  const x = Number(s);
  if (!s || !Number.isFinite(x)) return false;
  if (a.kind === 'int') return x === a.value;
  const v = x > 1 ? x / 100 : x; // accept "62" or "0.62"
  return Math.abs(v - a.value) <= a.tol + 1e-9;
}
