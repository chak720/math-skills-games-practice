/** Original variants of classic brainteasers, each checked by an independent method. */
import { Q, q } from '@/shared/math/rational';
import { choose, factorial } from '@/shared/math/combinatorics';
import type { Generator } from '../types';
import { I, R, fq, words } from '../util';

// ------------------------------------------------------------------ ants on a stick

interface AntsP { L: number; ants: { x: number; right: boolean }[]; ask: 'time' | 'collisions'; speed: number }

export const ants: Generator<AntsP> = {
  id: 'ants',
  category: 'brainteaser',
  title: 'Ants on a stick',
  techniques: ['invariants'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const L = r.pick([10, 12, 20, 30, 50, 100]);
    const k = tier === 'warmup' ? 3 : tier === 'interview' ? r.range(4, 5) : r.range(5, 7);
    const xs = r.sample(Array.from({ length: L - 1 }, (_, i) => i + 1), k).sort((a, b) => a - b);
    return { L, ants: xs.map((x) => ({ x, right: r.chance(0.5) })), ask: tier === 'warmup' ? 'time' : r.pick(['time', 'collisions'] as const), speed: r.pick([1, 1, 2]) };
  },
  structure: (p) => `ants:${p.ask}`,
  render(p) {
    const desc = p.ants.map((a) => `${a.x} cm facing ${a.right ? 'right' : 'left'}`).join('; ');
    return {
      prompt: `Ants walk along a ${p.L} cm stick at ${p.speed} cm per second. When two ants meet they both instantly turn around; an ant falls off when it reaches an end. Measured from the left end, the ants start at: ${desc}. ${p.ask === 'time' ? 'After how many seconds has the last ant fallen off?' : 'How many collisions (meetings of two ants) happen in total?'}`,
      ask: p.ask === 'time' ? 'Give the exact time in seconds.' : 'Give a whole number.',
    };
  },
  solve(p) {
    if (p.ask === 'time') {
      const times = p.ants.map((a) => q(a.right ? p.L - a.x : a.x, p.speed));
      const t = times.reduce((m, x) => (x.cmp(m) > 0 ? x : m), Q.ZERO);
      return {
        answer: R(t),
        steps: [
          'Trick: when two identical ants bounce, it looks exactly as if they had walked through each other and swapped labels. The set of positions evolves as if every ant walked straight on.',
          `So the last ant falls off when the furthest "ghost" walk ends: ${p.ants.map((a) => `${a.right ? p.L - a.x : a.x}`).join(', ')} cm to their ends.`,
          `Maximum ${t.mul(p.speed)} cm at ${p.speed} cm/s: ${fq(t)} seconds.`,
        ],
      };
    }
    let c = 0;
    for (let i = 0; i < p.ants.length; i++) for (let j = i + 1; j < p.ants.length; j++) if (p.ants[i].right && !p.ants[j].right) c++;
    return {
      answer: I(c),
      steps: [
        'Treat the ants as passing through each other: each meeting of ghosts is exactly one real collision.',
        'Two ghosts meet iff the left one walks right and the right one walks left (they always reach each other before either falls off).',
        `Count such pairs: ${c}.`,
      ],
    };
  },
  verify(p) {
    // Event-driven simulation with exact rationals and real bounces.
    let ants = p.ants.map((a, id) => ({ id, x: q(a.x), v: a.right ? p.speed : -p.speed }));
    let t = Q.ZERO, collisions = 0, lastFall = Q.ZERO;
    for (let guard = 0; guard < 500 && ants.length; guard++) {
      ants.sort((a, b) => a.x.cmp(b.x));
      // next event: a fall or a collision of adjacent ants
      let dt: Q | null = null;
      for (const a of ants) {
        const d = a.v > 0 ? q(p.L).sub(a.x).div(a.v) : a.x.div(-a.v);
        if (!dt || d.cmp(dt) < 0) dt = d;
      }
      for (let i = 0; i + 1 < ants.length; i++) {
        const a = ants[i], b = ants[i + 1];
        if (a.v > 0 && b.v < 0) {
          const d = b.x.sub(a.x).div(a.v - b.v);
          if (d.cmp(dt!) < 0) dt = d;
        }
      }
      t = t.add(dt!);
      for (const a of ants) a.x = a.x.add(dt!.mul(a.v));
      // resolve collisions (equal positions, approaching)
      ants.sort((a, b) => a.x.cmp(b.x));
      for (let i = 0; i + 1 < ants.length; i++) {
        const a = ants[i], b = ants[i + 1];
        if (a.x.eq(b.x) && a.v > 0 && b.v < 0) {
          a.v = -a.v;
          b.v = -b.v;
          collisions++;
        }
      }
      const before = ants.length;
      ants = ants.filter((a) => a.x.cmp(0) > 0 && a.x.cmp(p.L) < 0);
      if (ants.length < before) lastFall = t;
    }
    return p.ask === 'time' ? R(lastFall) : I(collisions);
  },
  hints: () => ['Do the identities of the ants matter for the question?', 'Two ants bouncing look identical to two ants walking through each other.', 'With "ghost" ants walking straight, the answer is a simple max (or a pair count).'],
  verifiedBy: 'an exact event-by-event simulation with real bounces',
};

