import { describe, expect, it } from 'vitest';
import { parseCards } from '@/shared/cards/card';
import type { PlayerView, ActionRecord } from '../engine/types';
import { classFromName, CLASS_COMBOS } from './combos';
import { inferRange, POPULATION, positionOf, preflopClassWeights } from './inference';

function view(actions: Partial<ActionRecord>[], board = '', n = 6): PlayerView {
  const order = Array.from({ length: n }, (_, i) => i);
  return {
    handId: 1, me: 0, hole: null, board: board ? parseCards(board) : [], street: 'flop', button: n - 1, sbSeat: 0, bbSeat: 1, sb: 5, bb: 10, ante: 0,
    seats: order.map((s) => ({ seat: s, playerId: `p${s}`, name: `p${s}`, stack: 1000, betStreet: 0, committed: 0, folded: false, allIn: false, inHand: true, shown: null, mucked: false })),
    pot: 0, currentBet: 0, toAct: null, legal: null, handOver: false, pots: null, winners: null, order,
    actions: actions.map((a) => ({ street: 'preflop', seat: 0, type: 'call', amount: 0, to: 0, allIn: false, potAfter: 0, ...a }) as ActionRecord),
  };
}

const classWeight = (w: Float64Array, name: string): number => {
  const ks = CLASS_COMBOS[classFromName(name)];
  return ks.reduce((s, k) => s + w[k], 0) / ks.length;
};

describe('range inference', () => {
  it('maps seats to positions', () => {
    const v = view([]);
    expect(positionOf(v, 0)).toBe('SB');
    expect(positionOf(v, 1)).toBe('BB');
    expect(positionOf(v, 2)).toBe('UTG');
    expect(positionOf(v, 5)).toBe('BTN');
  });
  it('an UTG open is tight, a button open is wide', () => {
    const utg = preflopClassWeights(view([{ seat: 2, type: 'raise', to: 25 }]), 2, POPULATION);
    const btn = preflopClassWeights(view([{ seat: 2, type: 'fold' }, { seat: 3, type: 'fold' }, { seat: 4, type: 'fold' }, { seat: 5, type: 'raise', to: 25 }]), 5, POPULATION);
    const sum = (w: Float64Array): number => w.reduce((a, b) => a + b, 0);
    expect(sum(btn)).toBeGreaterThan(sum(utg) * 2);
    expect(utg[classFromName('AA')]).toBeGreaterThan(0.95);
    expect(utg[classFromName('72o')]).toBeLessThan(0.01);
  });
  it('a 3-bet range is value-heavy with suited-ace bluffs and no middling offsuit hands', () => {
    const w = preflopClassWeights(view([{ seat: 2, type: 'raise', to: 25 }, { seat: 3, type: 'raise', to: 80 }]), 3, POPULATION);
    expect(w[classFromName('KK')]).toBeGreaterThan(0.9);
    expect(w[classFromName('A4s')]).toBeGreaterThan(0.3);
    expect(w[classFromName('KJo')]).toBeLessThan(0.1);
  });
  it('a big river bet shifts weight towards strong hands; a check shifts it away', () => {
    const base: Partial<ActionRecord>[] = [
      { seat: 5, type: 'raise', to: 25, potAfter: 40 },
      { seat: 1, type: 'call', to: 25, amount: 15, potAfter: 55 },
      { seat: 1, type: 'check', street: 'flop', potAfter: 55 },
      { seat: 5, type: 'check', street: 'flop', potAfter: 55 },
      { seat: 1, type: 'check', street: 'turn', potAfter: 55 },
      { seat: 5, type: 'check', street: 'turn', potAfter: 55 },
      { seat: 1, type: 'check', street: 'river', potAfter: 55 },
    ];
    const board = 'Kh 8d 3c 2s Jd';
    const bet = inferRange(view([...base, { seat: 5, type: 'bet', street: 'river', amount: 50, to: 50, potAfter: 105 }], board), 5, POPULATION, { dead: [] });
    const chk = inferRange(view([...base, { seat: 5, type: 'check', street: 'river', potAfter: 55 }], board), 5, POPULATION, { dead: [] });
    // Kings-up (KJ) relative to a weak pair (33 is a set! use 44: underpair)
    const ratio = (w: Float64Array): number => classWeight(w, 'KJs') / Math.max(1e-9, classWeight(w, '44'));
    expect(ratio(bet)).toBeGreaterThan(ratio(chk) * 2);
  });
  it('shown cards collapse the range to one combo', () => {
    const v = view([]);
    v.seats[3].shown = parseCards('As Ks');
    const w = inferRange(v, 3, POPULATION);
    expect(w.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
