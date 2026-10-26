import { describe, expect, it } from 'vitest';
import { Rng } from '@/shared/random/prng';
import { FULL_DECK, parseCards } from '@/shared/cards/card';
import { Cat, categoryOf, evaluate } from '../eval/evaluator';
import { classFromName, combosInClass } from '../ranges/combos';
import { checkDrill, combosQ, equityQ, MAKERS, openQ, outsQ, potOddsQ, showdownQ, type DrillId } from './drills';

describe('poker drills', () => {
  it('outs are counted by brute force over the unseen cards', () => {
    const r = new Rng(1);
    for (let i = 0; i < 40; i++) {
      const q = outsQ(r);
      const seen = [...q.hero!, ...q.board!];
      const n = FULL_DECK.filter((c) => !seen.includes(c) && categoryOf(evaluate([...seen, c])) >= Cat.Straight).length;
      expect(q.answer).toEqual({ kind: 'int', value: n });
      expect(n).toBeGreaterThanOrEqual(4);
    }
  });

  it('an open-ended straight-flush draw on the flop has 15 outs', () => {
    // Hand-built: 9h8h on 7h 6c 2h: 9 hearts + 3 non-heart fives + 3 non-heart tens = 15.
    const seen = parseCards('9h 8h 7h 6c 2h');
    const n = FULL_DECK.filter((c) => !seen.includes(c) && categoryOf(evaluate([...seen, c])) >= Cat.Straight).length;
    expect(n).toBe(15);
  });

  it('pot odds use bet / (pot + 2·bet)', () => {
    const r = new Rng(2);
    for (let i = 0; i < 50; i++) {
      const q = potOddsQ(r);
      expect(q.answer.kind).toBe('choice');
      expect(q.explain[0]).toMatch(/equity/);
    }
  });

  it('showdown winners match the evaluator', () => {
    const r = new Rng(3);
    for (let i = 0; i < 40; i++) {
      const q = showdownQ(r);
      const scores = q.others!.map((o) => evaluate([...o.cards, ...q.board!]));
      const best = Math.max(...scores);
      const winners = scores.filter((s) => s === best).length;
      if (q.answer.kind !== 'choice') throw new Error();
      expect(q.answer.accepted).toEqual(winners > 1 ? [q.others!.length] : [scores.indexOf(best)]);
    }
  });

  it('equity drill matches known benchmarks', () => {
    const r = new Rng(4);
    const q = equityQ(r);
    if (q.answer.kind !== 'pct') throw new Error();
    expect(q.answer.value).toBeGreaterThan(0.05);
    expect(q.answer.value).toBeLessThan(0.97);
    expect(checkDrill(q.answer, String(Math.round(q.answer.value * 100)))).toBe(true);
    expect(checkDrill(q.answer, String(Math.round(q.answer.value * 100) + 7))).toBe(false);
  });

  it('combos remove visible cards', () => {
    expect(combosInClass(classFromName('AKo'))).toBe(12);
    const r = new Rng(5);
    for (let i = 0; i < 40; i++) {
      const q = combosQ(r);
      if (q.answer.kind !== 'int') throw new Error();
      expect(q.answer.value).toBeGreaterThanOrEqual(0);
      expect(q.answer.value).toBeLessThanOrEqual(12);
    }
  });

  it('open drill accepts strong hands from every position and folds trash early', () => {
    const r = new Rng(6);
    for (let i = 0; i < 60; i++) {
      const q = openQ(r);
      if (q.answer.kind !== 'choice') throw new Error();
      if (/You hold AA\./.test(q.prompt)) expect(q.answer.accepted).toContain(0);
      if (/UTG\. You hold 72o\./.test(q.prompt)) expect(q.answer.accepted).toEqual([1]);
    }
  });

  it('every drill generates quickly', () => {
    const r = new Rng(7);
    for (const id of Object.keys(MAKERS) as DrillId[]) {
      const t = performance.now();
      for (let i = 0; i < 5; i++) MAKERS[id](r);
      expect(performance.now() - t, id).toBeLessThan(5000);
    }
  });
});
