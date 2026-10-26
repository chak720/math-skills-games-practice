import { useMemo, useState } from 'react';
import { Rng } from '@/shared/random/prng';
import { load } from '@/shared/storage/store';
import { getSessions, recordAttempt, recordSession } from '@/shared/stats/activity';
import { fmtOdds, makeOffer, roundFor, settle, skillScore, START, type Bankrolls, type Offer, type Round } from '@/training/betting/game';
import { bankrollFor, drawdownProb, edge, growth, kellyFraction, riskOfRuin, simulate } from '@/training/betting/kelly';
import { Button, cx, Field, fmtPct, NumberField, Panel, Stat, Tabs } from '../../components/core';
import { LineChart } from '../../components/charts';
import { Example, F, Lesson } from '../../components/Lesson';
import { usePersistent, useStorageVersion } from '../../hooks';
import { navigate, useRoute } from '../../router';

const TABS = [
  { value: 'game', label: 'Kelly game' },
  { value: 'simulate', label: 'Simulator' },
  { value: 'ruin', label: 'Risk of ruin' },
  { value: 'learn', label: 'Learn' },
] as const;

export default function BettingPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? 'game';
  return (
    <div>
      <h1 className="text-2xl mb-2">Betting &amp; sizing</h1>
      <Tabs value={tab} onChange={(v) => navigate(v === 'game' ? '/betting' : `/betting/${v}`)} tabs={TABS} />
      {tab === 'game' && <Game />}
      {tab === 'simulate' && <Simulator />}
      {tab === 'ruin' && <Ruin />}
      {tab === 'learn' && <Learn />}
    </div>
  );
}

const money = (x: number): string => `£${x >= 100 ? Math.round(x).toLocaleString('en-GB') : x.toFixed(2)}`;

// ------------------------------------------------------------------ game

const ROUNDS = 20;

interface GameState {
  seed: string;
  i: number;
  offer: Offer;
  rolls: Bankrolls;
  history: Round[];
  path: Bankrolls[];
  last?: Round;
  done: boolean;
}

function newGame(): GameState {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  const seed = `${b[0].toString(16)}${b[1].toString(16)}`;
  const r = new Rng(`${seed}:offer:0`);
  const start = { you: START, kelly: START, half: START, flat: START };
  return { seed, i: 0, offer: makeOffer(r), rolls: start, history: [], path: [start], done: false };
}

