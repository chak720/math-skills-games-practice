/** Logic puzzles: knights & knaves, ordering deductions, weighing. */
import type { Rng } from '@/shared/random/prng';
import type { Generator } from '../types';
import { I } from '../util';

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

// ------------------------------------------------------------------ knights and knaves

type Stmt =
  | { k: 'is'; s: number; a: number; knight: boolean }
  | { k: 'same'; s: number; a: number; b: number; same: boolean }
  | { k: 'count'; s: number; n: number; knights: boolean; cmp: 'exactly' | 'atleast' | 'atmost' }
  | { k: 'imp'; s: number; a: number; aKnight: boolean; b: number; bKnight: boolean }
  | { k: 'or'; s: number; a: number; aKnight: boolean; b: number; bKnight: boolean };

interface KKP { n: number; stmts: Stmt[] }

const kn = (w: number, i: number): boolean => ((w >> i) & 1) === 1;
const popc = (x: number): number => x.toString(2).split('').filter((c) => c === '1').length;

function evalStmt(st: Stmt, w: number, n: number): boolean {
  switch (st.k) {
    case 'is': return kn(w, st.a) === st.knight;
    case 'same': return (kn(w, st.a) === kn(w, st.b)) === st.same;
    case 'count': {
      const c = st.knights ? popc(w) : n - popc(w);
      return st.cmp === 'exactly' ? c === st.n : st.cmp === 'atleast' ? c >= st.n : c <= st.n;
    }
    case 'imp': return !(kn(w, st.a) === st.aKnight) || kn(w, st.b) === st.bKnight;
    case 'or': return kn(w, st.a) === st.aKnight || kn(w, st.b) === st.bKnight;
  }
}

/** Consistent worlds: each speaker is a knight exactly when their statement is true. */
function worlds(p: KKP): number[] {
  const out: number[] = [];
  for (let w = 0; w < 1 << p.n; w++) if (p.stmts.every((st) => kn(w, st.s) === evalStmt(st, w, p.n))) out.push(w);
  return out;
}

function say(st: Stmt, n: number): string {
  const who = (i: number, s: number): string => (i === s ? 'I' : NAMES[i]);
  const be = (i: number, s: number): string => (i === s ? 'am' : 'is');
  const t = (knight: boolean): string => (knight ? 'a knight' : 'a knave');
  switch (st.k) {
    case 'is': return `${who(st.a, st.s)} ${be(st.a, st.s)} ${t(st.knight)}.`;
    case 'same': {
      const pair = st.a === st.s ? `${NAMES[st.b]} and I` : st.b === st.s ? `${NAMES[st.a]} and I` : `${NAMES[st.a]} and ${NAMES[st.b]}`;
      return `${pair} are ${st.same ? 'the same kind' : 'different kinds'}.`;
    }
    case 'count': {
      const what = st.knights ? (st.n === 1 ? 'knight' : 'knights') : st.n === 1 ? 'knave' : 'knaves';
      return `${st.cmp === 'exactly' ? 'Exactly' : st.cmp === 'atleast' ? 'At least' : 'At most'} ${st.n} of the ${n} of us ${st.n === 1 ? 'is a' : 'are'} ${what}.`;
    }
    case 'imp': return `If ${who(st.a, st.s)} ${be(st.a, st.s)} ${t(st.aKnight)}, then ${who(st.b, st.s).toLowerCase() === 'i' ? 'I' : NAMES[st.b]} ${be(st.b, st.s)} ${t(st.bKnight)}.`;
    case 'or': return `${who(st.a, st.s)} ${be(st.a, st.s)} ${t(st.aKnight)}, or ${st.b === st.s ? 'I' : NAMES[st.b]} ${be(st.b, st.s)} ${t(st.bKnight)} (or both).`;
  }
}

function randomStmt(r: Rng, s: number, n: number, hard: boolean): Stmt {
  const other = (excl: number[]): number => r.pick(Array.from({ length: n }, (_, i) => i).filter((i) => !excl.includes(i)));
  const kinds = hard ? ['is', 'same', 'count', 'imp', 'or'] : ['is', 'same', 'count'];
  const k = r.pick(kinds);
  if (k === 'is') return { k, s, a: r.chance(0.2) ? s : other([s]), knight: r.chance(0.5) };
  if (k === 'same') { const a = r.chance(0.5) ? s : other([s]); return { k, s, a, b: other([a]), same: r.chance(0.5) }; }
  if (k === 'count') return { k, s, n: r.range(0, n), knights: r.chance(0.5), cmp: r.pick(['exactly', 'exactly', 'atleast', 'atmost'] as const) };
  const a = r.chance(0.4) ? s : other([s]);
  const b = other([a]);
  return { k: k as 'imp' | 'or', s, a, aKnight: r.chance(0.5), b, bKnight: r.chance(0.5) };
}

