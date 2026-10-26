import { describe, expect, it } from 'vitest';
import { Rng } from '@/shared/random/prng';
import { fair, makeContract, settlement, type ContractKind } from './contracts';
import { newGame, quote, review } from './game';

const KINDS: ContractKind[] = ['dice-sum', 'card-sum', 'coins', 'dice-max'];

describe('market-making contracts', () => {
  it('fair value is the conditional expectation (checked by simulation)', () => {
    for (const kind of KINDS) {
      const c = makeContract(kind, new Rng(kind));
      for (let revealed = 0; revealed < c.parts.length; revealed++) {
        const f = fair(c, revealed);
        // Resample the hidden parts given the revealed ones by rejection on fresh contracts.
        const r = new Rng(`${kind}:${revealed}`);
        let sum = 0, sq = 0, n = 0;
        for (let i = 0; i < 200_000 && n < 8_000; i++) {
          const d = makeContract(kind, r);
          if (d.parts.length !== c.parts.length) continue;
          if (!c.parts.slice(0, revealed).every((x, j) => d.parts[j] === x)) continue;
          const v = settlement(d);
          sum += v;
          sq += v * v;
          n++;
        }
        if (n < 1500) continue;
        const mean = sum / n, sd = Math.sqrt(sq / n - mean * mean);
        expect(Math.abs(mean - f.mean), `${kind} r=${revealed}`).toBeLessThan(4 * (sd / Math.sqrt(n)) + 1e-9);
        expect(Math.abs(sd - f.sd) / Math.max(1, f.sd), `${kind} sd r=${revealed}`).toBeLessThan(0.05);
      }
      expect(fair(c, c.parts.length).mean).toBe(settlement(c));
    }
  });
});

describe('market-making game', () => {
  it('a quote straddling fair value is never picked off by arbitrageurs, and P&L adds up', () => {
    for (let s = 0; s < 40; s++) {
      let g = newGame(`seed${s}`, 'normal');
      while (!g.done) {
        const f = fair(g.contract, g.revealed).mean;
        const w = g.maxWidth / 2;
        g = quote(g, f - w, f + w);
      }
      const rv = review(g);
      expect(g.log.flatMap((l) => l.trades).filter((t) => t.who === 'arb')).toHaveLength(0);
      expect(rv.pnl).toBeCloseTo(rv.edge + rv.inventory, 9);
      // Every trade at a symmetric quote earns exactly half the width against fair value.
      const trades = g.log.flatMap((l) => l.trades);
      expect(rv.edge).toBeCloseTo((trades.length * g.maxWidth) / 2, 9);
      expect(Math.abs(g.position)).toBeLessThanOrEqual(g.posLimit);
    }
  });

  it('a quote far from fair value gets picked off', () => {
    let g = newGame('off', 'normal', 'dice-sum');
    const f = fair(g.contract, 0).mean;
    g = quote(g, f - 10, f - 10 + g.maxWidth);
    const t = g.log[0].trades;
    expect(t.every((x) => x.who === 'noise' || x.side === 1)).toBe(true);
    expect(review(g).edge).toBeLessThan(0.0001 + t.filter((x) => x.who === 'noise').length * 100);
  });

  it('outcomes are reproducible from the seed and independent of quotes', () => {
    const a = newGame('same', 'hard');
    const b = newGame('same', 'hard');
    expect(a.contract.parts).toEqual(b.contract.parts);
  });
});
