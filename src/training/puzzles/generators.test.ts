import { describe, expect, it } from 'vitest';
import { Rng } from '@/shared/random/prng';
import { ALL_GENERATORS } from './registry';
import { sameAnswer, answerText, checkAnswer } from './answer';
import { buildPuzzle } from './pipeline';

describe('every generator: solver and independent verifier agree', () => {
  for (const g of ALL_GENERATORS) {
    it(`${g.id}`, () => {
      const r = new Rng(`test-${g.id}`);
      const fingerprints = new Set<string>();
      for (const tier of g.tiers)
        for (let k = 0; k < 25; k++) {
          const p = g.params(r, tier);
          const sol = g.solve(p);
          const ver = g.verify(p);
          expect(sameAnswer(sol.answer, ver), `${g.id} ${tier} ${JSON.stringify(p)}: solve ${answerText(sol.answer)} vs verify ${answerText(ver)}`).toBe(true);
          const rendered = g.render(p, r);
          expect(rendered.prompt.length).toBeGreaterThan(20);
          expect(g.hints(p)).toHaveLength(3);
          expect(sol.steps.length).toBeGreaterThan(0);
          const puzzle = buildPuzzle(g, p, tier, r);
          fingerprints.add(puzzle.id);
          // The displayed answer is accepted by the checker.
          if (sol.answer.kind === 'rational') expect(checkAnswer(sol.answer, sol.answer.value.toString()).correct).toBe(true);
          if (sol.answer.kind === 'integer') expect(checkAnswer(sol.answer, sol.answer.value.toString()).correct).toBe(true);
          if (sol.answer.kind === 'set') expect(checkAnswer(sol.answer, sol.answer.value.join('')).correct).toBe(true);
          if (sol.answer.kind === 'choice') expect(checkAnswer(sol.answer, sol.answer.correct).correct).toBe(true);
        }
      // Parameter spaces must be rich enough not to repeat in a short run.
      expect(fingerprints.size).toBeGreaterThan(Math.min(10, g.tiers.length * 6));
    });
  }
});
