import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FULL_DECK } from '../cards/card';
import { commitFor, deriveOrder, FairDeck, verifyReveal } from './commit';
import { chiSquaredSurvival } from '../math/special';
import { positionTest, uniformGoodnessOfFit } from './chisq';
import { CryptoSource, HashStream, type RandomSource, uniformInt } from './rng';
import { sha256, sha256Hex, toHex, utf8 } from './sha256';
import { fisherYates, naiveBiasedShuffle } from './shuffle';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('sha256', () => {
  it('matches the FIPS test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
  it('agrees with node:crypto on every length 0..300 (padding boundaries)', () => {
    const src = new CryptoSource();
    for (let len = 0; len <= 300; len++) {
      const bytes = new Uint8Array(len).map(() => src.nextUint32() & 0xff);
      expect(toHex(sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(toHex(sha256(utf8('naïve ♠♥ 🂡')))).toBe(createHash('sha256').update('naïve ♠♥ 🂡', 'utf8').digest('hex'));
  });
});

class FixedSource implements RandomSource {
  private i = 0;
  constructor(private readonly xs: number[]) {}
  nextUint32(): number {
    return this.xs[this.i++];
  }
}

describe('uniformInt (rejection sampling)', () => {
  it('rejects values in the biased tail instead of reducing them mod n', () => {
    // n = 3: limit = 3 * floor(2^32 / 3) = 4294967295; 4294967295 must be rejected.
    const src = new FixedSource([0xffffffff, 7]);
    expect(uniformInt(src, 3)).toBe(7 % 3);
  });
  it('is uniform for awkward n (chi-squared)', () => {
    const src = new CryptoSource();
    for (const n of [3, 7, 52, 311]) {
      const counts = new Array(n).fill(0);
      for (let i = 0; i < n * 2000; i++) counts[uniformInt(src, n)]++;
      expect(uniformGoodnessOfFit(counts).pValue).toBeGreaterThan(1e-6);
    }
  });
  it('validates its range', () => {
    expect(() => uniformInt(new CryptoSource(), 0)).toThrow();
    expect(uniformInt(new CryptoSource(), 1)).toBe(0);
  });
});

describe('chi-squared survival function', () => {
  it('reproduces textbook critical values', () => {
    expect(chiSquaredSurvival(3.841459, 1)).toBeCloseTo(0.05, 5);
    expect(chiSquaredSurvival(18.307038, 10)).toBeCloseTo(0.05, 5);
    expect(chiSquaredSurvival(23.209251, 10)).toBeCloseTo(0.01, 5);
    // Large df: mean df, so survival at df is just under 0.5.
    expect(chiSquaredSurvival(2601, 2601)).toBeGreaterThan(0.48);
    expect(chiSquaredSurvival(2601, 2601)).toBeLessThan(0.5);
  });
});

describe('Fisher–Yates', () => {
  it('produces every permutation of 4 items equally often', () => {
    const src = new CryptoSource();
    const index = new Map<string, number>();
    const counts = new Array(24).fill(0);
    for (let t = 0; t < 96_000; t++) {
      const k = fisherYates([0, 1, 2, 3], src).join('');
      if (!index.has(k)) index.set(k, index.size);
      counts[index.get(k)!]++;
    }
    expect(index.size).toBe(24);
    expect(uniformGoodnessOfFit(counts).pValue).toBeGreaterThan(1e-6);
  });

  it('the χ² position test detects a known-biased shuffle (test has power)', () => {
    const src = new CryptoSource();
    const res = positionTest(8, 40_000, () => naiveBiasedShuffle([0, 1, 2, 3, 4, 5, 6, 7], src));
    expect(res.pValue).toBeLessThan(1e-12);
  });

  it('real dealing path: 52-card positions are uniform over 20,000 seeded decks', () => {
    // Deterministic seeds so the test is reproducible, but each seed is an
    // independent SHA-256 output, exactly like a production server seed.
    let i = 0;
    const res = positionTest(52, 20_000, () => deriveOrder(sha256Hex(`seed-${i++}`), 'client', i));
    expect(res.df).toBe(51 * 51);
    expect(res.pValue).toBeGreaterThan(0.001);
    expect(res.maxAbsResidual).toBeLessThan(5.5);
  });

  it('crypto-seeded shuffles are uniform too', () => {
    const src = new CryptoSource();
    const res = positionTest(52, 10_000, () => fisherYates([...FULL_DECK], src));
    expect(res.pValue).toBeGreaterThan(1e-6);
  });
});

describe('commit / reveal', () => {
  it('derives a valid permutation deterministically from the seed triple', () => {
    const a = deriveOrder('ab'.repeat(32), 'me', 1, 2);
    expect(a).toEqual(deriveOrder('ab'.repeat(32), 'me', 1, 2));
    expect(a).not.toEqual(deriveOrder('ab'.repeat(32), 'me', 2, 2));
    expect(a).not.toEqual(deriveOrder('ab'.repeat(32), 'you', 1, 2));
    expect([...a].sort((x, y) => x - y)).toEqual([...FULL_DECK, ...FULL_DECK].sort((x, y) => x - y));
  });

  it('HashStream is the documented construction', () => {
    const s = new HashStream('k');
    const block0 = createHash('sha256').update('k:0').digest();
    expect(s.nextUint32()).toBe(block0.readUInt32BE(0));
    for (let i = 1; i < 8; i++) s.nextUint32();
    expect(s.nextUint32()).toBe(createHash('sha256').update('k:1').digest().readUInt32BE(0));
  });

  it('verifies an honest deck and catches every kind of tampering', async () => {
    const deck = new FairDeck({ clientSeed: 'player', nonce: 7 });
    const seen = [deck.draw(), deck.draw(), deck.draw()];
    expect(deck.info.commit).toMatch(/^[0-9a-f]{64}$/);
    const r = deck.finish();
    expect(() => deck.draw()).toThrow();
    expect(r.commit).toBe(commitFor(r.serverSeed));
    expect((await verifyReveal(r, seen)).ok).toBe(true);

    expect((await verifyReveal({ ...r, serverSeed: r.serverSeed.replace(/^./, (c) => (c === '0' ? '1' : '0')) }, seen)).hashOk).toBe(false);
    const swapped = [...r.order];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect((await verifyReveal({ ...r, order: swapped }, seen)).orderOk).toBe(false);
    const fakeSeen = [seen[1], seen[0], seen[2]];
    const bad = await verifyReveal(r, fakeSeen);
    expect(bad.dealtOk).toBe(false);
    expect(bad.firstMismatch).toBe(0);
  });

  it('checks sparse observations by deck position', async () => {
    const deck = new FairDeck({ clientSeed: 'x', nonce: 1 });
    const cards = Array.from({ length: 10 }, () => deck.draw());
    const r = deck.finish();
    expect((await verifyReveal(r, [cards[3], cards[9]], [3, 9])).ok).toBe(true);
    expect((await verifyReveal(r, [cards[3], cards[9]], [3, 8])).ok).toBe(false);
  });
});

describe('architecture guard: no Math.random near cards', () => {
  it('card, fairness and game-engine modules never call Math.random', () => {
    const root = join(__dirname, '..', '..');
    const dirs = ['shared/cards', 'shared/fairness', 'games'];
    const offenders: string[] = [];
    const walk = (d: string): void => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.endsWith('.test.ts') && /Math\.random\s*\(/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    for (const d of dirs) {
      try {
        walk(join(root, d));
      } catch {
        /* directory not created yet */
      }
    }
    expect(offenders).toEqual([]);
  });
});
