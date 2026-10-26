import { useEffect, useMemo, useRef, useState } from 'react';
import { Rng } from '@/shared/random/prng';
import { getAttempts, getSessions, getSkillAggs, recordSession } from '@/shared/stats/activity';
import { difference, FAMILY_IDS, FAMILY_LABEL, type Sequence, type Tier } from '@/training/sequences/sequences';
import { drawSequence, getLevel, levelTier, recordSequence } from '@/training/sequences/progress';
import { Button, cx, EmptyState, Field, fmtClock, fmtMs, Panel, ProgressBar, Segmented, Stat, Tabs } from '../../components/core';
import { LineChart } from '../../components/charts';
import { useHotkeys, useNow, usePersistent, useStorageVersion } from '../../hooks';
import { navigate, useRoute } from '../../router';

const TABS = [
  { value: 'sprint', label: 'Sprint' },
  { value: 'practice', label: 'Practice' },
  { value: 'stats', label: 'Stats' },
] as const;

const TIER_NAMES: Record<Tier, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const parseTerm = (s: string): number => Number(s.trim().replace(/[−–]/g, '-').replace(/,/g, ''));

export default function SequencesPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? 'sprint';
  return (
    <div>
      <h1 className="text-2xl mb-2">Sequences</h1>
      <Tabs value={tab} onChange={(v) => navigate(v === 'sprint' ? '/sequences' : `/sequences/${v}`)} tabs={TABS} />
      {tab === 'sprint' && <Sprint />}
      {tab === 'practice' && <Practice />}
      {tab === 'stats' && <Stats />}
    </div>
  );
}

function Terms({ s, reveal }: { s: Sequence; reveal?: boolean }): JSX.Element {
  return (
    <div className={cx('flex flex-wrap justify-center gap-x-3 gap-y-2 font-semibold num tracking-[-0.01em]', s.shown.join('').length + String(s.answer).length > 20 ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl')}>
      {s.shown.map((x, i) => (
        <span key={i}>
          {x}
          <span className="text-paper-dim">,</span>
        </span>
      ))}
      <span className={reveal ? 'text-bid' : 'text-signal'}>{reveal ? s.answer : '?'}</span>
    </div>
  );
}

// ------------------------------------------------------------------ sprint

interface LogEntry {
  s: Sequence;
  given: string;
  correct: boolean;
  skipped: boolean;
  ms: number;
}

function Sprint(): JSX.Element {
  const [dur, setDur] = usePersistent<number>('sequences.sprintSec', 180);
  const [run, setRun] = useState<number | null>(null);
  const [result, setResult] = useState<LogEntry[] | null>(null);
  useStorageVersion();
  const best = Math.max(0, ...getSessions('sequences').filter((x) => x.mode === `sprint-${dur}`).map((x) => x.score));
  if (run && !result) return <SprintRun key={run} durationSec={dur} onDone={setResult} onQuit={() => setRun(null)} />;
  if (result)
    return (
      <SprintResults
        log={result}
        onAgain={() => {
          setResult(null);
          setRun(Date.now());
        }}
        onBack={() => {
          setResult(null);
          setRun(null);
        }}
      />
    );
  return (
    <div className="panel p-5 max-w-2xl space-y-4">
      <p className="text-paper-muted">Find the next term of as many sequences as you can. Difficulty adapts as you go. Each sequence has one rule, checked against a dozen other simple readings, and none repeats.</p>
      <Field label="Length">
        <Segmented value={dur} onChange={setDur} options={[120, 180, 300].map((s) => ({ value: s, label: `${s / 60} min` }))} />
      </Field>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" onClick={() => setRun(Date.now())} kbd="↵">
          Start sprint
        </Button>
        <span className="text-sm text-paper-muted num">
          {best ? `Best ${best}` : 'No score yet'} · level {TIER_NAMES[levelTier(getLevel())]}
        </span>
      </div>
      <StartKey onStart={() => setRun(Date.now())} />
    </div>
  );
}

function StartKey({ onStart }: { onStart: () => void }): null {
  useHotkeys({ Enter: onStart });
  return null;
}

function SprintRun({ durationSec, onDone, onQuit }: { durationSec: number; onDone: (log: LogEntry[]) => void; onQuit: () => void }): JSX.Element {
  const rng = useMemo(() => new Rng(), []);
  const start = useRef(Date.now());
  const qStart = useRef(Date.now());
  const [s, setS] = useState<Sequence>(() => drawSequence(rng, 'adaptive'));
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState('');
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null);
  const done = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const now = useNow(200);
  const remaining = durationSec * 1000 - (now - start.current);

  const finish = (l: LogEntry[]): void => {
    if (done.current) return;
    done.current = true;
    const ms = Math.min(Date.now() - start.current, durationSec * 1000);
    recordSession({ section: 'sequences', mode: `sprint-${durationSec}`, durationMs: ms, score: l.filter((x) => x.correct).length, total: l.length });
    onDone(l);
  };
  useEffect(() => {
    if (remaining <= 0) finish(log);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining <= 0]);
  useEffect(() => inputRef.current?.focus(), [s]);

  const submit = (given: string, skipped = false): void => {
    if (done.current) return;
    const ms = Date.now() - qStart.current;
    const correct = !skipped && parseTerm(given) === s.answer;
    if (!skipped) recordSequence(s, correct, ms, true);
    setLog([...log, { s, given, correct, skipped, ms }]);
    setFlash(correct ? 'ok' : skipped ? null : 'bad');
    setTimeout(() => setFlash(null), 180);
    setS(drawSequence(rng, 'adaptive', s.family));
    setInput('');
    qStart.current = Date.now();
  };
  const last = log.at(-1);
  const score = log.filter((l) => l.correct).length;
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2 text-sm text-paper-muted">
        <span>Sprint · {TIER_NAMES[s.tier]}</span>
        <span className="num">score {score}</span>
        <span className={cx('num font-semibold', remaining < 10_000 && 'text-ask')}>{fmtClock(remaining)}</span>
      </div>
      <ProgressBar value={1 - remaining / (durationSec * 1000)} />
      <div className={cx('mt-8 rounded-lg border p-6 sm:p-10 text-center transition-colors', flash === 'ok' ? 'border-bid' : flash === 'bad' ? 'border-ask' : 'border-ink-line')}>
        <Terms s={s} />
        <form
          className="mt-6 flex justify-center"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) submit(input);
          }}
        >
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), submit('', true))} inputMode="numeric" autoComplete="off" className="input text-2xl text-center w-56 num" aria-label="Next term" />
        </form>
        <p className="text-xs text-paper-dim mt-3">Enter submits, Esc skips.</p>
      </div>
      <div className="mt-4 min-h-[44px] text-sm" aria-live="polite">
        {last && !last.correct && (
          <p className="text-paper-muted">
            <span className="text-ask">{last.skipped ? 'Skipped' : `Not ${last.given}`}</span>: {last.s.shown.join(', ')}, <span className="text-paper font-semibold num">{last.s.answer}</span>. {last.s.rule}
          </p>
        )}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => finish(log)}>
          Finish now
        </Button>
        <Button size="sm" variant="ghost" onClick={onQuit}>
          Quit
        </Button>
      </div>
    </div>
  );
}