function Game(): JSX.Element {
  const [g, setG] = usePersistent<GameState | null>('betting.game', null);
  const [stake, setStake] = useState('');
  const state = g ?? null;
  if (!state)
    return (
      <div className="panel p-5 max-w-2xl space-y-3">
        <p>You start with {money(START)} and get {ROUNDS} bet offers with exactly known odds. Choose how much of your bankroll to stake on each. Some offers are bad: the right stake is zero.</p>
        <p className="text-paper-muted">A full-Kelly bettor, a half-Kelly bettor and a flat 10% bettor play the same outcomes alongside you. You are scored on expected log growth (your skill), not on how the dice fell.</p>
        <Button variant="primary" onClick={() => setG(newGame())}>
          Start
        </Button>
      </div>
    );

  const o = state.offer;
  const f = Math.max(0, Math.min(100, Number(stake))) / 100;
  const place = (): void => {
    if (state.done || stake.trim() === '' || !Number.isFinite(Number(stake))) return;
    // Outcome from a per-round stream, independent of the stake you chose.
    const won = new Rng(`${state.seed}:outcome:${state.i}`).next() < o.p;
    const rd = roundFor(o, f, won);
    const rolls = settle(state.rolls, o, f, won);
    const k = rd.kelly;
    recordAttempt({ section: 'betting', skill: 'betting:kelly', correct: Math.abs(f - k) <= Math.max(0.01, 0.25 * k), score: rd.lost });
    const history = [...state.history, rd];
    const done = history.length >= ROUNDS || rolls.you < 0.01;
    if (done) recordSession({ section: 'betting', mode: 'kelly-game', durationMs: 0, score: skillScore(history), total: history.length, summary: { final: Math.round(rolls.you), kelly: Math.round(rolls.kelly) } });
    setG({ ...state, i: state.i + 1, offer: makeOffer(new Rng(`${state.seed}:offer:${state.i + 1}`)), rolls, history, path: [...state.path, rolls], last: rd, done });
    setStake('');
  };

  if (state.done) return <GameSummary g={state} onAgain={() => setG(newGame())} />;
  const last = state.last;
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-6 items-start">
      <div className="panel p-5 sm:p-6 space-y-5">
        <div className="flex items-baseline justify-between text-sm text-paper-muted">
          <span>
            Offer {state.i + 1} of {ROUNDS}
          </span>
          <span className="num">
            Your bankroll <span className="text-paper text-md">{money(state.rolls.you)}</span>
          </span>
        </div>
        <p className="prose-math text-[19px]">{o.text}</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            place();
          }}
        >
          <label className="label" htmlFor="stake">
            Stake, as a percentage of your bankroll
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <input id="stake" autoFocus className="input w-24 num text-right" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} autoComplete="off" />
              <span className="text-paper-muted">%</span>
            </div>
            <input type="range" min={0} max={50} step={0.5} value={Number(stake) || 0} onChange={(e) => setStake(e.target.value)} className="w-48 accent-[#E8A93A]" aria-label="Stake slider" />
            <span className="text-sm text-paper-muted num">= {money(state.rolls.you * f)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[0, 2, 5, 10, 20].map((x) => (
              <Button key={x} size="sm" variant="ghost" onClick={() => setStake(String(x))}>
                {x}%
              </Button>
            ))}
            <Button variant="primary" type="submit" className="ml-auto" disabled={stake.trim() === ''} kbd="↵">
              Place bet
            </Button>
          </div>
        </form>
        {last && (
          <div className="border-t border-ink-line pt-4 text-sm" aria-live="polite">
            <span className={last.won ? 'text-bid' : 'text-ask'}>{last.won ? 'Won' : 'Lost'}</span> the last bet ({last.offer.text.replace(/\.$/, '')}). You staked {fmtPct(last.f)}; Kelly staked {fmtPct(last.kelly)}
            {last.lost > 1e-6 ? `, so you gave up ${(last.lost * 100).toFixed(2)}% of expected log growth on that bet.` : ', so you matched it.'}
          </div>
        )}
      </div>
      <aside className="space-y-4">
        <Panel title="Bankrolls">
          <div className="grid grid-cols-2 gap-3">
            <Stat size="sm" label="You" value={money(state.rolls.you)} />
            <Stat size="sm" label="Full Kelly" value={money(state.rolls.kelly)} />
            <Stat size="sm" label="Half Kelly" value={money(state.rolls.half)} />
            <Stat size="sm" label="Flat 10%" value={money(state.rolls.flat)} />
          </div>
        </Panel>
        <Panel title="Reminder">
          <F>f* = p − q / b</F>
          <p className="text-sm text-paper-muted">p = win probability, q = 1 − p, b = net odds (pays b to 1). Bet nothing when p·b ≤ q.</p>
        </Panel>
        <Button variant="ghost" size="sm" onClick={() => setG(null)}>
          Abandon game
        </Button>
      </aside>
    </div>
  );
}