// ------------------------------------------------------------------ clock hands

interface ClockP { kind: 'angle' | 'overlap' | 'right-angle'; h: number; m: number }

export const clock: Generator<ClockP> = {
  id: 'clock',
  category: 'brainteaser',
  title: 'Clock hands',
  techniques: ['first-step', 'number-theory'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    const kind = r.pick(tier === 'warmup' ? (['angle'] as const) : (['angle', 'overlap', 'right-angle'] as const));
    // At 3:00 and 9:00 the hands already form a right angle, so "first" would be ambiguous.
    const h = kind === 'right-angle' ? r.pick([1, 2, 4, 5, 6, 7, 8, 10, 11]) : r.range(1, 11);
    return { kind, h, m: r.range(1, 59) };
  },
  structure: (p) => `clock:${p.kind}`,
  render(p) {
    if (p.kind === 'angle') return { prompt: `What is the smaller angle, in degrees, between the hour and minute hands of an analogue clock at ${p.h}:${String(p.m).padStart(2, '0')}?`, ask: 'Give the exact angle (a fraction is fine).' };
    if (p.kind === 'overlap') return { prompt: `The hands of a clock are together at 12:00. How many minutes after ${p.h}:00 do the hour and minute hands next point in exactly the same direction?`, ask: 'Give the exact number of minutes.' };
    return { prompt: `How many minutes after ${p.h}:00 are the hour and minute hands first at a right angle (90°)?`, ask: 'Give the exact number of minutes.' };
  },
  solve(p) {
    if (p.kind === 'angle') {
      const hour = q(30 * p.h).add(q(p.m, 2)), minute = q(6 * p.m);
      let d = hour.sub(minute);
      if (d.cmp(0) < 0) d = d.neg();
      if (d.cmp(180) > 0) d = q(360).sub(d);
      return { answer: R(d), steps: ['Minute hand: 6° per minute. Hour hand: 30° per hour plus 0.5° per minute.', `At ${p.h}:${String(p.m).padStart(2, '0')}: hour hand ${hour}°, minute hand ${minute}°.`, `Difference ${hour.sub(minute).cmp(0) < 0 ? minute.sub(hour) : hour.sub(minute)}°; the smaller angle is ${fq(d)}°.`] };
    }
    // Relative speed 5.5°/min. hour − minute starts at 30h and falls; we need it to reach 0 (overlap)
    // or the next value ≡ 90 (mod 180) below 30h (right angle: 90° either side).
    const start = 30 * p.h;
    const gap = p.kind === 'overlap' ? start : (((start - 90) % 180) + 180) % 180;
    const t = q(gap).div(q(11, 2));
    const via = p.kind === 'overlap' ? '' : start - gap === 90 ? ' (minute hand 90° behind)' : start - gap === 270 ? ' (minute hand 270° behind, i.e. 90° ahead the short way)' : ' (minute hand 90° ahead)';
    return {
      answer: R(t),
      steps: [
        `The minute hand gains 6 − 0.5 = 5.5° per minute on the hour hand. At ${p.h}:00 it is ${start}° behind.`,
        p.kind === 'overlap'
          ? `It catches up after ${start} / 5.5 = ${fq(t)} minutes.`
          : `The gap shrinks from ${start}°; the first time it equals 90° or 270° (both are right angles) is after closing ${gap}°${via}.`,
        p.kind === 'overlap' ? 'Equivalently, overlaps happen every 12/11 hours.' : `${gap} / 5.5 = ${fq(t)} minutes.`,
      ],
    };
  },
  verify(p) {
    const hourAt = (t: Q): Q => q(30 * p.h).add(t.div(2));
    const minuteAt = (t: Q): Q => t.mul(6);
    if (p.kind === 'angle') {
      // Reduce |hour − minute| into [0, 360) and take the smaller side.
      let d = hourAt(q(p.m)).sub(minuteAt(q(p.m)));
      while (d.cmp(0) < 0) d = d.add(360);
      while (d.cmp(360) >= 0) d = d.sub(360);
      return R(d.cmp(180) > 0 ? q(360).sub(d) : d);
    }
    // Scan minute by minute for the first t > 0 where the (unwrapped) separation passes a target
    // value: any multiple of 360 for an overlap, any odd multiple of 90 for a right angle.
    const sep = (t: Q): Q => hourAt(t).sub(minuteAt(t));
    for (let m = 0; m < 70; m++) {
      const g0 = sep(q(m)), g1 = sep(q(m + 1));
      for (let v = Math.floor(g0.toNumber() / 90) * 90; v >= Math.floor(g1.toNumber()) - 90; v -= 90) {
        const isTarget = p.kind === 'overlap' ? v % 360 === 0 : Math.abs(v % 180) === 90;
        if (!isTarget || g0.cmp(v) <= 0 || g1.cmp(v) > 0) continue;
        return R(q(m).add(g0.sub(v).div(g0.sub(g1))));
      }
    }
    return R(q(-1));
  },
  hints: (p) => ['Measure both hands in degrees from 12.', p.kind === 'angle' ? 'The hour hand moves 0.5° every minute.' : 'Think of relative speed: how fast does the minute hand gain on the hour hand?', p.kind === 'angle' ? 'Take the difference, then 360° minus it if it exceeds 180°.' : 'Gap to close ÷ 5.5° per minute.'],
  verifiedBy: 'tracking both hands minute by minute and interpolating the crossing exactly',
};

