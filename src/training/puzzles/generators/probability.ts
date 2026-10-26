/** Probability puzzle generators. Each has a textbook solver and an independent verifier. */
import { Q, q } from '@/shared/math/rational';
import { choose, factorial } from '@/shared/math/combinatorics';
import { solveLinear, clipHalfPlane, area, type Pt } from '@/shared/math/linalg';
import type { Generator, Tier } from '../types';
import { R, fq, words, ord } from '../util';

// ------------------------------------------------------------------ dice sums

interface DiceSumP { k: number; n: number; kind: 'eq' | 'ge' | 'le'; s: number; device: number }

const diceWays = (k: number, n: number): bigint[] => {
  let ways: bigint[] = [1n];
  for (let d = 0; d < k; d++) {
    const next = new Array<bigint>(ways.length + n).fill(0n);
    ways.forEach((w, s) => {
      if (w) for (let f = 1; f <= n; f++) next[s + f] += w;
    });
    ways = next;
  }
  return ways;
};

const favourable = (ways: bigint[], kind: DiceSumP['kind'], s: number): bigint =>
  ways.reduce((a, w, t) => a + ((kind === 'eq' ? t === s : kind === 'ge' ? t >= s : t <= s) ? w : 0n), 0n);

export const diceSum: Generator<DiceSumP> = {
  id: 'dice-sum',
  category: 'probability',
  title: 'Sums of dice',
  techniques: ['convolution', 'counting'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const k = tier === 'warmup' ? 2 : tier === 'interview' ? r.range(3, 4) : r.range(4, 5);
    const n = tier === 'warmup' ? r.pick([6, 4, 8]) : tier === 'interview' ? r.pick([4, 6, 8]) : r.pick([6, 8, 10, 12]);
    const kind = r.pick(['eq', 'ge', 'le'] as const);
    // Avoid trivial targets (probability 0 or 1) and the extreme tails.
    const s = r.range(k + 1, k * n - 1);
    return { k, n, kind, s, device: r.int(3) };
  },
  structure: (p) => `dice-sum:k${p.k}:${p.kind}`,
  render(p) {
    const what = [`${words(p.k)} fair ${p.n}-sided dice (faces 1 to ${p.n})`, `${words(p.k)} spinners, each with ${p.n} equal sectors numbered 1 to ${p.n}`, `a fair ${p.n}-sided die ${p.k === 2 ? 'twice' : `${words(p.k)} times`}`][p.device];
    const verb = p.device === 2 ? 'You roll' : p.device === 1 ? 'You spin' : 'You roll';
    const cond = p.kind === 'eq' ? `exactly ${p.s}` : p.kind === 'ge' ? `at least ${p.s}` : `at most ${p.s}`;
    return { prompt: `${verb} ${what}. What is the probability that the total is ${cond}?`, ask: 'Give the probability as a fraction.' };
  },
  solve(p) {
    const ways = diceWays(p.k, p.n);
    const fav = favourable(ways, p.kind, p.s);
    const total = BigInt(p.n) ** BigInt(p.k);
    const steps = [
      `All ${p.n}^${p.k} = ${total} ordered outcomes are equally likely, so P = (number of favourable outcomes) / ${total}.`,
      `Count sums with a generating function: the number of ways to roll total t is the coefficient of x^t in (x + x² + … + x^${p.n})^${p.k}. Equivalently, add one die at a time: ways_j(t) = Σ_{f=1}^{${p.n}} ways_{j−1}(t − f).`,
    ];
    if (p.kind !== 'eq') steps.push(`It is quicker to count the ${p.kind === 'ge' ? 'smaller' : 'larger'} side if it is shorter, using symmetry: totals t and ${p.k * (p.n + 1)} − t are equally likely (replace each face f by ${p.n + 1} − f).`);
    steps.push(`Favourable outcomes: ${fav}. So P = ${fav}/${total} = ${fq(new Q(fav, total))}.`);
    return { answer: R(new Q(fav, total)), steps };
  },
  verify(p) {
    // Brute force over every outcome.
    let fav = 0, total = 0;
    const rec = (d: number, sum: number): void => {
      if (d === p.k) {
        total++;
        if (p.kind === 'eq' ? sum === p.s : p.kind === 'ge' ? sum >= p.s : sum <= p.s) fav++;
        return;
      }
      for (let f = 1; f <= p.n; f++) rec(d + 1, sum + f);
    };
    rec(0, 0);
    return R(q(fav, total));
  },
  hints: (p) => [
    `There are ${p.n}^${p.k} equally likely outcomes. Count the favourable ones.`,
    'Build the distribution of the total one die at a time: the ways to reach t with j dice is a sum of ways to reach t − f with j − 1 dice.',
    `Use the symmetry t ↔ ${p.k * (p.n + 1)} − t to count whichever tail is shorter, then divide by ${BigInt(p.n) ** BigInt(p.k)}.`,
  ],
  verifiedBy: 'brute-force enumeration of every outcome',
};

// ------------------------------------------------------------------ binomial "at least"

interface BinomP { n: number; m: number; pn: number; pd: number; kind: 'atleast' | 'exactly' | 'atmost'; ctx: number }

const CTX_BINOM = [
  (n: number, p: string) => `A basketball player makes each free throw independently with probability ${p}. They take ${n} free throws.`,
  (n: number, p: string) => `Each of ${n} independent servers fails during the night with probability ${p}.`,
  (n: number, p: string) => `A biased coin lands heads with probability ${p}. You flip it ${n} times.`,
  (n: number, p: string) => `A trader's limit order fills on any given day with probability ${p}, independently. They place it on ${n} days.`,
];
const CTX_BINOM_EVENT = ['made shots', 'failed servers', 'heads', 'fills'];

