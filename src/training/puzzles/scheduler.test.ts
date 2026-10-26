import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll } from '@/shared/storage/store';
import { Rng } from '@/shared/random/prng';
import { getDeck } from '@/shared/srs/srs';
import { puzzleApi } from '@/workers/puzzleApi';
import { checkAnswer, answerText } from './answer';
import { candidates, fitTier, getHistory, getLevels, getSeen, markSeen, orderCandidates, quality, recentStructures, recordResult, type Filter } from './scheduler';
import { fromWire, toWire } from './wire';
import { generatorById } from './registry';
import { buildPuzzle } from './pipeline';
import type { Puzzle } from './types';

function next(filter: Filter, seed: string): Puzzle | null {
  const order = orderCandidates(candidates(filter), new Rng(seed));
  const w = puzzleApi.generate({ tries: order.slice(0, 8).map((c) => ({ generatorId: c.g.id, tier: c.tier })), seed, seen: getSeen(), avoid: recentStructures() });
  if (!w) return null;
  const p = fromWire(JSON.parse(JSON.stringify(w)));
  markSeen(p.id);
  return p;
}

describe('puzzle scheduler', () => {
  beforeEach(() => clearAll());

  it('never repeats a puzzle and rotates generators and structures', () => {
    const filter: Filter = { category: 'any', tier: 'adaptive', focus: 'mixed' };
    const shown: Puzzle[] = [];
    for (let i = 0; i < 160; i++) {
      const p = next(filter, `s${i}`)!;
      expect(p).not.toBeNull();
      shown.push(p);
      // Alternate outcomes so levels and SRS both move.
      recordResult(p, { correct: i % 3 !== 0, misses: 0, hintsUsed: i % 5 === 0 ? 1 : 0, revealed: false, ms: 90_000, interviewer: false });
    }
    expect(new Set(shown.map((p) => p.id)).size).toBe(shown.length);
    let sameGen = 0, sameStructNear = 0;
    for (let i = 1; i < shown.length; i++) {
      if (shown[i].generatorId === shown[i - 1].generatorId) sameGen++;
      if (shown.slice(Math.max(0, i - 3), i).some((q) => q.structure === shown[i].structure)) sameStructNear++;
    }
    expect(sameGen).toBeLessThanOrEqual(3);
    expect(sameStructNear).toBeLessThanOrEqual(4);
    // Breadth: most generators appear.
    expect(new Set(shown.map((p) => p.generatorId)).size).toBeGreaterThan(25);
    expect(new Set(shown.map((p) => p.category)).size).toBe(6);
  });

  it('falls through to another generator once one is exhausted', () => {
    // clock/angle has a tiny parameter space at warm-up (11 × 59); mark it all seen.
    const g = generatorById('clock')!;
    const r = new Rng(1);
    for (let i = 0; i < 4000; i++) markSeen(buildPuzzle(g, g.params(r, 'warmup'), 'warmup', r).id);
    const w = puzzleApi.generate({ tries: [{ generatorId: 'clock', tier: 'warmup' }, { generatorId: 'dice-sum', tier: 'warmup' }], seed: 'x', seen: getSeen(), avoid: [] });
    expect(w?.generatorId).toBe('dice-sum');
  });

  it('records history, SRS by technique and adaptive levels', () => {
    const g = generatorById('gamblers-ruin')!;
    const r = new Rng(3);
    const p = buildPuzzle(g, g.params(r, 'warmup'), 'warmup', r);
    recordResult(p, { correct: true, misses: 0, hintsUsed: 0, revealed: false, ms: 30_000, interviewer: false });
    expect(getHistory()).toHaveLength(1);
    for (const t of p.techniques) expect(getDeck('puzzles')[t].reps).toBe(1);
    const up = getLevels().markov!;
    recordResult(p, { correct: false, misses: 2, hintsUsed: 3, revealed: true, ms: 30_000, interviewer: false });
    expect(getLevels().markov!).toBeLessThan(up);
    for (const t of p.techniques) expect(getDeck('puzzles')[t].lapses).toBe(1);
  });

  it('review focus favours techniques that were missed', () => {
    const g = generatorById('penney')!;
    const r = new Rng(4);
    const p = buildPuzzle(g, g.params(r, 'interview'), 'interview', r);
    recordResult(p, { correct: false, misses: 1, hintsUsed: 2, revealed: true, ms: 1000, interviewer: false });
    const cs = candidates({ category: 'any', tier: 'adaptive', focus: 'review' }, []);
    const w = (id: string) => cs.find((c) => c.g.id === id)!.weight;
    expect(w('pattern-wait')).toBeGreaterThan(w('trailing-zeros')); // shares pattern-overlap with Penney
  });

  it('maps attempts to SM-2 quality', () => {
    const base = { correct: true, misses: 0, hintsUsed: 0, revealed: false, ms: 1000 };
    expect(quality(base)).toBe(5);
    expect(quality({ ...base, ms: 1e9 })).toBe(4);
    expect(quality({ ...base, hintsUsed: 1 })).toBe(3);
    expect(quality({ ...base, hintsUsed: 2 })).toBe(2);
    expect(quality({ ...base, misses: 1 })).toBe(4);
    expect(quality({ ...base, revealed: true })).toBe(1);
  });

  it('fits tiers to what a generator supports', () => {
    expect(fitTier(generatorById('bridge')!, 'warmup')).toBe('interview');
    expect(fitTier(generatorById('dice-sum')!, 'hard')).toBe('hard');
  });

  it('round-trips puzzles through JSON with exact answers', () => {
    for (const id of ['urn', 'trailing-zeros', 'running-total', 'knights-knaves', 'ordering']) {
      const g = generatorById(id)!;
      const r = new Rng(id);
      const tier = g.tiers.at(-1)!;
      const p = buildPuzzle(g, g.params(r, tier), tier, r);
      const back = fromWire(JSON.parse(JSON.stringify(toWire(p))));
      expect(answerText(back.answer)).toBe(answerText(p.answer));
      if (back.answer.kind === 'rational' || back.answer.kind === 'integer') expect(checkAnswer(back.answer, back.answer.value.toString()).correct).toBe(true);
    }
  });
});
