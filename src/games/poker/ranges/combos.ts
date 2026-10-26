/**
 * Hole-card combinatorics.
 *  - 1326 combos (unordered pairs of distinct cards), indexed 0..1325.
 *  - 169 hand classes laid out as the standard 13×13 grid: row/col 0 = Ace.
 *    Pairs on the diagonal, suited hands above it (row < col), offsuit below.
 *    Class index = row * 13 + col.
 * Combos per class: pairs 6, suited 4, offsuit 12.
 */
import { type Card, RANK_CHARS } from '@/shared/cards/card';

export const NUM_COMBOS = 1326;
export const COMBO_A = new Uint8Array(NUM_COMBOS);
export const COMBO_B = new Uint8Array(NUM_COMBOS);
const COMBO_INDEX = new Int16Array(52 * 52).fill(-1);
export const COMBO_CLASS = new Uint8Array(NUM_COMBOS);
/** Combo indices belonging to each of the 169 classes. */
export const CLASS_COMBOS: number[][] = Array.from({ length: 169 }, () => []);

/** Grid cell for two cards. Rank r (0 = deuce) maps to row/col 12 − r. */
export function classOf(a: Card, b: Card): number {
  const ra = a >> 2, rb = b >> 2;
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  const suited = (a & 3) === (b & 3);
  if (hi === lo) return (12 - hi) * 14;
  return suited ? (12 - hi) * 13 + (12 - lo) : (12 - lo) * 13 + (12 - hi);
}

{
  let k = 0;
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++) {
      COMBO_A[k] = a;
      COMBO_B[k] = b;
      COMBO_INDEX[a * 52 + b] = k;
      COMBO_INDEX[b * 52 + a] = k;
      const cls = classOf(a, b);
      COMBO_CLASS[k] = cls;
      CLASS_COMBOS[cls].push(k);
      k++;
    }
}

export const comboIndex = (a: Card, b: Card): number => COMBO_INDEX[a * 52 + b];

export const classRow = (cls: number): number => Math.floor(cls / 13);
export const classCol = (cls: number): number => cls % 13;
export const isPairClass = (cls: number): boolean => classRow(cls) === classCol(cls);
export const isSuitedClass = (cls: number): boolean => classRow(cls) < classCol(cls);
export const combosInClass = (cls: number): number => (isPairClass(cls) ? 6 : isSuitedClass(cls) ? 4 : 12);

/** "AKs", "T9o", "77". */
export function className(cls: number): string {
  const r = classRow(cls), c = classCol(cls);
  const hi = RANK_CHARS[12 - Math.min(r, c)], lo = RANK_CHARS[12 - Math.max(r, c)];
  if (r === c) return hi + hi;
  return hi + lo + (r < c ? 's' : 'o');
}

export function classFromName(name: string): number {
  const m = name.trim().match(/^([2-9TJQKA])([2-9TJQKA])([so]?)$/i);
  if (!m) throw new Error(`bad hand class "${name}"`);
  const a = RANK_CHARS.indexOf(m[1].toUpperCase()), b = RANK_CHARS.indexOf(m[2].toUpperCase());
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (hi === lo) return (12 - hi) * 14;
  const suited = m[3].toLowerCase() === 's';
  if (!m[3]) throw new Error(`"${name}" needs s or o`);
  return suited ? (12 - hi) * 13 + (12 - lo) : (12 - lo) * 13 + (12 - hi);
}

/** Highest and lowest rank (0 = deuce) of a class. */
export function classRanks(cls: number): [number, number] {
  const r = classRow(cls), c = classCol(cls);
  return [12 - Math.min(r, c), 12 - Math.max(r, c)];
}

/**
 * A range is a weight in [0,1] per class. Parses standard notation:
 *   "QQ+", "77-55", "AKs", "AKo", "AK" (both), "A2s+", "KTo+", "T9s-T6s",
 *   "J9s+", optional weights "AJo:0.5", "random"/"any".
 */
