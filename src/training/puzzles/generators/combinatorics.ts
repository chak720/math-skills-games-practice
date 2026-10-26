/** Combinatorics puzzle generators. */
import { choose, factorial, multinomial, stirling2 } from '@/shared/math/combinatorics';
import { lcmNum } from '@/shared/math/combinatorics';
import type { Generator } from '../types';
import { I, words } from '../util';

// ------------------------------------------------------------------ word arrangements

interface WordP { word: string; kind: 'all' | 'block' | 'apart' | 'ends'; letter: string; flavour: number }
const WORDS = ['BANANA', 'LETTER', 'COFFEE', 'SUCCESS', 'PEPPER', 'BALLOON', 'ADDRESS', 'BOOKKEEPER', 'STATISTICS', 'MISSISSIPPI', 'TATTOO', 'ASSESS', 'CANNON', 'COOKBOOK', 'REFERRED', 'GAZEBO', 'SEESAW', 'PARALLEL', 'TOMORROW', 'COMMITTEE'];

const counts = (w: string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const c of w) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
};

/** Distinct arrangements of a multiset, enumerated (for verification) with an optional filter. */
function enumerateArrangements(w: string, ok: (s: string) => boolean): number {
  const m = counts(w);
  const letters = [...m.keys()];
  const left = letters.map((l) => m.get(l)!);
  let n = 0;
  const cur: string[] = [];
  const rec = (): void => {
    if (cur.length === w.length) {
      if (ok(cur.join(''))) n++;
      return;
    }
    for (let i = 0; i < letters.length; i++) {
      if (!left[i]) continue;
      left[i]--;
      cur.push(letters[i]);
      rec();
      cur.pop();
      left[i]++;
    }
  };
  rec();
  return n;
}

export const wordArrangements: Generator<WordP> = {
  id: 'word-arrangements',
  category: 'combinatorics',
  title: 'Arrangements with repeated letters',
  techniques: ['counting', 'complement'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const pool = tier === 'warmup' ? WORDS.filter((w) => w.length <= 7) : tier === 'interview' ? WORDS.filter((w) => w.length <= 9) : WORDS;
    let word = r.pick(pool);
    if (r.chance(0.35)) {
      // A fresh random multiset word for extra variety.
      const L = tier === 'warmup' ? r.range(5, 6) : r.range(6, 9);
      const alpha = r.sample(['A', 'B', 'C', 'D', 'E', 'R', 'S', 'T'], r.range(3, 4));
      word = Array.from({ length: L }, () => r.pick(alpha)).sort().join('');
      if (new Set(word).size === word.length) word = word.slice(0, -1) + word[0];
    }
    const repeated = [...counts(word)].filter(([, c]) => c >= 2).map(([l]) => l);
    const kind = tier === 'warmup' ? r.pick(['all', 'block'] as const) : r.pick(['all', 'block', 'apart', 'ends'] as const);
    return { word, kind, letter: r.pick(repeated.length ? repeated : [word[0]]), flavour: r.int(2) };
  },
  structure: (p) => `words:${p.kind}`,
  render(p) {
    const c = counts(p.word).get(p.letter)!;
    const base = p.flavour === 0 ? `How many distinct arrangements are there of the letters of ${p.word}` : `How many different strings can be made by rearranging all the letters ${p.word.split('').join(' ')}`;
    const cond = {
      all: '',
      block: ` in which all ${c === 2 ? 'both' : `${words(c)}`} ${p.letter}'s appear together as one block`,
      apart: ` in which no two ${p.letter}'s are next to each other`,
      ends: ` that begin and end with the same letter`,
    }[p.kind];
    return { prompt: `${base}${cond}?`, ask: 'Give a whole number.' };
  },
  solve(p) {
    const m = counts(p.word);
    const n = p.word.length;
    const list = [...m.entries()];
    const multi = (cs: number[]): bigint => multinomial(cs);
    const fmt = list.map(([l, c]) => `${l}×${c}`).join(', ');
    const total = multi(list.map(([, c]) => c));
    const steps = [`${p.word} has ${n} letters: ${fmt}. All arrangements: ${n}! / (${list.map(([, c]) => `${c}!`).join('·')}) = ${total}.`];
    let ans: bigint;
    if (p.kind === 'all') ans = total;
    else if (p.kind === 'block') {
      const c = m.get(p.letter)!;
      const cs = list.map(([l, k]) => (l === p.letter ? 1 : k));
      ans = multi(cs);
      steps.push(`Glue the ${c} ${p.letter}'s into one block; it behaves like a single letter, leaving ${n - c + 1} objects: ${n - c + 1}! / (${list.filter(([l]) => l !== p.letter).map(([, k]) => `${k}!`).join('·') || '1'}) = ${ans}.`);
    } else if (p.kind === 'apart') {
      const c = m.get(p.letter)!;
      const rest = list.filter(([l]) => l !== p.letter).map(([, k]) => k);
      const others = n - c;
      const arrOthers = multi(rest.length ? rest : [0]);
      const gaps = others + 1;
      ans = arrOthers * choose(gaps, c);
      steps.push(`Gap method: arrange the other ${others} letters first: ${arrOthers} ways. They create ${gaps} gaps (ends included); choose ${c} distinct gaps for the ${p.letter}'s: C(${gaps}, ${c}) = ${choose(gaps, c)}.`, `Total: ${arrOthers} × ${choose(gaps, c)} = ${ans}.`);
    } else {
      // Sum over the letter that sits at both ends.
      let s = 0n;
      const parts: string[] = [];
      for (const [l, c] of list) {
        if (c < 2) continue;
        const cs = list.map(([x, k]) => (x === l ? k - 2 : k)).filter((k) => k > 0);
        const v = multi(cs.length ? cs : [0]);
        s += v;
        parts.push(`${l}…${l}: ${v}`);
      }
      ans = s;
      steps.push('Case on the letter at both ends (it must appear at least twice), then arrange the middle freely.', `${parts.join('; ')}. Sum: ${ans}.`);
    }
    return { answer: I(ans), steps };
  },
  verify(p) {
    const ok = (s: string): boolean => {
      if (p.kind === 'all') return true;
      if (p.kind === 'block') return new RegExp(`${p.letter}{${counts(p.word).get(p.letter)}}`).test(s);
      if (p.kind === 'apart') return !s.includes(p.letter + p.letter);
      return s[0] === s[s.length - 1];
    };
    return I(enumerateArrangements(p.word, ok));
  },
  hints: (p) => [
    'Identical letters are indistinguishable: divide n! by the factorial of each multiplicity.',
    p.kind === 'block' ? 'Treat the block as a single super-letter.' : p.kind === 'apart' ? 'Place the other letters first, then drop the separated letters into gaps.' : p.kind === 'ends' ? 'Split by which letter occupies both ends.' : 'Multinomial coefficient.',
    p.kind === 'apart' ? 'With m other letters there are m + 1 gaps; choose distinct gaps.' : 'n!/(a!·b!·…) counts arrangements of a multiset.',
  ],
  verifiedBy: 'enumerating every distinct arrangement',
};