export const binomial: Generator<BinomP> = {
  id: 'binomial',
  category: 'probability',
  title: 'Repeated independent trials',
  techniques: ['binomial', 'complement'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const [pn, pd] = r.pick(tier === 'warmup' ? [[1, 2], [1, 6], [1, 4], [1, 3]] : [[1, 3], [2, 5], [3, 4], [1, 4], [1, 5], [2, 3], [1, 10]]);
    const n = tier === 'warmup' ? r.range(3, 6) : tier === 'interview' ? r.range(5, 9) : r.range(8, 14);
    const kind = tier === 'warmup' ? 'atleast' : r.pick(['atleast', 'exactly', 'atmost'] as const);
    const m = tier === 'warmup' ? 1 : r.range(2, Math.max(2, Math.min(n - 1, tier === 'hard' ? 5 : 3)));
    return { n, m, pn, pd, kind, ctx: r.int(CTX_BINOM.length) };
  },
  structure: (p) => `binomial:${p.kind}:${p.m === 1 ? 'one' : 'many'}`,
  render(p) {
    const ps = `${p.pn}/${p.pd}`;
    const ev = CTX_BINOM_EVENT[p.ctx];
    const cond = p.kind === 'atleast' ? `at least ${p.m}` : p.kind === 'exactly' ? `exactly ${p.m}` : `at most ${p.m}`;
    return { prompt: `${CTX_BINOM[p.ctx](p.n, ps)} What is the probability of ${cond} ${ev}?`, ask: 'Give the exact probability as a fraction.' };
  },
  solve(p) {
    const P = q(p.pn, p.pd), Qn = Q.ONE.sub(P);
    const pmf = (j: number): Q => Q.of(choose(p.n, j)).mul(P.pow(j)).mul(Qn.pow(p.n - j));
    const steps = [`The number of successes X is Binomial(n = ${p.n}, p = ${P}): P(X = j) = C(${p.n}, j)·(${P})^j·(${Qn})^(${p.n} − j).`];
    let ans: Q;
    if (p.kind === 'exactly') {
      ans = pmf(p.m);
      steps.push(`P(X = ${p.m}) = C(${p.n}, ${p.m})·(${P})^${p.m}·(${Qn})^${p.n - p.m} = ${choose(p.n, p.m)} × ${P.pow(p.m)} × ${Qn.pow(p.n - p.m)} = ${fq(ans)}.`);
    } else if (p.kind === 'atleast') {
      let below = Q.ZERO;
      for (let j = 0; j < p.m; j++) below = below.add(pmf(j));
      ans = Q.ONE.sub(below);
      steps.push(`Use the complement: P(X ≥ ${p.m}) = 1 − Σ_{j<${p.m}} P(X = j).`);
      if (p.m === 1) steps.push(`P(X = 0) = (${Qn})^${p.n} = ${Qn.pow(p.n)}, so the answer is 1 − ${Qn.pow(p.n)} = ${fq(ans)}.`);
      else steps.push(`Σ_{j<${p.m}} P(X = j) = ${below}, so P = ${fq(ans)}.`);
    } else {
      let s = Q.ZERO;
      for (let j = 0; j <= p.m; j++) s = s.add(pmf(j));
      ans = s;
      steps.push(`P(X ≤ ${p.m}) = Σ_{j=0}^{${p.m}} P(X = j) = ${fq(ans)}.`);
    }
    return { answer: R(ans), steps };
  },
  verify(p) {
    // Dynamic programming over trials (no binomial formula).
    const P = q(p.pn, p.pd), Qn = Q.ONE.sub(P);
    let dist: Q[] = [Q.ONE];
    for (let t = 0; t < p.n; t++) {
      const next = new Array<Q>(dist.length + 1).fill(Q.ZERO);
      dist.forEach((x, j) => {
        next[j] = next[j].add(x.mul(Qn));
        next[j + 1] = next[j + 1].add(x.mul(P));
      });
      dist = next;
    }
    return R(dist.reduce((a, x, j) => ((p.kind === 'exactly' ? j === p.m : p.kind === 'atleast' ? j >= p.m : j <= p.m) ? a.add(x) : a), Q.ZERO));
  },
  hints: (p) => [
    'The trials are independent with the same success probability: which distribution counts the successes?',
    p.kind === 'atleast' ? 'For "at least", the complement (fewer than that many) usually has fewer terms.' : 'Write P(X = j) for the binomial and add the terms you need.',
    `P(X = j) = C(${p.n}, j)·p^j·(1 − p)^(${p.n} − j) with p = ${p.pn}/${p.pd}.`,
  ],
  verifiedBy: 'dynamic programming over the trials',
};

// ------------------------------------------------------------------ card hands (hypergeometric)

interface CardsP { hand: number; kind: 'suit-exact' | 'aces-atleast1' | 'aces-exact' | 'flush' | 'no-face'; j: number; suit: number }
const SUIT = ['clubs', 'diamonds', 'hearts', 'spades'];

export const cardHands: Generator<CardsP> = {
  id: 'card-hands',
  category: 'probability',
  title: 'Card hands',
  techniques: ['hypergeometric', 'counting', 'complement'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const hand = tier === 'warmup' ? r.pick([2, 3, 4]) : tier === 'interview' ? r.pick([4, 5]) : r.pick([5, 6, 7]);
    const kind = r.pick(tier === 'warmup' ? (['aces-atleast1', 'suit-exact', 'flush'] as const) : (['suit-exact', 'aces-exact', 'flush', 'no-face', 'aces-atleast1'] as const));
    const j = kind === 'suit-exact' ? r.range(1, Math.min(hand, 4)) : kind === 'aces-exact' ? r.range(1, Math.min(hand, 3)) : 0;
    return { hand, kind, j, suit: r.int(4) };
  },
  structure: (p) => `cards:${p.kind}`,
  render(p) {
    const base = `You are dealt ${words(p.hand)} cards from a well-shuffled standard 52-card deck.`;
    const ev = {
      'suit-exact': `exactly ${words(p.j)} of them ${p.j === 1 ? 'is a' : 'are'} ${SUIT[p.suit].slice(0, -1)}${p.j === 1 ? '' : 's'}`,
      'aces-atleast1': 'you hold at least one ace',
      'aces-exact': `you hold exactly ${words(p.j)} ace${p.j === 1 ? '' : 's'}`,
      flush: 'all of the cards are the same suit',
      'no-face': 'none of the cards is a face card (J, Q or K)',
    }[p.kind];
    return { prompt: `${base} What is the probability that ${ev}?`, ask: 'Give the probability as a fraction.' };
  },
  solve(p) {
    const N = 52, k = p.hand;
    const tot = choose(N, k);
    const steps = [`All C(52, ${k}) = ${tot} hands are equally likely (order does not matter).`];
    let fav: bigint;
    switch (p.kind) {
      case 'suit-exact':
        fav = choose(13, p.j) * choose(39, k - p.j);
        steps.push(`Choose which ${p.j} of the 13 ${SUIT[p.suit]} and which ${k - p.j} of the other 39 cards: C(13, ${p.j})·C(39, ${k - p.j}) = ${choose(13, p.j)} × ${choose(39, k - p.j)} = ${fav}.`);
        break;
      case 'aces-exact':
        fav = choose(4, p.j) * choose(48, k - p.j);
        steps.push(`Choose ${p.j} of the 4 aces and ${k - p.j} of the 48 non-aces: C(4, ${p.j})·C(48, ${k - p.j}) = ${fav}.`);
        break;
      case 'aces-atleast1': {
        const none = choose(48, k);
        fav = tot - none;
        steps.push(`Complement: hands with no ace number C(48, ${k}) = ${none}, so hands with at least one ace number ${tot} − ${none} = ${fav}.`);
        break;
      }
      case 'flush':
        fav = 4n * choose(13, k);
        steps.push(`Pick the suit (4 ways) and ${k} of its 13 cards: 4·C(13, ${k}) = ${fav}.`);
        break;
      default:
        fav = choose(40, k);
        steps.push(`There are 12 face cards, so choose all ${k} cards from the other 40: C(40, ${k}) = ${fav}.`);
    }
    const ans = new Q(fav, tot);
    steps.push(`P = ${fav}/${tot} = ${fq(ans)}.`);
    return { answer: R(ans), steps };
  },
  verify(p) {
    // Sequential draws without replacement, tracking counts by category (exact DP, no binomial coefficients).
    const k = p.hand;
    if (p.kind === 'flush') {
      // Probability every subsequent card matches the first card's suit.
      let pr = Q.ONE;
      for (let i = 1; i < k; i++) pr = pr.mul(q(13 - i, 52 - i));
      return R(pr);
    }
    const special = p.kind === 'suit-exact' ? 13 : p.kind === 'no-face' ? 12 : 4;
    const dp = (drawn: number, hits: number, memo = new Map<string, Q>()): Q => {
      if (drawn === k) {
        const ok = p.kind === 'suit-exact' || p.kind === 'aces-exact' ? hits === p.j : p.kind === 'aces-atleast1' ? hits >= 1 : hits === 0;
        return ok ? Q.ONE : Q.ZERO;
      }
      const key = `${drawn},${hits}`;
      const m = memo.get(key);
      if (m) return m;
      const left = 52 - drawn, sp = special - hits;
      const v = q(sp, left).mul(dp(drawn + 1, hits + 1, memo)).add(q(left - sp, left).mul(dp(drawn + 1, hits, memo)));
      memo.set(key, v);
      return v;
    };
    return R(dp(0, 0));
  },
  hints: (p) => [
    'Count unordered hands: every C(52, n) hand is equally likely.',
    p.kind === 'aces-atleast1' ? '"At least one" is easiest through the complement: no aces at all.' : 'Split the deck into the cards you care about and the rest, and choose from each group.',
    'Number of favourable hands = C(special, j)·C(others, n − j); divide by C(52, n).',
  ],
  verifiedBy: 'an exact card-by-card probability recursion',
};

