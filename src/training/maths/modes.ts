/** Practice modes and adaptive skill selection for mental maths. */
import { Rng } from '@/shared/random/prng';
import { load, save } from '@/shared/storage/store';
import { rankSkills } from '@/shared/srs/srs';
import { generate, type Question, type SkillId, targetMs, fmtNum } from './generators';

export type ModeId = 'zetamac' | 'eighty' | 'fractions' | 'estimation' | 'trading' | 'adaptive' | 'trick';

export interface ModeDef {
  id: ModeId;
  title: string;
  blurb: string;
  durationSec: number;
  /** Fixed question count (80-in-8); otherwise unlimited within the time. */
  count?: number;
  negativeMarking: boolean;
  skills: SkillId[];
}

export const MODES: ModeDef[] = [
  { id: 'zetamac', title: 'Speed arithmetic', blurb: 'Zetamac-style: + − × ÷ with your ranges, as many as you can.', durationSec: 120, negativeMarking: false, skills: ['add', 'sub', 'mul', 'div'] },
  { id: 'eighty', title: '80 in 8', blurb: '80 mixed questions in 8 minutes: decimals, fractions, percentages. Wrong answers cost a point.', durationSec: 480, count: 80, negativeMarking: true, skills: ['add', 'sub', 'mul', 'div', 'dec-add', 'dec-mul', 'frac-add', 'frac-mul', 'pct-of', 'frac-dec'] },
  { id: 'fractions', title: 'Percentages & fractions', blurb: 'Fraction ↔ decimal, percentage changes, compounding.', durationSec: 180, negativeMarking: false, skills: ['frac-dec', 'pct-of', 'pct-change', 'compound', 'frac-add', 'frac-mul', 'pct-swap'] },
  { id: 'estimation', title: 'Estimation', blurb: 'Answer within a tolerance (e.g. 47.3 × 21.8 within 5%). Press Enter to submit.', durationSec: 180, negativeMarking: false, skills: ['est-mul', 'est-div', 'est-sqrt', 'est-pct'] },
  { id: 'trading', title: 'Trading maths', blurb: 'Expected value, odds and probability, break-evens, P&L, average prices, basis points.', durationSec: 240, negativeMarking: false, skills: ['ev-bet', 'odds-prob', 'breakeven', 'pnl', 'avg-price', 'bps', 'pct-change'] },
  { id: 'adaptive', title: 'Adaptive mix', blurb: 'Targets the question types you are slowest or least accurate at, at the right level.', durationSec: 300, negativeMarking: false, skills: ['add', 'sub', 'mul', 'div', 'dec-mul', 'frac-dec', 'pct-of', 'pct-change', 'frac-add', 'est-mul', 'ev-bet', 'breakeven', 'pnl', 'sq-50', 'diff-sq', 'mul-25'] },
];

export interface ZetamacConfig {
  ops: { add: boolean; sub: boolean; mul: boolean; div: boolean };
  addA: [number, number];
  addB: [number, number];
  mulA: [number, number];
  mulB: [number, number];
  durationSec: number;
}

export const DEFAULT_ZETAMAC: ZetamacConfig = { ops: { add: true, sub: true, mul: true, div: true }, addA: [2, 100], addB: [2, 100], mulA: [2, 12], mulB: [2, 100], durationSec: 120 };

/** Zetamac's question model: subtraction and division are inverses of + and ×. */
export function zetamacQuestion(c: ZetamacConfig, r: Rng): Question {
  const ops = (Object.keys(c.ops) as (keyof ZetamacConfig['ops'])[]).filter((k) => c.ops[k]);
  const op = r.pick(ops.length ? ops : ['add']);
  const pickR = ([lo, hi]: [number, number]): number => r.range(Math.min(lo, hi), Math.max(lo, hi));
  if (op === 'add' || op === 'sub') {
    const a = pickR(c.addA), b = pickR(c.addB);
    return op === 'add' ? q('add', `${a} + ${b}`, a + b) : q('sub', `${a + b} − ${a}`, b);
  }
  const a = pickR(c.mulA), b = pickR(c.mulB);
  return op === 'mul' ? q('mul', `${a} × ${b}`, a * b) : q('div', `${a * b} ÷ ${a}`, b);
}

const q = (skill: SkillId, prompt: string, answer: number): Question => ({ skill, prompt, answer, answerText: fmtNum(answer), tol: { abs: 1e-9 }, autoSubmit: true });

// ---------------------------------------------------------------- adaptive levels

export interface LevelState {
  level: number;
  streak: number;
}

const LEVELS_KEY = 'maths.levels';
export const getLevels = (): Record<string, LevelState> => load(LEVELS_KEY, {});
export const levelOf = (s: SkillId): number => getLevels()[s]?.level ?? 2;

/**
 * Level rule: three correct answers inside the target time raise the level;
 * a wrong answer, or one slower than twice the target, lowers it.
 */
export function updateLevel(s: SkillId, correct: boolean, ms: number): LevelState {
  const all = getLevels();
  const cur = all[s] ?? { level: 2, streak: 0 };
  const t = targetMs(s, cur.level);
  let next: LevelState;
  if (!correct || ms > 2 * t) next = { level: Math.max(1, cur.level - (correct ? 0 : 1) - (ms > 2 * t ? 1 : 0)), streak: 0 };
  else if (ms <= t) next = cur.streak + 1 >= 3 ? { level: Math.min(5, cur.level + 1), streak: 0 } : { level: cur.level, streak: cur.streak + 1 };
  else next = { level: cur.level, streak: 0 };
  save(LEVELS_KEY, { ...all, [s]: next });
  return next;
}

/** Next skill for a mode: SRS priority-weighted, never the same type three times running. */
export function nextSkill(mode: ModeDef, recent: SkillId[], r: Rng): SkillId {
  if (mode.id !== 'adaptive') {
    let s = r.pick(mode.skills);
    if (recent.length >= 2 && recent.at(-1) === s && recent.at(-2) === s && mode.skills.length > 1) s = r.pick(mode.skills.filter((x) => x !== s));
    return s;
  }
  const ranked = rankSkills('maths', mode.skills);
  const cands = ranked.filter((x) => !(recent.at(-1) === x.id && recent.at(-2) === x.id));
  return r.weighted(cands.map((x) => x.id as SkillId), cands.map((x) => x.p * x.p));
}

export function questionFor(mode: ModeDef, skill: SkillId, r: Rng, seen: Set<string>, zc?: ZetamacConfig): Question {
  for (let k = 0; k < 20; k++) {
    const qn = mode.id === 'zetamac' && zc ? zetamacQuestion(zc, r) : generate(skill, levelOf(skill), r);
    if (!seen.has(qn.prompt)) {
      seen.add(qn.prompt);
      return qn;
    }
  }
  return generate(skill, levelOf(skill), r);
}