// ------------------------------------------------------------------ inclusion–exclusion divisibility

interface DivP { N: number; ds: number[]; kind: 'any' | 'none' | 'exactly-one' | 'first-not-others' }

export const divisibility: Generator<DivP> = {
  id: 'divisibility',
  category: 'combinatorics',
  title: 'Inclusion–exclusion counts',
  techniques: ['inclusion-exclusion', 'number-theory'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const k = tier === 'warmup' ? 2 : tier === 'interview' ? r.range(2, 3) : 3;
    const pool = tier === 'hard' ? [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15] : [2, 3, 5, 7, 4, 6];
    const ds = r.sample(pool, k).sort((a, b) => a - b);
    const N = r.pick([100, 200, 360, 500, 999, 1000, 2024, 2500, 3600, 5000].filter((x) => tier !== 'warmup' || x <= 1000)) + (tier === 'hard' ? r.range(0, 50) : 0);
    const kind = tier === 'warmup' ? r.pick(['any', 'none'] as const) : r.pick(['any', 'none', 'exactly-one', 'first-not-others'] as const);
    return { N, ds, kind };
  },
  structure: (p) => `div:${p.ds.length}:${p.kind}`,
  render(p) {
    const list = p.ds.length === 2 ? `${p.ds[0]} or ${p.ds[1]}` : `${p.ds[0]}, ${p.ds[1]} or ${p.ds[2]}`;
    const q2 = {
      any: `divisible by at least one of ${list}`,
      none: `divisible by none of ${list}`,
      'exactly-one': `divisible by exactly one of ${list}`,
      'first-not-others': `divisible by ${p.ds[0]} but not by ${p.ds.slice(1).join(p.ds.length === 2 ? '' : ' or ')}`,
    }[p.kind];
    return { prompt: `How many integers from 1 to ${p.N.toLocaleString()} are ${q2}?`, ask: 'Give a whole number.' };
  },
  solve(p) {
    const f = (d: number): number => Math.floor(p.N / d);
    const subsets: number[][] = [];
    for (let m = 1; m < 1 << p.ds.length; m++) subsets.push(p.ds.filter((_, i) => (m >> i) & 1));
    const L = (s: number[]): number => s.reduce((a, b) => lcmNum(a, b), 1);
    const steps: string[] = ['⌊N/d⌋ counts multiples of d up to N; multiples of both a and b are multiples of lcm(a, b).'];
    const union = subsets.reduce((acc, s) => acc + (s.length % 2 ? 1 : -1) * f(L(s)), 0);
    steps.push(`|A ∪ B${p.ds.length === 3 ? ' ∪ C' : ''}| = ${subsets.map((s) => `${s.length % 2 ? '+' : '−'}⌊${p.N}/${L(s)}⌋`).join(' ').replace(/^\+/, '')} = ${union}.`);
    let ans: number;
    if (p.kind === 'any') ans = union;
    else if (p.kind === 'none') {
      ans = p.N - union;
      steps.push(`None of them: ${p.N} − ${union} = ${ans}.`);
    } else if (p.kind === 'first-not-others') {
      const a = p.ds[0];
      const rest = p.ds.slice(1);
      const sub: number[][] = [];
      for (let m = 1; m < 1 << rest.length; m++) sub.push(rest.filter((_, i) => (m >> i) & 1));
      const overlap = sub.reduce((acc, s) => acc + (s.length % 2 ? 1 : -1) * f(L([a, ...s])), 0);
      ans = f(a) - overlap;
      steps.push(`Multiples of ${a}: ${f(a)}. Remove those also divisible by ${rest.join(' or ')} (inclusion–exclusion on lcms with ${a}): ${overlap}. Answer ${ans}.`);
    } else {
      // Exactly one: Σ|Aᵢ| − 2Σ|Aᵢ∩Aⱼ| + 3|A∩B∩C|
      const s1 = p.ds.reduce((a, d) => a + f(d), 0);
      const s2 = subsets.filter((s) => s.length === 2).reduce((a, s) => a + f(L(s)), 0);
      const s3 = subsets.filter((s) => s.length === 3).reduce((a, s) => a + f(L(s)), 0);
      ans = s1 - 2 * s2 + 3 * s3;
      steps.push(`Exactly one: Σ|Aᵢ| − 2Σ|Aᵢ ∩ Aⱼ| + 3|A₁ ∩ A₂ ∩ A₃| = ${s1} − 2·${s2}${p.ds.length === 3 ? ` + 3·${s3}` : ''} = ${ans}.`);
    }
    return { answer: I(ans), steps };
  },
  verify(p) {
    let c = 0;
    for (let x = 1; x <= p.N; x++) {
      const hits = p.ds.filter((d) => x % d === 0).length;
      if (p.kind === 'any' ? hits > 0 : p.kind === 'none' ? hits === 0 : p.kind === 'exactly-one' ? hits === 1 : x % p.ds[0] === 0 && hits === 1) c++;
    }
    return I(c);
  },
  hints: (p) => ['Count multiples of each number with ⌊N/d⌋.', 'Multiples of both a and b are multiples of lcm(a, b) — not of a·b unless they are coprime.', p.kind === 'exactly-one' ? 'Exactly one = Σ|Aᵢ| − 2Σ|Aᵢ∩Aⱼ| + 3|A∩B∩C|.' : 'Add singles, subtract pairs, add triples.'],
  verifiedBy: 'checking every integer directly',
};