// ------------------------------------------------------------------ urns

interface UrnP { r: number; b: number; k: number; kind: 'exact-red' | 'first-red-at' | 'last-red' | 'same-colour'; i: number; replace: boolean; ctx: number }
const URN_CTX = [
  { box: 'An urn', a: 'red', b: 'blue', thing: 'balls' },
  { box: 'A bag', a: 'green', b: 'white', thing: 'marbles' },
  { box: 'A drawer', a: 'black', b: 'grey', thing: 'socks' },
  { box: 'A jar', a: 'cherry', b: 'lemon', thing: 'sweets' },
];

export const urn: Generator<UrnP> = {
  id: 'urn',
  category: 'probability',
  title: 'Drawing from an urn',
  techniques: ['hypergeometric', 'symmetry', 'conditioning'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const red = r.range(2, tier === 'hard' ? 9 : 6), blue = r.range(2, tier === 'hard' ? 9 : 6);
    const kind = r.pick(tier === 'warmup' ? (['same-colour', 'exact-red'] as const) : (['exact-red', 'first-red-at', 'last-red', 'same-colour'] as const));
    const k = kind === 'exact-red' ? r.range(2, Math.min(4, red + blue - 1)) : 2;
    const i = kind === 'exact-red' ? r.range(1, Math.min(k, red)) : kind === 'first-red-at' ? r.range(2, Math.min(blue + 1, 4)) : 0;
    return { r: red, b: blue, k, kind, i, replace: tier === 'warmup' ? false : r.chance(0.2) && kind !== 'last-red' && kind !== 'first-red-at', ctx: r.int(URN_CTX.length) };
  },
  structure: (p) => `urn:${p.kind}:${p.replace ? 'with' : 'without'}`,
  render(p) {
    const c = URN_CTX[p.ctx];
    const draw = p.replace ? 'one at a time, putting each back before the next draw' : 'one at a time without replacement';
    const base = `${c.box} contains ${p.r} ${c.a} and ${p.b} ${c.b} ${c.thing}. You draw ${draw}.`;
    const ev = {
      'exact-red': `you draw ${words(p.k)} and exactly ${words(p.i)} ${p.i === 1 ? 'is' : 'are'} ${c.a}`,
      'first-red-at': `the first ${c.a} one appears on the ${ord(p.i)} draw`,
      'last-red': `you keep drawing until the ${c.box.toLowerCase().replace(/^an? /, '')} is empty and the very last one is ${c.a}`,
      'same-colour': `your first two draws are the same colour`,
    }[p.kind];
    return { prompt: `${base} What is the probability that ${ev}?`, ask: 'Give the probability as a fraction.' };
  },
  solve(p) {
    const N = p.r + p.b;
    const steps: string[] = [];
    let ans: Q;
    if (p.kind === 'last-red') {
      ans = q(p.r, N);
      steps.push('Symmetry: a uniformly random order of the items puts any particular item last with probability 1/N, so the last item is red with probability (number of red)/N.', `P = ${p.r}/${N}${ans.d !== BigInt(N) ? ` = ${ans}` : ''}. The order you remove them in does not matter.`);
    } else if (p.kind === 'same-colour') {
      if (p.replace) {
        ans = q(p.r * p.r + p.b * p.b, N * N);
        steps.push(`With replacement the draws are independent: P = (${p.r}/${N})² + (${p.b}/${N})² = ${fq(ans)}.`);
      } else {
        ans = q(p.r * (p.r - 1) + p.b * (p.b - 1), N * (N - 1));
        steps.push(`P(both of the first colour) = ${p.r}/${N} × ${p.r - 1}/${N - 1}; P(both of the second colour) = ${p.b}/${N} × ${p.b - 1}/${N - 1}.`, `Add them: P = ${fq(ans)}.`);
      }
    } else if (p.kind === 'first-red-at') {
      let pr = Q.ONE;
      const parts: string[] = [];
      for (let t = 0; t < p.i - 1; t++) {
        pr = pr.mul(q(p.b - t, N - t));
        parts.push(`${p.b - t}/${N - t}`);
      }
      pr = pr.mul(q(p.r, N - (p.i - 1)));
      parts.push(`${p.r}/${N - (p.i - 1)}`);
      ans = pr;
      steps.push(`The first ${p.i - 1} draws must all be the other colour and draw ${p.i} must be the wanted colour. Multiply the conditional probabilities: ${parts.join(' × ')} = ${fq(ans)}.`);
    } else if (p.replace) {
      ans = Q.of(choose(p.k, p.i)).mul(q(p.r, N).pow(p.i)).mul(q(p.b, N).pow(p.k - p.i));
      steps.push(`With replacement each draw is independently the wanted colour with probability ${p.r}/${N}: binomial, P = C(${p.k}, ${p.i})(${p.r}/${N})^${p.i}(${p.b}/${N})^${p.k - p.i} = ${fq(ans)}.`);
    } else {
      ans = new Q(choose(p.r, p.i) * choose(p.b, p.k - p.i), choose(N, p.k));
      steps.push(`Without replacement: hypergeometric. Choose ${p.i} of the ${p.r} and ${p.k - p.i} of the ${p.b}: P = C(${p.r}, ${p.i})C(${p.b}, ${p.k - p.i}) / C(${N}, ${p.k}) = ${choose(p.r, p.i) * choose(p.b, p.k - p.i)}/${choose(N, p.k)} = ${fq(ans)}.`);
    }
    return { answer: R(ans), steps };
  },
  verify(p) {
    // Enumerate draw sequences by remaining counts (exact).
    const N = p.r + p.b;
    const go = (red: number, blue: number, seq: string): Q => {
      const drawn = seq.length;
      const stop = p.kind === 'last-red' ? red + blue === 0 : p.kind === 'same-colour' ? drawn === 2 : p.kind === 'first-red-at' ? drawn === p.i : drawn === p.k;
      if (stop) {
        const reds = [...seq].filter((c) => c === 'r').length;
        const ok =
          p.kind === 'last-red' ? seq.at(-1) === 'r'
          : p.kind === 'same-colour' ? seq[0] === seq[1]
          : p.kind === 'first-red-at' ? seq.indexOf('r') === p.i - 1
          : reds === p.i;
        return ok ? Q.ONE : Q.ZERO;
      }
      const left = p.replace ? N : red + blue;
      const rr = p.replace ? p.r : red, bb = p.replace ? p.b : blue;
      let s = Q.ZERO;
      if (rr > 0) s = s.add(q(rr, left).mul(go(p.replace ? red : red - 1, blue, seq + 'r')));
      if (bb > 0) s = s.add(q(bb, left).mul(go(red, p.replace ? blue : blue - 1, seq + 'b')));
      return s;
    };
    return R(go(p.r, p.b, ''));
  },
  hints: (p) => [
    p.kind === 'last-red' ? 'Do you need to track the whole process? Think about where a particular ball ends up in a random order.' : 'Multiply conditional probabilities draw by draw, or count combinations.',
    p.replace ? 'With replacement the draws are independent.' : 'Without replacement, the counts change after each draw.',
    p.kind === 'last-red' ? 'Every position in a random ordering is equally likely to hold any given ball.' : 'Write down the probability of each draw given the earlier ones and multiply.',
  ],
  verifiedBy: 'exhaustive enumeration of draw sequences',
};

