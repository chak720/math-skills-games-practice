/** Markov chains and random walks: each solved by the textbook method and re-checked by a different exact algorithm. */
import { Q, q } from '@/shared/math/rational';
import { invert, solveLinear } from '@/shared/math/linalg';
import type { Rng } from '@/shared/random/prng';
import type { Generator } from '../types';
import { R, fq } from '../util';

const LETTERS = 'ABCDEFGH';
const frac = (n: number, d: number): string => q(n, d).toString();
const signed = (x: number): string => (x < 0 ? `−${-x}` : `${x}`);

// ------------------------------------------------------------------ gambler's ruin

interface RuinP { i: number; N: number; pn: number; pd: number; ask: 'prob' | 'duration'; ctx: number }

const RUIN_CTX = [
  {
    setup: (p: RuinP) => `You have ${p.i} chip${p.i === 1 ? '' : 's'} and bet one chip at a time on a game you win with probability ${frac(p.pn, p.pd)} (a win pays one chip). You stop as soon as you have ${p.N} chips or none.`,
    prob: (p: RuinP) => `What is the probability you reach ${p.N} chips?`,
    dur: 'What is the expected number of bets you make?',
  },
  {
    setup: (p: RuinP) => `A stock is ${p.i} ticks above your stop-loss. Each minute it moves one tick up with probability ${frac(p.pn, p.pd)}, otherwise one tick down. You exit at the stop-loss or at your take-profit ${p.N} ticks above the stop.`,
    prob: () => 'What is the probability you exit at the take-profit?',
    dur: 'What is the expected number of minutes until you exit?',
  },
  {
    setup: (p: RuinP) => `A drunk stands on step ${p.i} of a staircase with ${p.N} steps above the ground (step 0). Each second they go up a step with probability ${frac(p.pn, p.pd)}, otherwise down. At the top (step ${p.N}) or the ground they stay put.`,
    prob: (p: RuinP) => `What is the probability they reach step ${p.N} before the ground?`,
    dur: 'What is the expected number of seconds until they reach the top or the ground?',
  },
];

