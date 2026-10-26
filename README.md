# Quant Trainer

An offline training site for quant-trading interview preparation: poker, blackjack, mental maths, generated puzzles, sequences, Fermi estimation, market making, bet sizing, mock interviews and a progress dashboard. It is a static Vite + React + TypeScript app with no backend; everything runs and is stored in your browser.

## Running it

Requires Node 18 or newer.

```bash
npm install          # .npmrc sets legacy-peer-deps
npm run dev          # http://localhost:5173 (open this URL; the repo's index.html is source, not the app)
npm test             # the full Vitest suite
npm run typecheck    # strict TypeScript
npm run build        # type-check, then build dist/index.html
npm run preview      # serve dist/ locally
```

`npm run build` produces one self-contained file, `dist/index.html` (about 1.3 MB). Scripts, styles, fonts and the Web Workers are all inlined, so you can double-click it to open it straight from disk, copy it anywhere, or put it on any static host. (Browsers refuse to load separate script files from `file://` pages, which is why it is a single file.) Served over http(s), a small service worker (`dist/sw.js`) caches the page, so it keeps working without a network after the first visit.

**GitHub Pages:** `.github/workflows/pages.yml` builds the app and publishes it on every push. In the repository's Settings → Pages, set **Source** to **GitHub Actions**. With "Deploy from a branch" instead, Pages serves the source `index.html`, which is blank.

Heavy work (bots, equity, blackjack EVs, puzzle generation) runs in Web Workers. If a browser will not start them, the same code runs on the main thread instead.

## What's inside

| Section | What you do |
| --- | --- |
| Poker | No-limit hold'em against 28 recurring bots with distinct styles; Coach mode checks each decision against the equity maths; hand review and replay; equity calculator; lessons with an opening-range chart and a downswing simulator; six drills with spaced repetition. |
| Blackjack | Configurable rules; exact composition-dependent EV for every option; a basic-strategy chart computed from the rules; Hi-Lo counting with I18/Fab 4 deviations; a counting speed drill. |
| Mental maths | Zetamac-style speed arithmetic, 80-in-8, fractions and percentages, estimation, trading maths, an adaptive mix, and a library of tricks. |
| Puzzles | 40 generators in six categories (probability, combinatorics, EV games, logic, brainteasers, Markov chains). Every answer is computed twice by independent methods, and no puzzle is ever shown twice. |
| Sequences | 15 rule families; each sequence is checked so that no other simple rule continues it differently. Timed sprint and untimed practice. |
| Fermi estimation | A sourced question bank plus parameterised variants; factor-by-factor breakdowns; 90% intervals scored for calibration. |
| Market making | Quote bid/ask on hidden dice, card and coin quantities against noise, informed and arbitrage traders; P&L split into quoting edge and inventory luck. |
| Betting & sizing | A Kelly game scored on expected log growth; a path simulator; risk of ruin (it can use your poker results); lessons. |
| Interview simulator | Four timed formats mixing all of the above, with a scorecard. |
| Progress | Today's ~20-minute session, leaks found in your history, trends, an activity calendar, and export/import. |

## Folder structure

```
src/
  shared/
    cards/          card encoding (card = rank·4 + suit)
    fairness/       SHA-256, hash-based RNG, Fisher–Yates, commit–reveal, χ² tests
    math/           exact rationals, combinatorics, special functions, linear algebra, stats
    random/         seeded PRNG for non-card content (puzzles, scenarios)
    storage/        versioned localStorage store with export/import
    srs/            SM-2 spaced repetition keyed by skill
    stats/          activity log: attempts, sessions, per-skill and per-day aggregates
  games/
    poker/          evaluator, engine (side pots, all-in rules), ranges, equity, bots, coach, drills
    blackjack/      rules, exact EV, strategy chart, engine, counting, table players
  training/
    maths/  puzzles/  sequences/  fermi/  market-making/  betting/  interview/  progress/
  workers/          worker entry points and their APIs (with main-thread fallback)
  ui/               router, layout, shared components, charts and one folder per section
scripts/
  verify-hand.mjs   standalone fairness verifier (no app code)
```

## How fairness works

The rule for every card game here is simple: nothing is rigged, and you can check it.

**Shuffling.** Decks are shuffled with Fisher–Yates (Durstenfeld). Each swap index comes from `uniformInt`, which uses rejection sampling: draw a 32-bit word x, reject it if x ≥ ⌊2³²/n⌋·n, otherwise take x mod n. Every index is exactly uniform, so every permutation is equally likely. `Math.random` is never used for cards; a test scans the card, fairness and game folders and fails if it appears.

**Commit–reveal.** Before each poker hand or blackjack shoe:

1. A 32-byte server seed is drawn from `crypto.getRandomValues`.
2. Its SHA-256 hash (the *commit*) is shown on screen before any card is dealt.
3. The deck order is a pure function of `(serverSeed, clientSeed, nonce)`. The client seed is yours to change in Settings, and the nonce makes each hand distinct. The random stream is block *k* = SHA-256(`"serverSeed:clientSeed:nonce:k"`), read as eight big-endian 32-bit words.
4. The whole order is fixed when the deck is created and lives in a private field. Engines can only draw from the top.
5. After the hand, the server seed, the full deck order and the dealt cards are revealed.