function GameSummary({ g, onAgain }: { g: GameState; onAgain: () => void }): JSX.Element {
  const score = skillScore(g.history);
  const x = g.path.map((_, i) => i);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Sizing skill" value={`${score}%`} sub="your expected log growth as a share of Kelly's" size="lg" tone={score >= 80 ? 'pos' : score < 40 ? 'neg' : undefined} />
        <Stat label="Your bankroll" value={money(g.rolls.you)} />
        <Stat label="Full Kelly" value={money(g.rolls.kelly)} />
        <Stat label="Half Kelly" value={money(g.rolls.half)} />
      </div>
      <Panel title="Bankrolls over the game (same outcomes for everyone)">
        <LineChart
          x={x}
          xLabel="bet"
          series={[
            { name: 'You', values: g.path.map((p) => p.you) },
            { name: 'Full Kelly', values: g.path.map((p) => p.kelly) },
            { name: 'Half Kelly', values: g.path.map((p) => p.half), dashed: true },
            { name: 'Flat 10%', values: g.path.map((p) => p.flat), dashed: true },
          ]}
          yFormat={(v) => money(v)}
          height={220}
        />
      </Panel>
      <Panel title="Every offer">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-paper-muted">
              <tr>
                <th className="text-left font-normal py-1">Offer</th>
                <th className="text-right font-normal">Edge</th>
                <th className="text-right font-normal">Kelly</th>
                <th className="text-right font-normal">You</th>
                <th className="text-right font-normal">Growth given up</th>
                <th className="text-right font-normal">Result</th>
              </tr>
            </thead>
            <tbody>
              {g.history.map((r, i) => (
                <tr key={i} className="border-t border-ink-line/60">
                  <td className="py-1.5 pr-3">{r.offer.text}</td>
                  <td className={cx('text-right num pr-3', edge(r.offer.p, r.offer.b) < -1e-9 && 'text-ask')}>{fmtPct(Math.abs(edge(r.offer.p, r.offer.b)) < 1e-9 ? 0 : edge(r.offer.p, r.offer.b))}</td>
                  <td className="text-right num pr-3">{fmtPct(r.kelly)}</td>
                  <td className={cx('text-right num pr-3', Math.abs(r.f - r.kelly) > Math.max(0.01, 0.5 * r.kelly) && 'text-ask')}>{fmtPct(r.f)}</td>
                  <td className="text-right num pr-3">{r.lost > 1e-6 ? `${(r.lost * 100).toFixed(2)}%` : '–'}</td>
                  <td className={cx('text-right', r.won ? 'text-bid' : 'text-ask')}>{r.won ? 'won' : 'lost'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-paper-muted mt-3">Edge is the expected profit per £1 staked (p·b − q). "Growth given up" is the expected log growth per bet you lost versus staking exactly Kelly.</p>
      </Panel>
      <Button variant="primary" onClick={onAgain}>
        Play again
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ simulator

function Simulator(): JSX.Element {
  const [cfg, setCfg] = usePersistent('betting.sim', { pPct: 55, b: 1, mult: 1, bets: 1000 });
  const [seed, setSeed] = useState(1);
  const p = cfg.pPct / 100;
  const k = kellyFraction(p, cfg.b);
  const f = Math.min(0.99, k * cfg.mult);
  const sim = useMemo(() => (k > 0 ? simulate(p, cfg.b, f, cfg.bets, 1000, new Rng(`sim:${seed}`)) : null), [p, cfg.b, f, cfg.bets, k, seed]);
  const sup = (n: number): string => `${n < 0 ? '⁻' : ''}${String(Math.abs(n)).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]).join('')}`;
  const fmtW = (v: number): string => (Math.abs(v) >= 3 ? `×10${sup(Math.round(v))}` : `×${Number((10 ** v).toPrecision(2))}`);
  return (
    <div className="space-y-6">
      <div className="panel p-5 flex flex-wrap gap-5 items-end">
        <Field label="Win probability (%)">
          <NumberField value={cfg.pPct} min={1} max={99} step={1} onChange={(v) => setCfg({ ...cfg, pPct: v })} />
        </Field>
        <Field label="Pays (b to 1)">
          <NumberField value={cfg.b} min={0.1} max={50} step={0.1} onChange={(v) => setCfg({ ...cfg, b: v })} />
        </Field>
        <Field label={`Stake: ${cfg.mult}× Kelly`}>
          <input type="range" min={0.25} max={3} step={0.25} value={cfg.mult} onChange={(e) => setCfg({ ...cfg, mult: Number(e.target.value) })} className="w-48 accent-[#E8A93A]" aria-label="Kelly multiple" />
        </Field>
        <Field label="Bets">
          <NumberField value={cfg.bets} min={50} max={5000} step={50} onChange={(v) => setCfg({ ...cfg, bets: v })} />
        </Field>
        <Button size="sm" onClick={() => setSeed(seed + 1)}>
          Re-run
        </Button>
      </div>
      {k <= 0 ? (
        <Panel title="No edge">
          <p>With p = {cfg.pPct}% and odds of {fmtOdds(cfg.b)}, the edge is {fmtPct(edge(p, cfg.b))} per £1. Kelly says bet nothing; any positive stake loses money in the long run.</p>
        </Panel>
      ) : (
        sim && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Stake per bet" value={fmtPct(f)} sub={`Kelly is ${fmtPct(k)}`} />
              <Stat label="Growth per bet" value={`${(growth(f, p, cfg.b) * 100).toFixed(3)}%`} sub={`simulated ${(sim.meanGrowth * 100).toFixed(3)}%`} />
              <Stat label="Ever halved" value={fmtPct(sim.pHalved, 0)} sub={`continuous theory ${fmtPct(drawdownProb(0.5, cfg.mult), 0)}`} />
              <Stat label="Ends below start" value={fmtPct(sim.pBelowStart, 0)} />
            </div>
            <Panel title="Wealth over time: median and 5–95% range of 1,000 paths">
              <LineChart x={sim.steps} xLabel="bet" series={[{ name: 'Median', values: sim.q50 }]} band={{ lo: sim.q05, hi: sim.q95, name: '5–95%' }} yFormat={fmtW} zeroLine height={240} />
            </Panel>
            <Panel title="How the Kelly multiple trades growth for drawdowns">
              <table className="w-full text-sm num">
                <thead className="text-paper-muted">
                  <tr>
                    <th className="text-left font-normal">Multiple of Kelly</th>
                    <th className="text-right font-normal">Growth vs Kelly</th>
                    <th className="text-right font-normal">P(ever halved), theory</th>
                    <th className="text-right font-normal">P(ever down 80%), theory</th>
                  </tr>
                </thead>
                <tbody>
                  {[0.25, 0.5, 1, 1.5, 2].map((c) => (
                    <tr key={c} className={cx('border-t border-ink-line/60', c === cfg.mult && 'text-signal')}>
                      <td className="py-1">{c}×</td>
                      <td className="text-right">{fmtPct(growth(Math.min(0.99, c * k), p, cfg.b) / growth(k, p, cfg.b), 0)}</td>
                      <td className="text-right">{fmtPct(drawdownProb(0.5, c), 0)}</td>
                      <td className="text-right">{fmtPct(drawdownProb(0.2, c), 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </>
        )
      )}
    </div>
  );
}

// ------------------------------------------------------------------ risk of ruin

interface HeroLineLite {
  netBB: number;
}

function pokerNumbers(): { hands: number; wr: number; sd: number } | null {
  const lines = load<HeroLineLite[]>('poker.heroLines', []);
  if (lines.length < 100) return null;
  const xs = lines.map((l) => l.netBB);
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return { hands: xs.length, wr: m * 100, sd: Math.sqrt(v) * 10 };
}

function Ruin(): JSX.Element {
  useStorageVersion();
  const [c, setC] = usePersistent('betting.ruin', { wr: 5, sd: 90, bankroll: 2000 });
  const mine = pokerNumbers();
  // Per-hand drift and s.d. from per-100-hands figures.
  const mu = c.wr / 100, sigma = c.sd / 10;
  const ror = riskOfRuin(mu, sigma, c.bankroll);
  return (
    <div className="grid lg:grid-cols-2 gap-6 items-start">
      <Panel title="Poker bankroll">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Win rate (bb/100)">
            <NumberField value={c.wr} min={-50} max={50} step={0.5} onChange={(v) => setC({ ...c, wr: v })} />
          </Field>
          <Field label="Std dev (bb/100)">
            <NumberField value={c.sd} min={10} max={300} step={5} onChange={(v) => setC({ ...c, sd: v })} />
          </Field>
          <Field label="Bankroll (bb)">
            <NumberField value={c.bankroll} min={10} max={1e6} step={100} onChange={(v) => setC({ ...c, bankroll: v })} />
          </Field>
        </div>
        {mine ? (
          <div className="mt-4 text-sm text-paper-muted">
            From your {mine.hands.toLocaleString('en-GB')} hands here: {mine.wr.toFixed(1)} bb/100 with a standard deviation of {mine.sd.toFixed(0)} bb/100. The win rate's standard error is ±{(mine.sd / Math.sqrt(mine.hands / 100)).toFixed(1)} bb/100, so treat it with care.{' '}
            <button type="button" className="underline underline-offset-2 hover:text-paper" onClick={() => setC({ ...c, wr: Number(mine.wr.toFixed(1)), sd: Math.round(mine.sd) })}>
              Use my numbers
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-paper-dim">Play 100+ hands in the poker section and your own win rate and standard deviation can be filled in here.</p>
        )}
        <div className="grid grid-cols-3 gap-4 mt-6">
          <Stat label="Risk of ruin" value={ror >= 0.9995 ? '100%' : fmtPct(ror, ror < 0.01 ? 2 : 1)} tone={ror > 0.05 ? 'neg' : 'pos'} />
          <Stat label="Bankroll for 5%" value={Number.isFinite(bankrollFor(mu, sigma, 0.05)) ? `${Math.round(bankrollFor(mu, sigma, 0.05)).toLocaleString('en-GB')} bb` : '∞'} />
          <Stat label="Bankroll for 1%" value={Number.isFinite(bankrollFor(mu, sigma, 0.01)) ? `${Math.round(bankrollFor(mu, sigma, 0.01)).toLocaleString('en-GB')} bb` : '∞'} />
        </div>
      </Panel>
      <Panel title="Where the formula comes from">
        <div className="prose-math text-[16px]">
          <p>Treat your bankroll as a random walk with drift μ and standard deviation σ per hand. The probability of ever losing a bankroll B is</p>
          <F>RoR = exp(−2μB / σ²)</F>
          <p>With win rate w and standard deviation s quoted per 100 hands, μ = w/100 and σ = s/10 per hand, so 2μB/σ² = 2wB/s². Doubling your bankroll squares the risk; a small edge needs a big roll.</p>
          <Example>At 5 bb/100 and 90 bb/100, a 2,000 bb roll gives exp(−2·5·2000/8100) ≈ {fmtPct(riskOfRuin(0.05, 9, 2000), 1)}.</Example>
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ learn

function Learn(): JSX.Element {
  useStorageVersion();
  const games = getSessions('betting').filter((s) => s.mode === 'kelly-game');
  return (
    <div className="space-y-3 max-w-3xl">
      {games.length > 0 && <p className="text-sm text-paper-muted">Your last Kelly game scored {games.at(-1)!.score}% of Kelly's growth.</p>}
      <Lesson title="Why maximise log wealth" open>
        <p>A bet repeated many times multiplies your bankroll by (1 + b·f) after a win and (1 − f) after a loss. After n bets with k wins, wealth is W₀(1 + bf)ᵏ(1 − f)ⁿ⁻ᵏ. Its long-run growth rate is the expected log of one factor:</p>
        <F>g(f) = p·ln(1 + b·f) + q·ln(1 − f)</F>
        <p>Maximising g gives the Kelly fraction. Any other fraction grows more slowly in the long run, with probability one.</p>
      </Lesson>
      <Lesson title="The Kelly fraction">
        <p>Set g′(f) = 0: pb/(1 + bf) = q/(1 − f), so</p>
        <F>f* = p − q/b = edge / odds</F>
        <Example>A coin that lands heads 60% of the time at even money: f* = 0.6 − 0.4 = 20% of your bankroll. At 2 to 1 with p = 40%: f* = 0.4 − 0.6/2 = 10%.</Example>
        <p>If p·b ≤ q the edge is zero or negative and Kelly bets nothing.</p>
      </Lesson>
      <Lesson title="Over-betting is worse than under-betting">
        <p>Near the optimum, g(f) is roughly a parabola: g(c·f*) ≈ g(f*)·c(2 − c). Half Kelly keeps 75% of the growth; double Kelly keeps none, and more than double shrinks your bankroll despite a positive edge.</p>
        <p>Because your estimate of p is uncertain, and errors on the high side are punished harder, practitioners usually bet a fraction of Kelly.</p>
      </Lesson>
      <Lesson title="Drawdowns">
        <p>Betting c × Kelly, the chance of ever falling to a fraction x of your starting bankroll is about</p>
        <F>P(drawdown to x) ≈ x^(2/c − 1)</F>
        <Example>Full Kelly: a 50% chance of halving at some point. Half Kelly: 12.5%. That is the main argument for fractional Kelly: a little less growth for far smaller drawdowns.</Example>
      </Lesson>
      <Lesson title="Risk of ruin with fixed bets">
        <p>Betting a fixed amount (as poker players do with stakes), ruin is possible. For a random walk with drift μ and variance σ² per bet, starting B units from zero, RoR = exp(−2μB/σ²). Even-money bets with edge e give the classic ((1 − e)/(1 + e))^B.</p>
        <p>Kelly avoids ruin by betting a fraction of current wealth: stakes shrink as you lose.</p>
      </Lesson>
      <Lesson title="Several bets at once">
        <p>With simultaneous independent bets, Kelly maximises the expected log of total wealth across all outcome combinations. The optimal stakes are each a little smaller than the single-bet Kelly, and correlated bets should be treated as one bigger bet.</p>
      </Lesson>
    </div>
  );
}
