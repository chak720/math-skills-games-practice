/**
 * Spaced repetition (SM-2 variant) keyed by *skill*, not by item: a skill is a
 * question type ("maths:mul-2x2"), a puzzle technique ("linearity-of-expectation")
 * or a drill ("poker:count-outs"). Scheduling skills rather than items is what
 * lets generated content never repeat while weak areas still come back.
 *
 * quality q ∈ [0,5]: 5 perfect & fast, 4 correct, 3 correct but slow,
 * 2 wrong but close, 0–1 wrong.
 */
import { load, save } from '../storage/store';

export interface SrsCard {
  id: string;
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
  due: number;
  last: number;
  /** Exponentially weighted recent accuracy in [0,1]. */
  acc: number;
  seen: number;
}

const DAY = 86_400_000;

export function newCard(id: string, now = Date.now()): SrsCard {
  return { id, ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, due: now, last: 0, acc: 0.5, seen: 0 };
}

export function reviewCard(c: SrsCard, quality: number, now = Date.now()): SrsCard {
  const qv = Math.max(0, Math.min(5, quality));
  const ease = Math.max(1.3, c.ease + (0.1 - (5 - qv) * (0.08 + (5 - qv) * 0.02)));
  let reps = c.reps, interval = c.intervalDays, lapses = c.lapses;
  if (qv < 3) {
    reps = 0;
    lapses++;
    interval = 0; // due again within this session
  } else {
    reps++;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease);
  }
  // A failed card is due in ~10 minutes so it resurfaces in the same session.
  const due = qv < 3 ? now + 10 * 60_000 : now + interval * DAY;
  const acc = c.acc * 0.7 + (qv >= 3 ? 1 : 0) * 0.3;
  return { ...c, ease, intervalDays: interval, reps, lapses, due, last: now, acc, seen: c.seen + 1 };
}

type Deck = Record<string, SrsCard>;
const key = (domain: string): string => `srs.${domain}`;

export function getDeck(domain: string): Deck {
  return load<Deck>(key(domain), {});
}

export function recordReview(domain: string, id: string, quality: number, now = Date.now()): SrsCard {
  const deck = { ...getDeck(domain) };
  const card = reviewCard(deck[id] ?? newCard(id, now), quality, now);
  deck[id] = card;
  save(key(domain), deck);
  return card;
}

/**
 * Priority for choosing what to practise next: overdue and low-accuracy skills
 * first; unseen skills get a moderate priority so new material is introduced.
 */
export function priority(c: SrsCard | undefined, now = Date.now()): number {
  if (!c) return 1.0;
  const overdueDays = Math.max(0, (now - c.due) / DAY);
  const dueBoost = c.due <= now ? 1 + Math.min(2, overdueDays) : 0.15;
  const weakness = 1 - c.acc + c.lapses * 0.05 + (2.5 - c.ease) * 0.3;
  return dueBoost * (0.3 + Math.max(0, weakness));
}

export function rankSkills(domain: string, ids: readonly string[], now = Date.now()): { id: string; p: number }[] {
  const deck = getDeck(domain);
  return ids.map((id) => ({ id, p: priority(deck[id], now) })).sort((a, b) => b.p - a.p);
}

/** Convert a correct/incorrect + response time into an SM-2 quality grade. */
export function gradeFromResult(correct: boolean, ms: number | undefined, targetMs: number): number {
  if (!correct) return 1;
  if (ms === undefined) return 4;
  if (ms <= targetMs * 0.6) return 5;
  if (ms <= targetMs) return 4;
  return 3;
}