// ------------------------------------------------------------------ bridge and torch

interface BridgeP { times: number[]; cap: number }

export const bridge: Generator<BridgeP> = {
  id: 'bridge',
  category: 'brainteaser',
  title: 'Crossing the bridge',
  techniques: ['dynamic-programming', 'case-analysis'],
  tiers: ['interview', 'hard'],
  params(r, tier) {
    const n = tier === 'interview' ? 4 : r.range(4, 6);
    const times = r.sample([1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25], n).sort((a, b) => a - b);
    return { times, cap: 2 };
  },
  structure: (p) => `bridge:${p.times.length}`,
  render: (p) => ({
    prompt: `${words(p.times.length)[0].toUpperCase()}${words(p.times.length).slice(1)} people must cross a narrow bridge at night. At most two can cross at once and they need the single torch for every crossing, so someone must bring it back. They take ${p.times.slice(0, -1).join(', ')} and ${p.times.at(-1)} minutes to cross alone; a pair moves at the slower person's pace. What is the shortest total time for everyone to get across?`,
    ask: 'Give the time in minutes.',
  }),
  solve(p) {
    const t = [...p.times];
    let total = 0;
    const steps: string[] = ['While more than three people are left, get the two slowest (y, z) across and the torch back by the cheaper of: A, the fastest escorts each in turn and returns (z + y + 2·a); or B, the two fastest cross, the fastest returns, the two slowest cross together, the second fastest returns (a + 2·b + z).'];
    let n = t.length;
    while (n > 3) {
      const a = t[0], b = t[1], y = t[n - 2], z = t[n - 1];
      const optA = z + y + 2 * a;
      const optB = a + 2 * b + z;
      const use = Math.min(optA, optB);
      steps.push(`Send ${z} and ${y} across: option A costs ${optA}, option B costs ${optB} → ${use}.`);
      total += use;
      n -= 2;
    }
    const tail = n === 3 ? t[0] + t[1] + t[2] : n === 2 ? t[1] : t[0];
    steps.push(n === 3 ? `Last three: ${t[0]} + ${t[1]} + ${t[2]} = ${tail}.` : `Last pair crosses: ${tail}.`);
    total += tail;
    steps.push(`Total ${total} minutes.`);
    return { answer: I(total), steps };
  },
  verify(p) {
    // Dijkstra over states (who is on the far side, torch side).
    const n = p.times.length;
    const full = (1 << n) - 1;
    const dist = new Map<string, number>();
    const pq: [number, number, number][] = [[0, 0, 0]]; // cost, far-mask, torch(0 near,1 far)
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [c, far, torch] = pq.shift()!;
      const key = `${far},${torch}`;
      if (dist.has(key)) continue;
      dist.set(key, c);
      if (far === full) return I(c);
      const side = torch === 0 ? full & ~far : far;
      const ids = Array.from({ length: n }, (_, i) => i).filter((i) => (side >> i) & 1);
      for (let i = 0; i < ids.length; i++)
        for (let j = i; j < ids.length; j++) {
          if (torch === 0 && i === j && ids.length > 1) continue; // forward trips carry two when possible (never worse)
          const m = (1 << ids[i]) | (1 << ids[j]);
          const cost = Math.max(p.times[ids[i]], p.times[ids[j]]);
          const nf = torch === 0 ? far | m : far & ~m;
          if (!dist.has(`${nf},${1 - torch}`)) pq.push([c + cost, nf, 1 - torch]);
        }
    }
    return I(-1);
  },
  hints: () => ['The slowest people should cross together if possible.', 'Someone fast must keep bringing the torch back.', 'Compare two ways of getting the two slowest across, and apply the cheaper one repeatedly.'],
  verifiedBy: 'shortest-path search over every possible sequence of crossings',
};