export const gamblersRuin: Generator<RuinP> = {
  id: 'gamblers-ruin',
  category: 'markov',
  title: "Gambler's ruin",
  techniques: ['first-step', 'martingale', 'markov'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const fair = tier === 'warmup' || (tier === 'interview' && r.chance(0.5));
    const [pn, pd] = fair ? [1, 2] : r.pick([[2, 5], [3, 5], [1, 3], [2, 3], [9, 19], [4, 9]]);
    const N = tier === 'warmup' ? r.range(4, 10) : tier === 'interview' ? r.range(5, 12) : r.range(8, 16);
    const ask = tier === 'warmup' ? 'prob' : tier === 'hard' ? r.pick(['duration', 'duration', 'prob'] as const) : r.pick(['prob', 'duration'] as const);
    return { i: r.range(1, N - 1), N, pn, pd, ask, ctx: r.int(RUIN_CTX.length) };
  },
  structure: (p) => `ruin:${p.ask}:${p.pn * 2 === p.pd ? 'fair' : 'biased'}`,
  render(p) {
    const c = RUIN_CTX[p.ctx];
    return { prompt: `${c.setup(p)} ${p.ask === 'prob' ? c.prob(p) : c.dur}`, ask: p.ask === 'prob' ? 'Give the exact probability.' : 'Give the exact expected value.' };
  },
  solve(p) {
    const P = q(p.pn, p.pd), Qp = Q.ONE.sub(P);
    const fair = P.eq(q(1, 2));
    if (p.ask === 'prob') {
      if (fair) {
        const a = q(p.i, p.N);
        return { answer: R(a), steps: ['A fair walk is a martingale: your expected position never changes, so at the end i = N·P(win) + 0·P(lose).', `P(win) = i/N = ${p.i}/${p.N} = ${fq(a)}.`] };
      }
      const r = Qp.div(P);
      const a = Q.ONE.sub(r.pow(p.i)).div(Q.ONE.sub(r.pow(p.N)));
      return {
        answer: R(a),
        steps: [
          `Let x_k = P(reach ${p.N} | at k). First step: x_k = p·x_{k+1} + q·x_{k−1}, with x_0 = 0, x_${p.N} = 1.`,
          'The characteristic equation p·z² − z + q = 0 has roots 1 and r = q/p, so x_k = A + B·r^k.',
          `Here r = ${Qp}/${P} = ${r}. The boundary conditions give x_k = (1 − r^k)/(1 − r^N).`,
          `x_${p.i} = (1 − ${r}^${p.i}) / (1 − ${r}^${p.N}) = ${fq(a)}.`,
        ],
      };
    }
    if (fair) {
      const e = q(p.i * (p.N - p.i));
      return { answer: R(e), steps: ['Let E_k be the expected duration from k: E_k = 1 + ½E_{k+1} + ½E_{k−1}, E_0 = E_N = 0.', 'The second difference is constant (−2), so E_k is a quadratic vanishing at 0 and N: E_k = k(N − k).', `E_${p.i} = ${p.i} × ${p.N - p.i} = ${e}.`] };
    }
    const r = Qp.div(P), d = Qp.sub(P);
    const win = Q.ONE.sub(r.pow(p.i)).div(Q.ONE.sub(r.pow(p.N)));
    const e = q(p.i).div(d).sub(q(p.N).div(d).mul(win));
    return {
      answer: R(e),
      steps: [
        `E_k = 1 + p·E_{k+1} + q·E_{k−1}, E_0 = E_N = 0. A particular solution is k/(q − p); the homogeneous part is A + B·(q/p)^k.`,
        'Alternatively (Wald): your position drifts by p − q per step, so i + (p − q)·E[T] = N·P(win).',
        `P(win) = (1 − r^${p.i})/(1 − r^${p.N}) with r = ${r}, which is ${fq(win)}.`,
        `E[T] = (i − N·P(win)) / (q − p) = (${p.i} − ${p.N}·P(win)) / ${d.isInteger() ? d : `(${d})`} = ${fq(e)}.`,
      ],
    };
  },
  verify(p) {
    // Solve the first-step equations for states 1..N−1 directly.
    const n = p.N - 1, P = q(p.pn, p.pd), Qp = Q.ONE.sub(P);
    const A: Q[][] = Array.from({ length: n }, () => new Array<Q>(n).fill(Q.ZERO));
    const b: Q[] = new Array<Q>(n).fill(p.ask === 'prob' ? Q.ZERO : Q.ONE);
    for (let k = 1; k <= n; k++) {
      A[k - 1][k - 1] = Q.ONE;
      if (k + 1 <= n) A[k - 1][k] = P.neg();
      else if (p.ask === 'prob') b[k - 1] = P; // x_N = 1
      if (k - 1 >= 1) A[k - 1][k - 2] = Qp.neg();
    }
    return R(solveLinear(A, b)[p.i - 1]);
  },
  hints: (p) => [
    'Write x_k for the answer starting from k and condition on the first step.',
    p.pn * 2 === p.pd ? 'For a fair walk, use that the expected position (or position² − time) is a martingale.' : 'Try x_k = A + B·r^k with r = q/p.',
    p.ask === 'prob' ? 'Fix A and B from x_0 = 0 and x_N = 1.' : 'Wald: the drift per step times the expected time equals the expected total change.',
  ],
  verifiedBy: 'solving the full system of first-step equations exactly',
};

// ------------------------------------------------------------------ maze absorption

interface MazeP { n: number; edges: [number, number][]; cheese: number; trap: number; start: number; ask: 'prob' | 'time'; hard: boolean }