// ------------------------------------------------------------------ Bayes

interface BayesP { kind: 'test' | 'coin'; prior: [number, number]; sens: [number, number]; fpr: [number, number]; tests: number; ctx: number; coins: number; bias: [number, number]; flips: number }
const BAYES_CTX = [
  { cond: 'has a rare disease', test: 'a screening test', pos: 'tests positive', who: 'a randomly chosen person' },
  { cond: 'is fraudulent', test: 'a fraud detector', pos: 'is flagged', who: 'a random transaction' },
  { cond: 'is defective', test: 'an inspection machine', pos: 'is rejected', who: 'a random widget' },
  { cond: 'is spam', test: 'a spam filter', pos: 'is marked as spam', who: 'a random email' },
];

export const bayes: Generator<BayesP> = {
  id: 'bayes',
  category: 'probability',
  title: "Bayes' rule",
  techniques: ['bayes', 'conditioning'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const kind = r.chance(tier === 'warmup' ? 0.4 : 0.5) ? 'coin' : 'test';
    return {
      kind,
      prior: r.pick([[1, 100], [1, 50], [1, 20], [1, 10], [1, 1000], [3, 100]]) as [number, number],
      sens: r.pick([[9, 10], [19, 20], [99, 100], [4, 5]]) as [number, number],
      fpr: r.pick([[1, 10], [1, 20], [1, 100], [1, 50], [2, 25]]) as [number, number],
      tests: tier === 'hard' && kind === 'test' ? 2 : 1,
      ctx: r.int(BAYES_CTX.length),
      coins: r.range(2, tier === 'warmup' ? 3 : 10),
      bias: r.pick([[1, 1], [3, 4], [2, 3], [4, 5], [9, 10]]) as [number, number],
      flips: r.range(2, tier === 'warmup' ? 3 : 5),
    };
  },
  structure: (p) => `bayes:${p.kind}:${p.tests}`,
  render(p) {
    if (p.kind === 'coin') {
      const biasTxt = p.bias[0] === p.bias[1] ? 'a double-headed coin' : `a biased coin that lands heads with probability ${p.bias[0]}/${p.bias[1]}`;
      return { prompt: `A jar holds ${p.coins} coins: ${p.coins - 1} fair coin${p.coins > 2 ? 's' : ''} and ${biasTxt}. You pick one at random and flip it ${words(p.flips)} times; it lands heads every time. What is the probability you picked the special coin?`, ask: 'Give the probability as a fraction.' };
    }
    const c = BAYES_CTX[p.ctx];
    const twice = p.tests === 2 ? ` It is checked twice with independent runs of the same test and ${c.pos.replace('is ', '')} both times.` : ` It ${c.pos}.`;
    return {
      prompt: `${p.prior[0]} in ${p.prior[1]} items ${c.cond.replace('has', 'have').replace('is', 'are')} in this population. ${c.test[0].toUpperCase()}${c.test.slice(1)} catches a true case with probability ${p.sens[0]}/${p.sens[1]} and wrongly triggers on a clean case with probability ${p.fpr[0]}/${p.fpr[1]}. Take ${c.who}.${twice} What is the probability it really ${c.cond}?`,
      ask: 'Give the probability as a fraction.',
    };
  },
  solve(p) {
    if (p.kind === 'coin') {
      const prior = q(1, p.coins), b = q(p.bias[0], p.bias[1]);
      const lb = b.pow(p.flips), lf = q(1, 2).pow(p.flips);
      const num = prior.mul(lb), den = num.add(Q.ONE.sub(prior).mul(lf));
      const ans = num.div(den);
      return {
        answer: R(ans),
        steps: [
          `Prior: P(special) = 1/${p.coins}. Likelihood of ${p.flips} heads: special ${b}^${p.flips} = ${lb}; fair (1/2)^${p.flips} = ${lf}.`,
          `Bayes: P(special | all heads) = (1/${p.coins})·${lb} / [(1/${p.coins})·${lb} + (${p.coins - 1}/${p.coins})·${lf}] = ${fq(ans)}.`,
          `In odds form: prior odds 1 : ${p.coins - 1} times likelihood ratio ${lb.div(lf)} gives posterior odds ${lb.div(lf)} : ${p.coins - 1}.`,
        ],
      };
    }
    const prior = q(...p.prior), s = q(...p.sens), f = q(...p.fpr);
    const ls = s.pow(p.tests), lf = f.pow(p.tests);
    const num = prior.mul(ls), den = num.add(Q.ONE.sub(prior).mul(lf));
    const ans = num.div(den);
    const N = 100000;
    return {
      answer: R(ans),
      steps: [
        `Let H = really positive, E = the evidence. P(H) = ${prior}, P(E | H) = ${ls}${p.tests === 2 ? ' (both runs)' : ''}, P(E | ¬H) = ${lf}.`,
        `Bayes: P(H | E) = P(E | H)P(H) / [P(E | H)P(H) + P(E | ¬H)P(¬H)] = ${num} / ${den} = ${fq(ans)}.`,
        `Natural frequencies: in ${N.toLocaleString()} items, about ${prior.mul(N).mul(ls).toNumber().toFixed(1)} true cases trigger versus ${Q.ONE.sub(prior).mul(N).mul(lf).toNumber().toFixed(1)} false alarms.`,
      ],
    };
  },
  verify(p) {
    // Enumerate a joint table: each world with its probability, then condition on the evidence.
    if (p.kind === 'coin') {
      let ev = Q.ZERO, both = Q.ZERO;
      for (let c = 0; c < p.coins; c++) {
        const ph = c === 0 ? q(p.bias[0], p.bias[1]) : q(1, 2);
        // enumerate flip sequences; only all-heads counts
        for (let m = 0; m < 1 << p.flips; m++) {
          let pr = q(1, p.coins);
          for (let t = 0; t < p.flips; t++) pr = pr.mul((m >> t) & 1 ? ph : Q.ONE.sub(ph));
          if (m === (1 << p.flips) - 1) {
            ev = ev.add(pr);
            if (c === 0) both = both.add(pr);
          }
        }
      }
      return R(both.div(ev));
    }
    const prior = q(...p.prior), s = q(...p.sens), f = q(...p.fpr);
    let ev = Q.ZERO, both = Q.ZERO;
    for (const h of [true, false])
      for (let m = 0; m < 1 << p.tests; m++) {
        let pr = h ? prior : Q.ONE.sub(prior);
        let allPos = true;
        for (let t = 0; t < p.tests; t++) {
          const pos = ((m >> t) & 1) === 1;
          const pp = h ? s : f;
          pr = pr.mul(pos ? pp : Q.ONE.sub(pp));
          allPos &&= pos;
        }
        if (allPos) {
          ev = ev.add(pr);
          if (h) both = both.add(pr);
        }
      }
    return R(both.div(ev));
  },
  hints: (p) => [
    'Start from the prior: how likely is the hypothesis before seeing anything?',
    p.kind === 'coin' ? 'Compare how likely the observed flips are under each coin.' : 'Imagine a population of 100,000 and count the true and false positives.',
    'P(H | E) = P(E | H)P(H) / P(E), with P(E) summed over both possibilities.',
  ],
  verifiedBy: 'enumerating the full joint probability table',
};

// ------------------------------------------------------------------ waiting for a pattern