// ------------------------------------------------------------------ egg drop

interface EggP { eggs: number; floors: number }

export const eggDrop: Generator<EggP> = {
  id: 'egg-drop',
  category: 'brainteaser',
  title: 'Egg drop',
  techniques: ['dynamic-programming', 'recursion'],
  tiers: ['interview', 'hard'],
  params: (r, tier) => ({ eggs: tier === 'interview' ? 2 : r.range(2, 4), floors: r.pick(tier === 'interview' ? [36, 50, 100] : [100, 120, 200, 250, 500]) }),
  structure: (p) => `egg:${p.eggs}`,
  render: (p) => ({ prompt: `A building has ${p.floors} floors. An egg breaks if dropped from floor f or higher for some unknown f (possibly never), and survives below it; a surviving egg can be reused. You have ${words(p.eggs)} identical eggs. What is the minimum number of drops that guarantees you find f in the worst case?`, ask: 'Give a whole number.' }),
  solve(p) {
    // With d drops and k eggs you can cover Σ_{i=1}^{k} C(d, i) floors.
    let d = 0;
    const cover = (dd: number): bigint => {
      let s = 0n;
      for (let i = 1; i <= p.eggs; i++) s += choose(dd, i);
      return s;
    };
    while (cover(d) < BigInt(p.floors)) d++;
    return {
      answer: I(d),
      steps: [
        'Flip the question: with d drops and k eggs, how many floors F(d, k) can you resolve?',
        'Drop from some floor: if the egg breaks, you have d − 1 drops and k − 1 eggs for the floors below; if not, d − 1 drops and k eggs above. So F(d, k) = F(d − 1, k − 1) + 1 + F(d − 1, k), giving F(d, k) = Σ_{i=1}^{k} C(d, i).',
        `Find the smallest d with F(d, ${p.eggs}) ≥ ${p.floors}: F(${d - 1}) = ${cover(d - 1)} < ${p.floors} ≤ F(${d}) = ${cover(d)}. Answer ${d}.`,
        p.eggs === 2 ? `With two eggs that means first dropping from floor ${d}, then ${d} + ${d - 1}, and so on (decreasing steps).` : 'The first drop is from floor F(d − 1, k − 1) + 1.',
      ],
    };
  },
  verify(p) {
    // Classic minimax DP over (eggs, floors): T(k, n) = 1 + min_x max(T(k−1, x−1), T(k, n−x)).
    const T: number[][] = Array.from({ length: p.eggs + 1 }, () => new Array<number>(p.floors + 1).fill(0));
    for (let n = 1; n <= p.floors; n++) T[1][n] = n;
    for (let k = 2; k <= p.eggs; k++)
      for (let n = 1; n <= p.floors; n++) {
        let best = Infinity;
        // T(k−1, x−1) increases with x and T(k, n−x) decreases: binary search the crossing.
        let lo = 1, hi = n;
        while (lo <= hi) {
          const x = (lo + hi) >> 1;
          const br = T[k - 1][x - 1], sv = T[k][n - x];
          best = Math.min(best, 1 + Math.max(br, sv));
          if (br < sv) lo = x + 1;
          else hi = x - 1;
        }
        T[k][n] = best;
      }
    return I(T[p.eggs][p.floors]);
  },
  hints: () => ['Too many floors to search one at a time; too few eggs to bisect freely.', 'Ask instead: with d drops and k eggs, how many floors can you handle?', 'F(d, k) = F(d−1, k−1) + 1 + F(d−1, k) = Σ C(d, i).'],
  verifiedBy: 'the minimax dynamic programme over eggs and floors',
};