function mazeChain(p: MazeP): { Qm: Q[][]; Rm: Q[][] } {
  // Transient states 0..n−1; absorbing columns [cheese, trap] (time questions treat both as exits).
  const adj: number[][] = Array.from({ length: p.n }, () => []);
  for (const [a, b] of p.edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const Qm = Array.from({ length: p.n }, () => new Array<Q>(p.n).fill(Q.ZERO));
  const Rm = Array.from({ length: p.n }, () => [Q.ZERO, Q.ZERO]);
  for (let v = 0; v < p.n; v++) {
    const doors = adj[v].length + (v === p.cheese ? 1 : 0) + (v === p.trap ? 1 : 0);
    for (const w of adj[v]) Qm[v][w] = Qm[v][w].add(q(1, doors));
    if (v === p.cheese) Rm[v][0] = q(1, doors);
    if (v === p.trap) Rm[v][1] = q(1, doors);
  }
  return { Qm, Rm };
}

export const maze: Generator<MazeP> = {
  id: 'maze',
  category: 'markov',
  title: 'Mouse in a maze',
  techniques: ['first-step', 'markov'],
  tiers: ['interview', 'hard'],
  params(r, tier) {
    const n = tier === 'interview' ? r.range(4, 5) : r.range(6, 7);
    const edges: [number, number][] = [];
    const has = (a: number, b: number) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    for (let v = 1; v < n; v++) edges.push([r.int(v), v]);
    for (let extra = r.range(1, tier === 'hard' ? 3 : 2), guard = 0; extra > 0 && guard < 50; guard++) {
      const a = r.int(n), b = r.int(n);
      if (a !== b && !has(a, b)) {
        edges.push([Math.min(a, b), Math.max(a, b)]);
        extra--;
      }
    }
    const cheese = r.range(1, n - 1);
    let trap = r.range(1, n - 1);
    if (n > 2) while (trap === cheese) trap = r.range(1, n - 1);
    return { n, edges, cheese, trap, start: 0, ask: r.pick(['prob', 'time'] as const), hard: tier === 'hard' };
  },
  structure: (p) => `maze:${p.ask}:${p.n}`,
  render(p) {
    const adj: string[][] = Array.from({ length: p.n }, () => []);
    for (const [a, b] of p.edges) {
      adj[a].push(LETTERS[b]);
      adj[b].push(LETTERS[a]);
    }
    const exitName = p.ask === 'prob' ? ['the cheese', 'the trap'] : ['an exit', 'an exit'];
    const lines = adj.map((ns, v) => {
      const all = [...ns.sort()];
      if (v === p.cheese) all.push(exitName[0]);
      if (v === p.trap) all.push(exitName[1]);
      return `    Room ${LETTERS[v]}: doors to ${all.join(', ')}`;
    });
    return {
      prompt: [
        `A mouse wanders a maze of ${p.n} rooms. Every second it leaves through one of the doors of its current room, chosen uniformly at random (it may go back the way it came). ${p.ask === 'prob' ? 'One door leads to cheese and one to a trap; either ends the walk.' : 'Two doors lead outside; either ends the walk.'}`,
        lines.join('\n'),
        `The mouse starts in room A. ${p.ask === 'prob' ? 'What is the probability it finds the cheese before the trap?' : 'What is the expected number of seconds until it leaves the maze?'}`,
      ].join('\n\n'),
      ask: p.ask === 'prob' ? 'Give the exact probability.' : 'Give the exact expected value.',
    };
  },
  solve(p) {
    const { Qm, Rm } = mazeChain(p);
    // First-step equations: x_v − Σ Q[v][w] x_w = R[v][cheese] (or 1 for time).
    const A = Qm.map((row, v) => row.map((x, w) => (v === w ? Q.ONE.sub(x) : x.neg())));
    const b = p.ask === 'prob' ? Rm.map((r) => r[0]) : Qm.map(() => Q.ONE);
    const x = solveLinear(A, b);
    const sym = p.ask === 'prob' ? 'p' : 'E';
    const eq = Qm.map((row, v) => {
      const terms = row.map((c, w) => (c.isZero() ? '' : `${c}·${sym}${LETTERS[w]}`)).filter(Boolean);
      const extra = p.ask === 'prob' ? (Rm[v][0].isZero() ? [] : [`${Rm[v][0]}`]) : [];
      return `${sym}${LETTERS[v]} = ${p.ask === 'time' ? '1 + ' : ''}${[...terms, ...extra].join(' + ') || '0'}`;
    });
    return {
      answer: R(x[p.start]),
      steps: [
        `Let ${sym}X be the ${p.ask === 'prob' ? 'probability of reaching the cheese first' : 'expected remaining time'} from room X, and condition on the next door:`,
        ...eq,
        p.ask === 'prob' ? 'Doors to the trap contribute 0 and the door to the cheese contributes its probability times 1.' : 'Each move costs one second; exits contribute 0 further time.',
        `Solving the ${p.n} linear equations: ${LETTERS.slice(0, p.n).split('').map((L, i) => `${sym}${L} = ${x[i]}`).join(', ')}.`,
        `From A: ${fq(x[p.start])}.`,
      ],
    };
  },
  verify(p) {
    // Fundamental matrix N = (I − Q)⁻¹: absorption probabilities N·R, expected time N·1.
    const { Qm, Rm } = mazeChain(p);
    const Nm = invert(Qm.map((row, v) => row.map((x, w) => (v === w ? Q.ONE.sub(x) : x.neg()))));
    const row = Nm[p.start];
    if (p.ask === 'time') return R(row.reduce((s, x) => s.add(x), Q.ZERO));
    return R(row.reduce((s, x, w) => s.add(x.mul(Rm[w][0])), Q.ZERO));
  },
  hints: () => ['Give each room an unknown: the answer if the mouse were starting there.', 'Condition on the door it takes next; every unknown satisfies one linear equation.', 'Solve the system (symmetry may shortcut some of it).'],
  verifiedBy: 'the fundamental matrix (I − Q)⁻¹ of the absorbing chain',
};

// ------------------------------------------------------------------ Penney's game

interface PenneyP { a: string; b: string; ask: 'vs' | 'best' }

const corr = (x: string, y: string): number => {
  // Conway leading number: Σ 2^k over k where the last k letters of x equal the first k of y.
  let s = 0;
  for (let k = 1; k <= x.length; k++) if (x.slice(-k) === y.slice(0, k)) s += 2 ** k;
  return s;
};
const conwayB = (a: string, b: string): Q => {
  const num = corr(a, a) - corr(a, b), den = corr(b, b) - corr(b, a);
  return q(num, num + den);
};
function raceMarkov(a: string, b: string): Q {
  // States: longest suffix of the history that is a prefix of a or b.
  const reduce = (s: string): string => {
    for (let k = s.length; k > 0; k--) {
      const t = s.slice(-k);
      if (a.startsWith(t) || b.startsWith(t)) return t;
    }
    return '';
  };
  const states: string[] = [''];
  const step = (s: string, c: string): string => {
    const t = s + c;
    if (t.endsWith(a)) return 'WIN_A';
    if (t.endsWith(b)) return 'WIN_B';
    return reduce(t);
  };
  for (let i = 0; i < states.length; i++)
    for (const c of 'HT') {
      const t = step(states[i], c);
      if (!t.startsWith('WIN') && !states.includes(t)) states.push(t);
    }
  const n = states.length;
  const A = Array.from({ length: n }, () => new Array<Q>(n).fill(Q.ZERO));
  const rhs = new Array<Q>(n).fill(Q.ZERO);
  states.forEach((s, i) => {
    A[i][i] = Q.ONE;
    for (const c of 'HT') {
      const t = step(s, c);
      if (t === 'WIN_B') rhs[i] = rhs[i].add(q(1, 2));
      else if (t !== 'WIN_A') A[i][states.indexOf(t)] = A[i][states.indexOf(t)].sub(q(1, 2));
    }
  });
  return solveLinear(A, rhs)[0];
}
const allPatterns = (len: number): string[] => Array.from({ length: 2 ** len }, (_, m) => Array.from({ length: len }, (_, i) => ((m >> (len - 1 - i)) & 1 ? 'T' : 'H')).join(''));

export const penney: Generator<PenneyP> = {
  id: 'penney',
  category: 'markov',
  title: "Penney's game",
  techniques: ['pattern-overlap', 'first-step', 'markov'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r: Rng, tier) {
    const len = tier === 'warmup' ? 2 : tier === 'interview' ? 3 : r.pick([3, 4]);
    const pats = allPatterns(len);
    const a = r.pick(pats);
    let b = r.pick(pats);
    while (b === a) b = r.pick(pats);
    return { a, b, ask: tier === 'warmup' ? 'vs' : tier === 'hard' ? r.pick(['best', 'vs'] as const) : r.pick(['vs', 'best'] as const) };
  },
  structure: (p) => `penney:${p.ask}:${p.a.length}`,
  render(p) {
    return p.ask === 'vs'
      ? { prompt: `Alice picks the pattern ${p.a} and Bob picks ${p.b}. A fair coin is flipped until one of the two patterns appears as consecutive flips, and that player wins. What is the probability that Bob wins?`, ask: 'Give the exact probability.' }
      : { prompt: `Alice picks the pattern ${p.a}. Bob, knowing her choice, picks a different pattern of length ${p.a.length}. A fair coin is flipped until one of the two patterns appears as consecutive flips, and that player wins. If Bob chooses as well as possible, what is his probability of winning?`, ask: 'Give the exact probability.' };
  },
  solve(p) {
    const show = (x: string, y: string) => `${x}${y === x ? '' : `·${y}`}: ${corr(x, y)}`;
    if (p.ask === 'vs') {
      const pb = conwayB(p.a, p.b);
      return {
        answer: R(pb),
        steps: [
          "Conway's leading numbers: for patterns X, Y let XY = Σ 2^k over the k for which the last k flips of X equal the first k of Y.",
          `AA = ${corr(p.a, p.a)}, AB = ${corr(p.a, p.b)}, BB = ${corr(p.b, p.b)}, BA = ${corr(p.b, p.a)}  (A = ${p.a}, B = ${p.b}).`,
          `Odds that B beats A = (AA − AB) : (BB − BA) = ${corr(p.a, p.a) - corr(p.a, p.b)} : ${corr(p.b, p.b) - corr(p.b, p.a)}.`,
          `P(Bob wins) = ${fq(pb)}.`,
        ],
      };
    }
    const cands = allPatterns(p.a.length).filter((x) => x !== p.a).map((x) => ({ x, v: conwayB(p.a, x) }));
    const best = cands.reduce((m, c) => (c.v.cmp(m.v) > 0 ? c : m));
    const rule = p.a.length === 3 ? `${p.a[1] === 'H' ? 'T' : 'H'}${p.a.slice(0, 2)}` : null;
    return {
      answer: R(best.v),
      steps: [
        "For each response B, Conway's formula gives Bob's odds (AA − AB) : (BB − BA).",
        `A = ${p.a}: ${show(p.a, p.a)}.`,
        ...cands.slice().sort((x, y) => y.v.cmp(x.v)).slice(0, 3).map((c) => `B = ${c.x}: AB = ${corr(p.a, c.x)}, BB = ${corr(c.x, c.x)}, BA = ${corr(c.x, p.a)} → P(Bob) = ${c.v}.`),
        rule ? `This matches the classic rule for length 3: take the opposite of Alice's middle flip, then her first two flips (${rule}).` : 'The best response always ends with the start of Alice’s pattern, so it "steals" her prefix.',
        `Best: ${best.x}, winning with probability ${fq(best.v)}.`,
      ],
    };
  },
  verify(p) {
    if (p.ask === 'vs') return R(raceMarkov(p.a, p.b));
    return R(allPatterns(p.a.length).filter((x) => x !== p.a).map((x) => raceMarkov(p.a, x)).reduce((m, v) => (v.cmp(m) > 0 ? v : m)));
  },
  hints: (p) => [
    'This is not symmetric: a pattern can be "half-built" by the other.',
    p.ask === 'best' ? "Bob's pattern should end with the beginning of Alice's." : 'Track how much of each pattern the latest flips have built; that is a Markov chain.',
    "Conway's leading numbers turn the overlaps into odds: (AA − AB) : (BB − BA).",
  ],
  verifiedBy: 'a Markov chain over partial matches of both patterns, solved exactly',
};

// ------------------------------------------------------------------ stationary distribution

interface StatP { k: number; rows: number[][]; den: number[]; target: number; ask: 'fraction' | 'return' | 'reward'; reward: number[]; ctx: number }

const STAT_CTX = [
  { unit: 'day', names: ['Sunny', 'Cloudy', 'Rainy', 'Stormy'], intro: 'Tomorrow’s weather depends only on today’s.', reward: 'An ice-cream van earns' },
  { unit: 'day', names: ['Calm', 'Trending', 'Choppy', 'Crisis'], intro: 'A market moves between regimes; tomorrow’s regime depends only on today’s.', reward: 'A strategy makes' },
  { unit: 'hour', names: ['Running', 'Idle', 'Jammed', 'Repair'], intro: 'A machine changes state once an hour, depending only on its current state.', reward: 'The machine produces a profit of' },
];

function stationaryRows(p: StatP): Q[][] {
  return p.rows.map((row, i) => row.map((x) => q(x, p.den[i])));
}
function strongly(P: number[][]): boolean {
  const n = P.length;
  const reach = (from: number, fwd: boolean) => {
    const seen = new Set([from]);
    const st = [from];
    while (st.length) {
      const v = st.pop()!;
      for (let w = 0; w < n; w++) if ((fwd ? P[v][w] : P[w][v]) > 0 && !seen.has(w)) seen.add(w), st.push(w);
    }
    return seen.size === n;
  };
  return reach(0, true) && reach(0, false);
}
function det(M: Q[][]): Q {
  const A = M.map((r) => [...r]);
  const n = A.length;
  let d = Q.ONE;
  for (let c = 0; c < n; c++) {
    let piv = c;
    while (piv < n && A[piv][c].isZero()) piv++;
    if (piv === n) return Q.ZERO;
    if (piv !== c) {
      [A[c], A[piv]] = [A[piv], A[c]];
      d = d.neg();
    }
    d = d.mul(A[c][c]);
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c].div(A[c][c]);
      for (let k = c; k < n; k++) A[r][k] = A[r][k].sub(f.mul(A[c][k]));
    }
  }
  return d;
}

