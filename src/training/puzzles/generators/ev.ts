/** Expected-value games: optimal stopping, fair prices, betting systems. */
import { Q, q } from '@/shared/math/rational';
import { choose } from '@/shared/math/combinatorics';
import type { Generator } from '../types';
import { R, fq, words } from '../util';

// ------------------------------------------------------------------ re-roll for value

interface RerollP { n: number; rolls: number; cost: number; payoff: 'face' | 'square' }

/** Value of the game with `k` rolls left, by backward induction. */
function rerollValues(p: RerollP): Q[] {
  const pay = (f: number): Q => q(p.payoff === 'face' ? f : f * f);
  const V: Q[] = [Q.ZERO];
  // V[1] = E[payoff]; V[k] = E[max(payoff, V[k−1] − cost)]
  for (let k = 1; k <= p.rolls; k++) {
    let s = Q.ZERO;
    for (let f = 1; f <= p.n; f++) {
      const keep = pay(f);
      const cont = k === 1 ? null : V[k - 1].sub(p.cost);
      s = s.add(cont && cont.cmp(keep) > 0 ? cont : keep);
    }
    V.push(s.div(p.n));
  }
  return V;
}

export const reroll: Generator<RerollP> = {
  id: 'reroll',
  category: 'ev',
  title: 'Re-roll for value (optimal stopping)',
  techniques: ['backward-induction'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    return {
      n: r.pick(tier === 'warmup' ? [6] : [6, 8, 10, 12, 20]),
      rolls: tier === 'warmup' ? 2 : tier === 'interview' ? r.range(2, 3) : r.range(3, 5),
      cost: tier === 'hard' && r.chance(0.5) ? r.range(1, 2) : 0,
      payoff: tier === 'hard' && r.chance(0.35) ? 'square' : 'face',
    };
  },
  structure: (p) => `reroll:${p.rolls}:${p.payoff}:${p.cost ? 'cost' : 'free'}`,
  render(p) {
    const pay = p.payoff === 'face' ? 'its face value in dollars' : 'the square of its face value in dollars';
    const cost = p.cost ? ` Each re-roll costs $${p.cost}.` : '';
    return {
      prompt: `You roll a fair ${p.n}-sided die and are paid ${pay}. After seeing a roll you may stop, or re-roll (forfeiting that roll); you may roll at most ${words(p.rolls)} times in total and must accept the last roll.${cost} With optimal play, what is the game worth?`,
      ask: 'Give the exact expected value.',
    };
  },
  solve(p) {
    const V = rerollValues(p);
    const steps = [
      'Work backwards. With one roll left you must take it: V₁ = E[payoff] = ' + `${fq(V[1])}.`,
      `With k rolls left, keep a roll worth x if x ≥ V_{k−1}${p.cost ? ` − ${p.cost}` : ''}, otherwise re-roll: V_k = E[max(x, V_{k−1}${p.cost ? ` − ${p.cost}` : ''})].`,
    ];
    for (let k = 2; k <= p.rolls; k++) steps.push(`V${k}: keep any roll paying at least ${V[k - 1].sub(p.cost).toNumber().toFixed(3)}; V${k} = ${fq(V[k])}.`);
    return { answer: R(V[p.rolls]), steps };
  },
  verify(p) {
    // Brute force over every threshold policy (one threshold per stage): search in
    // floating point, then evaluate the best policy exactly.
    const pay = (f: number): number => (p.payoff === 'face' ? f : f * f);
    const stages = p.rolls - 1;
    const evalPolicy = (th: number[]): number => {
      let next = 0;
      for (let f = 1; f <= p.n; f++) next += pay(f);
      next /= p.n;
      for (let s = stages - 1; s >= 0; s--) {
        let e = 0;
        for (let f = 1; f <= p.n; f++) e += f >= th[s] ? pay(f) : next - p.cost;
        next = e / p.n;
      }
      return next;
    };
    let best = -Infinity;
    let bestTh: number[] = [];
    const policies = (p.n + 1) ** stages;
    for (let m = 0; m < policies; m++) {
      const th: number[] = [];
      let x = m;
      for (let s = 0; s < stages; s++) {
        th.push(x % (p.n + 1));
        x = Math.floor(x / (p.n + 1));
      }
      const v = evalPolicy(th);
      if (v > best + 1e-12) {
        best = v;
        bestTh = th;
      }
    }
    let next = Q.ZERO;
    for (let f = 1; f <= p.n; f++) next = next.add(q(pay(f)));
    next = next.div(p.n);
    for (let s = stages - 1; s >= 0; s--) {
      let e = Q.ZERO;
      for (let f = 1; f <= p.n; f++) e = e.add(f >= bestTh[s] ? q(pay(f)) : next.sub(p.cost));
      next = e.div(p.n);
    }
    return R(next);
  },
  hints: () => ['Start from the last roll, where you have no choice.', 'With one re-roll left, keep a roll only if it beats the expected value of re-rolling.', 'V_k = E[max(roll, V_{k−1})]: compute stage by stage.'],
  verifiedBy: 'trying every threshold strategy exhaustively',
};

