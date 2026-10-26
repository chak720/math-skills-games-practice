#!/usr/bin/env node
/**
 * Independent verifier for Quant Trainer's commit–reveal fairness.
 *
 *   node scripts/verify-hand.mjs reveal-xxxxxxxx.json
 *
 * The reveal file is the "Download reveal JSON" output from any poker hand or
 * blackjack shoe. This script shares no code with the app: it uses Node's own
 * SHA-256 and re-implements the documented algorithm from scratch:
 *
 *   1. commit == SHA-256(serverSeed)                      (hex of the ASCII seed)
 *   2. stream block k = SHA-256("serverSeed:clientSeed:nonce:k"), read as eight
 *      big-endian uint32 words, k = 0, 1, 2, …
 *   3. j = uniform integer in [0, i] by rejection sampling: reject x ≥ ⌊2³²/n⌋·n,
 *      then j = x mod n (n = i + 1)
 *   4. Fisher–Yates from the last position down over `decks` copies of 0..51
 *   5. card = rank·4 + suit, ranks 2..A = 0..12, suits c d h s = 0..3
 *
 * It then checks that the revealed order and the dealt cards match.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest();

export function stream(key) {
  let block = null, word = 8, counter = 0;
  return () => {
    if (word >= 8) {
      block = sha256(`${key}:${counter++}`);
      word = 0;
    }
    return block.readUInt32BE(4 * word++);
  };
}

export function uniformInt(next, n) {
  if (n === 1) return 0;
  const limit = Math.floor(0x100000000 / n) * n;
  let x = next();
  while (x >= limit) x = next();
  return x % n;
}

export function deriveOrder(serverSeed, clientSeed, nonce, decks = 1) {
  const a = [];
  for (let d = 0; d < decks; d++) for (let c = 0; c < 52; c++) a.push(c);
  const next = stream(`${serverSeed}:${clientSeed}:${nonce}`);
  for (let i = a.length - 1; i > 0; i--) {
    const j = uniformInt(next, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const cardName = (c) => '23456789TJQKA'[c >> 2] + 'cdhs'[c & 3];

export function verify(r) {
  const lines = [];
  const hash = createHash('sha256').update(r.serverSeed, 'utf8').digest('hex');
  const hashOk = hash === r.commit;
  lines.push(`${hashOk ? 'PASS' : 'FAIL'}  SHA-256(serverSeed) = ${hash}${hashOk ? '' : `, but the commit was ${r.commit}`}`);
  const order = deriveOrder(r.serverSeed, r.clientSeed, r.nonce, r.decks ?? 1);
  const orderOk = Array.isArray(r.order) && order.length === r.order.length && order.every((c, i) => c === r.order[i]);
  lines.push(`${orderOk ? 'PASS' : 'FAIL'}  recomputed ${order.length}-card order ${orderOk ? 'matches' : 'does not match'} the revealed order`);
  const dealt = r.dealt ?? [];
  const bad = dealt.findIndex((c, i) => order[i] !== c);
  const dealtOk = bad === -1;
  lines.push(`${dealtOk ? 'PASS' : 'FAIL'}  ${dealt.length} dealt cards ${dealtOk ? 'are the top of the deck, in order' : `differ at position ${bad + 1}: dealt ${cardName(dealt[bad])}, deck has ${cardName(order[bad])}`}`);
  lines.push(`      first cards: ${order.slice(0, Math.min(12, order.length)).map(cardName).join(' ')}`);
  return { ok: hashOk && orderOk && dealtOk, lines };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/verify-hand.mjs <reveal.json>');
    process.exit(2);
  }
  const { ok, lines } = verify(JSON.parse(readFileSync(file, 'utf8')));
  console.log(lines.join('\n'));
  console.log(ok ? '\nVerified: this deal was fixed before the hand and not altered.' : '\nNOT verified.');
  process.exit(ok ? 0 : 1);
}