export const stationary: Generator<StatP> = {
  id: 'stationary',
  category: 'markov',
  title: 'Long-run behaviour of a chain',
  techniques: ['markov'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const k = tier === 'warmup' ? 2 : tier === 'interview' ? 3 : r.pick([3, 4]);
    for (;;) {
      const den: number[] = [], rows: number[][] = [];
      for (let i = 0; i < k; i++) {
        const d = r.pick(k === 2 ? [2, 3, 4, 5, 10] : [2, 3, 4, 5, 6, 10]);
        // A random composition of d into k non-negative parts.
        const cuts = Array.from({ length: k - 1 }, () => r.range(0, d)).sort((a, b) => a - b);
        const parts = [...cuts, d].map((c, j) => c - (j ? cuts[j - 1] : 0));
        den.push(d);
        rows.push(parts);
      }
      if (!strongly(rows) || rows.some((row, i) => row[i] === den[i])) continue;
      const ask = tier === 'warmup' ? r.pick(['fraction', 'return'] as const) : tier === 'hard' ? r.pick(['reward', 'return', 'fraction'] as const) : r.pick(['fraction', 'return'] as const);
      const reward = Array.from({ length: k }, () => r.pick([-20, -10, -5, 0, 5, 10, 20, 30, 50]));
      return { k, rows, den, target: r.int(k), ask, reward, ctx: r.int(STAT_CTX.length) };
    }
  },
  structure: (p) => `stationary:${p.ask}:${p.k}`,
  render(p) {
    const c = STAT_CTX[p.ctx];
    const names = c.names.slice(0, p.k);
    const lines = names.map((nm, i) => `    After ${nm}: ${p.rows[i].some((x) => x === p.den[i]) ? `always ${names[p.rows[i].indexOf(p.den[i])]}` : names.map((m, j) => (p.rows[i][j] ? `${m} ${frac(p.rows[i][j], p.den[i])}` : '')).filter(Boolean).join(', ')}`);
    const question =
      p.ask === 'fraction'
        ? `In the long run, what fraction of ${c.unit}s are ${names[p.target]}?`
        : p.ask === 'return'
          ? `Starting from a ${names[p.target]} ${c.unit}, what is the expected number of ${c.unit}s until the next ${names[p.target]} ${c.unit}? (If the next ${c.unit} is ${names[p.target]}, that counts as 1.)`
          : `${c.reward} ${names.map((nm, i) => `${signed(p.reward[i])} on ${/^[AEIOU]/.test(nm) ? 'an' : 'a'} ${nm} ${c.unit}`).join(', ')}. What is its long-run average per ${c.unit}?`;
    return { prompt: [`${c.intro} The transition probabilities are:`, lines.join('\n'), question].join('\n\n'), ask: 'Give the exact value.' };
  },
  solve(p) {
    const P = stationaryRows(p);
    const names = STAT_CTX[p.ctx].names.slice(0, p.k);
    // Balance equations πP = π for states 1..k−1 plus normalisation.
    const A: Q[][] = [], b: Q[] = [];
    for (let j = 1; j < p.k; j++) {
      A.push(P.map((row, i) => (i === j ? row[j].sub(1) : row[j])));
      b.push(Q.ZERO);
    }
    A.push(new Array<Q>(p.k).fill(Q.ONE));
    b.push(Q.ONE);
    const pi = solveLinear(A, b);
    const value = p.ask === 'fraction' ? pi[p.target] : p.ask === 'return' ? pi[p.target].inv() : pi.reduce((s, x, i) => s.add(x.mul(p.reward[i])), Q.ZERO);
    const steps = [
      'The chain is irreducible, so it has a unique stationary distribution π with π = πP and Σπ = 1; long-run fractions of time equal π.',
      ...(p.k === 2
        ? [`For two states with switching probabilities a = ${P[0][1]} and b = ${P[1][0]}: π = (b, a)/(a + b).`]
        : names.slice(1).map((nm, idx) => `π(${nm}) = ${P.map((row, i) => (row[idx + 1].isZero() ? '' : `${row[idx + 1]}·π(${names[i]})`)).filter(Boolean).join(' + ')}`)),
      `Solving with Σπ = 1: ${names.map((nm, i) => `π(${nm}) = ${pi[i]}`).join(', ')}.`,
    ];
    if (p.ask === 'return') steps.push(`Kac's formula: the expected return time is 1/π(${names[p.target]}) = ${fq(value)}.`);
    if (p.ask === 'reward') steps.push(`Ergodic average: Σ π(s)·reward(s) = ${pi.map((x, i) => `${x}·${p.reward[i] < 0 ? `(${signed(p.reward[i])})` : p.reward[i]}`).join(' + ')} = ${fq(value)}.`);
    if (p.ask === 'fraction') steps.push(`Answer: π(${names[p.target]}) = ${fq(value)}.`);
    return { answer: R(value), steps };
  },
  verify(p) {
    // Markov chain tree theorem: π_i ∝ det of (I − P) with row i and column i deleted.
    const P = stationaryRows(p);
    const L = P.map((row, i) => row.map((x, j) => (i === j ? Q.ONE.sub(x) : x.neg())));
    const w = L.map((_, i) => det(L.filter((_, r) => r !== i).map((row) => row.filter((_, c) => c !== i))));
    const tot = w.reduce((s, x) => s.add(x), Q.ZERO);
    const pi = w.map((x) => x.div(tot));
    return R(p.ask === 'fraction' ? pi[p.target] : p.ask === 'return' ? pi[p.target].inv() : pi.reduce((s, x, i) => s.add(x.mul(p.reward[i])), Q.ZERO));
  },
  hints: (p) => [
    'In the long run the probability of being in each state stops changing.',
    'Write the balance equations π = πP and add Σπ = 1.',
    p.ask === 'return' ? 'Expected return time to a state is 1/π of that state.' : p.ask === 'reward' ? 'Average reward = Σ π(s)·reward(s).' : 'Solve the linear system.',
  ],
  verifiedBy: 'the Markov chain tree theorem (cofactors of I − P)',
};

