import { describe, expect, it } from 'vitest';
import { PRESETS, scoreFermi, scoreKelly, scoreMarket, scoreMaths, scorePuzzle, segmentMinutes } from './presets';

describe('interview scoring', () => {
  it('scores each segment on 0–100', () => {
    expect(scoreMaths(10, 0, 10)).toBe(100);
    expect(scoreMaths(6, 4, 10)).toBe(40);
    expect(scoreMaths(0, 10, 10)).toBe(0);
    expect(scorePuzzle(true, 0, 0)).toBe(100);
    expect(scorePuzzle(true, 2, 1)).toBe(50);
    expect(scorePuzzle(false, 0, 0)).toBe(0);
    expect(scoreFermi(100, true)).toBe(100);
    expect(scoreFermi(50, false)).toBe(30);
    expect(scoreMarket(5, 4, 2.5)).toBe(100);
    expect(scoreMarket(0, 4, 2.5)).toBe(50);
    expect(scoreKelly(0.6, 1, 0.2)).toBe(100);
    expect(scoreKelly(0.6, 1, 0.4)).toBeLessThan(10); // twice Kelly: no growth
    expect(scoreKelly(1 / 6, 4, 0)).toBe(100); // negative edge, bet nothing
    expect(scoreKelly(1 / 6, 4, 0.05)).toBe(50);
  });

  it('presets have the advertised lengths', () => {
    const mins = Object.fromEntries(PRESETS.map((p) => [p.id, p.segments.reduce((s, x) => s + segmentMinutes(x), 0)]));
    expect(mins.screen).toBeGreaterThanOrEqual(12);
    expect(mins.screen).toBeLessThanOrEqual(18);
    expect(mins.full).toBeGreaterThanOrEqual(30);
    expect(mins.full).toBeLessThanOrEqual(40);
  });
});