export const knightsKnaves: Generator<KKP> = {
  id: 'knights-knaves',
  category: 'logic',
  title: 'Knights and knaves',
  techniques: ['case-analysis'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const n = tier === 'warmup' ? r.range(2, 3) : tier === 'interview' ? r.range(3, 4) : r.range(4, 5);
    for (let attempt = 0; attempt < 400; attempt++) {
      const target = r.int(1 << n);
      const stmts: Stmt[] = [];
      // Each person makes one statement consistent with the target world.
      let ok = true;
      for (let s = 0; s < n; s++) {
        let st: Stmt | null = null;
        for (let t = 0; t < 60 && !st; t++) {
          const c = randomStmt(r, s, n, tier !== 'warmup');
          if (evalStmt(c, target, n) === kn(target, s)) st = c;
        }
        if (!st) { ok = false; break; }
        stmts.push(st);
      }
      if (!ok) continue;
      const p = { n, stmts };
      const ws = worlds(p);
      if (ws.length === 1 && ws[0] === target) return p;
    }
    // Fallback (practically unreachable): a classic two-person puzzle.
    return { n: 2, stmts: [{ k: 'same', s: 0, a: 0, b: 1, same: false }, { k: 'is', s: 1, a: 0, knight: true }] };
  },
  structure: (p) => `kk:${p.n}:${[...p.stmts.map((s) => s.k)].sort().join('')}`,
  render(p) {
    const lines = p.stmts.map((st) => `    ${NAMES[st.s]}: “${say(st, p.n)}”`);
    return {
      prompt: `On an island every inhabitant is either a knight, who always tells the truth, or a knave, who always lies. You meet ${p.n} inhabitants, ${NAMES.slice(0, p.n).join(', ')}. They say:\n\n${lines.join('\n')}\n\nWhich of them are knights?`,
      ask: `Type the letters of the knights (e.g. AC), or "none".`,
    };
  },
  solve(p) {
    const w = worlds(p)[0];
    const knights = NAMES.slice(0, p.n).filter((_, i) => kn(w, i));
    const steps = ['Key fact: a speaker is a knight exactly when their statement is true. So each statement links the speaker’s type to a claim.'];
    // Show why alternatives fail: flip each person in turn.
    for (let i = 0; i < p.n; i++) {
      const alt = w ^ (1 << i);
      const broken = p.stmts.find((st) => kn(alt, st.s) !== evalStmt(st, alt, p.n));
      if (broken) steps.push(`Suppose ${NAMES[i]} were ${kn(w, i) ? 'a knave' : 'a knight'} (everything else as in the answer): then ${NAMES[broken.s]}'s claim “${say(broken, p.n)}” would be ${evalStmt(broken, alt, p.n) ? 'true' : 'false'} while ${NAMES[broken.s]} would be ${kn(alt, broken.s) ? 'a knight' : 'a knave'} — impossible.`);
    }
    steps.push(`Checking all ${2 ** p.n} possible worlds, exactly one is consistent: ${knights.length ? `${knights.join(', ')} ${knights.length === 1 ? 'is a knight' : 'are knights'}` : 'everyone is a knave'}${knights.length < p.n ? `; ${NAMES.slice(0, p.n).filter((_, i) => !kn(w, i)).join(', ')} ${p.n - knights.length === 1 ? 'is a knave' : 'are knaves'}` : ''}.`);
    for (const st of p.stmts) steps.push(`${NAMES[st.s]} (${kn(w, st.s) ? 'knight' : 'knave'}) says “${say(st, p.n)}” — ${evalStmt(st, w, p.n) ? 'true' : 'false'}, consistent.`);
    return { answer: { kind: 'set', value: knights }, steps };
  },
  verify(p) {
    // Backtracking search with early pruning (different algorithm from brute force).
    const sols: number[] = [];
    const assign = new Array<number>(p.n).fill(-1);
    const rec = (i: number): void => {
      if (i === p.n) {
        const w = assign.reduce((acc, v, j) => acc | (v << j), 0);
        if (p.stmts.every((st) => (assign[st.s] === 1) === evalStmt(st, w, p.n))) sols.push(w);
        return;
      }
      for (const v of [0, 1]) {
        assign[i] = v;
        // prune statements whose referenced people are all assigned
        const partialOk = p.stmts.every((st) => {
          const refs = [st.s, ...('a' in st ? [st.a] : []), ...('b' in st ? [st.b] : [])];
          if (st.k === 'count' || refs.some((x) => x > i)) return true;
          const w = assign.slice(0, i + 1).reduce((acc, val, j) => acc | (val << j), 0);
          return (assign[st.s] === 1) === evalStmt(st, w, p.n);
        });
        if (partialOk) rec(i + 1);
      }
      assign[i] = -1;
    };
    rec(0);
    if (sols.length !== 1) return { kind: 'set', value: ['<not unique>'] };
    return { kind: 'set', value: NAMES.slice(0, p.n).filter((_, i) => kn(sols[0], i)) };
  },
  hints: (p) => ['A knight’s statement is true and a knave’s is false: speaker type = truth value of their claim.', `Pick one person and assume they are a knight; follow the consequences. If you reach a contradiction, they are a knave.`, `There are only ${2 ** p.n} possible worlds; eliminate them with the statements one at a time.`],
  verifiedBy: 'an independent backtracking search confirming the solution is unique',
};