export function parseRange(text: string): Float64Array {
  const w = new Float64Array(169);
  const set = (cls: number, v: number): void => void (w[cls] = Math.max(w[cls], v));
  for (const raw of text.split(/[,\s]+/).filter(Boolean)) {
    const [tok, wt] = raw.split(':');
    const v = wt === undefined ? 1 : Number(wt);
    const up = tok.toUpperCase();
    if (up === 'RANDOM' || up === 'ANY') {
      w.fill(Math.max(v, 0));
      continue;
    }
    const t = up.replace(/S/g, 's').replace(/O/g, 'o');
    const R = (ch: string): number => RANK_CHARS.indexOf(ch);
    let m = t.match(/^([2-9TJQKA])\1(\+)?$/);
    if (m) {
      const r = R(m[1]);
      for (let x = r; x <= (m[2] ? 12 : r); x++) set((12 - x) * 14, v);
      continue;
    }
    m = t.match(/^([2-9TJQKA])\1-([2-9TJQKA])\2$/);
    if (m) {
      const a = R(m[1]), b = R(m[2]);
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) set((12 - x) * 14, v);
      continue;
    }
    m = t.match(/^([2-9TJQKA])([2-9TJQKA])([so]?)(\+)?$/);
    if (m) {
      const hi = R(m[1]), lo = R(m[2]);
      const kinds = m[3] ? [m[3]] : ['s', 'o'];
      const top = m[4] ? hi - 1 : lo;
      for (const k of kinds) for (let x = lo; x <= top; x++) set(classFromName(RANK_CHARS[hi] + RANK_CHARS[x] + k), v);
      continue;
    }
    m = t.match(/^([2-9TJQKA])([2-9TJQKA])([so])-([2-9TJQKA])([2-9TJQKA])\3$/);
    if (m && m[1] === m[4]) {
      const hi = R(m[1]), a = R(m[2]), b = R(m[5]);
      for (let x = Math.min(a, b); x <= Math.max(a, b); x++) set(classFromName(RANK_CHARS[hi] + RANK_CHARS[x] + m[3]), v);
      continue;
    }
    throw new Error(`can't parse range token "${raw}"`);
  }
  return w;
}

/** Fraction of all 1326 combos covered by a class-weight range. */
export function rangePercent(w: ArrayLike<number>): number {
  let s = 0;
  for (let c = 0; c < 169; c++) s += w[c] * combosInClass(c);
  return s / NUM_COMBOS;
}

/** Number of live combos of a class given dead cards. */
export function liveCombos(cls: number, dead: readonly Card[]): number {
  if (!dead.length) return combosInClass(cls);
  return CLASS_COMBOS[cls].filter((k) => !dead.includes(COMBO_A[k]) && !dead.includes(COMBO_B[k])).length;
}

/** Expand class weights to 1326 combo weights, zeroing combos that use dead cards. */
export function toComboWeights(classW: ArrayLike<number>, dead: readonly Card[] = []): Float64Array {
  const out = new Float64Array(NUM_COMBOS);
  const deadMask = new Uint8Array(52);
  for (const d of dead) deadMask[d] = 1;
  for (let k = 0; k < NUM_COMBOS; k++) {
    if (deadMask[COMBO_A[k]] || deadMask[COMBO_B[k]]) continue;
    out[k] = classW[COMBO_CLASS[k]];
  }
  return out;
}

/** Compact range text from class weights (weights >= 0.5 included). */
export function formatRange(w: ArrayLike<number>): string {
  const parts: string[] = [];
  // pairs
  let run: number[] = [];
  const flushPairs = (): void => {
    if (!run.length) return;
    const hi = RANK_CHARS[run[0]], lo = RANK_CHARS[run[run.length - 1]];
    parts.push(run[0] === 12 && run.length > 1 ? `${lo}${lo}+` : run.length === 1 ? hi + hi : `${hi}${hi}-${lo}${lo}`);
    run = [];
  };
  for (let r = 12; r >= 0; r--) {
    if (w[(12 - r) * 14] >= 0.5) run.push(r);
    else flushPairs();
  }
  flushPairs();
  for (const kind of ['s', 'o'] as const)
    for (let hi = 12; hi >= 1; hi--) {
      let seg: number[] = [];
      const flush = (): void => {
        if (!seg.length) return;
        const top = seg[0], bot = seg[seg.length - 1];
        const H = RANK_CHARS[hi];
        if (top === hi - 1 && seg.length > 1) parts.push(`${H}${RANK_CHARS[bot]}${kind}+`);
        else if (seg.length === 1) parts.push(`${H}${RANK_CHARS[top]}${kind}`);
        else parts.push(`${H}${RANK_CHARS[top]}${kind}-${H}${RANK_CHARS[bot]}${kind}`);
        seg = [];
      };
      for (let lo = hi - 1; lo >= 0; lo--) {
        const cls = classFromName(RANK_CHARS[hi] + RANK_CHARS[lo] + kind);
        if (w[cls] >= 0.5) seg.push(lo);
        else flush();
      }
      flush();
    }
  return parts.join(', ');
}
