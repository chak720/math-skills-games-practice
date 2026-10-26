/**
 * Card randomness. Two sources, both implementing {@link RandomSource}:
 *
 *  - {@link CryptoSource}: raw entropy from `crypto.getRandomValues`. Used to
 *    create server seeds (and anywhere unpredictability matters).
 *  - {@link HashStream}: a deterministic SHA-256 counter-mode stream keyed by
 *    `serverSeed:clientSeed:nonce`. Every deck/shoe is shuffled from this, so
 *    the shuffle is a pure function of the committed seed and can be replayed
 *    by anyone after the seed is revealed.
 *
 * `Math.random` is never used for cards.
 */
import { sha256, utf8 } from './sha256';

export interface RandomSource {
  /** Uniform integer in [0, 2^32). */
  nextUint32(): number;
}

export function cryptoRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export class CryptoSource implements RandomSource {
  private buf = new Uint32Array(256);
  private i = 256;
  nextUint32(): number {
    if (this.i >= this.buf.length) {
      globalThis.crypto.getRandomValues(this.buf);
      this.i = 0;
    }
    return this.buf[this.i++];
  }
}

/**
 * block_k = SHA-256( ASCII("<serverSeed>:<clientSeed>:<nonce>:<k>") ), k = 0,1,2,...
 * Each 32-byte block yields eight big-endian uint32 words, consumed in order.
 * Deliberately string-based so it is trivial to re-implement in any language.
 */
export class HashStream implements RandomSource {
  private block: Uint8Array = new Uint8Array(0);
  private view: DataView = new DataView(new ArrayBuffer(0));
  private word = 8;
  private counter = 0;
  /** Number of uint32 words consumed so far (useful for auditing). */
  consumed = 0;
  constructor(private readonly key: string) {}
  nextUint32(): number {
    if (this.word >= 8) {
      this.block = sha256(utf8(`${this.key}:${this.counter++}`));
      this.view = new DataView(this.block.buffer);
      this.word = 0;
    }
    this.consumed++;
    return this.view.getUint32(4 * this.word++, false);
  }
}

/**
 * Unbiased integer in [0, n) by rejection sampling.
 *
 * Taking `x % n` directly is biased whenever n does not divide 2^32: the first
 * (2^32 mod n) residues get one extra preimage. We reject x >= limit where
 * limit = n * floor(2^32 / n) is the largest multiple of n not exceeding 2^32,
 * so every residue has exactly floor(2^32/n) preimages. The expected number of
 * draws is < 2 for any n, and ~1 for small n like 52.
 */
export function uniformInt(src: RandomSource, n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > 0x100000000) throw new RangeError(`bad range ${n}`);
  if (n === 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  let x = src.nextUint32();
  while (x >= limit) x = src.nextUint32();
  return x % n;
}