// ------------------------------------------------------------------ pay to play

interface PayP { n: number; dice: 2 | 3; rule: 'max' | 'product' | 'diff' | 'doubles' | 'sum-if-6' ; prize: number }

export const payToPlay: Generator<PayP> = {
  id: 'pay-to-play',
  category: 'ev',
  title: 'Fair price of a game',
  techniques: ['linearity', 'counting'],
  tiers: ['warmup', 'interview', 'hard'],
  params(r, tier) {
    return {
      n: r.pick(tier === 'warmup' ? [6] : [4, 6, 8]),
      dice: tier === 'hard' ? r.pick([2, 3] as const) : 2,
      rule: r.pick(tier === 'warmup' ? (['max', 'doubles'] as const) : (['max', 'product', 'diff', 'doubles', 'sum-if-6'] as const)),
      prize: r.pick([10, 20, 30, 36, 50]),
    };
  },
  structure: (p) => `pay:${p.rule}:${p.dice}`,
  render(p) {
    const roll = `You roll ${words(p.dice)} fair ${p.n}-sided dice`;
    const rule = {
      max: 'and are paid the highest number showing, in dollars',
      product: 'and are paid the product of the numbers, in dollars',
      diff: p.dice === 2 ? 'and are paid the absolute difference of the two numbers, in dollars' : 'and are paid the highest minus the lowest number, in dollars',
      doubles: `and win $${p.prize} if ${p.dice === 2 ? 'both show the same number' : 'all show the same number'}, otherwise nothing`,
      'sum-if-6': `and are paid the sum of the dice if at least one shows a ${p.n}, otherwise nothing`,
    }[p.rule];
    return { prompt: `${roll} ${rule}. What is the most you should pay to play (the fair price)?`, ask: 'Give the expected payout exactly.' };
  },
  solve(p) {
    const { n } = p;
    const steps: string[] = ['The fair price equals the expected payout.'];
    let e: Q;
    if (p.rule === 'max') {
      e = Q.ZERO;
      for (let m = 1; m <= n; m++) e = e.add(Q.ONE.sub(q(m - 1, n).pow(p.dice)));
      steps.push(`Tail sum: E[max] = Σ_m P(max ≥ m) = Σ_{m=1}^{${n}} [1 − ((m − 1)/${n})^${p.dice}] = ${fq(e)}.`);
    } else if (p.rule === 'product') {
      e = q(n + 1, 2).pow(p.dice);
      steps.push(`Independent dice: E[product] = Π E[die] = ((${n} + 1)/2)^${p.dice} = ${fq(e)}.`);
    } else if (p.rule === 'doubles') {
      const pr = q(1, n).pow(p.dice - 1);
      e = pr.mul(p.prize);
      steps.push(`P(all equal) = ${n}/${n}^${p.dice} = ${pr}. E = ${pr} × ${p.prize} = ${fq(e)}.`);
    } else if (p.rule === 'sum-if-6') {
      // E[sum · 1{some die = n}] = E[sum] − E[sum · 1{no die = n}]
      const noN = q(n - 1, n).pow(p.dice);
      const meanNoN = q(n, 2); // conditional mean of a die given it is < n is n/2
      e = q(p.dice * (n + 1), 2).sub(noN.mul(meanNoN.mul(p.dice)));
      steps.push(`E[sum] = ${p.dice}·(${n} + 1)/2. Remove the outcomes with no ${n}: probability (${n - 1}/${n})^${p.dice}, and then each die averages ${n}/2.`, `E = ${q(p.dice * (n + 1), 2)} − ${noN}·${p.dice}·${n}/2 = ${fq(e)}.`);
    } else {
      // E[max − min] = E[max] − E[min]
      let emax = Q.ZERO, emin = Q.ZERO;
      for (let m = 1; m <= n; m++) {
        emax = emax.add(Q.ONE.sub(q(m - 1, n).pow(p.dice)));
        emin = emin.add(q(n - m + 1, n).pow(p.dice));
      }
      e = emax.sub(emin);
      steps.push(`Linearity: E[max − min] = E[max] − E[min] = ${emax} − ${emin} = ${fq(e)} (tail sums for each).`);
    }
    return { answer: R(e), steps };
  },
  verify(p) {
    let tot = 0, cnt = 0;
    const v = new Array<number>(p.dice).fill(1);
    const rec = (i: number): void => {
      if (i === p.dice) {
        cnt++;
        const mx = Math.max(...v), mn = Math.min(...v);
        tot += p.rule === 'max' ? mx : p.rule === 'product' ? v.reduce((a, b) => a * b, 1) : p.rule === 'diff' ? mx - mn : p.rule === 'doubles' ? (mx === mn ? p.prize : 0) : v.includes(p.n) ? v.reduce((a, b) => a + b, 0) : 0;
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
  hints: (p) => ['A fair price is the expected payout.', p.rule === 'product' ? 'Expectation of a product of independent variables factorises.' : 'Try linearity or the tail-sum formula instead of listing every outcome.', p.rule === 'max' ? 'E[max] = Σ P(max ≥ m).' : 'Compute the expectation of each piece and combine.'],
  verifiedBy: 'enumerating every roll',
};

// ------------------------------------------------------------------ red/black card game

interface RedBlackP { red: number; black: number }

export const redBlack: Generator<RedBlackP> = {
  id: 'red-black',
  category: 'ev',
  title: 'Red and black card game',
  techniques: ['backward-induction', 'dynamic-programming'],
  tiers: ['interview', 'hard'],
  params: (r, tier) => ({ red: r.range(2, tier === 'interview' ? 4 : 7), black: r.range(2, tier === 'interview' ? 4 : 7) }),
  structure: (p) => `redblack:${p.red === p.black ? 'balanced' : 'unbalanced'}`,
  render: (p) => ({
    prompt: `A shuffled deck has ${p.red} red and ${p.black} black cards. You turn cards over one at a time; each red card pays you $1 and each black card costs you $1. You may stop at any time (including before the first card) and keep your running total. With optimal play, what is the expected value of the game?`,
    ask: 'Give the exact expected value.',
  }),
  solve(p) {
    const memo = new Map<string, Q>();
    const V = (r: number, b: number): Q => {
      if (r === 0) return Q.ZERO;
      if (b === 0) return q(r);
      const k = `${r},${b}`;
      const m = memo.get(k);
      if (m) return m;
      const cont = q(r, r + b).mul(Q.ONE.add(V(r - 1, b))).add(q(b, r + b).mul(V(r, b - 1).sub(1)));
      const v = cont.cmp(0) > 0 ? cont : Q.ZERO;
      memo.set(k, v);
      return v;
    };
    const ans = V(p.red, p.black);
    return {
      answer: R(ans),
      steps: [
        'Let V(r, b) be the value of continuing optimally with r red and b black cards left (counting only future winnings).',
        'Stopping is worth 0. Drawing gives r/(r + b)·(1 + V(r − 1, b)) + b/(r + b)·(−1 + V(r, b − 1)); take the larger. Boundary: V(0, b) = 0, V(r, 0) = r.',
        `Fill the table upwards; V(${p.red}, ${p.black}) = ${fq(ans)}.`,
        'Even with equal colours the value is positive: you can always quit while ahead, but never have to stop while behind.',
      ],
    };
  },
  verify(p) {
    // Independent bottom-up table in a different order.
    const T: Q[][] = Array.from({ length: p.red + 1 }, () => new Array<Q>(p.black + 1).fill(Q.ZERO));
    for (let total = 1; total <= p.red + p.black; total++)
      for (let r = Math.max(0, total - p.black); r <= Math.min(p.red, total); r++) {
        const b = total - r;
        if (r === 0) T[r][b] = Q.ZERO;
        else if (b === 0) T[r][b] = q(r);
        else {
          const cont = q(r, total).mul(T[r - 1][b].add(1)).add(q(b, total).mul(T[r][b - 1].sub(1)));
          T[r][b] = cont.cmp(0) > 0 ? cont : Q.ZERO;
        }
      }
    return R(T[p.red][p.black]);
  },
  hints: () => ['Your decision only depends on how many red and black cards remain.', 'Compare stopping (worth 0 more) with the expected value of drawing one more card.', 'V(r, b) = max(0, r/(r+b)(1 + V(r−1, b)) + b/(r+b)(−1 + V(r, b−1))).'],
  verifiedBy: 'an independent bottom-up table',
};

// ------------------------------------------------------------------ martingale doubling

interface MartP { k: number; pn: number; pd: number; base: number; ask: 'ruin' | 'ev' }

export const martingale: Generator<MartP> = {
  id: 'martingale',
  category: 'ev',
  title: 'Doubling systems',
  techniques: ['martingale', 'complement'],
  tiers: ['warmup', 'interview', 'hard'],
  params: (r, tier) => {
    const [pn, pd] = tier === 'warmup' ? [1, 2] : r.pick([[1, 2], [18, 37], [9, 19], [2, 5]]);
    return { k: r.range(3, tier === 'hard' ? 9 : 6), pn, pd, base: r.pick([1, 5, 10]), ask: r.pick(['ruin', 'ev'] as const) };
  },
  structure: (p) => `martingale:${p.ask}:${p.pn * 2 === p.pd ? 'fair' : 'unfair'}`,
  render(p) {
    const bank = p.base * (2 ** p.k - 1);
    const game = p.pn * 2 === p.pd ? 'a fair coin (even-money bet)' : `an even-money bet you win with probability ${p.pn}/${p.pd}`;
    return {
      prompt: `You play ${game} with a bankroll of $${bank}. You bet $${p.base}; after each loss you double your bet, and you stop as soon as you win once or cannot cover the next bet. ${p.ask === 'ruin' ? 'What is the probability that you lose the whole bankroll?' : 'What is your expected profit from one run of this system?'}`,
      ask: p.ask === 'ruin' ? 'Give the probability as a fraction.' : 'Give the exact expected profit.',
    };
  },
  solve(p) {
    const P = q(p.pn, p.pd), L = Q.ONE.sub(P);
    const bank = p.base * (2 ** p.k - 1);
    const ruin = L.pow(p.k);
    const ev = Q.ONE.sub(ruin).mul(p.base).sub(ruin.mul(bank));
    return {
      answer: R(p.ask === 'ruin' ? ruin : ev),
      steps: [
        `The bankroll ${bank} = ${p.base}·(1 + 2 + … + 2^${p.k - 1}) covers exactly ${p.k} consecutive bets.`,
        `You lose everything only if all ${p.k} bets lose: P = (${L})^${p.k} = ${fq(ruin)}. Otherwise the first win nets exactly +$${p.base}.`,
        `Expected profit = (1 − ${ruin})·${p.base} − ${ruin}·${bank} = ${fq(ev)}.`,
        p.pn * 2 === p.pd ? 'Zero, as it must be: in a fair game no stopping rule can create an edge (optional stopping theorem). The system trades frequent small wins for rare large losses.' : 'Negative: doubling cannot turn a losing bet into a winning one; it only reshapes the distribution of results.',
      ],
    };
  },
  verify(p) {
    // Enumerate the outcome tree bet by bet.
    const P = q(p.pn, p.pd), L = Q.ONE.sub(P);
    let ev = Q.ZERO, ruin = Q.ZERO, reach = Q.ONE, lost = 0;
    for (let i = 0; i < p.k; i++) {
      const bet = p.base * 2 ** i;
      ev = ev.add(reach.mul(P).mul(bet - lost));
      lost += bet;
      reach = reach.mul(L);
    }
    ruin = reach;
    ev = ev.sub(ruin.mul(lost));
    return R(p.ask === 'ruin' ? ruin : ev);
  },
  hints: (p) => [`How many consecutive losses can the bankroll absorb?`, 'Every run ends either with a single win of the base bet, or with the whole bankroll lost.', p.ask === 'ruin' ? 'Ruin = all of those bets lose.' : 'E = P(win once)·base − P(ruin)·bankroll.'],
  verifiedBy: 'summing the outcome tree bet by bet',
};

// ------------------------------------------------------------------ capped St Petersburg / coin bets

interface CoinBetP { kind: 'stpete' | 'majority' | 'runs'; n: number; cap: number; stake: number }

export const coinBets: Generator<CoinBetP> = {
  id: 'coin-bets',
  category: 'ev',
  title: 'Should you take this bet?',
  techniques: ['linearity', 'binomial', 'counting'],
  tiers: ['warmup', 'interview', 'hard'],
  params: (r, tier) => ({
    kind: r.pick(tier === 'warmup' ? (['stpete', 'majority'] as const) : (['stpete', 'majority', 'runs'] as const)),
    n: r.range(tier === 'warmup' ? 3 : 4, tier === 'hard' ? 9 : 7),
    cap: r.range(3, tier === 'hard' ? 12 : 7),
    stake: r.pick([1, 2, 5]),
  }),
  structure: (p) => `coinbet:${p.kind}`,
  render(p) {
    if (p.kind === 'stpete')
      return { prompt: `A casino flips a fair coin until the first tails, or until ${p.cap} flips have been made. If the game lasts k flips you win $2^k (so $2 if the first flip is tails, $4 if it is the second, …, and $2^${p.cap} at most). What is the expected payout?`, ask: 'Give the exact expected value.' };
    if (p.kind === 'majority')
      return { prompt: `You flip ${words(p.n)} fair coins. If heads strictly outnumber tails you win $${p.stake * 3}; otherwise you lose $${p.stake * 2}. What is the expected value of the bet?`, ask: 'Give the exact expected value (negative if it loses money).' };
    return { prompt: `You flip a fair coin ${words(p.n)} times. You are paid $1 for every run (maximal block of identical consecutive results); for example HHTH has 3 runs. What is the expected payout?`, ask: 'Give the exact expected value.' };
  },
  solve(p) {
    if (p.kind === 'stpete') {
      // P(game lasts exactly k) = 1/2^k for k < cap, and 1/2^(cap−1) for k = cap
      let e = Q.ZERO;
      for (let k = 1; k < p.cap; k++) e = e.add(q(1, 2 ** k).mul(2 ** k));
      e = e.add(q(1, 2 ** (p.cap - 1)).mul(2 ** p.cap));
      return { answer: R(e), steps: [`For k < ${p.cap}: P(first tails on flip k) = 1/2^k and the payout is 2^k, contributing exactly $1 each: ${p.cap - 1} dollars.`, `The game reaches flip ${p.cap} with probability 1/2^${p.cap - 1} and pays 2^${p.cap}: contributing $2.`, `E = ${p.cap - 1} + 2 = ${e}. Without the cap every term contributes 1 and the sum diverges — the St Petersburg paradox.`] };
    }
    if (p.kind === 'majority') {
      let win = 0n;
      for (let h = Math.floor(p.n / 2) + 1; h <= p.n; h++) win += choose(p.n, h);
      const pw = new Q(win, 2n ** BigInt(p.n));
      const e = pw.mul(p.stake * 3).sub(Q.ONE.sub(pw).mul(p.stake * 2));
      return { answer: R(e), steps: [`P(heads > tails) = Σ_{h > ${p.n}/2} C(${p.n}, h)/2^${p.n} = ${win}/${2 ** p.n} = ${pw}${p.n % 2 ? ' (exactly 1/2 by symmetry when n is odd)' : ' (less than 1/2 when n is even because of ties)'}.`, `EV = ${pw}·${p.stake * 3} − ${Q.ONE.sub(pw)}·${p.stake * 2} = ${fq(e)}.`] };
    }
    const e = q(p.n + 1, 2);
    return { answer: R(e), steps: ['Runs = 1 + (number of positions i ≥ 2 where flip i differs from flip i − 1).', `Each of the ${p.n - 1} adjacent pairs differs with probability 1/2, so by linearity E = 1 + (${p.n} − 1)/2 = ${e}.`] };
  },
  verify(p) {
    if (p.kind === 'stpete') {
      let e = Q.ZERO;
      // Enumerate flip sequences of length cap.
      for (let m = 0; m < 1 << p.cap; m++) {
        let k = p.cap;
        for (let i = 0; i < p.cap; i++) if ((m >> i) & 1) { k = i + 1; break; }
        e = e.add(q(2 ** k, 1 << p.cap));
      }
      return R(e);
    }
    let tot = Q.ZERO;
    for (let m = 0; m < 1 << p.n; m++) {
      const bits = Array.from({ length: p.n }, (_, i) => (m >> i) & 1);
      if (p.kind === 'majority') {
        const h = bits.reduce((a, b) => a + b, 0);
        tot = tot.add(h > p.n - h ? p.stake * 3 : -p.stake * 2);
      } else {
        let runs = 1;
        for (let i = 1; i < p.n; i++) if (bits[i] !== bits[i - 1]) runs++;
        tot = tot.add(runs);
      }
    }
    return R(tot.div(1 << p.n));
  },
  hints: (p) => ['Write the payout as a sum over cases weighted by probability.', p.kind === 'runs' ? 'Count runs as 1 plus the number of "changes" between neighbours.' : p.kind === 'stpete' ? 'Each early outcome contributes the same amount.' : 'Find P(win) by counting heads.', p.kind === 'runs' ? 'Use linearity over the n − 1 neighbouring pairs.' : 'EV = P(win)·gain − P(lose)·loss.'],
  verifiedBy: 'enumerating every flip sequence',
};

export const EV = [reroll, payToPlay, redBlack, martingale, coinBets] as Generator<unknown>[];
