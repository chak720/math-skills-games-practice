import { describe, expect, it } from 'vitest';
import { verifyReveal } from '@/shared/fairness/commit';
import { Table } from './table';

function table(n: number): Table {
  const t = new Table({ maxSeats: 6, sb: 5, bb: 10, ante: 0, startingStack: 1000 });
  for (let i = 0; i < n; i++) t.sit(i, { playerId: `p${i}`, name: `P${i}`, stack: 1000, isHuman: i === 0 });
  return t;
}

describe('table', () => {
  it('moves the button clockwise over active seats, skipping empty ones', () => {
    const t = new Table({ maxSeats: 6, sb: 5, bb: 10, ante: 0, startingStack: 1000 });
    for (const s of [0, 2, 5]) t.sit(s, { playerId: `p${s}`, name: `P${s}`, stack: 1000, isHuman: false });
    const buttons: number[] = [];
    for (let k = 0; k < 6; k++) {
      const h = t.startHand('c');
      buttons.push(t.button);
      while (!h.finished) {
        const s = h.toAct!;
        const L = h.legal(s)!;
        h.act(s, L.canCheck ? { type: 'check' } : { type: 'fold' });
      }
      t.settle();
    }
    for (let k = 1; k < buttons.length; k++) {
      const order = [0, 2, 5];
      expect(order[(order.indexOf(buttons[k - 1]) + 1) % 3]).toBe(buttons[k]);
    }
  });

  it('every hand reveals a verifiable deck that matches the dealt cards', async () => {
    const t = table(6);
    for (let k = 0; k < 20; k++) {
      const h = t.startHand('my-seed');
      const commit = t.commit!.commit;
      while (!h.finished) {
        const s = h.toAct!;
        const L = h.legal(s)!;
        h.act(s, L.canCheck ? { type: 'check' } : { type: 'call' });
      }
      const rec = t.settle();
      expect(rec.reveal.commit).toBe(commit);
      const dealt = rec.history.dealt.map((d) => d.card);
      const report = await verifyReveal(rec.reveal, dealt);
      expect(report.ok).toBe(true);
      // The verifier's view of the dealing sequence matches the history exactly.
      expect(rec.reveal.dealt).toEqual(dealt);
    }
  });

  it('chips are conserved across many hands and rebuys work', () => {
    const t = table(4);
    for (let k = 0; k < 200; k++) {
      if (t.activeSeats().length < 2) for (let s = 0; s < 4; s++) t.rebuy(s);
      const total = (): number => t.seats.reduce((a, o) => a + (o?.stack ?? 0), 0);
      const before = total();
      const h = t.startHand('x');
      while (!h.finished) {
        const s = h.toAct!;
        const L = h.legal(s)!;
        h.act(s, L.canRaise && k % 3 === 0 ? { type: 'raise', to: L.maxTo } : L.canCheck ? { type: 'check' } : { type: 'call' });
      }
      t.settle();
      expect(total()).toBe(before);
      expect(t.seats.every((o) => (o?.stack ?? 0) >= 0)).toBe(true);
    }
  });
});