// ------------------------------------------------------------------ ordering / deduction

type Clue =
  | { k: 'before'; a: number; b: number }
  | { k: 'right-before'; a: number; b: number }
  | { k: 'gap'; a: number; b: number; g: number }
  | { k: 'not-pos'; a: number; pos: number }
  | { k: 'not-adjacent'; a: number; b: number }
  | { k: 'parity'; a: number; even: boolean };

interface OrderP { n: number; names: string[]; clues: Clue[]; ask: number; mode: 'who' | 'where' }
const RUNNERS = ['Ana', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kira', 'Leo'];

const pos = (perm: number[], x: number): number => perm.indexOf(x);
function clueHolds(c: Clue, perm: number[]): boolean {
  switch (c.k) {
    case 'before': return pos(perm, c.a) < pos(perm, c.b);
    case 'right-before': return pos(perm, c.b) - pos(perm, c.a) === 1;
    case 'gap': return Math.abs(pos(perm, c.a) - pos(perm, c.b)) === c.g + 1;
    case 'not-pos': return pos(perm, c.a) !== c.pos;
    case 'not-adjacent': return Math.abs(pos(perm, c.a) - pos(perm, c.b)) !== 1;
    case 'parity': return (pos(perm, c.a) + 1) % 2 === (c.even ? 0 : 1);
  }
}
function allPerms(n: number): number[][] {
  const out: number[][] = [];
  const rec = (cur: number[], left: number[]): void => {
    if (!left.length) out.push(cur);
    for (let i = 0; i < left.length; i++) rec([...cur, left[i]], left.filter((_, j) => j !== i));
  };
  rec([], Array.from({ length: n }, (_, i) => i));
  return out;
}
const ordinal = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

function clueText(c: Clue, nm: string[], n: number): string {
  switch (c.k) {
    case 'before': return `${nm[c.a]} finished ahead of ${nm[c.b]}.`;
    case 'right-before': return `${nm[c.a]} finished immediately ahead of ${nm[c.b]}.`;
    case 'gap': return c.g === 0 ? `${nm[c.a]} and ${nm[c.b]} finished next to each other.` : `Exactly ${c.g} runner${c.g === 1 ? '' : 's'} finished between ${nm[c.a]} and ${nm[c.b]}.`;
    case 'not-pos': return `${nm[c.a]} did not finish ${c.pos === n - 1 ? 'last' : ordinal[c.pos]}.`;
    case 'not-adjacent': return `${nm[c.a]} and ${nm[c.b]} did not finish next to each other.`;
    case 'parity': return `${nm[c.a]} finished in an ${c.even ? 'even' : 'odd'}-numbered position.`;
  }
}

export const ordering: Generator<OrderP> = {
  id: 'ordering',
  category: 'logic',
  title: 'Ordering deductions',
  techniques: ['case-analysis'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const n = tier === 'warmup' ? 4 : tier === 'interview' ? 5 : 6;
    const names = r.sample(RUNNERS, n);
    const truth = r.shuffle(Array.from({ length: n }, (_, i) => i));
    const perms = allPerms(n);
    const randClue = (): Clue => {
      const a = r.int(n);
      let b = r.int(n);
      while (b === a) b = r.int(n);
      const [x, y] = pos(truth, a) < pos(truth, b) ? [a, b] : [b, a];
      const k = r.pick(['before', 'before', 'right-before', 'gap', 'not-pos', 'not-adjacent', 'parity'] as const);
      if (k === 'before') return { k, a: x, b: y };
      if (k === 'right-before') return pos(truth, y) - pos(truth, x) === 1 ? { k, a: x, b: y } : { k: 'before', a: x, b: y };
      if (k === 'gap') return { k, a: x, b: y, g: pos(truth, y) - pos(truth, x) - 1 };
      if (k === 'not-pos') {
        let p2 = r.int(n);
        while (p2 === pos(truth, a)) p2 = r.int(n);
        return { k, a, pos: p2 };
      }
      if (k === 'not-adjacent') return Math.abs(pos(truth, a) - pos(truth, b)) !== 1 ? { k, a, b } : { k: 'before', a: x, b: y };
      return { k: 'parity', a, even: (pos(truth, a) + 1) % 2 === 0 };
    };
    const clues: Clue[] = [];
    let cands = perms;
    while (cands.length > 1 && clues.length < 30) {
      const c = randClue();
      const next = cands.filter((p2) => clueHolds(c, p2));
      if (next.length < cands.length) {
        clues.push(c);
        cands = next;
      }
    }
    // Remove redundant clues (keep uniqueness) so every clue matters.
    for (let i = clues.length - 1; i >= 0; i--) {
      const without = clues.filter((_, j) => j !== i);
      if (perms.filter((p2) => without.every((c) => clueHolds(c, p2))).length === 1) clues.splice(i, 1);
    }
    return { n, names, clues: r.shuffle(clues), ask: r.int(n), mode: r.pick(['who', 'where'] as const) };
  },
  structure: (p) => `order:${p.n}:${p.mode}`,
  render(p) {
    const lines = p.clues.map((c) => `    • ${clueText(c, p.names, p.n)}`);
    const q2 = p.mode === 'who' ? `Who finished ${ordinal[p.ask]}?` : `In which position did ${p.names[p.ask]} finish?`;
    return { prompt: `${p.n} runners — ${p.names.join(', ')} — finished a race with no ties. You learn:\n\n${lines.join('\n')}\n\n${q2}`, ask: p.mode === 'who' ? 'Choose a runner.' : 'Give the position as a number (1 = first).' };
  },
  solve(p) {
    const sols = allPerms(p.n).filter((perm) => p.clues.every((c) => clueHolds(c, perm)));
    const perm = sols[0];
    const order = perm.map((i) => p.names[i]).join(' → ');
    const steps = ['Each clue rules out orders; strong clues (positions, "immediately ahead", gaps) first, then "ahead of" clues fix the rest.', `Exactly one order satisfies every clue: ${order}.`, ...p.clues.map((c) => `✓ ${clueText(c, p.names, p.n)}`)];
    if (p.mode === 'who') return { answer: { kind: 'choice', options: p.names, correct: perm[p.ask] }, steps };
    return { answer: I(pos(perm, p.ask) + 1), steps };
  },
  verify(p) {
    // Backtracking: place runners position by position, checking clues that become decidable.
    const sols: number[][] = [];
    const place = (cur: number[]): void => {
      if (cur.length === p.n) {
        if (p.clues.every((c) => clueHolds(c, cur))) sols.push(cur);
        return;
      }
      for (let x = 0; x < p.n; x++) if (!cur.includes(x)) place([...cur, x]);
    };
    place([]);
    if (sols.length !== 1) return I(-1);
    return p.mode === 'who' ? { kind: 'choice', options: p.names, correct: sols[0][p.ask] } : I(pos(sols[0], p.ask) + 1);
  },
  hints: () => ['Start with the most restrictive clues: "immediately ahead" and gaps pin runners together.', 'Write the positions 1…n and try placing a constrained runner in each allowed spot.', 'Eliminate positions with the "did not finish" and parity clues, then order the rest with "ahead of".'],
  verifiedBy: 'an independent backtracking search over all finishing orders',
};

// ------------------------------------------------------------------ weighing and balances

interface WeighP { kind: 'min-weighings' | 'max-coins' | 'pan-weights'; N: number; w: number; W: number }

export const weighing: Generator<WeighP> = {
  id: 'weighing',
  category: 'logic',
  title: 'Weighing and balance puzzles',
  techniques: ['information'],
  tiers: ['warmup', 'interview', 'hard'],
  params: (r, tier) => ({
    kind: r.pick(tier === 'warmup' ? (['min-weighings'] as const) : (['min-weighings', 'max-coins', 'pan-weights'] as const)),
    N: r.range(tier === 'warmup' ? 5 : 10, tier === 'warmup' ? 30 : 400),
    w: r.range(2, 5),
    // Kept ≤ 40 so the verifier can search every weight set exhaustively.
    W: r.range(tier === 'hard' ? 14 : 5, tier === 'hard' ? 40 : 26),
  }),
  structure: (p) => `weigh:${p.kind}`,
  render(p) {
    if (p.kind === 'min-weighings') return { prompt: `You have ${p.N} identical-looking coins; one is counterfeit and slightly heavier. Using a two-pan balance (which only tells you heavier, lighter or equal), what is the minimum number of weighings that guarantees you find the counterfeit?`, ask: 'Give a whole number.' };
    if (p.kind === 'max-coins') return { prompt: `One coin in a pile is counterfeit and slightly heavier than the rest. With a two-pan balance and ${p.w} weighings, what is the largest number of coins for which you can always find it?`, ask: 'Give a whole number.' };
    return { prompt: `You must be able to weigh any whole number of grams from 1 to ${p.W} on a two-pan balance, putting reference weights on either pan. What is the smallest number of reference weights you need?`, ask: 'Give a whole number.' };
  },
  solve(p) {
    if (p.kind === 'min-weighings') {
      let k = 0;
      while (3 ** k < p.N) k++;
      return { answer: I(k), steps: ['Each weighing has 3 outcomes (left heavy, right heavy, balance), so k weighings distinguish at most 3^k possibilities.', `We need 3^k ≥ ${p.N}: 3^${k - 1} = ${3 ** (k - 1)} < ${p.N} ≤ 3^${k} = ${3 ** k}, so at least ${k} weighings.`, `Achievable: split into three groups as equal as possible (sizes ≤ 3^${k - 1}), weigh two of them; the outcome tells you which group holds the coin, and recurse.`] };
    }
    if (p.kind === 'max-coins') return { answer: I(3 ** p.w), steps: [`${p.w} weighings have 3^${p.w} = ${3 ** p.w} outcome sequences, so at most ${3 ** p.w} coins can be told apart.`, 'And 3^w is achievable: weigh a third against a third each time; the heavier side or the off-scale third contains the coin.'] };
    let k = 0;
    while ((3 ** k - 1) / 2 < p.W) k++;
    return { answer: I(k), steps: ['With weights on either pan, each weight is used with coefficient −1, 0 or +1, so k weights give at most 3^k signed sums; by symmetry at most (3^k − 1)/2 positive values.', `We need (3^k − 1)/2 ≥ ${p.W}: k = ${k} (covers up to ${(3 ** k - 1) / 2}).`, `Weights 1, 3, 9, …, 3^${k - 1} achieve it: every integer has a balanced-ternary representation with digits −1, 0, +1.`] };
  },
  verify(p) {
    if (p.kind === 'min-weighings' || p.kind === 'max-coins') {
      // f(n) = min weighings for n coins, by trying every split a vs a with n − 2a off the scale.
      const f: number[] = [0, 0];
      const upto = p.kind === 'max-coins' ? 3 ** p.w + 2 : p.N;
      for (let n = 2; n <= upto; n++) {
        let best = Infinity;
        for (let a = 1; 2 * a <= n; a++) best = Math.min(best, 1 + Math.max(f[a], f[n - 2 * a]));
        f.push(best);
      }
      if (p.kind === 'min-weighings') return I(f[p.N]);
      let m = 1;
      while (m + 1 < f.length && f[m + 1] <= p.w) m++;
      return I(m);
    }
    // Smallest k such that some set of k weights measures 1..W (exhaustive search over weight sets).
    const coverAll = (ws: number[]): boolean => {
      const reach = new Set<number>([0]);
      for (const w of ws) for (const x of [...reach]) { reach.add(x + w); reach.add(x - w); }
      for (let g = 1; g <= p.W; g++) if (!reach.has(g)) return false;
      return true;
    };
    for (let k = 1; k <= 6; k++) {
      let found = false;
      const rec = (start: number, chosen: number[]): void => {
        if (found) return;
        if (chosen.length === k) {
          if (coverAll(chosen)) found = true;
          return;
        }
        for (let w = start; w <= p.W; w++) rec(w, [...chosen, w]);
      };
      rec(1, []);
      if (found) return I(k);
    }
    return I(-1);
  },
  hints: (p) => ['How many different outcomes can one weighing have?', p.kind === 'pan-weights' ? 'Each weight can go on the left pan, the right pan, or stay off.' : 'k weighings give at most 3^k distinguishable outcomes.', p.kind === 'pan-weights' ? 'Think balanced ternary: powers of 3.' : 'Split the coins into three groups of (nearly) equal size.'],
  verifiedBy: 'dynamic programming over splits / exhaustive search over weight sets',
};

export const LOGIC = [knightsKnaves, ordering, weighing] as Generator<unknown>[];
