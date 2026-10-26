import { useState } from 'react';
import type { PositionTestResult } from '@/shared/fairness/chisq';
import type { FairnessReveal } from '@/shared/fairness/commit';
import { cardToString } from '@/shared/cards/card';
import { fairnessWorker } from '@/workers/clients';
import { Button, Panel, PageHeader, ProgressBar, Segmented, Stat } from '../components/core';
import { divergingColor, Heatmap } from '../components/charts';
import { VerifyPanel } from '../components/Fairness';

export default function FairnessPage(): JSX.Element {
  const [trials, setTrials] = useState(20000);
  const [kind, setKind] = useState<'fair' | 'naive'>('fair');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<PositionTestResult | null>(null);
  const [json, setJson] = useState('');
  const [reveal, setReveal] = useState<FairnessReveal | null>(null);
  const [parseError, setParseError] = useState('');

  const run = async (): Promise<void> => {
    setProgress(0);
    setResult(null);
    const r = await fairnessWorker.call('positionTest', { trials, kind }, (p) => setProgress(p as number));
    setResult(r);
    setProgress(null);
  };

  const E = result ? result.trials / 52 : 1;
  const residuals = result?.counts.map((row) => row.map((o) => (o - E) / Math.sqrt(E))) ?? [];

  return (
    <div>
      <PageHeader
        title="Fairness lab"
        lede="Every poker hand and blackjack shoe is shuffled from a seed whose SHA-256 hash is shown before the first card. Test the shuffle statistically here, or verify any revealed deal."
      />
      <div className="grid xl:grid-cols-[1fr_380px] gap-6">
        <Panel
          title="Chi-squared position test"
>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Segmented size="sm" value={kind} onChange={(v) => (setKind(v), setResult(null))} options={[{ value: 'fair', label: 'Production shuffle' }, { value: 'naive', label: 'Biased naive shuffle', title: 'Swap each position with any position: a classic bug' }]} label="Shuffle to test" />
            <Segmented size="sm" value={trials} onChange={setTrials} options={[{ value: 5000, label: '5k' }, { value: 20000, label: '20k' }, { value: 100000, label: '100k' }]} label="Number of shuffles" />
            <Button variant="primary" size="sm" onClick={run} disabled={progress !== null}>
              Run test
            </Button>
          </div>
          <div className="prose-math mb-4">
            <p>
              Shuffle {trials.toLocaleString()} decks with fresh random seeds and count how often each card lands in each position. A uniform shuffle puts card <em>c</em> at position <em>p</em> with probability 1/52, so each cell expects <em>E</em> = T/52.
            </p>
            <div className="formula">
              X² = Σ<sub>c,p</sub> (O<sub>cp</sub> − E)² / E, with (52 − 1)² = 2601 degrees of freedom
            </div>
            <p>Row and column totals are fixed at T, which removes 2·52 − 1 constraints from the 52² cells. Under uniformity X² ≈ 2601 ± 72, and the p-value is uniform on (0, 1).</p>
            <p>To see that the test has teeth, switch to the biased naive shuffle (swap each position with <em>any</em> position). It has 52⁵² equally likely paths, which cannot spread evenly over 52! orders, and the test rejects it decisively.</p>
          </div>
          {progress !== null && <ProgressBar value={progress} className="mb-4" />}
          {result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="X² statistic" value={result.stat.toFixed(0)} sub={`df ${result.df}`} />
                <Stat label="p-value" value={result.pValue.toFixed(3)} tone={result.pValue > 0.001 ? 'pos' : 'neg'} sub={result.pValue > 0.001 ? 'consistent with uniform' : 'reject uniformity'} />
                <Stat label="Max |residual|" value={result.maxAbsResidual.toFixed(2)} sub="typically 3 to 4 across 2704 cells" />
                <Stat label="Expected per cell" value={E.toFixed(1)} />
              </div>
              <div>
                <p className="text-sm text-paper-muted mb-2">Standardised residuals (O − E)/√E. Rows are cards, columns are positions; blue is below expectation, orange above. Pure noise should look like static.</p>
                <Heatmap
                  values={residuals}
                  cell={9}
                  label="Residual heatmap"
                  color={(v) => divergingColor(v / 3)}
                  describe={(r, c, v) => (
                    <span>
                      {cardToString(r)} at position {c + 1}: {result.counts[r][c]} vs {E.toFixed(1)} expected (z = {v.toFixed(2)})
                    </span>
                  )}
                />
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Verify a revealed deal">
          <p className="text-sm text-paper-muted mb-3">Paste the reveal JSON downloaded from any hand or shoe.</p>
          <textarea className="input w-full h-28 font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"commit": "…", "serverSeed": "…", …}' aria-label="Reveal JSON" />
          <div className="mt-2 flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => {
                try {
                  const r = JSON.parse(json) as FairnessReveal;
                  if (!r.serverSeed || !r.commit || !Array.isArray(r.order)) throw new Error('missing fields');
                  setReveal({ ...r, dealt: r.dealt ?? [] });
                  setParseError('');
                } catch (e) {
                  setParseError(`That isn't a reveal file (${(e as Error).message}). Download one from a finished hand.`);
                  setReveal(null);
                }
              }}
            >
              Verify
            </Button>
            {parseError && <span className="text-sm text-ask">{parseError}</span>}
          </div>
          {reveal && (
            <div className="mt-4">
              <VerifyPanel reveal={reveal} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