interface PatternP { pattern: string; pn: number; pd: number; ctx: number }
const PATTERN_CTX = [
  { h: 'H', t: 'T', trial: 'flip a coin', what: (pn: number, pd: number) => (pn * 2 === pd ? 'a fair coin' : `a coin that lands heads with probability ${pn}/${pd}`), sym: { H: 'heads', T: 'tails' } },
  { h: 'S', t: 'N', trial: 'roll a die', what: () => 'a fair die', sym: { H: 'a six', T: 'a non-six' } },
];

/** KMP automaton transition: longest prefix of `pat` that is a suffix of `s`. */
function advance(pat: string, s: string): number {
  for (let k = Math.min(pat.length, s.length); k >= 0; k--) if (s.endsWith(pat.slice(0, k))) return k;
  return 0;
}

export const patternWait: Generator<PatternP> = {
  id: 'pattern-wait',
  category: 'probability',
  title: 'Waiting for a pattern',
  techniques: ['first-step', 'pattern-overlap', 'markov'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const ctx = r.chance(0.3) ? 1 : 0;
    const len = tier === 'warmup' ? 2 : tier === 'interview' ? r.pick([2, 3]) : r.pick([3, 4]);
    let pattern = '';
    for (let i = 0; i < len; i++) pattern += r.chance(0.5) ? 'H' : 'T';
    if (ctx === 1 && !pattern.includes('H')) pattern = 'H' + pattern.slice(1);
    const [pn, pd] = ctx === 1 ? [1, 6] : tier === 'hard' && r.chance(0.5) ? r.pick([[1, 3], [2, 3], [3, 4]]) : [1, 2];
    return { pattern, pn, pd, ctx };
  },
  structure: (p) => `pattern:${p.pattern.length}:${p.pn * 2 === p.pd ? 'fair' : 'biased'}`,
  render(p) {
    const c = PATTERN_CTX[p.ctx];
    const seq = [...p.pattern].map((x) => (x === 'H' ? c.sym.H : c.sym.T)).join(', then ');
    const short = [...p.pattern].map((x) => (x === 'H' ? c.h : c.t)).join('');
    return { prompt: `You repeatedly ${c.trial} (${c.what(p.pn, p.pd)}) until you first see ${seq} on consecutive ${p.ctx === 0 ? 'flips' : 'rolls'} (pattern ${short}). What is the expected number of ${p.ctx === 0 ? 'flips' : 'rolls'}?`, ask: 'Give the exact expected value.' };
  },
  solve(p) {
    // First-step analysis on the KMP automaton: state k = length of pattern prefix matched.
    const m = p.pattern.length;
    const P = q(p.pn, p.pd), T = Q.ONE.sub(P);
    // E_k = 1 + P·E_{δ(k,H)} + T·E_{δ(k,T)}, E_m = 0
    const A: Q[][] = [], b: Q[] = [];
    const eqs: string[] = [];
    for (let k = 0; k < m; k++) {
      const row = new Array<Q>(m).fill(Q.ZERO);
      row[k] = Q.ONE;
      const pre = p.pattern.slice(0, k);
      const nh = advance(p.pattern, pre + 'H'), nt = advance(p.pattern, pre + 'T');
      if (nh < m) row[nh] = row[nh].sub(P);
      if (nt < m) row[nt] = row[nt].sub(T);
      A.push(row);
      b.push(Q.ONE);
      eqs.push(`E${k} = 1 + ${P}·${nh === m ? '0' : `E${nh}`} + ${T}·${nt === m ? '0' : `E${nt}`}`);
    }
    const sol = solveLinear(A, b);
    return {
      answer: R(sol[0]),
      steps: [
        `Let E_k be the expected number of further trials when the last k trials match the first k symbols of ${p.pattern} (H = ${PATTERN_CTX[p.ctx].sym.H}, probability ${P}).`,
        'First-step analysis: from each state, one trial moves you to the longest prefix of the pattern that is a suffix of what you have seen.',
        ...eqs,
        `Solving the ${m} linear equations gives E0 = ${fq(sol[0])}.`,
      ],
    };
  },
  verify(p) {
    // Conway / overlap formula: E = Σ over k with prefix_k == suffix_k of 1 / P(prefix_k).
    const P = q(p.pn, p.pd), T = Q.ONE.sub(P);
    let e = Q.ZERO;
    for (let k = 1; k <= p.pattern.length; k++) {
      if (p.pattern.slice(0, k) !== p.pattern.slice(p.pattern.length - k)) continue;
      let pr = Q.ONE;
      for (const c of p.pattern.slice(0, k)) pr = pr.mul(c === 'H' ? P : T);
      e = e.add(pr.inv());
    }
    return R(e);
  },
  hints: (p) => [
    'Track how much of the pattern you have matched so far: that is a Markov chain.',
    'Write E_k = 1 + (weighted E of the next state) for each partial match k and solve.',
    `Shortcut (Conway): E = Σ 1/P(prefix) over prefixes of ${p.pattern} that are also suffixes; overlaps make patterns slower.`,
  ],
  verifiedBy: "Conway's overlap formula (independent of the Markov system)",
};

// ------------------------------------------------------------------ coupon collector

interface CouponP { n: number; k: number; ctx: number }
const COUPON_CTX = [
  (n: number, k: number) => `You roll a fair ${n}-sided die repeatedly. What is the expected number of rolls until ${k === n ? 'every face has appeared at least once' : `${words(k)} different faces have appeared`}?`,
  (n: number, k: number) => `Each cereal box contains one of ${n} toys, equally likely and independently. What is the expected number of boxes you must buy to collect ${k === n ? 'all of them' : `${words(k)} different toys`}?`,
  (n: number, k: number) => `A random number generator outputs integers from 1 to ${n} uniformly. What is the expected number of outputs until ${k === n ? 'all of them have been seen' : `${words(k)} distinct values have been seen`}?`,
];

export const coupon: Generator<CouponP> = {
  id: 'coupon',
  category: 'probability',
  title: 'Coupon collector',
  techniques: ['linearity', 'first-step'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const n = tier === 'warmup' ? r.range(3, 4) : tier === 'interview' ? r.range(4, 8) : r.range(6, 12);
    return { n, k: tier === 'warmup' || r.chance(0.5) ? n : r.range(2, n - 1), ctx: r.int(COUPON_CTX.length) };
  },
  structure: (p) => `coupon:${p.k === p.n ? 'all' : 'some'}`,
  render: (p) => ({ prompt: COUPON_CTX[p.ctx](p.n, p.k), ask: 'Give the exact expected value as a fraction.' }),
  solve(p) {
    let e = Q.ZERO;
    const terms: string[] = [];
    for (let i = 0; i < p.k; i++) {
      e = e.add(q(p.n, p.n - i));
      terms.push(`${p.n}/${p.n - i}`);
    }
    return {
      answer: R(e),
      steps: [
        `Split the wait into stages: after i distinct values have appeared, each new trial is new with probability (${p.n} − i)/${p.n}, so stage i is geometric with mean ${p.n}/(${p.n} − i).`,
        `By linearity of expectation, E = Σ_{i=0}^{${p.k - 1}} ${p.n}/(${p.n} − i) = ${terms.join(' + ')} = ${fq(e)}.`,
      ],
    };
  },
  verify(p) {
    // Markov chain on the number of distinct values seen, solved exactly.
    const A: Q[][] = [], b: Q[] = [];
    for (let i = 0; i < p.k; i++) {
      const row = new Array<Q>(p.k).fill(Q.ZERO);
      row[i] = Q.ONE.sub(q(i, p.n));
      if (i + 1 < p.k) row[i + 1] = q(p.n - i, p.n).neg();
      A.push(row);
      b.push(Q.ONE);
    }
    return R(solveLinear(A, b)[0]);
  },
  hints: () => ['Break the waiting time into stages: waiting for the 1st new value, the 2nd new value, …', 'Each stage is a geometric wait. What is its success probability?', 'Add the stage means by linearity of expectation: Σ n/(n − i).'],
  verifiedBy: 'solving the Markov chain on "number seen so far" exactly',
};