// ------------------------------------------------------------------ running totals

interface TotalP { sides: number; N: number; ask: 'rolls' | 'hit' | 'continuous'; t: [number, number] }

export const runningTotal: Generator<TotalP> = {
  id: 'running-total',
  category: 'markov',
  title: 'Running totals',
  techniques: ['first-step', 'recursion', 'convolution'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const ask = tier === 'warmup' ? 'hit' : tier === 'interview' ? r.pick(['rolls', 'hit'] as const) : r.pick(['rolls', 'continuous', 'hit'] as const);
    return { sides: r.pick(tier === 'warmup' ? [4, 6] : [4, 6, 8]), N: r.range(tier === 'warmup' ? 3 : 5, tier === 'warmup' ? 6 : tier === 'interview' ? 9 : 14), ask, t: r.pick([[1, 1], [1, 2], [3, 4], [2, 3], [1, 3]] as [number, number][]) };
  },
  structure: (p) => `total:${p.ask}`,
  render(p) {
    if (p.ask === 'continuous') {
      const t = q(p.t[0], p.t[1]);
      return { prompt: `You draw independent Uniform(0, 1) numbers and keep a running sum. What is the expected number of draws until the sum first exceeds ${t.toString()}?`, ask: 'Give the value to 4 decimal places (or an exact expression).' };
    }
    const die = `a fair ${p.sides}-sided die (faces 1 to ${p.sides})`;
    return p.ask === 'hit'
      ? { prompt: `You roll ${die} repeatedly and keep a running total. What is the probability that the running total is ever exactly ${p.N}?`, ask: 'Give the exact probability (a decimal to 4 significant figures is fine).' }
      : { prompt: `You roll ${die} repeatedly and keep a running total. What is the expected number of rolls until the total is at least ${p.N}?`, ask: 'Give the exact expected value (a decimal to 4 significant figures is fine).' };
  },
  solve(p) {
    if (p.ask === 'continuous') {
      const t = p.t[0] / p.t[1];
      const e = Math.exp(t);
      return {
        answer: { kind: 'number', value: e, tol: 0.0005 },
        steps: [
          `P(N > n) = P(U₁ + … + U_n ≤ t) = tⁿ/n! for t ≤ 1 (the volume of a corner simplex).`,
          'E[N] = Σ_{n≥0} P(N > n) = Σ tⁿ/n! = eᵗ.',
          `With t = ${q(p.t[0], p.t[1])}: e${p.t[0] === p.t[1] ? '' : `^(${q(p.t[0], p.t[1])})`} ≈ ${e.toFixed(4)}.`,
        ],
      };
    }
    const k = p.sides;
    const f: Q[] = [];
    // hit: h(0) = 1, h(n) = (1/k) Σ_{j=1}^{k} h(n−j), negatives 0. rolls: E(n) = 0 for n ≤ 0, E(n) = 1 + (1/k) Σ E(n−j).
    for (let n = 0; n <= p.N; n++) {
      if (p.ask === 'hit' && n === 0) {
        f.push(Q.ONE);
        continue;
      }
      if (p.ask === 'rolls' && n === 0) {
        f.push(Q.ZERO);
        continue;
      }
      let s = Q.ZERO;
      for (let j = 1; j <= k; j++) if (n - j >= 0) s = s.add(f[n - j]);
      f.push(p.ask === 'hit' ? s.div(k) : Q.ONE.add(s.div(k)));
    }
    const a = f[p.N];
    const show = f.slice(0, Math.min(p.N + 1, 6)).map((x, n) => `${p.ask === 'hit' ? 'h' : 'E'}(${n}) = ${x}`).join(', ');
    return {
      answer: R(a),
      steps:
        p.ask === 'hit'
          ? [`Let h(n) be the probability the total ever equals n. The last roll before reaching n was some j ∈ {1…${k}}, so h(n) = (1/${k})·Σ h(n − j), with h(0) = 1 and h(negative) = 0.`, `${show}, …`, `h(${p.N}) = ${fq(a)}. (As n grows, h(n) → 2/(${k} + 1), one over the mean roll.)`]
          : [`Let E(n) be the expected rolls still needed when n more is required. Condition on the first roll: E(n) = 1 + (1/${k})·Σ_{j=1}^{${k}} E(n − j), with E(n) = 0 for n ≤ 0.`, `${show}, …`, `E(${p.N}) = ${fq(a)}.`],
    };
  },
  verify(p) {
    if (p.ask === 'continuous') {
      // Independent: replace Uniform(0,1) by M equally likely midpoints (2j−1)/(2M), solve that discrete
      // recursion, and Richardson-extrapolate the O(1/M) discretisation error away.
      const discrete = (M: number): number => {
        const T = Math.round((2 * M * p.t[0]) / p.t[1]); // threshold in units of 1/(2M); draws are odd integers < 2M
        const E = new Float64Array(T + 1), S = new Float64Array(T + 1); // S[x] = E[x] + E[x−2] + …
        for (let x = 0; x <= T; x++) {
          // E(x) = 1 + (1/M)·Σ E(x − v) over odd v ≤ min(x, 2M − 1)
          const hi = x - 1, lo = x - 1 - 2 * M;
          const sum = hi < 0 ? 0 : S[hi] - (lo >= 0 ? S[lo] : 0);
          E[x] = 1 + sum / M;
          S[x] = E[x] + (x >= 2 ? S[x - 2] : 0);
        }
        return E[T];
      };
      return { kind: 'number', value: 2 * discrete(48000) - discrete(24000), tol: 0.0005 }; // M divisible by 6 keeps 2M·t integral
    }
    // Distribution of the total after t rolls, by convolution: E[T] = Σ_t P(S_t < N); P(hit) = Σ_t P(S_t = N).
    let dist = new Map<number, Q>([[0, Q.ONE]]);
    let acc = Q.ZERO;
    for (let t = 0; t <= p.N; t++) {
      if (p.ask === 'hit') acc = acc.add(dist.get(p.N) ?? Q.ZERO);
      else for (const [s, pr] of dist) if (s < p.N) acc = acc.add(pr);
      const next = new Map<number, Q>();
      for (const [s, pr] of dist)
        if (s < p.N)
          for (let j = 1; j <= p.sides; j++) next.set(s + j, (next.get(s + j) ?? Q.ZERO).add(pr.div(p.sides)));
      dist = next;
    }
    return R(acc);
  },
  hints: (p) =>
    p.ask === 'continuous'
      ? ['Compute P(more than n draws are needed).', 'That is the volume of {u ∈ [0,1]ⁿ : Σu ≤ t}.', 'E[N] = Σ P(N > n).']
      : ['Condition on the first (or last) roll.', p.ask === 'hit' ? 'h(n) = average of h(n−1), …, h(n−k).' : 'E(n) = 1 + average of E(n−1), …, E(n−k), with E ≤ 0 equal to 0.', 'Build the table up from small n.'],
  verifiedBy: 'the exact distribution of the running total (convolution), or for the continuous case a fine discretisation',
};

export const MARKOV = [gamblersRuin, maze, penney, stationary, runningTotal] as Generator<unknown>[];
