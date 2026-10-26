import { describe, expect, it } from 'vitest';
import { parseCards } from '@/shared/cards/card';
import { CLASS_COMBOS, classFromName, className, classOf, combosInClass, formatRange, NUM_COMBOS, parseRange, rangePercent, toComboWeights, liveCombos, comboIndex, COMBO_A, COMBO_B } from './combos';

describe('combos and classes', () => {
  it('indexes 1326 combos into 169 classes with the right multiplicities', () => {
    let total = 0;
    for (let c = 0; c < 169; c++) {
      expect(CLASS_COMBOS[c].length).toBe(combosInClass(c));
      total += CLASS_COMBOS[c].length;
    }
    expect(total).toBe(NUM_COMBOS);
    const [a, b] = parseCards('As Kd');
    const k = comboIndex(a, b);
    expect([COMBO_A[k], COMBO_B[k]].sort()).toEqual([a, b].sort());
  });
  it('class names round-trip and grid layout is standard', () => {
    for (let c = 0; c < 169; c++) expect(classFromName(className(c))).toBe(c);
    expect(className(0)).toBe('AA');
    expect(className(1)).toBe('AKs');
    expect(className(13)).toBe('AKo');
    expect(className(168)).toBe('22');
    const [a, b] = parseCards('Ts 9s');
    expect(className(classOf(a, b))).toBe('T9s');
  });
  it('parses and formats range notation', () => {
    const r = parseRange('QQ+, AKs, AKo, A5s-A2s, KTs+, 77-55, T9s');
    expect(rangePercent(r) * NUM_COMBOS).toBe(18 + 4 + 12 + 16 + 12 + 18 + 4);
    expect(formatRange(r)).toBe('QQ+, 77-55, AKs, A5s-A2s, KTs+, T9s, AKo');
    expect(rangePercent(parseRange('any'))).toBe(1);
    expect(() => parseRange('AKx')).toThrow();
  });
  it('removes dead cards from combo weights', () => {
    const w = toComboWeights(parseRange('AA'), parseCards('As'));
    expect(w.reduce((a, b) => a + b, 0)).toBe(3);
    // 12 offsuit AK combos; As kills 3 (AsKc, AsKd, AsKh), Kh kills 2 more (AcKh, AdKh).
    expect(liveCombos(classFromName('AKo'), parseCards('As Kh'))).toBe(7);
  });
});