// ------------------------------------------------------------------ geometric probability

interface GeoP { kind: 'meet' | 'close' | 'sum'; T: number; w1: number; w2: number; a: number; b: number; c: number; ctx: number }

export const geometric: Generator<GeoP> = {
  id: 'geometric',
  category: 'probability',
  title: 'Geometric probability',
  techniques: ['geometric'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const kind = r.pick(tier === 'warmup' ? (['close', 'meet'] as const) : (['meet', 'close', 'sum'] as const));
    const T = r.pick([30, 60, 60, 120]);
    const w1 = r.pick([5, 10, 15, 20].filter((x) => x < T));
    const w2 = tier === 'warmup' ? w1 : r.pick([5, 10, 15, 20, 30].filter((x) => x < T));
    const a = r.range(2, 6), b = r.range(2, 6);
    const c = r.range(1, a + b - 1);
    return { kind, T, w1, w2, a, b, c, ctx: r.int(2) };
  },
  structure: (p) => `geo:${p.kind}:${p.w1 === p.w2 ? 'sym' : 'asym'}`,
  render(p) {
    if (p.kind === 'meet')
      return {
        prompt: `Two ${p.ctx ? 'traders' : 'friends'} each arrive at a uniformly random time between 12:00 and ${p.T === 60 ? '13:00' : p.T === 30 ? '12:30' : '14:00'}, independently. The first waits ${p.w1} minutes${p.w1 === p.w2 ? ' (and so does the second)' : `; the second would wait ${p.w2} minutes`}, then leaves. What is the probability they meet?`,
        ask: 'Give the probability as a fraction.',
      };
    if (p.kind === 'close') return { prompt: `Two points are chosen independently and uniformly on a ${p.T} cm stick. What is the probability that they are less than ${p.w1} cm apart?`, ask: 'Give the probability as a fraction.' };
    return { prompt: `X is uniform on [0, ${p.a}] and Y is uniform on [0, ${p.b}], independently. What is P(X + Y < ${p.c})?`, ask: 'Give the probability as a fraction.' };
  },
  solve(p) {
    if (p.kind === 'meet' || p.kind === 'close') {
      const w1 = q(p.w1, p.T), w2 = q(p.kind === 'meet' ? p.w2 : p.w1, p.T);
      // They meet iff −w2 < X − Y < w1 (X first arrival waits w1 if earlier...). Region outside is two corner triangles.
      const ans = Q.ONE.sub(Q.ONE.sub(w1).pow(2).div(2)).sub(Q.ONE.sub(w2).pow(2).div(2));
      return {
        answer: R(ans),
        steps: [
          `Scale time so the window is [0, 1]: arrival times (X, Y) are uniform on the unit square, so probability = area.`,
          p.kind === 'meet' ? `They meet if the later arrival comes within the earlier one's wait: Y − X < ${w1} when X arrives first, X − Y < ${w2} when Y arrives first.` : `They are close if |X − Y| < ${w1}.`,
          `The failing region is two right triangles in opposite corners, with legs 1 − ${w1} and 1 − ${w2}: areas (1 − ${w1})²/2 and (1 − ${w2})²/2.`,
          `P = 1 − (${Q.ONE.sub(w1)})²/2 − (${Q.ONE.sub(w2)})²/2 = ${fq(ans)}.`,
        ],
      };
    }
    const { a, b, c } = p;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    let A: Q;
    if (c <= lo) A = q(c * c, 2);
    else if (c <= hi) A = q(lo * lo, 2).add(q((c - lo) * lo, 1));
    else A = q(a * b, 1).sub(q((a + b - c) * (a + b - c), 2));
    const ans = A.div(a * b);
    return {
      answer: R(ans),
      steps: [
        `(X, Y) is uniform on the ${a} × ${b} rectangle, so P = (area where x + y < ${c}) / ${a * b}.`,
        c <= lo ? `The line x + y = ${c} cuts off a triangle with legs ${c}: area ${c}²/2 = ${q(c * c, 2)}.` : c <= hi ? `The region is a triangle plus a parallelogram strip: ${lo}²/2 + (${c} − ${lo})·${lo} = ${A}.` : `It is easier to subtract the corner triangle where x + y > ${c}: legs ${a + b - c}, so area ${a * b} − ${(a + b - c)}²/2 = ${A}.`,
        `P = ${A}/${a * b} = ${fq(ans)}.`,
      ],
    };
  },
  verify(p) {
    // Exact polygon clipping of the sample region.
    const box = (w: number, h: number): Pt[] => [[Q.ZERO, Q.ZERO], [q(w), Q.ZERO], [q(w), q(h)], [Q.ZERO, q(h)]];
    if (p.kind === 'meet' || p.kind === 'close') {
      const w1 = q(p.w1, p.T), w2 = q(p.kind === 'meet' ? p.w2 : p.w1, p.T);
      let poly = box(1, 1);
      poly = clipHalfPlane(poly, Q.ONE.neg(), Q.ONE, w1); // y − x <= w1
      poly = clipHalfPlane(poly, Q.ONE, Q.ONE.neg(), w2); // x − y <= w2
      return R(area(poly));
    }
    const poly = clipHalfPlane(box(p.a, p.b), Q.ONE, Q.ONE, q(p.c));
    return R(area(poly).div(p.a * p.b));
  },
  hints: (p) => [
    'With independent uniform variables, probability is just area in the square (or rectangle) of possibilities.',
    p.kind === 'sum' ? 'Draw the line x + y = c through the rectangle and find the area below it.' : 'Sketch the band |x − y| small; the failing part is two triangles in the corners.',
    'Compute the area of the simple shapes (triangles), then divide by the total area.',
  ],
  verifiedBy: 'exact polygon clipping and the shoelace area formula',
};

// ------------------------------------------------------------------ linearity: distinct values

interface DistinctP { n: number; k: number; kind: 'distinct' | 'missing' | 'pairs'; ctx: number }