// ------------------------------------------------------------------ stars and bars

interface StarsP { n: number; k: number; lo: number; cap: number | null; ctx: number }
const STARS_CTX = [
  (n: number, k: number) => `In how many ways can ${n} identical sweets be shared among ${words(k)} children`,
  (n: number, k: number) => `A shop sells ${words(k)} flavours of doughnut. In how many ways can you buy a box of ${n} doughnuts`,
  (n: number, k: number) => `How many solutions in integers are there to x₁ + … + x_${k} = ${n}`,
];

export const starsAndBars: Generator<StarsP> = {
  id: 'stars-bars',
  category: 'combinatorics',
  title: 'Stars and bars',
  techniques: ['stars-and-bars', 'inclusion-exclusion'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const k = r.range(3, tier === 'warmup' ? 4 : 5);
    const n = r.range(k + 2, tier === 'warmup' ? 10 : 16);
    const lo = r.pick(tier === 'warmup' ? [0, 1] : [0, 1, 2].filter((x) => x * k <= n));
    const cap = tier === 'hard' ? r.range(Math.ceil(n / k), n - 1) : null;
    return { n, k, lo, cap, ctx: r.int(STARS_CTX.length) };
  },
  structure: (p) => `stars:${p.lo ? 'lower' : 'free'}:${p.cap ? 'cap' : 'nocap'}`,
  render(p) {
    const cond = p.ctx === 2 ? ` with every xᵢ ≥ ${p.lo}${p.cap ? ` and every xᵢ ≤ ${p.cap}` : ''}` : `${p.lo ? ` if every ${p.ctx === 0 ? 'child gets' : 'flavour is included'} at least ${words(p.lo)}` : ''}${p.cap ? `${p.lo ? ' and' : ' if'} no ${p.ctx === 0 ? 'child gets' : 'flavour appears'} more than ${p.cap}` : ''}`;
    return { prompt: `${STARS_CTX[p.ctx](p.n, p.k)}${cond}?`, ask: 'Give a whole number.' };
  },
  solve(p) {
    const m = p.n - p.k * p.lo; // after giving everyone the minimum
    const steps = [p.lo ? `Give each of the ${p.k} the minimum ${p.lo} first; ${m} remain to distribute freely.` : `Distribute ${p.n} identical items into ${p.k} distinct boxes.`, `Stars and bars: ${m} stars and ${p.k - 1} bars, so C(${m} + ${p.k - 1}, ${p.k - 1}) = ${choose(m + p.k - 1, p.k - 1)} without an upper limit.`];
    if (!p.cap) return { answer: I(choose(m + p.k - 1, p.k - 1)), steps };
    const c = p.cap - p.lo; // upper bound after the shift
    let tot = 0n;
    const terms: string[] = [];
    for (let j = 0; j <= p.k && m - j * (c + 1) >= 0; j++) {
      const t = choose(p.k, j) * choose(m - j * (c + 1) + p.k - 1, p.k - 1);
      tot += j % 2 ? -t : t;
      terms.push(`${j % 2 ? '−' : '+'} C(${p.k}, ${j})·C(${m - j * (c + 1) + p.k - 1}, ${p.k - 1})`);
    }
    steps.push(`Upper limit ${p.cap} (i.e. ≤ ${c} after the shift): inclusion–exclusion over the boxes that overflow. If j chosen boxes get at least ${c + 1}, pre-fill them: ${terms.join(' ').replace(/^\+ /, '')} = ${tot}.`);
    return { answer: I(tot), steps };
  },
  verify(p) {
    // DP: ways[t] for t items into the first b boxes with bounds.
    const hi = p.cap ?? p.n;
    let ways = new Array<bigint>(p.n + 1).fill(0n);
    ways[0] = 1n;
    for (let b = 0; b < p.k; b++) {
      const next = new Array<bigint>(p.n + 1).fill(0n);
      for (let t = 0; t <= p.n; t++) for (let x = p.lo; x <= hi && t + x <= p.n; x++) next[t + x] += ways[t];
      ways = next;
    }
    return I(ways[p.n]);
  },
  hints: (p) => ['Picture the items as stars in a row and the dividers between boxes as bars.', p.lo ? 'First hand out the required minimum, then distribute the rest freely.' : 'n stars and k − 1 bars: choose the bar positions.', p.cap ? 'For an upper limit, subtract the arrangements where some box overflows (inclusion–exclusion).' : 'C(n + k − 1, k − 1).'],
  verifiedBy: 'dynamic programming over the boxes',
};

