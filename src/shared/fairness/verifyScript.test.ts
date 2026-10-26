import { describe, expect, it } from 'vitest';
import { deriveOrder, FairDeck } from './commit';
// The standalone script shares no code with the app; it must agree with it.
// @ts-expect-error plain JavaScript module without types
import { deriveOrder as scriptOrder, verify } from '../../../scripts/verify-hand.mjs';

describe('scripts/verify-hand.mjs', () => {
  it('recomputes the same order as the app for random seeds and multi-deck shoes', () => {
    for (let i = 0; i < 20; i++) {
      const decks = i % 4 === 0 ? 6 : 1;
      expect(scriptOrder(`s${i}`, `c${i}`, i, decks)).toEqual(deriveOrder(`s${i}`, `c${i}`, i, decks));
    }
  });

  it('passes a genuine reveal and fails a tampered one', () => {
    const d = new FairDeck({ clientSeed: 'me', nonce: 7 });
    for (let i = 0; i < 9; i++) d.draw();
    const r = d.finish();
    expect(verify(r).ok).toBe(true);
    const tampered = { ...r, dealt: [...r.dealt] };
    [tampered.dealt[0], tampered.dealt[1]] = [tampered.dealt[1], tampered.dealt[0]];
    expect(verify(tampered).ok).toBe(false);
    expect(verify({ ...r, serverSeed: r.serverSeed.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a')) }).ok).toBe(false);
  });
});