// ------------------------------------------------------------------ pirates

interface PirateP { n: number; gold: number; rank: number }

export const pirates: Generator<PirateP> = {
  id: 'pirates',
  category: 'brainteaser',
  title: 'Pirate gold',
  techniques: ['backward-induction'],
  tiers: ['interview', 'hard'],
  params(r, tier) {
    const n = tier === 'interview' ? r.range(3, 6) : r.range(5, 10);
    // rank 1 = the proposer; in the hard tier ask about someone further down.
    return { n, gold: r.pick([10, 20, 50, 100, 1000]), rank: tier === 'interview' ? 1 : r.range(2, n) };
  },
  structure: (p) => `pirates:${p.rank === 1 ? 'senior' : 'other'}`,
  render: (p) => ({
    prompt: `${words(p.n)[0].toUpperCase()}${words(p.n).slice(1)} perfectly rational pirates, ranked 1 (most senior) to ${p.n}, must split ${p.gold} gold coins. The most senior pirate still aboard proposes a split and everyone votes; it passes if at least half the votes are in favour (the proposer votes too). If it fails, the proposer is thrown overboard and the next most senior proposes. Pirates care about survival first, then gold, and, all else equal, would rather see someone thrown overboard. ${p.rank === 1 ? 'How many coins does pirate 1 keep?' : `How many coins does pirate ${p.rank} receive?`}`,
    ask: 'Give a whole number.',
  }),
  solve(p) {
    const need = Math.ceil(p.n / 2) - 1;
    const keep = p.gold - need;
    const ans = p.rank === 1 ? keep : p.rank % 2 === 1 ? 1 : 0;
    return {
      answer: I(ans),
      steps: [
        'Backward induction: solve the game with the fewest pirates first.',
        'Two pirates: the senior proposes keeping everything; their own vote is half, so it passes and the junior gets 0.',
        'Each extra pirate needs votes from people who would get nothing if they were thrown overboard; those cost exactly 1 coin (0 is not enough, because ties go to bloodlust).',
        `With ${p.n} pirates the proposer needs ⌈${p.n}/2⌉ − 1 = ${need} other vote${need === 1 ? '' : 's'}. The pirates who get 0 in the ${p.n - 1}-pirate game are exactly those at odd ranks 3, 5, … (counting the current proposer as rank 1), and there are exactly ${need} of them.`,
        p.rank === 1
          ? `Pirate 1 pays them 1 coin each and keeps ${p.gold} − ${need} = ${keep}.`
          : `So pirate ${p.rank} gets ${ans} (odd ranks below the proposer get 1, even ranks get 0).`,
      ],
    };
  },
  verify(p) {
    // Explicit backward induction; alloc[i] is what pirate i gets, i = 0 the most junior.
    let alloc: number[] = [p.gold];
    for (let m = 2; m <= p.n; m++) {
      const others = Math.ceil(m / 2) - 1; // yes-votes needed besides the proposer
      // A pirate votes yes only for strictly more than they'd get if the proposer died.
      const offers = alloc.map((g, i) => ({ i, price: g + 1 })).sort((a, b) => a.price - b.price);
      const buy = offers.slice(0, others);
      // A tie at the cut-off would make the equilibrium ambiguous; the generator never allows it.
      if (others < offers.length && others > 0 && offers[others].price === buy[others - 1].price) return I(-1);
      const next = new Array<number>(m).fill(0);
      for (const b of buy) next[b.i] = b.price;
      next[m - 1] = p.gold - buy.reduce((s, b) => s + b.price, 0);
      alloc = next;
    }
    return I(alloc[p.n - p.rank]);
  },
  hints: (p) => ['Solve the two-pirate case, then three, then four…', 'A pirate votes yes only if the offer beats what they would get after the proposer is thrown overboard.', p.rank === 1 ? 'The cheapest votes belong to pirates who would get nothing otherwise: one coin each.' : 'Write out the full split for 2, 3, 4 pirates and look at the pattern.'],
  verifiedBy: 'backward induction computing every split explicitly',
};