// ------------------------------------------------------------------ grid paths

interface GridP { w: number; h: number; blocked: [number, number][]; via: [number, number] | null }

export const gridPaths: Generator<GridP> = {
  id: 'grid-paths',
  category: 'combinatorics',
  title: 'Lattice paths',
  techniques: ['counting', 'inclusion-exclusion', 'dynamic-programming'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const w = r.range(3, tier === 'warmup' ? 4 : 6), h = r.range(3, tier === 'warmup' ? 4 : 6);
    const interior = (): [number, number] => [r.range(1, w - 1), r.range(1, h - 1)];
    if (tier === 'warmup') return { w, h, blocked: r.chance(0.5) ? [interior()] : [], via: null };
    const nb = tier === 'hard' ? 2 : 1;
    const blocked: [number, number][] = [];
    while (blocked.length < nb) {
      const pt = interior();
      if (!blocked.some((b) => b[0] === pt[0] && b[1] === pt[1])) blocked.push(pt);
    }
    let via: [number, number] | null = null;
    if (r.chance(0.35)) {
      const v = interior();
      if (!blocked.some((b) => b[0] === v[0] && b[1] === v[1])) via = v;
    }
    return { w, h, blocked, via };
  },
  structure: (p) => `grid:${p.blocked.length}:${p.via ? 'via' : 'free'}`,
  render(p) {
    const rows: string[] = [];
    for (let y = p.h; y >= 0; y--) {
      let row = '    ';
      for (let x = 0; x <= p.w; x++) {
        const b = p.blocked.some((q) => q[0] === x && q[1] === y);
        const v = p.via && p.via[0] === x && p.via[1] === y;
        row += x === 0 && y === 0 ? 'A' : x === p.w && y === p.h ? 'B' : b ? 'X' : v ? 'V' : '·';
        if (x < p.w) row += ' ';
      }
      rows.push(row);
    }
    const blockTxt = p.blocked.length ? ` You may not pass through the point${p.blocked.length > 1 ? 's' : ''} marked X.` : '';
    const viaTxt = p.via ? ' The path must pass through the point marked V.' : '';
    return { prompt: `On the grid below you walk from A (bottom-left) to B (top-right), moving one step right or one step up at a time.${blockTxt}${viaTxt} How many different paths are there?\n\n${rows.join('\n')}`, ask: 'Give a whole number.' };
  },
  solve(p) {
    const paths = (a: [number, number], b: [number, number]): bigint => (b[0] < a[0] || b[1] < a[1] ? 0n : choose(b[0] - a[0] + b[1] - a[1], b[0] - a[0]));
    const A: [number, number] = [0, 0], B: [number, number] = [p.w, p.h];
    // Count paths from s to t avoiding blocked points (inclusion–exclusion over ordered blocked chains).
    const avoid = (s: [number, number], t: [number, number]): bigint => {
      const pts = p.blocked.filter((b) => b[0] >= s[0] && b[1] >= s[1] && b[0] <= t[0] && b[1] <= t[1]).sort((x, y) => x[0] + x[1] - (y[0] + y[1]) || x[0] - y[0]);
      let total = 0n;
      for (let m = 0; m < 1 << pts.length; m++) {
        const chain = pts.filter((_, i) => (m >> i) & 1);
        let ok = true, ways = 1n, cur = s;
        for (const c of chain) {
          if (c[0] < cur[0] || c[1] < cur[1]) { ok = false; break; }
          ways *= paths(cur, c);
          cur = c;
        }
        if (!ok) continue;
        ways *= paths(cur, t);
        total += chain.length % 2 ? -ways : ways;
      }
      return total;
    };
    const steps = [`Each path is a sequence of ${p.w} rights and ${p.h} ups, so without restrictions there are C(${p.w + p.h}, ${p.w}) = ${paths(A, B)} paths.`];
    if (p.blocked.length) steps.push(`Paths through a blocked point P number paths(A→P)·paths(P→B); subtract them, adding back paths through both blocked points (inclusion–exclusion).`);
    let ans: bigint;
    if (p.via) {
      const a = avoid(A, p.via), b = avoid(p.via, B);
      ans = a * b;
      steps.push(`Forced through V = (${p.via[0]}, ${p.via[1]}): count A→V and V→B separately (each avoiding X) and multiply: ${a} × ${b} = ${ans}.`);
    } else {
      ans = avoid(A, B);
      steps.push(`Result: ${ans}.`);
    }
    return { answer: I(ans), steps };
  },
  verify(p) {
    // Dynamic programming over the grid.
    const blocked = (x: number, y: number): boolean => p.blocked.some((b) => b[0] === x && b[1] === y);
    const dp = (sx: number, sy: number, tx: number, ty: number): bigint => {
      const W = tx - sx, H = ty - sy;
      if (W < 0 || H < 0) return 0n;
      const g = Array.from({ length: W + 1 }, () => new Array<bigint>(H + 1).fill(0n));
      for (let x = 0; x <= W; x++)
        for (let y = 0; y <= H; y++) {
          if (blocked(sx + x, sy + y)) continue;
          if (x === 0 && y === 0) g[x][y] = 1n;
          else g[x][y] = (x > 0 ? g[x - 1][y] : 0n) + (y > 0 ? g[x][y - 1] : 0n);
        }
      return g[W][H];
    };
    return I(p.via ? dp(0, 0, p.via[0], p.via[1]) * dp(p.via[0], p.via[1], p.w, p.h) : dp(0, 0, p.w, p.h));
  },
  hints: (p) => ['A path is a word of R’s and U’s: how many such words?', p.blocked.length ? 'Count paths that DO pass through a blocked point and subtract them.' : 'Split the path at the forced point.', 'paths(a→b) = C(Δx + Δy, Δx); paths through P = paths(A→P)·paths(P→B).'],
  verifiedBy: 'dynamic programming across the grid',
};