export const distinctValues: Generator<DistinctP> = {
  id: 'distinct-values',
  category: 'probability',
  title: 'Linearity of expectation',
  techniques: ['linearity'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const n = tier === 'warmup' ? r.pick([4, 6]) : r.range(4, 6);
    const k = tier === 'warmup' ? r.range(2, 3) : r.range(3, tier === 'hard' ? 6 : 5);
    return { n, k, kind: r.pick(tier === 'warmup' ? (['distinct', 'missing'] as const) : (['distinct', 'missing', 'pairs'] as const)), ctx: r.int(2) };
  },
  structure: (p) => `linearity:${p.kind}`,
  render(p) {
    const roll = p.ctx === 0 ? `You roll a fair ${p.n}-sided die ${words(p.k)} times.` : `${words(p.k)[0].toUpperCase()}${words(p.k).slice(1)} people each pick a whole number from 1 to ${p.n} uniformly at random, independently.`;
    const q2 = { distinct: `What is the expected number of distinct ${p.ctx === 0 ? 'faces that appear' : 'numbers picked'}?`, missing: `What is the expected number of ${p.ctx === 0 ? 'faces that never appear' : 'numbers nobody picks'}?`, pairs: `What is the expected number of pairs (unordered) that ${p.ctx === 0 ? 'show the same face' : 'pick the same number'}?` }[p.kind];
    return { prompt: `${roll} ${q2}`, ask: 'Give the exact expected value as a fraction.' };
  },
  solve(p) {
    const miss = q(p.n - 1, p.n).pow(p.k);
    if (p.kind === 'pairs') {
      const ans = Q.of(choose(p.k, 2)).mul(q(1, p.n));
      return { answer: R(ans), steps: [`Let I_ij indicate that pair {i, j} matches; P(match) = 1/${p.n}.`, `E[pairs] = Σ E[I_ij] = C(${p.k}, 2) × 1/${p.n} = ${fq(ans)}. No independence is needed.`] };
    }
    const ans = p.kind === 'missing' ? miss.mul(p.n) : Q.ONE.sub(miss).mul(p.n);
    return {
      answer: R(ans),
      steps: [
        `Let I_v indicate that value v ${p.kind === 'missing' ? 'never appears' : 'appears at least once'}. The count is Σ_v I_v, so its expectation is Σ_v P(event for v).`,
        `P(v never appears in ${p.k} independent tries) = (${p.n - 1}/${p.n})^${p.k} = ${miss}.`,
        p.kind === 'missing' ? `E = ${p.n} × ${miss} = ${fq(ans)}.` : `E = ${p.n} × (1 − ${miss}) = ${fq(ans)}.`,
      ],
    };
  },
  verify(p) {
    let total = 0;
    let count = 0;
    const vals = new Array<number>(p.k).fill(0);
    const rec = (i: number): void => {
      if (i === p.k) {
        count++;
        const s = new Set(vals);
        if (p.kind === 'distinct') total += s.size;
        else if (p.kind === 'missing') total += p.n - s.size;
        else for (let a = 0; a < p.k; a++) for (let b = a + 1; b < p.k; b++) if (vals[a] === vals[b]) total++;
        return;
      }
      for (let v = 0; v < p.n; v++) {
        vals[i] = v;
        rec(i + 1);
      }
    };
    rec(0);
    return R(q(total, count));
  },
  hints: (p) => ['Do not try to find the whole distribution.', 'Write the count as a sum of indicator variables, one per value (or pair).', p.kind === 'pairs' ? 'E[sum] = sum of E[indicators]: how many pairs, and how likely is each to match?' : 'P(a given value never appears) = ((n − 1)/n)^k.'],
  verifiedBy: 'brute-force averaging over every outcome',
};

// ------------------------------------------------------------------ derangements

interface DerangeP { n: number; kind: 'exact' | 'atleast1' | 'two-wrong'; j: number; ctx: number }
const DERANGE_CTX = [
  (n: number) => `${words(n)[0].toUpperCase()}${words(n).slice(1)} guests check their hats; the hats are handed back in a uniformly random order.`,
  (n: number) => `${words(n)[0].toUpperCase()}${words(n).slice(1)} letters are put into ${words(n)} addressed envelopes at random.`,
  (n: number) => `${words(n)[0].toUpperCase()}${words(n).slice(1)} colleagues draw names for a gift exchange from a hat containing all ${words(n)} names.`,
];
const DERANGE_PHRASES = [
  { none: 'nobody gets their own hat back', one: 'exactly one guest gets their own hat back', two: 'exactly two guests get their own hats back', some: 'at least one guest gets their own hat back', pair: 'neither Ana nor Ben (two of the guests) gets their own hat back' },
  { none: 'no letter goes into its own envelope', one: 'exactly one letter goes into its own envelope', two: 'exactly two letters go into their own envelopes', some: 'at least one letter goes into its own envelope', pair: 'neither of the first two letters goes into its own envelope' },
  { none: 'nobody draws their own name', one: 'exactly one person draws their own name', two: 'exactly two people draw their own names', some: 'at least one person draws their own name', pair: 'neither Ana nor Ben draws their own name' },
];
const derange = (m: number): bigint => {
  let s = 0n;
  for (let k = 0; k <= m; k++) s += (k % 2 ? -1n : 1n) * (factorial(m) / factorial(k));
  return s;
};

export const derangements: Generator<DerangeP> = {
  id: 'derangements',
  category: 'probability',
  title: 'Matching problems',
  techniques: ['inclusion-exclusion', 'counting'],
  tiers: ['interview', 'hard'],
  params: (r, tier) => {
    const n = tier === 'interview' ? r.range(4, 6) : r.range(5, 8);
    const kind = r.pick(['exact', 'exact', 'atleast1', 'two-wrong'] as const);
    return { n, kind, j: kind === 'exact' ? (tier === 'hard' ? r.range(0, 2) : 0) : 0, ctx: r.int(DERANGE_CTX.length) };
  },
  structure: (p) => `derange:${p.kind}:${p.j ? 'some' : 'none'}`,
  render(p) {
    const ph = DERANGE_PHRASES[p.ctx];
    const ev = p.kind === 'atleast1' ? ph.some : p.kind === 'two-wrong' ? ph.pair : [ph.none, ph.one, ph.two][p.j];
    return { prompt: `${DERANGE_CTX[p.ctx](p.n)} What is the probability that ${ev}?`, ask: 'Give the probability as a fraction.' };
  },
  solve(p) {
    const nf = factorial(p.n);
    if (p.kind === 'two-wrong') {
      // Inclusion–exclusion on A1 = "item 1 fixed", A2 = "item 2 fixed".
      const ans = Q.ONE.sub(q(2, p.n)).add(q(1, p.n * (p.n - 1)));
      return { answer: R(ans), steps: [`Let A₁, A₂ be the events that each of the two named items lands correctly. P(A₁) = P(A₂) = 1/${p.n}, P(A₁ ∩ A₂) = 1/(${p.n}·${p.n - 1}).`, `P(neither) = 1 − P(A₁ ∪ A₂) = 1 − 2/${p.n} + 1/${p.n * (p.n - 1)} = ${fq(ans)}.`] };
    }
    if (p.kind === 'atleast1') {
      const ans = Q.ONE.sub(new Q(derange(p.n), nf));
      return { answer: R(ans), steps: ['Complement of "no fixed points". Count derangements by inclusion–exclusion: !m = Σ (−1)^k m!/k!.', `!${p.n} = ${derange(p.n)}, so P(no match) = ${derange(p.n)}/${nf} and P(at least one) = ${fq(ans)} (close to 1 − 1/e ≈ 0.632).`] };
    }
    const fav = choose(p.n, p.j) * derange(p.n - p.j);
    const ans = new Q(fav, nf);
    return {
      answer: R(ans),
      steps: [
        'Count derangements (no fixed points) by inclusion–exclusion: !m = Σ_{k=0}^{m} (−1)^k m!/k!.',
        p.j ? `Choose the ${p.j} matched ${p.j === 1 ? 'one' : 'ones'} (C(${p.n}, ${p.j}) ways) and derange the other ${p.n - p.j}: C(${p.n}, ${p.j})·!${p.n - p.j} = ${fav}.` : `!${p.n} = ${derange(p.n)}.`,
        `Divide by ${p.n}! = ${nf}: P = ${fq(ans)}.${p.j === 0 ? ' For large n this tends to 1/e ≈ 0.3679.' : ''}`,
      ],
    };
  },
  verify(p) {
    let fav = 0, total = 0;
    const perm = Array.from({ length: p.n }, (_, i) => i);
    const ok = (): boolean => {
      const fixed = perm.filter((x, i) => x === i).length;
      return p.kind === 'atleast1' ? fixed >= 1 : p.kind === 'two-wrong' ? perm[0] !== 0 && perm[1] !== 1 : fixed === p.j;
    };
    const heap = (k: number): void => {
      if (k === 1) {
        total++;
        if (ok()) fav++;
        return;
      }
      heap(k - 1);
      for (let i = 0; i < k - 1; i++) {
        const j = k % 2 === 0 ? i : 0;
        [perm[j], perm[k - 1]] = [perm[k - 1], perm[j]];
        heap(k - 1);
      }
    };
    heap(p.n);
    return R(q(fav, total));
  },
  hints: (p) => [
    p.kind === 'two-wrong' ? 'Work with the complementary events "this item lands correctly".' : 'Count permutations with no fixed points (derangements).',
    'Use inclusion–exclusion over which items land correctly.',
    p.kind === 'two-wrong' ? 'P(A₁ ∪ A₂) = P(A₁) + P(A₂) − P(A₁ ∩ A₂).' : '!m = m!·Σ (−1)^k/k!; for exactly j matches, choose them first.',
  ],
  verifiedBy: 'enumerating every permutation',
};