// ------------------------------------------------------------------ trailing zeros

interface ZerosP { n: number; base: 10 | 2 | 5 | 6 | 12 }

export const trailingZeros: Generator<ZerosP> = {
  id: 'trailing-zeros',
  category: 'brainteaser',
  title: 'Trailing zeros of factorials',
  techniques: ['number-theory'],
  tiers: ['warmup', 'interview', 'hard'],
  params: (r, tier) => ({ n: r.range(tier === 'warmup' ? 20 : 50, tier === 'warmup' ? 120 : 400), base: tier === 'hard' ? r.pick([2, 6, 12, 10] as const) : 10 }),
  structure: (p) => `zeros:${p.base === 10 ? 'ten' : 'other'}`,
  render: (p) => ({ prompt: `How many zeros does ${p.n}! end with${p.base === 10 ? '' : ` when written in base ${p.base}`}?`, ask: 'Give a whole number.' }),
  solve(p) {
    const legendre = (pr: number): number => {
      let e = 0;
      for (let k = pr; k <= p.n; k *= pr) e += Math.floor(p.n / k);
      return e;
    };
    const fact = (b: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let pr = 2; pr <= b; pr++) if (b % pr === 0) { let e = 0; while (b % pr === 0) { b /= pr; e++; } out.push([pr, e]); }
      return out;
    };
    const parts = fact(p.base);
    const each = parts.map(([pr, e]) => ({ pr, e, v: legendre(pr), z: Math.floor(legendre(pr) / e) }));
    const ans = Math.min(...each.map((x) => x.z));
    return {
      answer: I(ans),
      steps: [
        `Trailing zeros in base ${p.base} = the number of times ${p.base} = ${parts.map(([pr, e]) => (e > 1 ? `${pr}^${e}` : `${pr}`)).join('·')} divides ${p.n}!.`,
        "Legendre's formula: the exponent of prime p in n! is Σ_k ⌊n/p^k⌋.",
        ...each.map((x) => `Exponent of ${x.pr}: ${x.v}${x.e > 1 ? `, giving ⌊${x.v}/${x.e}⌋ = ${x.z} copies of ${x.pr}^${x.e}` : ''}.`),
        `The scarcest factor limits it: ${ans}.`,
      ],
    };
  },
  verify(p) {
    let f = factorial(p.n);
    let z = 0;
    const b = BigInt(p.base);
    while (f % b === 0n) {
      f /= b;
      z++;
    }
    return I(z);
  },
  hints: (p) => [`A trailing zero in base ${p.base} is a factor of ${p.base}.`, 'Count prime factors of n! with ⌊n/p⌋ + ⌊n/p²⌋ + …', p.base === 10 ? 'Fives are scarcer than twos.' : 'Divide each prime exponent by its power in the base and take the minimum.'],
  verifiedBy: 'computing the factorial exactly with big integers',
};