// ------------------------------------------------------------------ committees

interface CommitteeP { men: number; women: number; k: number; kind: 'each' | 'exact' | 'feud' | 'chair'; j: number }

export const committees: Generator<CommitteeP> = {
  id: 'committees',
  category: 'combinatorics',
  title: 'Choosing committees',
  techniques: ['counting', 'complement'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const men = r.range(3, tier === 'warmup' ? 6 : 8), women = r.range(3, tier === 'warmup' ? 6 : 8);
    const k = r.range(3, Math.min(5, men + women - 2));
    const kind = r.pick(tier === 'warmup' ? (['each', 'exact'] as const) : (['each', 'exact', 'feud', 'chair'] as const));
    return { men, women, k, kind, j: r.range(1, Math.min(k - 1, women)) };
  },
  structure: (p) => `committee:${p.kind}`,
  render(p) {
    const base = `A department has ${p.men} analysts and ${p.women} traders. A committee of ${words(p.k)} is chosen.`;
    const ask = {
      each: 'How many committees include at least one analyst and at least one trader?',
      exact: `How many committees contain exactly ${words(p.j)} trader${p.j === 1 ? '' : 's'}?`,
      feud: 'Two of the traders refuse to serve together. How many committees are possible?',
      chair: 'One member of the committee is also named its chair. How many (committee, chair) choices are there?',
    }[p.kind];
    return { prompt: `${base} ${ask}`, ask: 'Give a whole number.' };
  },
  solve(p) {
    const n = p.men + p.women;
    const all = choose(n, p.k);
    let ans: bigint;
    const steps = [`Total without restrictions: C(${n}, ${p.k}) = ${all}.`];
    if (p.kind === 'each') {
      ans = all - choose(p.men, p.k) - choose(p.women, p.k);
      steps.push(`Subtract the all-analyst committees C(${p.men}, ${p.k}) = ${choose(p.men, p.k)} and all-trader committees C(${p.women}, ${p.k}) = ${choose(p.women, p.k)}: ${ans}.`);
    } else if (p.kind === 'exact') {
      ans = choose(p.women, p.j) * choose(p.men, p.k - p.j);
      steps.push(`Choose the ${p.j} trader${p.j === 1 ? '' : 's'} and the ${p.k - p.j} analysts independently: C(${p.women}, ${p.j})·C(${p.men}, ${p.k - p.j}) = ${ans}.`);
    } else if (p.kind === 'feud') {
      ans = all - choose(n - 2, p.k - 2);
      steps.push(`Subtract committees containing both feuding traders: fix them and choose ${p.k - 2} of the other ${n - 2}: C(${n - 2}, ${p.k - 2}) = ${choose(n - 2, p.k - 2)}. Answer ${ans}.`);
    } else {
      ans = all * BigInt(p.k);
      steps.push(`Choose the committee, then the chair from its ${p.k} members: ${all} × ${p.k} = ${ans}. (Equivalently choose the chair first: ${n}·C(${n - 1}, ${p.k - 1}).)`);
    }
    return { answer: I(ans), steps };
  },
  verify(p) {
    const n = p.men + p.women;
    let c = 0;
    for (let m = 0; m < 1 << n; m++) {
      let bits = 0, women = 0;
      for (let i = 0; i < n; i++) if ((m >> i) & 1) { bits++; if (i >= p.men) women++; }
      if (bits !== p.k) continue;
      const feudBoth = ((m >> p.men) & 1) === 1 && ((m >> (p.men + 1)) & 1) === 1;
      if (p.kind === 'each' ? women > 0 && women < p.k : p.kind === 'exact' ? women === p.j : p.kind === 'feud' ? !feudBoth : true) c += p.kind === 'chair' ? p.k : 1;
    }
    return I(c);
  },
  hints: (p) => ['Order does not matter: use combinations.', p.kind === 'each' || p.kind === 'feud' ? 'Count everything, then subtract the forbidden committees.' : 'Choose each group separately and multiply.', p.kind === 'chair' ? 'Choose the committee, then its chair (or the chair first).' : 'C(n, k) counts subsets of size k.'],
  verifiedBy: 'checking every subset of people',
};