// ------------------------------------------------------------------ birthday-style

interface BirthdayP { k: number; d: number; ctx: number }

export const birthday: Generator<BirthdayP> = {
  id: 'birthday',
  category: 'probability',
  title: 'Birthday-type collisions',
  techniques: ['complement', 'counting'],
  tiers: ['warmup', 'interview', 'hard'],
  params: (r, tier) => ({ k: tier === 'warmup' ? r.range(3, 4) : r.range(4, 7), d: tier === 'warmup' ? r.pick([6, 8, 10]) : r.range(10, 30), ctx: r.int(3) }),
  structure: () => 'birthday',
  render(p) {
    const ctx = [
      `On a planet with ${p.d} days in a year (all equally likely birthdays), ${words(p.k)} people meet.`,
      `${words(p.k)[0].toUpperCase()}${words(p.k).slice(1)} people each pick a locker uniformly at random from ${p.d} lockers.`,
      `A hash function maps each of ${words(p.k)} keys uniformly and independently to one of ${p.d} buckets.`,
    ][p.ctx];
    const ev = ['at least two share a birthday', 'at least two pick the same locker', 'there is at least one collision'][p.ctx];
    return { prompt: `${ctx} What is the probability that ${ev}?`, ask: 'Give the probability as a fraction.' };
  },
  solve(p) {
    let none = Q.ONE;
    const parts: string[] = [];
    for (let i = 0; i < p.k; i++) {
      none = none.mul(q(p.d - i, p.d));
      parts.push(`${p.d - i}/${p.d}`);
    }
    const ans = Q.ONE.sub(none);
    return { answer: R(ans), steps: [`Complement: P(all different) = ${parts.join(' × ')} = ${none}.`, `So P(at least one collision) = 1 − ${none} = ${fq(ans)}.`] };
  },
  verify(p) {
    // DP on the number of distinct values used so far.
    let dist = new Map<number, Q>([[0, Q.ONE]]);
    for (let i = 0; i < p.k; i++) {
      const next = new Map<number, Q>();
      for (const [u, pr] of dist) {
        next.set(u + 1, (next.get(u + 1) ?? Q.ZERO).add(pr.mul(q(p.d - u, p.d))));
        next.set(u, (next.get(u) ?? Q.ZERO).add(pr.mul(q(u, p.d))));
      }
      dist = next;
    }
    return R(Q.ONE.sub(dist.get(p.k) ?? Q.ZERO));
  },
  hints: () => ['"At least two match" has many cases; its complement has one.', 'Line the people up: the second must avoid one value, the third two values, …', 'P(no match) = Π (d − i)/d.'],
  verifiedBy: 'a dynamic program over the number of distinct values',
};

// ------------------------------------------------------------------ order statistics

interface MaxP { k: number; n: number; kind: 'emax' | 'emin' | 'pmax' ; m: number }

export const maxDice: Generator<MaxP> = {
  id: 'max-dice',
  category: 'probability',
  title: 'Maximum and minimum of dice',
  techniques: ['complement', 'linearity'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const k = tier === 'warmup' ? 2 : r.range(2, tier === 'hard' ? 5 : 3);
    const n = r.pick([4, 6, 8]);
    return { k, n, kind: r.pick(tier === 'warmup' ? (['pmax', 'emax'] as const) : (['emax', 'emin', 'pmax'] as const)), m: r.range(2, n) };
  },
  structure: (p) => `max:${p.kind}`,
  render(p) {
    const roll = `You roll ${words(p.k)} fair ${p.n}-sided dice.`;
    const ask = { emax: 'What is the expected value of the highest roll?', emin: 'What is the expected value of the lowest roll?', pmax: `What is the probability that the highest roll is exactly ${p.m}?` }[p.kind];
    return { prompt: `${roll} ${ask}`, ask: p.kind === 'pmax' ? 'Give the probability as a fraction.' : 'Give the exact expected value as a fraction.' };
  },
  solve(p) {
    const n = p.n, k = p.k;
    if (p.kind === 'pmax') {
      const ans = q(p.m, n).pow(k).sub(q(p.m - 1, n).pow(k));
      return { answer: R(ans), steps: [`P(max ≤ m) = (m/${n})^${k}: every die must be at most m.`, `P(max = ${p.m}) = P(max ≤ ${p.m}) − P(max ≤ ${p.m - 1}) = (${p.m}/${n})^${k} − (${p.m - 1}/${n})^${k} = ${fq(ans)}.`] };
    }
    let e = Q.ZERO;
    for (let m = 1; m <= n; m++) e = e.add(p.kind === 'emax' ? Q.ONE.sub(q(m - 1, n).pow(k)) : q(n - m + 1, n).pow(k));
    return {
      answer: R(e),
      steps: [
        'For a non-negative integer variable, E[X] = Σ_{m≥1} P(X ≥ m) (tail-sum formula).',
        p.kind === 'emax' ? `P(max ≥ m) = 1 − P(all < m) = 1 − ((m − 1)/${n})^${k}.` : `P(min ≥ m) = P(all ≥ m) = ((${n} − m + 1)/${n})^${k}.`,
        `Sum over m = 1…${n}: E = ${fq(e)}.`,
      ],
    };
  },
  verify(p) {
    let tot = 0, cnt = 0;
    const v = new Array<number>(p.k).fill(1);
    const rec = (i: number): void => {
      if (i === p.k) {
        cnt++;
        const mx = Math.max(...v), mn = Math.min(...v);
        tot += p.kind === 'emax' ? mx : p.kind === 'emin' ? mn : mx === p.m ? 1 : 0;
        return;
      }
      for (let f = 1; f <= p.n; f++) {
        v[i] = f;
        rec(i + 1);
      }
    };
    rec(0);
    return R(q(tot, cnt));
  },
  hints: (p) => [p.kind === 'pmax' ? 'P(max ≤ m) is easy: every die must be ≤ m.' : 'Instead of the distribution, use P(X ≥ m).', 'P(max = m) = P(max ≤ m) − P(max ≤ m − 1).', 'E[X] = Σ_{m≥1} P(X ≥ m) for integer-valued X ≥ 0.'],
  verifiedBy: 'brute-force enumeration of every roll',
};

export const PROBABILITY = [diceSum, binomial, cardHands, urn, bayes, patternWait, coupon, geometric, distinctValues, derangements, birthday, maxDice] as Generator<unknown>[];

export type { Tier };
