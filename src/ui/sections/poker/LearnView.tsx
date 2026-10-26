import { useState } from 'react';
import { classFromName, combosInClass } from '@/games/poker/ranges/combos';
import { RANK_PCT, rfiPercent, type Position } from '@/games/poker/ranges/preflop';
import { equityWorker } from '@/workers/clients';
import { Button, cx, Field, fmtPct, NumberField, Panel, Segmented, Stat } from '../../components/core';
import { LineChart } from '../../components/charts';
import { Example, F, Lesson } from '../../components/Lesson';
import { usePersistent } from '../../hooks';

const RANKS = 'AKQJT98765432';

export function LearnView(): JSX.Element {
  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
      <div className="space-y-3">
        <Lesson title="Hand rankings and how rare they are" open>
          <p>Of the 2,598,960 possible five-card hands:</p>
          <table className="w-full text-[15px] font-sans num">
            <tbody>
              {(
                [
                  ['Straight flush', 40],
                  ['Four of a kind', 624],
                  ['Full house', 3744],
                  ['Flush', 5108],
                  ['Straight', 10200],
                  ['Three of a kind', 54912],
                  ['Two pair', 123552],
                  ['One pair', 1098240],
                  ['High card', 1302540],
                ] as [string, number][]
              ).map(([n, c]) => (
                <tr key={n} className="border-t border-ink-line/60">
                  <td className="py-1">{n}</td>
                  <td className="text-right">{c.toLocaleString('en-GB')}</td>
                  <td className="text-right text-paper-muted w-24">{fmtPct(c / 2598960, c < 1000 ? 4 : 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Rarer hands rank higher. The app's evaluator reproduces these counts exactly (it is tested against them).</p>
        </Lesson>
        <Lesson title="Pot odds: the price of a call">
          <p>Facing a bet B into a pot P, you call B to win P + B. Calling breaks even when your equity is</p>
          <F>required equity = B / (P + 2B)</F>
          <Example>Half-pot bet: 0.5 / 2 = 25%. Pot-sized bet: 1 / 3 ≈ 33%. Twice pot: 2 / 5 = 40%.</Example>
          <p>The other side of the coin: to stop a bluff with any two cards being profitable, the defender must continue with at least P / (P + B) of their range, the minimum defence frequency.</p>
        </Lesson>
        <Lesson title="Outs and the rule of 2 and 4">
          <p>An out is an unseen card that should give you the best hand. With one card to come, equity ≈ 2% per out; with two (all in on the flop) ≈ 4% per out, which overstates large draws slightly.</p>
          <Example>Flush draw (9 outs) on the flop: rule of 4 says 36%; exactly 1 − C(38,2)/C(47,2) = 35.0%. On the turn: 9/46 = 19.6%.</Example>
          <p>Discount "dirty" outs that also improve your opponent, e.g. a flush card that pairs the board when they might have a full house.</p>
        </Lesson>
        <Lesson title="Combos and blockers">
          <p>There are 1,326 starting hands: each pair has 6 combinations, each suited hand 4, each offsuit hand 12. Cards you can see remove combinations from your opponent's range.</p>
          <Example>On a K♠7♦2♣ board, sets of kings: C(3,2) = 3 combos, against 12 for AK offsuit before blockers (9 with a king on board).</Example>
        </Lesson>
        <Lesson title="Bluffing frequency on the river">
          <p>If you bet B into P, your opponent's call gets P + B : B. To make them indifferent, your betting range should contain bluffs at a ratio of</p>
          <F>bluffs / (value + bluffs) = B / (P + 2B)</F>
          <p>The same number as the caller's required equity: a pot-sized bet supports one bluff for every two value bets.</p>
        </Lesson>
        <Lesson title="Position and equity realisation">
          <p>Acting last lets you see what your opponent does before deciding, so you realise more of your raw equity. That is why opening ranges widen towards the button and why the coach discounts out-of-position calls.</p>
        </Lesson>
        <Lesson title="Variance">
          <p>A good player wins perhaps 5 bb per 100 hands with a standard deviation near 90 bb/100. After 10,000 hands the standard error of your win rate is still 90 / √100 = 9 bb/100: results tell you very little about skill over short samples. Try the simulator.</p>
        </Lesson>
      </div>
      <div className="space-y-6">
        <OpeningChart />
        <VarianceSim />
      </div>
    </div>
  );
}

function OpeningChart(): JSX.Element {
  const [pos, setPos] = usePersistent<Position>('poker.learnPos', 'CO');
  const cut = rfiPercent(pos, 6);
  let combos = 0;
  const cells = Array.from(RANKS).flatMap((r1, i) =>
    Array.from(RANKS).map((r2, j) => {
      const name = i === j ? `${r1}${r2}` : i < j ? `${r1}${r2}s` : `${r2}${r1}o`;
      const cls = classFromName(name);
      const open = RANK_PCT[cls] - combosInClass(cls) / 1326 / 2 <= cut;
      if (open) combos += combosInClass(cls);
      return { name, open, edge: Math.abs(RANK_PCT[cls] - cut) < 0.02 };
    }),
  );
  return (
    <Panel title="6-max opening ranges (100bb, raise first in)">
      <Segmented size="sm" label="Position" value={pos} onChange={setPos} options={(['UTG', 'HJ', 'CO', 'BTN', 'SB'] as Position[]).map((p) => ({ value: p, label: p }))} />
      <div className="grid gap-px mt-3 text-[10px] sm:text-[11px] num select-none" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }} role="img" aria-label={`Opening range from ${pos}: ${Math.round((combos / 1326) * 100)}% of hands`}>
        {cells.map((c) => (
          <div key={c.name} className={cx('aspect-square flex items-center justify-center rounded-[2px]', c.open ? 'bg-signal/80 text-ink font-semibold' : 'bg-ink-raised text-paper-dim', c.edge && 'ring-1 ring-inset ring-paper/40')}>
            {c.name}
          </div>
        ))}
      </div>
      <p className="text-sm text-paper-muted mt-3">
        Opens {Math.round((combos / 1326) * 100)}% of hands. Suited hands are above the diagonal, offsuit below; outlined cells are borderline. These ranges come from this app's hand ordering and approximate standard charts.
      </p>
    </Panel>
  );
}

interface VarResult {
  x: number[];
  p5: number[];
  p50: number[];
  p95: number[];
  sample: number[][];
  maxDowns: number[];
  pLosing: number;
}

function VarianceSim(): JSX.Element {
  const [cfg, setCfg] = usePersistent('poker.variance', { winrate: 5, sd: 90, hands: 50000 });
  const [res, setRes] = useState<VarResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      setRes((await equityWorker.call('variance', { ...cfg, paths: 1000 })) as VarResult);
    } finally {
      setBusy(false);
    }
  };
  const q = (xs: number[], f: number): number => [...xs].sort((a, b) => a - b)[Math.floor(f * (xs.length - 1))];
  return (
    <Panel title="Downswing simulator">
      <div className="flex flex-wrap gap-4 items-end">
        <Field label="Win rate (bb/100)">
          <NumberField value={cfg.winrate} min={-20} max={30} step={0.5} onChange={(v) => setCfg({ ...cfg, winrate: v })} />
        </Field>
        <Field label="Std dev (bb/100)">
          <NumberField value={cfg.sd} min={30} max={200} step={5} onChange={(v) => setCfg({ ...cfg, sd: v })} />
        </Field>
        <Field label="Hands">
          <NumberField value={cfg.hands} min={1000} max={200000} step={1000} onChange={(v) => setCfg({ ...cfg, hands: v })} />
        </Field>
        <Button variant="primary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Simulating…' : 'Simulate 1,000 players'}
        </Button>
      </div>
      {res && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Stat size="sm" label="Losing after all hands" value={fmtPct(res.pLosing, 0)} />
            <Stat size="sm" label="Typical worst downswing" value={`${Math.round(q(res.maxDowns, 0.5)).toLocaleString('en-GB')} bb`} sub="median of the biggest peak-to-trough" />
            <Stat size="sm" label="1 in 20 players see" value={`${Math.round(q(res.maxDowns, 0.95)).toLocaleString('en-GB')} bb`} sub="95th percentile downswing" />
          </div>
          <LineChart
            x={res.x}
            xLabel="hands"
            xFormat={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
            series={[{ name: 'Median player', values: res.p50 }, ...res.sample.slice(0, 2).map((s, i) => ({ name: `Player ${i + 1}`, values: s, dashed: true }))]}
            band={{ lo: res.p5, hi: res.p95, name: '5–95% of players' }}
            zeroLine
            yFormat={(v) => `${Math.round(v).toLocaleString('en-GB')} bb`}
            height={240}
          />
          <p className="text-sm text-paper-muted">Every simulated player has exactly the same true win rate. The spread is luck.</p>
        </div>
      )}
    </Panel>
  );
}