function SprintResults({ log, onAgain, onBack }: { log: LogEntry[]; onAgain: () => void; onBack: () => void }): JSX.Element {
  const answered = log.filter((l) => !l.skipped);
  const correct = log.filter((l) => l.correct);
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Score" value={correct.length} size="lg" />
        <Stat label="Accuracy" value={answered.length ? `${Math.round((100 * correct.length) / answered.length)}%` : '–'} />
        <Stat label="Average time" value={answered.length ? fmtMs(answered.reduce((a, l) => a + l.ms, 0) / answered.length) : '–'} />
        <Stat label="Skipped" value={log.length - answered.length} />
      </div>
      <Panel title="Every sequence and its rule">
        <ul className="space-y-2 text-sm">
          {log.map((l, i) => (
            <li key={i} className={cx('border-l-2 pl-3', l.correct ? 'border-bid/60' : 'border-ask/60')}>
              <span className="num">
                {l.s.shown.join(', ')}, <strong>{l.s.answer}</strong>
              </span>
              {!l.correct && <span className="text-paper-dim"> ({l.skipped ? 'skipped' : `you: ${l.given}`})</span>}
              <div className="text-paper-muted">
                {l.s.rule} <span className="text-paper-dim">{l.s.working}.</span>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="flex gap-2">
        <Button variant="primary" onClick={onAgain}>
          Go again
        </Button>
        <Button onClick={onBack}>Back</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ practice

function Practice(): JSX.Element {
  const rng = useMemo(() => new Rng(), []);
  const [tier, setTier] = usePersistent<Tier | 'adaptive'>('sequences.practiceTier', 'adaptive');
  const [s, setS] = useState<Sequence>(() => drawSequence(rng, tier));
  const [input, setInput] = useState('');
  const [state, setState] = useState<{ correct: boolean; given: string } | null>(null);
  const t0 = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const next = (t = tier): void => {
    setS(drawSequence(rng, t, s.family));
    setInput('');
    setState(null);
    t0.current = Date.now();
  };
  useEffect(() => inputRef.current?.focus(), [s]);
  const check = (given: string, giveUp = false): void => {
    if (state) return;
    const correct = !giveUp && parseTerm(given) === s.answer;
    recordSequence(s, correct, Date.now() - t0.current, tier === 'adaptive');
    setState({ correct, given: giveUp ? '' : given });
  };
  useHotkeys({ Enter: () => next(), n: () => next() }, !!state);

  const d1 = difference(s.shown), d2 = difference(d1);
  return (
    <div className="max-w-3xl space-y-4">
      <Segmented
        label="Difficulty"
        value={tier}
        onChange={(v) => {
          setTier(v);
          next(v);
        }}
        options={[{ value: 'adaptive' as const, label: 'Adaptive' }, ...([1, 2, 3] as Tier[]).map((t) => ({ value: t, label: TIER_NAMES[t] }))]}
      />
      <div className="panel p-6 sm:p-8 text-center">
        <Terms s={s} reveal={!!state} />
        {!state ? (
          <form
            className="mt-6 flex flex-wrap justify-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (input.trim()) check(input);
            }}
          >
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} inputMode="numeric" autoComplete="off" className="input text-xl text-center w-48 num" aria-label="Next term" />
            <Button variant="primary" type="submit">
              Check
            </Button>
            <Button variant="ghost" onClick={() => check('', true)}>
              Show rule
            </Button>
          </form>
        ) : (
          <div className="mt-6 text-left max-w-xl mx-auto" aria-live="polite">
            <div className={cx('text-lg', state.correct ? 'text-bid' : 'text-ask')}>{state.correct ? 'Correct' : state.given ? `Not ${state.given}: the next term is ${s.answer}` : `The next term is ${s.answer}`}</div>
            <div className="mt-2">
              <span className="text-paper-muted">{FAMILY_LABEL[s.family]}.</span> {s.rule}
            </div>
            <div className="text-paper-muted mt-1">{s.working}.</div>
            <div className="mt-4 text-sm text-paper-dim num space-y-0.5">
              <div>Differences: {d1.join(', ')}</div>
              <div>Second differences: {d2.join(', ')}</div>
            </div>
            <Button className="mt-4" variant="primary" onClick={() => next()} kbd="N">
              Next sequence
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-paper-dim">Stuck? Write out the differences, then the ratios; look at alternate terms; check squares, cubes and primes nearby.</p>
    </div>
  );
}

// ------------------------------------------------------------------ stats

function Stats(): JSX.Element {
  useStorageVersion();
  const sessions = getSessions('sequences');
  const aggs = getSkillAggs();
  if (!getAttempts('sequences').length) return <EmptyState title="No sequences yet">Run a sprint or a few practice sequences and your scores and weakest rule types appear here.</EmptyState>;
  const rows = FAMILY_IDS.map((f) => ({ f, a: aggs[`sequences:${f}`] }))
    .filter((x) => x.a)
    .sort((x, y) => x.a!.ewmaAcc - y.a!.ewmaAcc);
  return (
    <div className="space-y-6">
      {sessions.length > 0 && (
        <Panel title="Sprint scores">
          <LineChart series={[{ name: 'Score', values: sessions.map((s) => s.score) }]} height={170} xLabel="sprint" yFormat={(v) => v.toFixed(0)} />
        </Panel>
      )}
      <Panel title="By rule type">
        <table className="w-full text-sm num">
          <thead className="text-paper-muted">
            <tr>
              <th className="text-left font-normal">Rule type</th>
              <th className="text-right font-normal">Seen</th>
              <th className="text-right font-normal">Accuracy (recent)</th>
              <th className="text-right font-normal">Speed (recent)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ f, a }) => (
              <tr key={f} className="border-t border-ink-line/60">
                <td className="py-1">{FAMILY_LABEL[f]}</td>
                <td className="text-right">{a!.n}</td>
                <td className={cx('text-right', a!.ewmaAcc < 0.7 && 'text-ask')}>{Math.round(a!.ewmaAcc * 100)}%</td>
                <td className="text-right">{a!.timed ? fmtMs(a!.ewmaMs) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
