import { useEffect, useRef, useState } from 'react';
import { CryptoSource } from '@/shared/fairness/rng';
import { fisherYates } from '@/shared/fairness/shuffle';
import { hiLo } from '@/games/blackjack/counting';
import { recordAttempt, recordSession } from '@/shared/stats/activity';
import { recordReview } from '@/shared/srs/srs';
import { Button, Field, Panel, Segmented, Stat } from '../../components/core';
import { PlayingCard } from '../../components/PlayingCard';
import { usePersistent } from '../../hooks';

type Phase = 'setup' | 'flashing' | 'answer' | 'result';

interface DrillBest {
  [key: string]: number;
}

/** Speed-counting drill: cards flash; then give the running count. */
export function CountDrill(): JSX.Element {
  const [perSec, setPerSec] = usePersistent('bj.drill.speed', 2);
  const [group, setGroup] = usePersistent('bj.drill.group', 1);
  const [count, setCount] = usePersistent('bj.drill.count', 52);
  const [best, setBest] = usePersistent<DrillBest>('bj.drill.best', {});
  const [phase, setPhase] = useState<Phase>('setup');
  const [cards, setCards] = useState<number[]>([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<{ ok: boolean; truth: number; given: number; ms: number } | null>(null);
  const started = useRef(0);

  const start = (): void => {
    const deck = fisherYates(Array.from({ length: 52 * 2 }, (_, i) => i % 52), new CryptoSource()).slice(0, count);
    setCards(deck);
    setIdx(0);
    setAnswer('');
    setResult(null);
    started.current = Date.now();
    setPhase('flashing');
  };

  useEffect(() => {
    if (phase !== 'flashing') return;
    if (idx >= cards.length) {
      setPhase('answer');
      return;
    }
    const t = setTimeout(() => setIdx((i) => i + group), 1000 / perSec);
    return () => clearTimeout(t);
  }, [phase, idx, cards.length, group, perSec]);

  const submit = (): void => {
    const truth = cards.reduce((a, c) => a + hiLo(c), 0);
    const given = Number(answer);
    const ok = given === truth;
    const ms = Date.now() - started.current;
    setResult({ ok, truth, given, ms });
    setPhase('result');
    recordAttempt({ section: 'blackjack', skill: 'speed-count', correct: ok, ms });
    recordReview('blackjack', 'speed-count', ok ? (perSec >= 3 ? 5 : 4) : 1);
    recordSession({ section: 'blackjack', mode: 'count-drill', durationMs: ms, score: ok ? 1 : 0, total: 1, summary: { cardsPerSec: perSec, cards: count } });
    const key = `${count}`;
    if (ok && perSec * group > (best[key] ?? 0)) setBest({ ...best, [key]: perSec * group });
  };

  const shown = cards.slice(idx, idx + group);
  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <Panel title="Speed counting">
        <div className="min-h-[260px] flex flex-col items-center justify-center gap-6">
          {phase === 'setup' && <p className="text-paper-muted max-w-md text-center">Cards will flash one group at a time. Keep the Hi-Lo running count (2–6 +1, 7–9 0, tens and aces −1), then enter it.</p>}
          {phase === 'flashing' && (
            <>
              <div className="flex gap-2">
                {shown.map((c, k) => (
                  <PlayingCard key={`${idx}-${k}`} card={c} size="lg" />
                ))}
              </div>
              <div className="text-sm text-paper-dim num">
                {Math.min(idx + group, cards.length)} / {cards.length}
              </div>
            </>
          )}
          {phase === 'answer' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (answer.trim() !== '') submit();
              }}
              className="flex flex-col items-center gap-3"
            >
              <Field label="Running count">
                <input autoFocus className="input w-32 text-center text-xl num" inputMode="numeric" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Running count" />
              </Field>
              <Button variant="primary" type="submit">
                Check
              </Button>
            </form>
          )}
          {phase === 'result' && result && (
            <div className="text-center space-y-2">
              <p className={result.ok ? 'text-bid text-xl' : 'text-ask text-xl'}>{result.ok ? 'Correct' : 'Not quite'}</p>
              <p className="text-paper-muted">
                Running count {result.truth}
                {!result.ok && `, you said ${result.given}`}. {cards.length} cards at {perSec * group} cards/s.
              </p>
            </div>
          )}
          {phase !== 'flashing' && phase !== 'answer' && (
            <Button variant="primary" onClick={start}>
              {phase === 'result' ? 'Go again' : 'Start'}
            </Button>
          )}
        </div>
      </Panel>
      <Panel title="Settings">
        <div className="space-y-4">
          <Field label="Flashes per second">
            <Segmented value={perSec} onChange={setPerSec} options={[1, 2, 3, 4, 6].map((x) => ({ value: x, label: String(x) }))} />
          </Field>
          <Field label="Cards per flash" hint="Counting pairs at once is how fast counters cancel +1/−1 combinations.">
            <Segmented value={group} onChange={setGroup} options={[1, 2, 3].map((x) => ({ value: x, label: String(x) }))} />
          </Field>
          <Field label="Cards">
            <Segmented value={count} onChange={setCount} options={[20, 52, 104].map((x) => ({ value: x, label: String(x) }))} />
          </Field>
          <Stat size="sm" label={`Best accurate speed (${count} cards)`} value={best[`${count}`] ? `${best[`${count}`]} cards/s` : '–'} />
        </div>
      </Panel>
    </div>
  );
}
