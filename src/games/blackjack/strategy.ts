/**
 * Basic strategy computed from the rules, not copied from a table.
 *
 * For each cell (player total or pair × dealer upcard) we evaluate every
 * two-card composition that makes that total, using the full shoe minus those
 * cards and the upcard, with the dealer distribution fixed per composition
 * ("total-dependent" basic strategy). The EV of each action is averaged over
 * compositions weighted by their probability, and the best action wins.
 * Codes follow the usual charts: Dh = double else hit, Ds = double else
 * stand, Rh/Rs/Rp = surrender else hit/stand/split.
 */
import { type BJRules, canDoubleTotal, valueOf } from './rules';
import { computeEVs, shoeCounts, without, type EVs } from './ev';

export type Cell = 'H' | 'S' | 'Dh' | 'Ds' | 'P' | 'Rh' | 'Rs' | 'Rp';
export type Move = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

/** Dealer upcards in chart column order. */
export const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1] as const;

export interface Chart {
  hard: Record<number, Cell[]>;
  soft: Record<number, Cell[]>;
  pairs: Record<number, Cell[]>;
  /** EVs behind each cell, for explanations: [row key][upIndex] → action → ev. */
  evs: Record<string, Record<string, number>[]>;
}

/** Best total of card values (1 = ace). */
export function totalOf(values: readonly number[]): number {
  const s = values.reduce((x, y) => x + y, 0);
  return values.includes(1) && s + 10 <= 21 ? s + 10 : s;
}

const pick = (cands: [Move, number][]): Move => cands.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

function cellFrom(evs: Record<Move, number | null>): Cell {
  const all = (Object.entries(evs) as [Move, number | null][]).filter((e): e is [Move, number] => e[1] !== null);
  const best = pick(all);
  const hs = pick([['hit', evs.hit!], ['stand', evs.stand!]]);
  if (best === 'double') return hs === 'hit' ? 'Dh' : 'Ds';
  if (best === 'surrender') {
    if (evs.split !== null && evs.split >= Math.max(evs.hit!, evs.stand!, evs.double ?? -9)) return 'Rp';
    return hs === 'hit' ? 'Rh' : 'Rs';
  }
  if (best === 'split') return 'P';
  return best === 'hit' ? 'H' : 'S';
}

function averaged(rules: BJRules, comps: [number, number][], up: number, allowSplit: boolean): Record<Move, number | null> {
  const shoe = without(shoeCounts(rules.decks), [up]);
  const acc: Record<Move, number> = { hit: 0, stand: 0, double: 0, split: 0, surrender: 0 };
  let wsum = 0;
  let canD = false;
  for (const [a, b] of comps) {
    const w = a === b ? (shoe[a] * (shoe[a] - 1)) / 2 : shoe[a] * shoe[b];
    if (w <= 0) continue;
    const n = without(shoe, [a, b]);
    const t = totalOf([a, b]);
    canD = canDoubleTotal(rules, t);
    const e: EVs = computeEVs([a, b], up, n, rules, { double: canD, split: allowSplit, surrender: rules.surrender }, 'fixed');
    acc.hit += w * e.hit;
    acc.stand += w * e.stand;
    if (e.double !== null) acc.double += w * e.double;
    if (e.split !== null) acc.split += w * e.split;
    wsum += w;
  }
  return {
    hit: acc.hit / wsum,
    stand: acc.stand / wsum,
    double: canD ? acc.double / wsum : null,
    split: allowSplit ? acc.split / wsum : null,
    surrender: rules.surrender ? -0.5 : null,
  };
}

const cache = new Map<string, Chart>();

export function computeChart(rules: BJRules): Chart {
  const key = JSON.stringify({ ...rules, penetration: 0 });
  const hit = cache.get(key);
  if (hit) return hit;
  const chart: Chart = { hard: {}, soft: {}, pairs: {}, evs: {} };
  const record = (row: string, i: number, e: Record<Move, number | null>): void => {
    chart.evs[row] ??= [];
    chart.evs[row][i] = Object.fromEntries(Object.entries(e).filter(([, v]) => v !== null)) as Record<string, number>;
  };
  for (let T = 4; T <= 21; T++) {
    const comps: [number, number][] = [];
    for (let a = 2; a <= 10; a++) for (let b = a + 1; b <= 10; b++) if (a + b === T) comps.push([a, b]);
    chart.hard[T] = UPS.map((up, i) => {
      if (T >= 20) return 'S';
      if (!comps.length) return 'H'; // hard 4 is only 2-2 (a pair)
      const e = averaged(rules, comps, up, false);
      record(`h${T}`, i, e);
      return cellFrom(e);
    });
  }
  for (let x = 2; x <= 9; x++) {
    chart.soft[11 + x] = UPS.map((up, i) => {
      const e = averaged(rules, [[1, x]], up, false);
      record(`s${11 + x}`, i, e);
      return cellFrom(e);
    });
  }
  chart.soft[21] = UPS.map(() => 'S');
  for (let c = 1; c <= 10; c++) {
    chart.pairs[c] = UPS.map((up, i) => {
      const e = averaged(rules, [[c, c]], up, true);
      record(`p${c}`, i, e);
      return cellFrom(e);
    });
  }
  cache.set(key, chart);
  return chart;
}

export interface Situation {
  /** Card values (1 = ace … 10). */
  values: number[];
  up: number;
  canDouble: boolean;
  canSplit: boolean;
  canSurrender: boolean;
}

/** The chart cell and resulting move for a live situation. */
export function chartMove(chart: Chart, s: Situation): { cell: Cell; move: Move; row: string } {
  const col = UPS.indexOf(s.up as (typeof UPS)[number]);
  const isPair = s.values.length === 2 && s.values[0] === s.values[1];
  if (isPair && s.canSplit) {
    const cell = chart.pairs[s.values[0]][col];
    if (cell === 'P') return { cell, move: 'split', row: `p${s.values[0]}` };
    if (cell === 'Rp') return { cell, move: s.canSurrender ? 'surrender' : 'split', row: `p${s.values[0]}` };
  }
  const sum = s.values.reduce((a, b) => a + b, 0);
  const soft = s.values.includes(1) && sum + 10 <= 21;
  const t = soft ? sum + 10 : sum;
  const row = soft ? `s${t}` : `h${Math.max(4, t)}`;
  const cell = soft ? chart.soft[t][col] : chart.hard[Math.min(21, Math.max(4, t))][col];
  const move: Move =
    cell === 'H' ? 'hit'
    : cell === 'S' ? 'stand'
    : cell === 'Dh' ? (s.canDouble ? 'double' : 'hit')
    : cell === 'Ds' ? (s.canDouble ? 'double' : 'stand')
    : cell === 'Rh' ? (s.canSurrender ? 'surrender' : 'hit')
    : cell === 'Rs' ? (s.canSurrender ? 'surrender' : 'stand')
    : cell === 'Rp' ? (s.canSurrender ? 'surrender' : 'split')
    : 'split';
  // A pair the chart says not to split falls back to its total row.
  return { cell, move, row };
}

export const MOVE_LABEL: Record<Move, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' };

export { valueOf };