// ------------------------------------------------------------------ lockers

interface LockerP { n: number; people: number }

export const lockers: Generator<LockerP> = {
  id: 'lockers',
  category: 'brainteaser',
  title: 'The locker problem',
  techniques: ['number-theory', 'invariants'],
  tiers: ['warmup', 'interview', 'hard'],
  params: (r, tier) => {
    const n = r.range(tier === 'warmup' ? 20 : 50, tier === 'warmup' ? 100 : 1000);
    return { n, people: tier === 'hard' ? r.range(Math.floor(n / 4), n - 1) : n };
  },
  structure: (p) => `lockers:${p.people === p.n ? 'full' : 'partial'}`,
  render: (p) => ({ prompt: `A corridor has ${p.n} closed lockers numbered 1 to ${p.n}. ${p.people === p.n ? `${p.n} students` : `Only the first ${p.people} of ${p.n} students`} walk by in turn; student k toggles (opens if closed, closes if open) every locker whose number is a multiple of k. How many lockers are open at the end?`, ask: 'Give a whole number.' }),
  solve(p) {
    if (p.people === p.n) {
      const ans = Math.floor(Math.sqrt(p.n));
      return { answer: I(ans), steps: ['Locker m is toggled once for each divisor of m.', 'Divisors pair up as (d, m/d) except when d = m/d, so m has an odd number of divisors iff m is a perfect square.', `Open lockers are the perfect squares up to ${p.n}: ⌊√${p.n}⌋ = ${ans}.`] };
    }
    let c = 0;
    for (let m = 1; m <= p.n; m++) {
      let d = 0;
      for (let k = 1; k <= p.people && k <= m; k++) if (m % k === 0) d++;
      if (d % 2) c++;
    }
    return { answer: I(c), steps: ['Locker m is toggled once for each divisor k of m with k ≤ ' + p.people + '.', `Lockers up to ${p.people} get all their divisors: open iff a perfect square (⌊√${p.people}⌋ of them).`, `A locker m > ${p.people} misses the divisors above ${p.people}; count those with an odd number of divisors ≤ ${p.people}.`, `Total open: ${c}.`] };
  },
  verify(p) {
    const open = new Array<boolean>(p.n + 1).fill(false);
    for (let k = 1; k <= p.people; k++) for (let m = k; m <= p.n; m += k) open[m] = !open[m];
    return I(open.filter(Boolean).length);
  },
  hints: () => ['How many times is a given locker toggled?', 'Pair each divisor d of m with m/d.', 'Only perfect squares have an unpaired divisor.'],
  verifiedBy: 'simulating every toggle',
};

export const BRAINTEASERS = [ants, clock, bridge, eggDrop, pirates, trailingZeros, lockers] as Generator<unknown>[];