// ------------------------------------------------------------------ round tables

interface RoundP { n: number; kind: 'together' | 'apart' | 'couples'; couples: number }

export const roundTable: Generator<RoundP> = {
  id: 'round-table',
  category: 'combinatorics',
  title: 'Circular arrangements',
  techniques: ['counting', 'inclusion-exclusion', 'symmetry'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const kind = tier === 'hard' ? 'couples' : r.pick(['together', 'apart'] as const);
    const couples = kind === 'couples' ? r.range(2, 3) : 0;
    const n = kind === 'couples' ? couples * 2 + r.range(0, 2) : r.range(5, tier === 'warmup' ? 6 : 8);
    return { n, kind, couples };
  },
  structure: (p) => `round:${p.kind}`,
  render(p) {
    const base = `${words(p.n)[0].toUpperCase()}${words(p.n).slice(1)} people sit around a round table; seatings that differ only by a rotation count as the same.`;
    const ask = { together: 'In how many seatings do Ana and Ben sit next to each other?', apart: 'In how many seatings are Ana and Ben not next to each other?', couples: `Among them are ${words(p.couples)} couples. In how many seatings does no couple sit next to each other?` }[p.kind];
    return { prompt: `${base} ${ask}`, ask: 'Give a whole number.' };
  },
  solve(p) {
    const total = factorial(p.n - 1);
    const steps = [`Fix one person's seat to remove rotations: (${p.n} − 1)! = ${total} seatings.`];
    let ans: bigint;
    if (p.kind !== 'couples') {
      const tog = 2n * factorial(p.n - 2);
      steps.push(`Glue Ana and Ben into a block (2 internal orders): ${p.n - 1} units around the table, so 2·(${p.n - 2})! = ${tog}.`);
      ans = p.kind === 'together' ? tog : total - tog;
      if (p.kind === 'apart') steps.push(`Not together: ${total} − ${tog} = ${ans}.`);
    } else {
      let s = 0n;
      const terms: string[] = [];
      for (let j = 0; j <= p.couples; j++) {
        const t = choose(p.couples, j) * 2n ** BigInt(j) * factorial(p.n - j - 1);
        s += j % 2 ? -t : t;
        terms.push(`${j % 2 ? '−' : '+'} C(${p.couples}, ${j})·2^${j}·(${p.n - j - 1})!`);
      }
      ans = s;
      steps.push(`Inclusion–exclusion over couples sitting together: gluing j couples leaves ${p.n} − j units and 2^j internal orders.`, `${terms.join(' ').replace(/^\+ /, '')} = ${ans}.`);
    }
    return { answer: I(ans), steps };
  },
  verify(p) {
    // Brute force with person 0 fixed in seat 0 (removes rotations).
    const others = Array.from({ length: p.n - 1 }, (_, i) => i + 1);
    let c = 0;
    const partner = (x: number): number => (x < p.couples * 2 ? (x % 2 ? x - 1 : x + 1) : -1);
    const rec = (seat: number[], left: number[]): void => {
      if (!left.length) {
        const adj = (a: number, b: number): boolean => {
          const ia = seat.indexOf(a), ib = seat.indexOf(b);
          const d = Math.abs(ia - ib);
          return d === 1 || d === p.n - 1;
        };
        if (p.kind === 'couples') {
          let ok = true;
          for (let i = 0; i < p.couples * 2; i += 2) if (adj(i, partner(i))) ok = false;
          if (ok) c++;
        } else if (adj(0, 1) === (p.kind === 'together')) c++;
        return;
      }
      for (let i = 0; i < left.length; i++) rec([...seat, left[i]], left.filter((_, j) => j !== i));
    };
    rec([0], others);
    return I(c);
  },
  hints: (p) => ['Rotations are the same seating: fix one person, then arrange the rest in a line.', p.kind === 'couples' ? 'Use inclusion–exclusion over which couples sit together.' : 'Treat the two as a single block.', p.kind === 'couples' ? 'Gluing j couples leaves n − j units: (n − j − 1)! circular orders, times 2^j.' : 'A block of 2 has 2 internal orders.'],
  verifiedBy: 'enumerating every seating with one person fixed',
};

