/**
 * Commit–reveal provable fairness.
 *
 * Before a hand (poker) or shoe (blackjack):
 *   1. serverSeed  := 32 bytes from crypto.getRandomValues, as 64 hex chars.
 *   2. commit      := SHA-256(ASCII(serverSeed)) is shown to the player.
 *   3. The deck order is a pure function of (serverSeed, clientSeed, nonce):
 *        Fisher–Yates over the unshuffled deck(s), driven by HashStream.
 *      The client seed is chosen by the player, so neither side alone controls
 *      the order; the nonce makes every hand/shoe distinct.
 * After the hand/shoe the server seed and order are revealed. Anyone can then
 * check SHA-256(serverSeed) == commit, recompute the order, and compare it with
 * the cards that were actually dealt.
 *
 * Because the order is fixed at commit time, the engine cannot react to who is
 * winning: any change to the deck would break the hash check.
 */
import type { Card } from '../cards/card';
import { cardToString } from '../cards/card';
import { cryptoRandomBytes, HashStream } from './rng';
import { sha256Hex, sha256HexWebCrypto, toHex } from './sha256';
import { fisherYates } from './shuffle';

export interface FairnessCommit {
  /** SHA-256 of the server seed, published before any card is dealt. */
  commit: string;
  clientSeed: string;
  nonce: number;
  decks: number;
}

export interface FairnessReveal extends FairnessCommit {
  serverSeed: string;
  /** Full deck order (top of deck first). */
  order: Card[];
  /** Cards dealt from the top, in dealing order (including burns). */
  dealt: Card[];
}

export function newServerSeed(): string {
  return toHex(cryptoRandomBytes(32));
}

export function newClientSeed(): string {
  return toHex(cryptoRandomBytes(8));
}

export const commitFor = (serverSeed: string): string => sha256Hex(serverSeed);

/** Deterministic deck order for a seed triple. `decks` copies of 0..51, top first. */
export function deriveOrder(serverSeed: string, clientSeed: string, nonce: number, decks = 1): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) for (let c = 0; c < 52; c++) cards.push(c);
  return fisherYates(cards, new HashStream(`${serverSeed}:${clientSeed}:${nonce}`));
}

/**
 * The only object that ever holds a live deck. Engines keep it private and
 * hand out cards one at a time. The order is fixed in the constructor and can
 * never be modified afterwards; `reveal()` is refused until the engine marks
 * the hand/shoe finished.
 */
export class FairDeck {
  readonly info: FairnessCommit;
  readonly size: number;
  readonly #serverSeed: string;
  readonly #order: readonly Card[];
  #pos = 0;
  #finished = false;

  constructor(opts: { clientSeed: string; nonce: number; decks?: number; serverSeed?: string }) {
    const decks = opts.decks ?? 1;
    this.#serverSeed = opts.serverSeed ?? newServerSeed();
    this.#order = Object.freeze(deriveOrder(this.#serverSeed, opts.clientSeed, opts.nonce, decks));
    this.size = this.#order.length;
    this.info = Object.freeze({ commit: commitFor(this.#serverSeed), clientSeed: opts.clientSeed, nonce: opts.nonce, decks });
  }

  draw(): Card {
    if (this.#finished) throw new Error('deck already revealed');
    if (this.#pos >= this.#order.length) throw new Error('deck exhausted');
    return this.#order[this.#pos++];
  }

  get dealtCount(): number {
    return this.#pos;
  }

  get remaining(): number {
    return this.#order.length - this.#pos;
  }

  finish(): FairnessReveal {
    this.#finished = true;
    return {
      ...this.info,
      serverSeed: this.#serverSeed,
      order: [...this.#order],
      dealt: this.#order.slice(0, this.#pos),
    };
  }
}

export interface VerifyReport {
  hashOk: boolean;
  orderOk: boolean;
  dealtOk: boolean;
  /** WebCrypto second opinion: true/false, or null when unavailable. */
  webCryptoOk: boolean | null;
  firstMismatch: number | null;
  ok: boolean;
  details: string[];
}

/**
 * Checks a reveal end to end. `observed` is the list of cards the player
 * actually saw dealt (from the game log, in dealing order); it must be a
 * prefix of the recomputed order. Pass `observedPositions` when only some
 * deck positions were seen (e.g. opponents' mucked cards are unknown).
 */
export async function verifyReveal(
  r: FairnessReveal,
  observed: readonly Card[] = r.dealt,
  observedPositions?: readonly number[],
): Promise<VerifyReport> {
  const details: string[] = [];
  const hash = sha256Hex(r.serverSeed);
  const hashOk = hash === r.commit;
  details.push(`SHA-256(serverSeed) = ${hash} ${hashOk ? '= commit' : '!= commit ' + r.commit}`);
  const wc = await sha256HexWebCrypto(r.serverSeed);
  const webCryptoOk = wc === null ? null : wc === r.commit;
  if (wc !== null) details.push(`WebCrypto agrees: ${webCryptoOk ? 'yes' : 'NO'}`);

  const order = deriveOrder(r.serverSeed, r.clientSeed, r.nonce, r.decks);
  const orderOk = order.length === r.order.length && order.every((c, i) => c === r.order[i]);
  details.push(orderOk ? `Recomputed ${order.length}-card order matches the revealed order` : 'Revealed order does NOT match the seed');

  let firstMismatch: number | null = null;
  let mismatchAt = -1;
  observed.forEach((c, k) => {
    const pos = observedPositions ? observedPositions[k] : k;
    if (firstMismatch === null && order[pos] !== c) {
      firstMismatch = pos;
      mismatchAt = k;
    }
  });
  const dealtOk = firstMismatch === null;
  details.push(
    dealtOk
      ? `All ${observed.length} dealt cards match their deck positions`
      : `Dealt card at position ${firstMismatch} is ${cardToString(observed[mismatchAt])}, seed says ${cardToString(order[firstMismatch!])}`,
  );
  return { hashOk, orderOk, dealtOk, webCryptoOk, firstMismatch, ok: hashOk && orderOk && dealtOk && webCryptoOk !== false, details };
}
