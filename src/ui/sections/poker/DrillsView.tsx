import { useEffect, useMemo, useRef, useState } from 'react';
import { Rng } from '@/shared/random/prng';
import { priority, getDeck, recordReview } from '@/shared/srs/srs';
import { getSkillAggs, recordAttempt } from '@/shared/stats/activity';
import { checkDrill, DRILLS, MAKERS, type DrillId, type DrillQ } from '@/games/poker/drills/drills';
import { Button, cx, Segmented } from '../../components/core';
import { CardRow } from '../../components/PlayingCard';
import { useHotkeys, usePersistent, useStorageVersion } from '../../hooks';

type Choice = DrillId | 'mixed';

/** Mixed mode: spaced repetition over drill types, weakest and most overdue first. */
function pickDrill(r: Rng, last?: DrillId): DrillId {
  const deck = getDeck('poker');
  const ids = DRILLS.map((d) => d.id);
  const w = ids.map((id) => (id === last ? 0.2 : 1) * (0.3 + priority(deck[`drill:${id}`])));
  return r.weighted(ids, w);
}

export function DrillsView(): JSX.Element {
  useStorageVersion();
  const rng = useMemo(() => new Rng(), []);
  const [mode, setMode] = usePersistent<Choice>('poker.drillMode', 'mixed');
  const [q, setQ] = useState<DrillQ>(() => MAKERS[mode === 'mixed' ? pickDrill(rng) : mode](rng));
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{ ok: boolean; given: string } | null>(null);
  const t0 = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const next = (m: Choice = mode): void => {
    setQ(MAKERS[m === 'mixed' ? pickDrill(rng, q.drill) : m](rng));
    setInput('');
    setResult(null);
    t0.current = Date.now();
  };
  useEffect(() => inputRef.current?.focus(), [q]);

  const submit = (given: string | number): void => {
    if (result) return;
    const ok = checkDrill(q.answer, given);
    const ms = Date.now() - t0.current;
    recordAttempt({ section: 'poker', skill: `drill-${q.drill}`, correct: ok, ms });
    recordReview('poker', `drill:${q.drill}`, ok ? (ms < 20_000 ? 5 : 4) : 1);
    setResult({ ok, given: q.answer.kind === 'choice' ? q.answer.options[Number(given)] : String(given) });
  };
  useHotkeys({ Enter: () => next(), n: () => next() }, !!result);
  useHotkeys(Object.fromEntries((q.answer.kind === 'choice' ? q.answer.options : []).map((_, i) => [String(i + 1), () => submit(i)])), !result && q.answer.kind === 'choice');

  const aggs = getSkillAggs();
  const meta = DRILLS.find((d) => d.id === q.drill)!;
  const correctText = q.answer.kind === 'int' ? String(q.answer.value) : q.answer.kind === 'pct' ? `${(q.answer.value * 100).toFixed(1)}%` : q.answer.accepted.map((i) => (q.answer as { options: string[] }).options[i]).join(' or ');
  return (
    <div className="space-y-4 max-w-4xl">
      <Segmented
        label="Drill"
        size="sm"
        value={mode}
        onChange={(v) => {
          setMode(v);
          next(v);
        }}
        options={[{ value: 'mixed' as Choice, label: 'Mixed (spaced repetition)' }, ...DRILLS.map((d) => ({ value: d.id as Choice, label: d.title }))]}
      />
      <div className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline gap-3 text-sm">
          <span className="font-medium">{meta.title}</span>
          <span className="text-paper-muted">{meta.blurb}</span>
          {aggs[`poker:drill-${q.drill}`] && <span className="ml-auto text-paper-dim num">{Math.round(aggs[`poker:drill-${q.drill}`].ewmaAcc * 100)}% recently</span>}
        </div>
        <div className="flex flex-wrap gap-6 mt-4">
          {q.hero && (
            <div>
              <div className="label">Your hand</div>
              <CardRow cards={q.hero} />
            </div>
          )}
          {q.others?.map((o) => (
            <div key={o.label}>
              <div className="label">{o.label}</div>
              <CardRow cards={o.cards} />
            </div>
          ))}
          {q.board && q.board.length > 0 && (
            <div>
              <div className="label">Board</div>
              <CardRow cards={q.board} />
            </div>
          )}
        </div>
        <p className="mt-4 text-md">{q.prompt}</p>
        {!result ? (
          q.answer.kind === 'choice' ? (
            <div className="flex flex-wrap gap-2 mt-4">
              {q.answer.options.map((o, i) => (
                <Button key={o} onClick={() => submit(i)} kbd={String(i + 1)}>
                  {o}
                </Button>
              ))}
            </div>
          ) : (
            <form
              className="flex items-center gap-2 mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim()) submit(input);
              }}
            >
              <input ref={inputRef} className="input w-32 num text-right" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Answer" inputMode="decimal" autoComplete="off" />
              {q.answer.kind === 'pct' && <span className="text-paper-muted">%</span>}
              <Button variant="primary" type="submit" kbd="↵">
                Check
              </Button>
            </form>
          )
        ) : (
          <div className="mt-4" aria-live="polite">
            <div className={cx('text-lg', result.ok ? 'text-bid' : 'text-ask')}>{result.ok ? 'Correct' : `Not ${result.given}: the answer is ${correctText}`}</div>
            <ul className="mt-2 space-y-1 text-paper-muted">
              {q.explain.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <Button className="mt-4" variant="primary" onClick={() => next()} kbd="N">
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
