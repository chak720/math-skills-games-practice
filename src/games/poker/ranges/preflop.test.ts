import { describe, expect, it } from 'vitest';
import { classFromName, rangePercent } from './combos';
import { ORDER, positionsFor, RANK_PCT, rfiPercent, topRange } from './preflop';

const inRange = (pct: number, name: string): boolean => topRange(pct)[classFromName(name)] === 1;

describe('preflop ordering and charts', () => {
  it('covers all 169 classes once', () => {
    expect(new Set(ORDER).size).toBe(169);
    expect(RANK_PCT[ORDER[168]]).toBeCloseTo(1, 10);
  });
  it('top-X% ranges look like standard 6-max charts', () => {
    const utg = rfiPercent('UTG', 6), co = rfiPercent('CO', 6), btn = rfiPercent('BTN', 6);
    expect(rangePercent(topRange(utg))).toBeCloseTo(utg, 1);
    for (const h of ['AA', '77', 'AKo', 'AJo', 'KQs', 'QJs', 'JTs', 'A5s']) expect(inRange(utg, h), h).toBe(true);
    for (const h of ['K9o', '22', '87s', 'Q8o', 'A8o']) expect(inRange(utg, h), h).toBe(false);
    for (const h of ['33', 'KTo', 'QTo', 'JTo', '98s', 'A8o']) expect(inRange(co, h), h).toBe(true);
    for (const h of ['K2o', '72o', '64o', 'J5o']) expect(inRange(btn, h), h).toBe(false);
    for (const h of ['22', '65s', 'K8o', 'A2o', 'J9o', 'Q2s']) expect(inRange(btn, h), h).toBe(true);
  });
  it('names positions by table size', () => {
    expect(positionsFor(6)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(positionsFor(9)).toEqual(['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(positionsFor(2)).toEqual(['BTN', 'BB']);
    expect(rfiPercent('UTG', 9)).toBeLessThan(rfiPercent('UTG', 6));
  });
});