// ------------------------------------------------------------------ surjections

interface SurjP { n: number; k: number; ctx: number }

export const surjections: Generator<SurjP> = {
  id: 'surjections',
  category: 'combinatorics',
  title: 'Onto functions',
  techniques: ['inclusion-exclusion'],
  tiers: ['interview', 'hard'],
  params: (r, tier) => {
    const k = r.range(2, tier === 'interview' ? 3 : 4);
    return { k, n: r.range(k + 1, tier === 'interview' ? 6 : 7), ctx: r.int(3) };
  },
  structure: () => 'surjections',
  render(p) {
    const s = [
      `${words(p.n)[0].toUpperCase()}${words(p.n).slice(1)} distinct tasks are each assigned to one of ${words(p.k)} analysts. In how many ways can this be done so that every analyst gets at least one task?`,
      `In how many ways can ${words(p.n)} distinguishable balls be placed into ${words(p.k)} distinguishable boxes with no box left empty?`,
      `How many functions from a ${p.n}-element set onto a ${p.k}-element set are there (every element of the codomain is hit)?`,
    ][p.ctx];
    return { prompt: s, ask: 'Give a whole number.' };
  },
  solve(p) {
    let s = 0n;
    const terms: string[] = [];
    for (let j = 0; j <= p.k; j++) {
      const t = choose(p.k, j) * BigInt(p.k - j) ** BigInt(p.n);
      s += j % 2 ? -t : t;
      terms.push(`${j % 2 ? '−' : '+'} C(${p.k}, ${j})·${p.k - j}^${p.n}`);
    }
    return {
      answer: I(s),
      steps: [`All assignments: ${p.k}^${p.n}. Subtract those missing some box by inclusion–exclusion over the set of empty boxes.`, `${terms.join(' ').replace(/^\+ /, '')} = ${s}.`, `Equivalently ${p.k}!·S(${p.n}, ${p.k}) with S a Stirling number of the second kind: ${p.k}! × ${stirling2(p.n, p.k)}.`],
    };
  },
  verify(p) {
    let c = 0;
    const total = p.k ** p.n;
    for (let m = 0; m < total; m++) {
      let x = m;
      const hit = new Set<number>();
      for (let i = 0; i < p.n; i++) {
        hit.add(x % p.k);
        x = Math.floor(x / p.k);
      }
      if (hit.size === p.k) c++;
    }
    return I(c);
  },
  hints: () => ['Count all assignments, then remove the ones that leave someone empty.', 'Inclusion–exclusion over which boxes are empty.', 'Σ (−1)^j C(k, j)(k − j)^n.'],
  verifiedBy: 'checking every assignment',
};

