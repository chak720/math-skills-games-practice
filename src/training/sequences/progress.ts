/** Sequence practice state: seen keys (no repeats), adaptive level, family weighting from your accuracy. */
import { load, save, update } from '@/shared/storage/store';
import { getSkillAggs, recordAttempt } from '@/shared/stats/activity';
import type { Rng } from '@/shared/random/prng';
import { FAMILY_IDS, nextSequence, type FamilyId, type Sequence, type Tier } from './sequences';

const SEEN = 'sequences.seen';
const LEVEL = 'sequences.level';

export const getLevel = (): number => load<number>(LEVEL, 1.3);
export const levelTier = (lv: number): Tier => Math.max(1, Math.min(3, Math.floor(lv))) as Tier;

export function familyWeights(): Partial<Record<FamilyId, number>> {
  const aggs = getSkillAggs();
  return Object.fromEntries(FAMILY_IDS.map((f) => [f, aggs[`sequences:${f}`] ? 0.6 + 1.6 * (1 - aggs[`sequences:${f}`].ewmaAcc) : 1]));
}

export function drawSequence(r: Rng, tier: Tier | 'adaptive', last?: FamilyId): Sequence {
  const seen = new Set(load<string[]>(SEEN, []));
  const s = nextSequence(r, tier === 'adaptive' ? levelTier(getLevel()) : tier, (k) => seen.has(k), familyWeights(), last);
  update<string[]>(SEEN, [], (xs) => [...xs, s.key].slice(-20_000));
  return s;
}

export function recordSequence(s: Sequence, correct: boolean, ms: number, adaptive: boolean): void {
  recordAttempt({ section: 'sequences', skill: `sequences:${s.family}`, correct, ms });
  if (adaptive) {
    const lv = getLevel();
    save(LEVEL, Math.max(1, Math.min(3.99, lv + (correct ? (ms < 20_000 ? 0.15 : 0.05) : -0.2))));
  }
}
