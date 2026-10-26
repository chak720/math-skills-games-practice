/**
 * Leak detection: specific, actionable weaknesses found in your history across
 * every section. Each rule needs a minimum sample before it fires, and says
 * what to practise.
 */
import { load } from '@/shared/storage/store';
import { getAttempts, getSessions, getSkillAggs, type SectionId } from '@/shared/stats/activity';
import { SKILL_LABEL, type SkillId } from '@/training/maths/generators';
import { techniqueSummary } from '@/training/puzzles/scheduler';
import { TECHNIQUES } from '@/training/puzzles/techniques';
import { FAMILY_LABEL, type FamilyId } from '@/training/sequences/sequences';
import { calibration } from '@/training/fermi/scoring';

export interface Leak {
  id: string;
  section: SectionId;
  title: string;
  detail: string;
  /** 0–1, for ordering. */
  severity: number;
  action: { label: string; to: string; prefs?: { key: string; value: unknown } };
}

interface HeroLineLite {
  netBB: number;
  vpip: number;
  pfr: number;
  threeBetOpp: number;
  threeBet: number;
  foldTo3BetOpp: number;
  foldTo3Bet: number;
  cbetOpp: number;
  cbet: number;
  sawFlop: number;
  wtsd: number;
  bbStealOpp: number;
  bbStealFold: number;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function pokerLeaks(lines: HeroLineLite[] = load<HeroLineLite[]>('poker.heroLines', [])): Leak[] {
  const out: Leak[] = [];
  const n = lines.length;
  const sum = (k: keyof HeroLineLite): number => lines.reduce((s, l) => s + (l[k] ?? 0), 0);
  const opp = sum('bbStealOpp'), fold = sum('bbStealFold');
  if (opp >= 12 && fold / opp > 0.6)
    out.push({ id: 'poker-bb-steal', section: 'poker', title: 'Folding your big blind to steals', detail: `You folded the big blind to a single late-position raise ${pct(fold / opp)} of the time (${fold}/${opp}). Against a button open you are getting good odds; most of the time you should defend well over half your hands.`, severity: clamp01((fold / opp - 0.5) * 2), action: { label: 'Play hands in coach mode', to: '/poker/coach' } });
  if (n >= 100) {
    const vpip = sum('vpip') / n, pfr = sum('pfr') / n;
    if (vpip > 0.36) out.push({ id: 'poker-loose', section: 'poker', title: 'Playing too many hands', detail: `You voluntarily put money in ${pct(vpip)} of hands. At a 6-max table a solid range is roughly 20–28%.`, severity: clamp01((vpip - 0.3) * 4), action: { label: 'Review preflop ranges', to: '/poker/learn' } });
    else if (vpip < 0.14) out.push({ id: 'poker-tight', section: 'poker', title: 'Playing too few hands', detail: `You play only ${pct(vpip)} of hands, which makes you easy to read and leaves blinds on the table.`, severity: clamp01((0.18 - vpip) * 5), action: { label: 'Review preflop ranges', to: '/poker/learn' } });
    if (vpip - pfr > 0.12) out.push({ id: 'poker-passive', section: 'poker', title: 'Calling preflop instead of raising', detail: `Your VPIP is ${pct(vpip)} but you raise only ${pct(pfr)}. A large gap means lots of flat calls, which play poorly out of position.`, severity: clamp01((vpip - pfr - 0.08) * 5), action: { label: 'Drill preflop opens', to: '/poker/drills' } });
  }
  const f3o = sum('foldTo3BetOpp'), f3 = sum('foldTo3Bet');
  if (f3o >= 10 && f3 / f3o > 0.65) out.push({ id: 'poker-fold-3bet', section: 'poker', title: 'Over-folding to 3-bets', detail: `You fold to ${pct(f3 / f3o)} of 3-bets (${f3}/${f3o}). Opponents can 3-bet you light profitably above about 55–60%.`, severity: clamp01((f3 / f3o - 0.55) * 3), action: { label: 'Play in coach mode', to: '/poker/coach' } });
  const co = sum('cbetOpp'), cb = sum('cbet');
  if (co >= 15 && (cb / co > 0.85 || cb / co < 0.35)) out.push({ id: 'poker-cbet', section: 'poker', title: cb / co > 0.85 ? 'C-betting almost every flop' : 'Rarely continuation betting', detail: `You c-bet ${pct(cb / co)} of flops when you could. ${cb / co > 0.85 ? 'Observant players will float and raise you; check back more on boards that favour the caller.' : 'You give up too many pots where your range is stronger.'}`, severity: 0.5, action: { label: 'Play in coach mode', to: '/poker/coach' } });
  const sf = sum('sawFlop'), sd = sum('wtsd');
  if (sf >= 50 && sd / sf > 0.36) out.push({ id: 'poker-wtsd', section: 'poker', title: 'Calling down too often', detail: `You reach showdown in ${pct(sd / sf)} of hands where you see the flop; around 25–32% is typical. Fold more marginal bluff-catchers on the river.`, severity: clamp01((sd / sf - 0.32) * 4), action: { label: 'Review your hands', to: '/poker/review' } });
  if (n >= 300) {
    const bb100 = (sum('netBB') / n) * 100;
    if (bb100 < -5) out.push({ id: 'poker-losing', section: 'poker', title: `Losing ${Math.abs(bb100).toFixed(1)} bb/100`, detail: `Over ${n} hands you are down ${Math.abs(bb100).toFixed(1)} big blinds per 100. Variance is large over small samples, so check the specific leaks above before changing everything.`, severity: 0.6, action: { label: 'Review your hands', to: '/poker/review' } });
  }
  const mistakes = load<{ street: string }[]>('poker.mistakes', []).slice(-60);
  if (mistakes.length >= 6) {
    const by = new Map<string, number>();
    for (const m of mistakes) by.set(m.street, (by.get(m.street) ?? 0) + 1);
    const [street, k] = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    if (k / mistakes.length >= 0.4) out.push({ id: 'poker-street', section: 'poker', title: `Most coach flags come on the ${street}`, detail: `${k} of your last ${mistakes.length} flagged decisions were on the ${street}.`, severity: 0.45, action: { label: 'See flagged decisions', to: '/poker/coach' } });
  }
  return out;
}

export function skillLeaks(): Leak[] {
  const out: Leak[] = [];
  const aggs = getSkillAggs();
  for (const [skill, a] of Object.entries(aggs)) {
    if (skill.startsWith('maths:') || (!skill.includes(':') && SKILL_LABEL[skill as SkillId])) {
      const id = skill.replace('maths:', '') as SkillId;
      if (a.n >= 8 && a.ewmaAcc < 0.8 && SKILL_LABEL[id]) out.push({ id: `maths-${id}`, section: 'maths', title: `${SKILL_LABEL[id]}: ${pct(a.ewmaAcc)} recent accuracy`, detail: 'Slow down slightly until accuracy is above 90%; speed comes back quickly once the method is reliable.', severity: clamp01((0.9 - a.ewmaAcc) * 2.5), action: { label: 'Adaptive mental maths', to: '/maths' } });
    }
    if (skill.startsWith('sequences:')) {
      const f = skill.slice(10) as FamilyId;
      if (a.n >= 4 && a.ewmaAcc < 0.6 && FAMILY_LABEL[f]) out.push({ id: `seq-${f}`, section: 'sequences', title: `Sequences: "${FAMILY_LABEL[f]}" rules`, detail: `Recent accuracy ${pct(a.ewmaAcc)} on this rule type. Check differences, ratios and alternate terms in that order.`, severity: clamp01((0.75 - a.ewmaAcc) * 2), action: { label: 'Practise sequences', to: '/sequences/practice' } });
    }
    if (skill.startsWith('bs-') && a.n >= 10 && a.ewmaAcc < 0.9) out.push({ id: `bj-${skill}`, section: 'blackjack', title: `Basic strategy: ${skill.slice(3).replace(/-/g, ' ')} hands`, detail: `You follow the chart ${pct(a.ewmaAcc)} of the time on these hands. Each deviation costs expected value.`, severity: clamp01((0.95 - a.ewmaAcc) * 3), action: { label: 'Study the chart', to: '/blackjack/chart' } });
    if ((skill === 'running-count' || skill === 'true-count' || skill === 'speed-count') && a.n >= 6 && a.ewmaAcc < 0.75) out.push({ id: `bj-${skill}`, section: 'blackjack', title: `Card counting: ${skill.replace('-', ' ')}`, detail: `Recent accuracy ${pct(a.ewmaAcc)}. Count in pairs (cancel +1/−1) to keep pace.`, severity: clamp01((0.85 - a.ewmaAcc) * 2), action: { label: 'Counting drill', to: '/blackjack/drill' } });
    if (skill === 'market:quote' && a.n >= 8 && a.ewmaAcc < 0.6) out.push({ id: 'mm-centre', section: 'market', title: 'Market making: quotes off fair value', detail: `Only ${pct(a.ewmaAcc)} of your recent quotes were centred on fair value. Work out the fair value first, then put the spread around it.`, severity: clamp01((0.8 - a.ewmaAcc) * 2), action: { label: 'Play a market', to: '/market' } });
  }
  return out;
}

export function puzzleLeaks(): Leak[] {
  return techniqueSummary()
    .filter((t) => t.n >= 3 && t.clean / t.n < 0.5)
    .map((t) => ({ id: `tech-${t.id}`, section: 'puzzles' as const, title: `Puzzle technique: ${TECHNIQUES[t.id].name}`, detail: `${t.clean} of ${t.n} puzzles using it solved cleanly. ${TECHNIQUES[t.id].idea}`, severity: clamp01(0.7 - t.clean / t.n), action: { label: 'Practise weak techniques', to: '/puzzles', prefs: { key: 'puzzles.prefs', value: { category: 'any', tier: 'adaptive', focus: 'review', timer: true, interviewer: false } } } }));
}

export function fermiLeaks(): Leak[] {
  const hist = load<{ hit: boolean; widthOom: number; logErr: number }[]>('fermi.history', []);
  const out: Leak[] = [];
  const cal = calibration(hist);
  if (cal.n >= 8 && cal.hi < 0.9) out.push({ id: 'fermi-overconfident', section: 'fermi', title: 'Fermi intervals too narrow', detail: `Your 90% intervals contain the truth ${pct(cal.rate)} of the time. Widen them until you hit about 9 in 10.`, severity: clamp01((0.9 - cal.rate) * 2), action: { label: 'Estimate', to: '/fermi' } });
  if (hist.length >= 8) {
    const bias = hist.reduce((s, h) => s + h.logErr, 0) / hist.length;
    if (Math.abs(bias) > 0.2) out.push({ id: 'fermi-bias', section: 'fermi', title: `Fermi estimates run ${bias > 0 ? 'high' : 'low'}`, detail: `On average you are ${(10 ** Math.abs(bias)).toFixed(1)}× too ${bias > 0 ? 'high' : 'low'}. Sanity-check each factor against something you know.`, severity: clamp01(Math.abs(bias)), action: { label: 'Estimate', to: '/fermi' } });
  }
  return out;
}

export function bettingLeaks(): Leak[] {
  const games = getSessions('betting').filter((s) => s.mode === 'kelly-game').slice(-3);
  if (games.length < 2) return [];
  const avg = games.reduce((s, g) => s + g.score, 0) / games.length;
  if (avg >= 60) return [];
  const sized = getAttempts('betting').slice(-60);
  return [{ id: 'betting-kelly', section: 'betting', title: 'Bet sizing far from Kelly', detail: `Your last ${games.length} Kelly games captured ${Math.round(avg)}% of Kelly's growth on average (${sized.filter((a) => a.correct).length}/${sized.length} recent stakes within 25% of Kelly). Compute f = p − q/b before each bet, and bet nothing on negative edges.`, severity: clamp01((80 - avg) / 100), action: { label: 'Play the Kelly game', to: '/betting' } }];
}

export function allLeaks(): Leak[] {
  return [...pokerLeaks(), ...skillLeaks(), ...puzzleLeaks(), ...fermiLeaks(), ...bettingLeaks()].sort((a, b) => b.severity - a.severity);
}