Because the order is committed before play, the game cannot react to who is winning without breaking the hash.

**No peeking.** Bots and the blackjack dealer act only on a `PlayerView`: your hole cards are never in a bot's view, and bots run in a separate Web Worker that receives structured-cloned views and nothing else. Tests check that bot modules cannot import the engine or deck, and that no bot view ever contains another player's hidden cards. There is no adaptive difficulty that touches the cards: bots adapt to your *play*, never to the deck.

**Statistics.** The Fairness lab runs a χ² test of card-by-position uniformity over many production shuffles (df = (n−1)²), shows the residual heatmap, and lets you run the same test on a deliberately biased "naive" shuffle to watch it fail.

## Verifying a hand

You can check any hand three ways.

1. **In the app.** After a poker hand press **Verify deck** (also available for every hand in Hand review); after a blackjack shoe the verification panel appears below the table. The app recomputes SHA-256 of the revealed seed (also cross-checked with the browser's WebCrypto), re-derives the full deck order, and confirms every card you saw came from the right position.
2. **In the Fairness lab.** Press **Download reveal JSON** on any hand, then paste the file into the Fairness lab's verifier.
3. **Outside the app.** `scripts/verify-hand.mjs` re-implements the algorithm with Node's own `crypto` and shares no code with the app:

   ```bash
   npm run verify-hand -- reveal-1a2b3c4d.json
   # PASS  SHA-256(serverSeed) = 5ce8…7258
   # PASS  recomputed 52-card order matches the revealed order
   # PASS  11 dealt cards are the top of the deck, in order
   ```

   It exits with status 0 only if all three checks pass. To verify by hand in any language, apply the five steps documented at the top of the script.

## Puzzles: how they never repeat

Each puzzle comes from a **generator** that:

- draws parameters;
- renders a fresh wording;
- solves the problem with the textbook method (with worked steps);
- re-solves it with an independent method, such as brute-force enumeration, exact simulation, a different algorithm, or exact linear algebra over the rationals.

A puzzle is only shown if the two answers agree. Each shown puzzle gets a fingerprint: generator id plus a SHA-256 of its canonical parameters. Wording-only fields (`ctx`, `device`, `names`, `flavour`) are ignored, so the same numbers told as a different story still count as seen. Fingerprints are stored, and a seen fingerprint is never generated again.

On top of that, the scheduler:

- avoids the *structure* of your last six puzzles;
- rotates categories and generators;
- schedules review by technique with spaced repetition (missed techniques come back sooner);
- adapts the difficulty tier per category.

### Adding a puzzle generator

1. Create or extend a file in `src/training/puzzles/generators/` and implement `Generator<P>` from `src/training/puzzles/types.ts`:

   ```ts
   interface P { n: number; k: number }

   export const myGenerator: Generator<P> = {
     id: 'my-generator',                    // unique and stable: it is part of the fingerprint
     category: 'probability',
     title: 'Short name shown after solving',
     techniques: ['complement'],            // keys of TECHNIQUES in techniques.ts
     tiers: ['warmup', 'interview', 'hard'],
     params: (rng, tier) => ({ n: rng.range(3, tier === 'hard' ? 12 : 6), k: rng.range(1, 3) }),
     structure: (p) => `my:${p.k}`,         // equal keys = "the same puzzle in disguise"
     render: (p) => ({ prompt: `…uses ${p.n} and ${p.k}…`, ask: 'Give the exact probability.' }),
     solve: (p) => ({ answer: R(q(1, p.n)), steps: ['Step one…', 'Step two…'] }),
     verify: (p) => R(bruteForce(p)),       // a genuinely different method
     hints: () => ['Nudge', 'Approach', 'Nearly there'],
     verifiedBy: 'enumerating every outcome',
   };
   ```

   Use exact answers (`R(Q)` for rationals, `I(n)` for integers) wherever possible. Choice and set answers are supported too.
2. Add it to the category's exported array, which `registry.ts` collects.
3. Run `npx vitest run src/training/puzzles`. The suite draws 25 parameter sets per tier and checks that solver and verifier agree. It also checks that the rendered text, hints and steps exist, that the shown answer passes the answer checker, and that the generator produces enough distinct fingerprints.

## Your data

Everything is stored in `localStorage` under keys prefixed `qt.v1.`; nothing leaves your browser. Use **Progress → Data** (or **Settings**) to export a JSON file, import it in another browser, or reset everything.

## Tests

`npm test` runs about 200 tests:

- the 7-card evaluator against every hand class and textbook category counts;
- engine rules (all-in reopening, short blinds, side pots against a reference, odd chips, showdown order);
- bot information isolation;
- blackjack EVs and the computed chart against the published chart;
- shuffle uniformity, with χ² catching a biased shuffle;
- the standalone verifier agreeing with the app;
- every puzzle generator's solver against its verifier;
- sequence ambiguity, Fermi scoring, Kelly optimality, market fair values against simulation, leak detection and the daily plan.

## Known approximations

- Preflop ranges come from this app's own hand ordering and approximate standard 6-max charts; they are labelled as approximate wherever they are shown.
- Bots are designed to play like recognisable human types, not like a solver.
- Fermi bank answers are rounded published figures with their sources noted. Scoring is in log space, so small uncertainties in a reference barely change a score.
