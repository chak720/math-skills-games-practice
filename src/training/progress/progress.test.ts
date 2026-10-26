import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll, save } from '@/shared/storage/store';
import { recordAttempt } from '@/shared/stats/activity';
import { buildPlan, isDone, todaysPlan } from './daily';
import { allLeaks, pokerLeaks } from './leaks';

const line = (o: Partial<Record<string, number>>) => ({ netBB: 0, vpip: 0, pfr: 0, threeBetOpp: 0, threeBet: 0, foldTo3BetOpp: 0, foldTo3Bet: 0, cbetOpp: 0, cbet: 0, sawFlop: 0, wtsd: 0, bbStealOpp: 0, bbStealFold: 0, ...o });

describe('leaks', () => {
  beforeEach(() => clearAll());

  it('flags folding the big blind to steals only with enough data', () => {
    expect(pokerLeaks(Array.from({ length: 8 }, () => line({ bbStealOpp: 1, bbStealFold: 1 })))).toHaveLength(0);
    const ls = pokerLeaks(Array.from({ length: 20 }, (_, i) => line({ bbStealOpp: 1, bbStealFold: i < 16 ? 1 : 0 })));
    expect(ls.map((l) => l.id)).toContain('poker-bb-steal');
  });

  it('flags loose and passive preflop play over 100 hands', () => {
    const ls = pokerLeaks(Array.from({ length: 120 }, (_, i) => line({ vpip: i % 2 === 0 ? 1 : 0, pfr: i % 10 === 0 ? 1 : 0 })));
    expect(ls.map((l) => l.id)).toEqual(expect.arrayContaining(['poker-loose', 'poker-passive']));
  });

  it('finds weak maths skills and overconfident Fermi intervals', () => {
    for (let i = 0; i < 12; i++) recordAttempt({ section: 'maths', skill: 'frac-add', correct: i % 2 === 0, ms: 4000 });
    save('fermi.history', Array.from({ length: 10 }, (_, i) => ({ hit: i < 4, widthOom: 0.3, logErr: 0.5 })));
    const ids = allLeaks().map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['maths-frac-add', 'fermi-overconfident', 'fermi-bias']));
  });
});

describe('daily plan', () => {
  beforeEach(() => clearAll());

  it('adds up to about 20 minutes, puts the warm-up first, and is stable within a day', () => {
    const p = buildPlan(Date.now(), []);
    const total = p.items.reduce((s, i) => s + i.minutes, 0);
    expect(total).toBeGreaterThanOrEqual(17);
    expect(total).toBeLessThanOrEqual(25);
    expect(p.items[0].section).toBe('maths');
    expect(new Set(p.items.map((i) => i.section)).size).toBe(p.items.length);
    const a = todaysPlan();
    expect(todaysPlan()).toEqual(a);
  });

  it('includes the top leak and ticks items off from activity', () => {
    save('fermi.history', Array.from({ length: 10 }, () => ({ hit: false, widthOom: 0.2, logErr: 0.1 })));
    const p = buildPlan(Date.now() - 1000);
    expect(p.items[1].id).toBe('leak:fermi-overconfident');
    expect(isDone(p.items[1], p)).toBe(false);
    recordAttempt({ section: 'fermi', skill: 'fermi:people', correct: true });
    expect(isDone(p.items[1], p)).toBe(true);
  });
});
