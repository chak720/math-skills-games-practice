import { describe, expect, it } from 'vitest';
import { Rng } from '@/shared/random/prng';
import { ALL_SKILLS, generate, isCorrect } from './generators';
import { parseAnswer } from '@/shared/math/rational';

describe('mental maths generators', () => {
  it('every skill at every level produces finite answers that its own answer text satisfies', () => {
    const r = new Rng(3);
    for (const s of ALL_SKILLS)
      for (let L = 1; L <= 5; L++)
        for (let k = 0; k < 60; k++) {
          const q = generate(s, L, r);
          expect(Number.isFinite(q.answer), `${s} ${q.prompt}`).toBe(true);
          expect(q.prompt.length).toBeGreaterThan(2);
          // The displayed answer (first number in answerText) must be accepted.
          const shown = q.answerText.split(' ≈ ').pop()!.replace('%', '').replace(/^\+/, '');
          const typed = parseAnswer(shown);
          expect(isCorrect(q, typed), `${s} L${L}: "${q.prompt}" answer ${q.answer} shown "${q.answerText}"`).toBe(true);
        }
  });
  it('spot checks of exact answers', () => {
    const r = new Rng(1);
    const q = generate('diff-sq', 3, r);
    const [a, b] = q.prompt.split(' × ').map(Number);
    expect(q.answer).toBe(a * b);
    const p = generate('pct-change', 2, r);
    const [, from, to] = p.prompt.match(/From ([\d.]+) to ([\d.]+)/)!;
    expect(p.answer).toBeCloseTo(((+to - +from) / +from) * 100, 6);
  });
  it('estimation accepts answers within tolerance and rejects outside', () => {
    const r = new Rng(2);
    const q = generate('est-mul', 3, r);
    expect(isCorrect(q, q.answer * 1.04)).toBe(true);
    expect(isCorrect(q, q.answer * 1.2)).toBe(false);
  });
});
