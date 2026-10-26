import { useState } from 'react';
import { describeRules } from '@/games/blackjack/rules';
import { bjWorker } from '@/workers/clients';
import { Button, Panel, ProgressBar } from '../../components/core';
import { Example, F, Lesson } from '../../components/Lesson';
import { useBJ } from './PlayBJ';

export function LearnBJ(): JSX.Element {
  const { snap } = useBJ();
  const rules = snap.config.rules;
  const [sim, setSim] = useState<{ mean: number; se: number; sd: number; n: number } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const run = async (): Promise<void> => {
    setProgress(0);
    const r = await bjWorker.call('houseEdge', { rules, rounds: 1_000_000 }, (p) => setProgress(p as number));
    setSim(r);
    setProgress(null);
  };
  return (
    <div className="space-y-3 max-w-4xl">
      <Panel title="House edge for your table">
        <p className="text-paper-muted mb-3">{describeRules(rules)}. Simulate a million rounds of perfect basic strategy to estimate the edge and its uncertainty.</p>
        <div className="flex items-center gap-3">
          <Button variant="primary" size="sm" onClick={run} disabled={progress !== null}>
            Simulate 1,000,000 rounds
          </Button>
          {progress !== null && <ProgressBar value={progress} className="flex-1" />}
        </div>
        {sim && (
          <p className="mt-3">
            Player return per initial bet: <span className="num font-semibold">{(sim.mean * 100).toFixed(2)}%</span> ± {(1.96 * sim.se * 100).toFixed(2)}% (95%), so the house edge is about {(-sim.mean * 100).toFixed(2)}%. Standard deviation per round {sim.sd.toFixed(2)} units.
          </p>
        )}
      </Panel>
      <Lesson title="House edge and how rules change it" open>
        <p>
          The house edge is the expected loss per unit of <em>initial</em> bet: <strong>edge = −E[X]</strong>, where X is your net result for one round with optimal (basic) strategy. Doubles and splits put more money on the table, so the edge per dollar wagered is smaller than per initial bet.
        </p>
        <p>The only structural advantage the house has is that you act first: if you bust, you lose even if the dealer would also have busted. Everything else — 3:2 blackjacks, doubling, splitting, surrender, standing on stiff hands — claws value back.</p>
        <p>Approximate effects relative to a 6-deck, S17, DAS game (positive = worse for you):</p>
        <ul>
          <li>Blackjack pays 6:5 instead of 3:2: about +1.4%. A natural comes ≈ 4.75% of the time and pays 0.3 less: 0.0475 × 0.3 ≈ 1.4%.</li>
          <li>Dealer hits soft 17: about +0.2% (the dealer improves soft 17 more often than it busts).</li>
          <li>No double after split: about +0.14%. Late surrender available: about −0.08%. Re-split aces: about −0.08%.</li>
          <li>More decks: 1→2 decks ≈ +0.3%, 2→6 ≈ +0.3%, 6→8 ≈ +0.03%. Fewer decks help because removing cards shifts the odds more (e.g. your blackjack is likelier when you hold an ace).</li>
        </ul>
        <p>Use the simulator above to check any rule set: with a million rounds the standard error is about 0.12%.</p>
      </Lesson>
      <Lesson title="Why basic strategy works">
        <p>
          The dealer has no choices, so given the upcard u and the unseen cards, the dealer's final total D has a fixed distribution over {'{17, 18, 19, 20, 21, bust}'}. That makes every decision a pure expected-value comparison:
        </p>
        <F>
          EV<sub>stand</sub>(T) = P(bust) + P(D &lt; T) − P(D &gt; T)
        </F>
        <F>
          EV<sub>hit</sub>(H) = Σ<sub>r</sub> p<sub>r</sub> · max(EV<sub>stand</sub>(H + r), EV<sub>hit</sub>(H + r)),  with −1 for a bust
        </F>
        <F>
          EV<sub>double</sub>(H) = 2 · Σ<sub>r</sub> p<sub>r</sub> · EV<sub>stand</sub>(H + r),  EV<sub>surrender</sub> = −½
        </F>
        <p>Basic strategy is simply the argmax of these, averaged over the two-card hands that make each total. This app computes the chart from these equations for whatever rules you set (see the Strategy chart tab).</p>
        <Example>
          16 vs 10. Standing wins only if the dealer busts (≈ 21% with a ten up, after the peek), so EV ≈ 2(0.21) − 1 ≈ −0.58. Hitting busts often but sometimes makes 17–21; its EV is about −0.54. Both are bad; hitting is less bad. With surrender (−0.50) you should give it up.
        </Example>
        <p>The chart is "total-dependent". The exact best play can differ slightly with the precise cards (e.g. 16 made of three cards); the Hints panel shows those exact composition-dependent EVs.</p>
      </Lesson>
      <Lesson title="Risk of ruin">
        <p>
          Treat your bankroll as a random walk with per-round mean μ and standard deviation σ (in betting units). For μ &gt; 0 the probability of ever losing a bankroll B is approximately
        </p>
        <F>RoR ≈ exp(−2μB / σ²)</F>
        <p>
          This comes from the diffusion approximation: for Brownian motion with drift μ and variance σ² per round, P(hit −B) = e<sup>−2μB/σ²</sup>. For μ ≤ 0 ruin is certain if you play forever — a negative-edge game cannot be beaten by bankroll management.
        </p>
        <Example>
          Suppose a counter's results (measured by simulating their bet spread) average μ = 0.04 units per round with σ = 6.4 units per round, and their bankroll is B = 400 units. Then 2μB/σ² = 2 × 0.04 × 400 / 40.96 ≈ 0.78, so RoR ≈ e<sup>−0.78</sup> ≈ 46%. Doubling the bankroll squares the risk: 0.46² ≈ 21%.
        </Example>
      </Lesson>
      <Lesson title="The maths of card counting">
        <p>
          Each card's <strong>effect of removal</strong> (EoR) is the change in the player's expectation when one card of that rank is removed from a full shoe. Small cards (2–6) help the dealer complete stiff hands, so removing them helps you; tens and aces make blackjacks, doubles and dealer busts, so removing them hurts you.
        </p>
        <p>Hi-Lo tags (+1 for 2–6, 0 for 7–9, −1 for tens and aces) are a simple integer approximation of the EoRs and sum to zero over a deck. The <strong>running count</strong> RC is the sum of tags seen. Dividing by decks remaining gives the <strong>true count</strong>, which measures the excess of high cards <em>per deck</em> — what actually drives your edge:</p>
        <F>TC = RC / decks remaining,  edge ≈ (base edge) + 0.5% × TC</F>
        <p>Off the top of a 6-deck S17 game the edge is about −0.4%, so you have the advantage from roughly TC +1. Counters bet more when TC is high: the Kelly fraction for a near-even-money game is f* ≈ edge / σ², with σ² ≈ 1.3 for blackjack.</p>
        <Example>
          Insurance pays 2:1, so it breaks even when P(hole card is a ten) = 1/3. In a fresh 6-deck shoe with an ace showing, P(ten) = 96/311 ≈ 30.9% &lt; 33.3%: insurance loses about 7% of the stake. At a true count of about +3 the ten density reaches 1/3 — that is the insurance index.
        </Example>
        <p>The other index plays (Illustrious 18, Fab 4) are the true counts at which two actions' EVs cross, e.g. 16 vs 10: stand at TC ≥ 0. The counting trainer grades you on them.</p>
      </Lesson>
    </div>
  );
}