// ------------------------------------------------------------------ necklaces (Burnside)

interface NeckP { n: number; k: number }
const totient = (n: number): number => {
  let result = n, m = n;
  for (let p2 = 2; p2 * p2 <= m; p2++)
    if (m % p2 === 0) {
      while (m % p2 === 0) m /= p2;
      result -= result / p2;
    }
  if (m > 1) result -= result / m;
  return result;
};

export const necklaces: Generator<NeckP> = {
  id: 'necklaces',
  category: 'combinatorics',
  title: "Counting up to rotation (Burnside)",
  techniques: ['burnside', 'symmetry'],
  tiers: ['hard'],
  params: (r) => ({ n: r.range(4, 8), k: r.range(2, 3) }),
  structure: () => 'necklaces',
  render: (p) => ({ prompt: `A necklace has ${words(p.n)} beads equally spaced on a circle, each one of ${words(p.k)} colours. Two necklaces are the same if one can be rotated into the other (no flipping). How many different necklaces are there?`, ask: 'Give a whole number.' }),
  solve(p) {
    let s = 0;
    const parts: string[] = [];
    for (let d = 1; d <= p.n; d++)
      if (p.n % d === 0) {
        s += totient(d) * p.k ** (p.n / d);
        parts.push(`φ(${d})·${p.k}^${p.n / d}`);
      }
    const ans = s / p.n;
    return {
      answer: I(ans),
      steps: [
        `Burnside: the number of orbits equals the average number of colourings fixed by each of the ${p.n} rotations.`,
        `Rotation by r positions splits the beads into gcd(r, ${p.n}) cycles, so it fixes ${p.k}^gcd(r, ${p.n}) colourings. Grouping rotations by d = ${p.n}/gcd: Σ_{d | ${p.n}} φ(d)·${p.k}^(${p.n}/d).`,
        `(1/${p.n})·(${parts.join(' + ')}) = ${s}/${p.n} = ${ans}.`,
      ],
    };
  },
  verify(p) {
    // Canonical form = lexicographically smallest rotation; count distinct.
    const seen = new Set<string>();
    const total = p.k ** p.n;
    for (let m = 0; m < total; m++) {
      let x = m;
      const a: number[] = [];
      for (let i = 0; i < p.n; i++) {
        a.push(x % p.k);
        x = Math.floor(x / p.k);
      }
      let best = '';
      for (let r = 0; r < p.n; r++) {
        const s = [...a.slice(r), ...a.slice(0, r)].join('');
        if (!best || s < best) best = s;
      }
      seen.add(best);
    }
    return I(seen.size);
  },
  hints: () => ['Many colourings are the same necklace: count orbits under rotation.', "Burnside's lemma: orbits = average number of colourings fixed by a rotation.", 'A rotation by r fixes exactly the colourings constant on each of its gcd(r, n) cycles.'],
  verifiedBy: 'canonicalising every colouring by brute force',
};


export const COMBINATORICS = [wordArrangements, divisibility, starsAndBars, gridPaths, committees, roundTable, surjections, necklaces] as Generator<unknown>[];
