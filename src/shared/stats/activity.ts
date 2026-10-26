/**
 * Activity log shared by every section. Two granularities:
 *  - Attempt: one question/decision (skill, correct, time).
 *  - SessionRecord: one finished run (mode, score, duration, summary).
 * Plus rolling per-skill aggregates and per-day totals, which survive the
 * caps on raw logs so long-term trends and streaks are never lost.
 */
import { load, save, update } from '../storage/store';

export type SectionId = 'poker' | 'blackjack' | 'maths' | 'puzzles' | 'market' | 'sequences' | 'fermi' | 'betting' | 'interview';

export interface Attempt {
  t: number;
  section: SectionId;
  skill: string;
  correct: boolean;
  ms?: number;
  /** Optional continuous score (e.g. EV lost, calibration error). */
  score?: number;
}

export interface SessionRecord {
  t: number;
  section: SectionId;
  mode: string;
  durationMs: number;
  score: number;
  total?: number;
  summary?: Record<string, number | string>;
}

export interface SkillAgg {
  n: number;
  correct: number;
  totalMs: number;
  timed: number;
  ewmaAcc: number;
  ewmaMs: number;
  last: number;
}

export interface DayAgg {
  attempts: number;
  correct: number;
  ms: number;
  sections: Partial<Record<SectionId, number>>;
}

const MAX_ATTEMPTS = 12_000;
const MAX_SESSIONS = 2_500;

export const dayKey = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function recordAttempt(a: Omit<Attempt, 't'> & { t?: number }): void {
  const t = a.t ?? Date.now();
  const full: Attempt = { ...a, t };
  update<Attempt[]>('activity.attempts', [], (xs) => {
    const next = xs.length >= MAX_ATTEMPTS ? xs.slice(xs.length - MAX_ATTEMPTS + 1) : xs.slice();
    next.push(full);
    return next;
  });
  update<Record<string, SkillAgg>>('activity.skills', {}, (m) => {
    const id = `${a.section}:${a.skill}`;
    const prev = m[id] ?? { n: 0, correct: 0, totalMs: 0, timed: 0, ewmaAcc: 0.5, ewmaMs: a.ms ?? 0, last: 0 };
    const alpha = prev.n < 10 ? 1 / (prev.n + 1) : 0.1;
    const agg: SkillAgg = {
      n: prev.n + 1,
      correct: prev.correct + (a.correct ? 1 : 0),
      totalMs: prev.totalMs + (a.ms ?? 0),
      timed: prev.timed + (a.ms !== undefined ? 1 : 0),
      ewmaAcc: prev.ewmaAcc + alpha * ((a.correct ? 1 : 0) - prev.ewmaAcc),
      ewmaMs: a.ms !== undefined ? (prev.timed === 0 ? a.ms : prev.ewmaMs + 0.15 * (a.ms - prev.ewmaMs)) : prev.ewmaMs,
      last: t,
    };
    return { ...m, [id]: agg };
  });
  bumpDay(t, { attempts: 1, correct: a.correct ? 1 : 0, ms: a.ms ?? 0 }, a.section);
}

export function recordSession(s: Omit<SessionRecord, 't'> & { t?: number }): void {
  const full: SessionRecord = { ...s, t: s.t ?? Date.now() };
  update<SessionRecord[]>('activity.sessions', [], (xs) => {
    const next = xs.length >= MAX_SESSIONS ? xs.slice(xs.length - MAX_SESSIONS + 1) : xs.slice();
    next.push(full);
    return next;
  });
  bumpDay(full.t, { attempts: 0, correct: 0, ms: s.durationMs }, s.section);
}

function bumpDay(t: number, d: { attempts: number; correct: number; ms: number }, section: SectionId): void {
  update<Record<string, DayAgg>>('activity.days', {}, (m) => {
    const k = dayKey(t);
    const prev = m[k] ?? { attempts: 0, correct: 0, ms: 0, sections: {} };
    return {
      ...m,
      [k]: {
        attempts: prev.attempts + d.attempts,
        correct: prev.correct + d.correct,
        ms: prev.ms + d.ms,
        sections: { ...prev.sections, [section]: (prev.sections[section] ?? 0) + 1 },
      },
    };
  });
}

export const getAttempts = (section?: SectionId): Attempt[] => {
  const xs = load<Attempt[]>('activity.attempts', []);
  return section ? xs.filter((a) => a.section === section) : xs;
};
export const getSessions = (section?: SectionId): SessionRecord[] => {
  const xs = load<SessionRecord[]>('activity.sessions', []);
  return section ? xs.filter((s) => s.section === section) : xs;
};
export const getSkillAggs = (): Record<string, SkillAgg> => load('activity.skills', {});
export const getDays = (): Record<string, DayAgg> => load('activity.days', {});

/** Consecutive days (ending today or yesterday) with any activity. */
export function currentStreak(now = Date.now()): number {
  const days = getDays();
  let streak = 0;
  let t = now;
  if (!days[dayKey(t)]) t -= 86_400_000; // streak still alive if you trained yesterday
  while (days[dayKey(t)]) {
    streak++;
    t -= 86_400_000;
  }
  return streak;
}

/** Testing hook. */
export function resetActivity(): void {
  save('activity.attempts', []);
  save('activity.sessions', []);
  save('activity.skills', {});
  save('activity.days', {});
}
