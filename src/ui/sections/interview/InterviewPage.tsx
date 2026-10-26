import { useEffect, useMemo, useRef, useState } from 'react';
import { Rng } from '@/shared/random/prng';
import { parseAnswer } from '@/shared/math/rational';
import { load, update } from '@/shared/storage/store';
import { recordAttempt, recordSession } from '@/shared/stats/activity';
import { generate, isCorrect, type Question } from '@/training/maths/generators';
import { answerText, checkAnswer } from '@/training/puzzles/answer';
import { recordResult } from '@/training/puzzles/scheduler';
import type { Puzzle } from '@/training/puzzles/types';
import { drawSequence, recordSequence } from '@/training/sequences/progress';
import { nextQuestion, type FermiQuestion } from '@/training/fermi/bank';
import { describeError, fmtQuantity, parseQuantity, score as fermiScore } from '@/training/fermi/scoring';
import { fair } from '@/training/market-making/contracts';
import { newGame, quote, review, validateQuote, type GameState } from '@/training/market-making/game';
import { fmtOdds, makeOffer, type Offer } from '@/training/betting/game';
import { kellyFraction } from '@/training/betting/kelly';
import { PRESETS, scoreFermi, scoreKelly, scoreMarket, scoreMaths, scorePuzzle, SEGMENT_LABEL, segmentMinutes, segmentTitle, verdict, type Preset, type Segment } from '@/training/interview/presets';
import { Badge, Button, cx, EmptyState, fmtClock, Panel, ProgressBar, Stat, Tabs } from '../../components/core';
import { LineChart } from '../../components/charts';
import { useHotkeys, useNow, useStorageVersion } from '../../hooks';
import { navigate, useRoute } from '../../router';
import { nextPuzzle } from '../puzzles/next';

interface SegResult {
  kind: Segment['kind'];
  title: string;
  score: number;
  /** One-line summary for the scorecard. */
  summary: string;
  /** Review lines: what went wrong and the right answers. */
  review: string[];
  ms: number;
}

interface RunRecord {
  t: number;
  preset: string;
  overall: number;
  segments: Omit<SegResult, 'review'>[];
  durationMs: number;
}

const HISTORY = 'interview.history';
const TABS = [
  { value: 'run', label: 'Mock interview' },
  { value: 'history', label: 'History' },
] as const;

export default function InterviewPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? 'run';
  return (
    <div>
      <h1 className="text-2xl mb-2">Interview simulator</h1>
      <Tabs value={tab} onChange={(v) => navigate(v === 'run' ? '/interview' : `/interview/${v}`)} tabs={TABS} />
      {tab === 'run' ? <Runner /> : <History />}
    </div>
  );
}

// ------------------------------------------------------------------ runner

function Runner(): JSX.Element {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [results, setResults] = useState<SegResult[]>([]);
  const [between, setBetween] = useState(false);
  const started = useRef(0);
  const [finished, setFinished] = useState<RunRecord | null>(null);

  const start = (p: Preset): void => {
    setPreset(p);
    setResults([]);
    setBetween(false);
    setFinished(null);
    started.current = Date.now();
  };
  const onSegment = (r: SegResult): void => {
    const all = [...results, r];
    setResults(all);
    recordAttempt({ section: 'interview', skill: `interview:${r.kind}`, correct: r.score >= 65, ms: r.ms, score: r.score });
    if (all.length >= preset!.segments.length) {
      const overall = Math.round(all.reduce((s, x) => s + x.score, 0) / all.length);
      const rec: RunRecord = { t: Date.now(), preset: preset!.id, overall, segments: all.map(({ review: _r, ...rest }) => rest), durationMs: Date.now() - started.current };
      update<RunRecord[]>(HISTORY, [], (xs) => [...xs, rec].slice(-300));
      recordSession({ section: 'interview', mode: preset!.id, durationMs: rec.durationMs, score: overall, total: all.length });
      setFinished(rec);
    } else setBetween(true);
  };

  if (!preset) return <Setup onStart={start} />;
  if (finished) return <Scorecard preset={preset} rec={finished} results={results} onAgain={() => start(preset)} onBack={() => setPreset(null)} />;
  const i = results.length;
  const seg = preset.segments[i];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-paper-muted">
        <span className="text-paper">{preset.name}</span>
        <span>
          Part {i + 1} of {preset.segments.length}: {SEGMENT_LABEL[seg.kind]}
        </span>
        <div className="flex-1 min-w-[120px]">
          <ProgressBar value={i / preset.segments.length} />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPreset(null)}>
          End interview
        </Button>
      </div>
      {between ? <Interstitial last={results[i - 1]} next={seg} onGo={() => setBetween(false)} /> : <SegmentView key={i} seg={seg} onDone={onSegment} />}
    </div>
  );
}

function Setup({ onStart }: { onStart: (p: Preset) => void }): JSX.Element {
  useStorageVersion();
  const hist = load<RunRecord[]>(HISTORY, []);
  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-paper-muted">Timed rounds that mix the sections the way interviews do. No hints for free, no pausing: when a part's clock runs out it moves on. You get a scorecard at the end, and every question is new.</p>
      {PRESETS.map((p) => {
        const last = hist.filter((h) => h.preset === p.id).at(-1);
        return (
          <div key={p.id} className="panel p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1 min-w-[240px]">
                <div className="font-medium">{p.name}</div>
                <p className="text-sm text-paper-muted mt-1">{p.blurb}</p>
                <ol className="mt-3 text-sm text-paper-dim space-y-0.5 list-decimal pl-5">
                  {p.segments.map((s, i) => (
                    <li key={i}>
                      {segmentTitle(s)} <span className="num">({s.kind === 'market' ? 'about 5 min' : `${segmentMinutes(s)} min`})</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button variant="primary" onClick={() => onStart(p)}>
                  Start
                </Button>
                <span className="text-xs text-paper-dim num">{last ? `Last score ${last.overall}` : 'Not attempted'}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Interstitial({ last, next, onGo }: { last: SegResult; next: Segment; onGo: () => void }): JSX.Element {
  useHotkeys({ Enter: onGo });
  return (
    <div className="panel p-6 max-w-xl">
      <p className="text-paper-muted">
        {last.title}: <span className="text-paper num">{last.score}</span> / 100. {last.summary}
      </p>
      <p className="mt-4 text-lg">Next: {segmentTitle(next)}</p>
      <p className="text-sm text-paper-muted">{next.kind === 'market' ? 'Rounds, not a clock.' : `${fmtClock(next.sec * 1000)} on the clock.`}</p>
      <Button className="mt-4" variant="primary" onClick={onGo} kbd="↵">
        Start this part
      </Button>
    </div>
  );
}

/** Countdown that fires once when time is up. */
function useDeadline(sec: number, onExpire: () => void): number {
  const start = useRef(Date.now());
  const fired = useRef(false);
  const now = useNow(250);
  const left = sec * 1000 - (now - start.current);
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  });
  return Math.max(0, left);
}

function Clock({ left, total }: { left: number; total: number }): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <ProgressBar value={1 - left / total} tone={left < 15_000 ? 'neg' : 'signal'} />
      </div>
      <span className={cx('num font-semibold w-12 text-right', left < 15_000 && 'text-ask')}>{fmtClock(left)}</span>
    </div>
  );
}

function SegmentView({ seg, onDone }: { seg: Segment; onDone: (r: SegResult) => void }): JSX.Element {
  switch (seg.kind) {
    case 'maths':
      return <MathsSeg seg={seg} onDone={onDone} />;
    case 'puzzle':
      return <PuzzleSeg seg={seg} onDone={onDone} />;
    case 'sequences':
      return <SeqSeg seg={seg} onDone={onDone} />;
    case 'fermi':
      return <FermiSeg seg={seg} onDone={onDone} />;
    case 'market':
      return <MarketSeg seg={seg} onDone={onDone} />;
    case 'kelly':
      return <KellySeg seg={seg} onDone={onDone} />;
  }
}

// ------------------------------------------------------------------ segments

function MathsSeg({ seg, onDone }: { seg: Extract<Segment, { kind: 'maths' }>; onDone: (r: SegResult) => void }): JSX.Element {
  const rng = useMemo(() => new Rng(), []);
  const t0 = useRef(Date.now());
  const make = (): Question => generate(rng.pick(seg.skills), seg.level, rng);
  const [q, setQ] = useState<Question>(make);
  const [input, setInput] = useState('');
  const log = useRef<{ q: Question; given: string; ok: boolean }[]>([]);
  const done = useRef(false);
  const finish = (): void => {
    if (done.current) return;
    done.current = true;
    const ok = log.current.filter((l) => l.ok).length, wrong = log.current.length - ok;
    onDone({ kind: 'maths', title: 'Mental maths', score: scoreMaths(ok, wrong, seg.n), summary: `${ok} right, ${wrong} wrong, ${seg.n - log.current.length} unanswered.`, review: log.current.filter((l) => !l.ok).map((l) => `${l.q.prompt} = ${l.q.answerText} (you said ${l.given})`), ms: Date.now() - t0.current });
  };
  const left = useDeadline(seg.sec, finish);
  const submit = (): void => {
    if (!input.trim() || done.current) return;
    const v = parseAnswer(input.replace('%', ''));
    const ok = isCorrect(q, v);
    log.current.push({ q, given: input, ok });
    recordAttempt({ section: 'maths', skill: q.skill, correct: ok });
    if (log.current.length >= seg.n) return finish();
    setQ(make());
    setInput('');
  };
  return (
    <div className="max-w-xl space-y-6">
      <Clock left={left} total={seg.sec * 1000} />
      <div className="panel p-8 text-center">
        <div className="text-sm text-paper-dim mb-2 num">
          {log.current.length + 1} / {seg.n}
        </div>
        <div className="text-3xl font-semibold num">{q.prompt}</div>
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input autoFocus className="input text-2xl text-center w-56 num" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Answer" autoComplete="off" inputMode="decimal" />
        </form>
        <p className="text-xs text-paper-dim mt-3">Enter submits. Wrong answers cost half a point; there is no going back.</p>
      </div>
    </div>
  );
}

function PuzzleSeg({ seg, onDone }: { seg: Extract<Segment, { kind: 'puzzle' }>; onDone: (r: SegResult) => void }): JSX.Element {
  const [p, setP] = useState<Puzzle | null>(null);
  const [input, setInput] = useState('');
  const [choice, setChoice] = useState<number | null>(null);
  const [hints, setHints] = useState(0);
  const [misses, setMisses] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  const done = useRef(false);
  useEffect(() => {
    void nextPuzzle({ category: seg.category, tier: seg.tier, focus: 'mixed' }).then((r) => {
      setP(r.puzzle);
      t0.current = Date.now();
    });
  }, [seg.category, seg.tier]);
  const finish = (solved: boolean): void => {
    if (done.current || !p) return;
    done.current = true;
    const ms = Date.now() - t0.current;
    recordResult(p, { correct: solved, misses, hintsUsed: hints, revealed: !solved, ms, interviewer: true });
    onDone({ kind: 'puzzle', title: p.title, score: scorePuzzle(solved, hints, misses), summary: solved ? `Solved in ${fmtClock(ms)} with ${hints} hint${hints === 1 ? '' : 's'} and ${misses} wrong tr${misses === 1 ? 'y' : 'ies'}.` : 'Not solved in time.', review: [`${p.title}: answer ${answerText(p.answer)}.`, ...p.steps], ms });
  };
  const left = useDeadline(seg.sec, () => finish(false));
  if (!p) return <div className="panel p-6 text-paper-muted">Generating a fresh puzzle…</div>;
  const submit = (): void => {
    const raw = p.answer.kind === 'choice' ? choice : input;
    if (raw === null || String(raw).trim() === '') return;
    const r = checkAnswer(p.answer, raw);
    if (r.correct) finish(true);
    else {
      setMisses(misses + 1);
      setMsg(r.note ?? 'Not right. Try again, or take a hint.');
    }
  };
  return (
    <div className="max-w-3xl space-y-4">
      <Clock left={left} total={seg.sec * 1000} />
      <div className="panel p-5 sm:p-6">
        <Badge>{seg.tier === 'hard' ? 'Hard' : 'Interview'}</Badge>
        <div className="prose-math mt-2">
          {p.prompt.split('\n\n').map((para, i) =>
            para.startsWith('    ') ? (
              <pre key={i} className="font-mono text-[14px] bg-ink-raised/60 border border-ink-line rounded px-4 py-3 overflow-x-auto">
                {para.split('\n').map((l) => l.slice(4)).join('\n')}
              </pre>
            ) : (
              <p key={i}>{para}</p>
            ),
          )}
        </div>
        <p className="text-sm text-paper-muted">{p.ask}</p>
        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {p.answer.kind === 'choice' ? (
            p.answer.options.map((o, i) => (
              <button key={o} type="button" onClick={() => setChoice(i)} className={cx('h-10 px-4 rounded border', choice === i ? 'border-signal bg-signal/15' : 'border-ink-line text-paper-muted')}>
                {o}
              </button>
            ))
          ) : (
            <input autoFocus className="input w-56 num" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Answer" autoComplete="off" />
          )}
          <Button variant="primary" type="submit">
            Submit
          </Button>
          <Button onClick={() => setHints(Math.min(3, hints + 1))} disabled={hints >= 3}>
            Ask for a hint (−20)
          </Button>
          <Button variant="ghost" onClick={() => finish(false)}>
            Give up
          </Button>
        </form>
        {msg && <p className="text-sm text-ask mt-2">{msg}</p>}
        {hints > 0 && (
          <ol className="mt-4 space-y-1 text-paper-muted text-sm list-decimal pl-5">
            {p.hints.slice(0, hints).map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function SeqSeg({ seg, onDone }: { seg: Extract<Segment, { kind: 'sequences' }>; onDone: (r: SegResult) => void }): JSX.Element {
  const rng = useMemo(() => new Rng(), []);
  const [s, setS] = useState(() => drawSequence(rng, seg.tier));
  const [input, setInput] = useState('');
  const log = useRef<{ shown: number[]; answer: number; rule: string; given: string; ok: boolean }[]>([]);
  const t0 = useRef(Date.now()), q0 = useRef(Date.now());
  const done = useRef(false);
  const finish = (): void => {
    if (done.current) return;
    done.current = true;
    const ok = log.current.filter((l) => l.ok).length;
    onDone({ kind: 'sequences', title: 'Sequences', score: Math.round((100 * ok) / seg.n), summary: `${ok} of ${seg.n} correct.`, review: log.current.filter((l) => !l.ok).map((l) => `${l.shown.join(', ')}, ${l.answer}: ${l.rule}${l.given ? ` (you said ${l.given})` : ''}`), ms: Date.now() - t0.current });
  };
  const left = useDeadline(seg.sec, finish);
  const submit = (given: string): void => {
    if (done.current) return;
    const ok = Number(given.trim().replace(/[−–]/g, '-')) === s.answer && given.trim() !== '';
    recordSequence(s, ok, Date.now() - q0.current, false);
    log.current.push({ shown: s.shown, answer: s.answer, rule: s.rule, given, ok });
    if (log.current.length >= seg.n) return finish();
    setS(drawSequence(rng, seg.tier, s.family));
    setInput('');
    q0.current = Date.now();
  };
  return (
    <div className="max-w-2xl space-y-6">
      <Clock left={left} total={seg.sec * 1000} />
      <div className="panel p-8 text-center">
        <div className="text-sm text-paper-dim mb-2 num">
          {log.current.length + 1} / {seg.n}
        </div>
        <div className="text-2xl sm:text-3xl font-semibold num">{s.shown.join(', ')}, ?</div>
        <form
          className="mt-6 flex justify-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) submit(input);
          }}
        >
          <input autoFocus className="input text-xl text-center w-48 num" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Next term" autoComplete="off" />
          <Button variant="ghost" onClick={() => submit('')}>
            Skip
          </Button>
        </form>
      </div>
    </div>
  );
}

function FermiSeg({ seg, onDone }: { seg: Extract<Segment, { kind: 'fermi' }>; onDone: (r: SegResult) => void }): JSX.Element {
  const q = useMemo<FermiQuestion>(() => {
    const seen = new Set(load<string[]>('fermi.seen', []));
    const x = nextQuestion(new Rng(), seen, true);
    update<string[]>('fermi.seen', [], (xs) => [...xs, x.id].slice(-5000));
    return x;
  }, []);
  const [v, setV] = useState({ lo: '', est: '', hi: '' });
  const [err, setErr] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  const done = useRef(false);
  const finish = (est: number | null, lo: number | null, hi: number | null): void => {
    if (done.current) return;
    done.current = true;
    const ms = Date.now() - t0.current;
    if (est === null || lo === null || hi === null) return onDone({ kind: 'fermi', title: 'Estimation', score: 0, summary: 'No complete answer before time ran out.', review: [`${q.prompt} Reference: ${fmtQuantity(q.truth)} ${q.unit}. ${q.source}`], ms });
    const s = fermiScore(est, lo, hi, q.truth);
    recordAttempt({ section: 'fermi', skill: `fermi:${q.topic}`, correct: s.within2, ms, score: s.intervalScore });
    update('fermi.history', [] as unknown[], (xs) => [...xs, { id: q.id, prompt: q.prompt, topic: q.topic, unit: q.unit, truth: q.truth, est, lo, hi, t: Date.now(), ms, logErr: s.logErr, hit: s.hit, widthOom: s.widthOom, intervalScore: s.intervalScore, usedBreakdown: false }].slice(-2000));
    onDone({ kind: 'fermi', title: 'Estimation', score: scoreFermi(s.points, s.hit), summary: `${describeError(s.logErr)}; interval ${s.hit ? 'contained' : 'missed'} the reference.`, review: [`${q.prompt} You: ${fmtQuantity(est)} (${fmtQuantity(lo)} to ${fmtQuantity(hi)}). Reference: ${fmtQuantity(q.truth)} ${q.unit}.`, q.source, `One breakdown: ${q.breakdown.map((f, i) => `${i ? `${f.op} ` : ''}${f.label} ${fmtQuantity(f.value)}`).join(' ')}.`], ms });
  };
  const left = useDeadline(seg.sec, () => finish(parseQuantity(v.est), parseQuantity(v.lo), parseQuantity(v.hi)));
  const submit = (): void => {
    const est = parseQuantity(v.est), lo = parseQuantity(v.lo), hi = parseQuantity(v.hi);
    if (est === null || lo === null || hi === null) return setErr('Enter all three numbers (e.g. 3.5 million, 2e6, 40k).');
    if (!(lo <= est && est <= hi)) return setErr('Keep low ≤ estimate ≤ high.');
    finish(est, lo, hi);
  };
  return (
    <div className="max-w-2xl space-y-4">
      <Clock left={left} total={seg.sec * 1000} />
      <div className="panel p-5 sm:p-6">
        <p className="prose-math text-[19px]">{q.prompt}</p>
        <p className="text-sm text-paper-muted">Answer in {q.unit}. Talk yourself through the factors on paper, then give a best estimate and a 90% interval.</p>
        <form
          className="grid sm:grid-cols-3 gap-3 mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {(['lo', 'est', 'hi'] as const).map((k) => (
            <div key={k}>
              <label className="label" htmlFor={`ifermi-${k}`}>
                {k === 'lo' ? '90% low' : k === 'est' ? 'Best estimate' : '90% high'}
              </label>
              <input id={`ifermi-${k}`} className="input w-full num" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} autoComplete="off" />
              <div className="text-xs text-paper-dim h-4 mt-1">{parseQuantity(v[k]) !== null ? fmtQuantity(parseQuantity(v[k])!) : ''}</div>
            </div>
          ))}
          <div className="sm:col-span-3 flex items-center gap-3">
            <Button variant="primary" type="submit">
              Submit estimate
            </Button>
            {err && <span className="text-sm text-ask">{err}</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

function MarketSeg({ seg, onDone }: { seg: Extract<Segment, { kind: 'market' }>; onDone: (r: SegResult) => void }): JSX.Element {
  const [g, setG] = useState<GameState>(() => {
    const b = new Uint32Array(2);
    crypto.getRandomValues(b);
    return newGame(`${b[0]}${b[1]}`, seg.difficulty, 'dice-sum');
  });
  const [bid, setBid] = useState('');
  const [ask, setAsk] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const t0 = useRef(Date.now());
  const post = (): void => {
    const b = Number(bid), a = Number(ask);
    const e = bid && ask ? validateQuote(g, b, a) : 'Enter a bid and an ask.';
    if (e) return setErr(e);
    setErr(null);
    const next = quote(g, b, a);
    const l = next.log.at(-1)!;
    recordAttempt({ section: 'market', skill: 'market:quote', correct: b <= l.fair && a >= l.fair, score: l.sd ? Math.abs((a + b) / 2 - l.fair) / l.sd : 0 });
    if (next.done) {
      const rv = review(next);
      const trades = next.log.reduce((s, x) => s + x.trades.length, 0);
      onDone({ kind: 'market', title: 'Market making', score: scoreMarket(rv.edge, trades, next.maxWidth), summary: `Edge ${rv.edge.toFixed(1)} over ${trades} trades; P&L ${rv.pnl.toFixed(1)} at settlement (${rv.settlement}).`, review: [`${next.contract.title}: ${next.contract.parts.join(', ')} → ${rv.settlement}.`, ...next.log.map((x) => `Round ${x.round + 1}: you quoted ${x.bid} / ${x.ask}; fair was ${fair(next.contract, x.round).mean}.`), ...rv.notes], ms: Date.now() - t0.current });
    } else setG(next);
  };
  return (
    <div className="max-w-2xl space-y-4">
      <div className="panel p-5 sm:p-6">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg">{g.contract.title}</h2>
          <span className="text-sm text-paper-muted">
            Round {g.round + 1} of {g.contract.parts.length} · max width {g.maxWidth} · position {g.position > 0 ? '+' : ''}
            {g.position}
          </span>
        </div>
        <p className="text-sm text-paper-muted mt-1">{g.contract.description}</p>
        <div className="flex gap-2 mt-4">
          {g.contract.parts.map((v, i) => (
            <div key={i} className={cx('w-11 h-12 rounded border flex items-center justify-center num', i < g.revealed ? 'border-ink-strong bg-ink-raised' : 'border-dashed border-ink-line text-paper-dim')}>
              {i < g.revealed ? v : '?'}
            </div>
          ))}
        </div>
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            post();
          }}
        >
          <div>
            <label className="label" htmlFor="imm-bid">
              Bid
            </label>
            <input id="imm-bid" autoFocus className="input w-24 num text-right" value={bid} onChange={(e) => setBid(e.target.value)} autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="imm-ask">
              Ask
            </label>
            <input id="imm-ask" className="input w-24 num text-right" value={ask} onChange={(e) => setAsk(e.target.value)} autoComplete="off" />
          </div>
          <Button variant="primary" type="submit">
            Post quote
          </Button>
        </form>
        {err && <p className="text-sm text-ask mt-2">{err}</p>}
        {g.log.at(-1) && <p className="text-sm text-paper-muted mt-3">Last round: {g.log.at(-1)!.trades.map((t) => (t.side === 1 ? `you sold at ${t.price}` : `you bought at ${t.price}`)).join(', ') || 'no trades'}.</p>}
      </div>
    </div>
  );
}

function KellySeg({ seg, onDone }: { seg: Extract<Segment, { kind: 'kelly' }>; onDone: (r: SegResult) => void }): JSX.Element {
  const rng = useMemo(() => new Rng(), []);
  const [o, setO] = useState<Offer>(() => makeOffer(rng));
  const [stake, setStake] = useState('');
  const log = useRef<{ o: Offer; f: number; s: number }[]>([]);
  const t0 = useRef(Date.now());
  const done = useRef(false);
  const finish = (): void => {
    if (done.current) return;
    done.current = true;
    const total = log.current.reduce((s, x) => s + x.s, 0) / seg.n;
    onDone({ kind: 'kelly', title: 'Bet sizing', score: Math.round(total), summary: `${log.current.length} of ${seg.n} answered.`, review: log.current.map((x) => `${x.o.text} Kelly ${(100 * kellyFraction(x.o.p, x.o.b)).toFixed(1)}%, you ${(100 * x.f).toFixed(1)}%.`), ms: Date.now() - t0.current });
  };
  const left = useDeadline(seg.sec, finish);
  const submit = (): void => {
    const f = Number(stake) / 100;
    if (stake.trim() === '' || !Number.isFinite(f) || f < 0 || f > 1) return;
    const s = scoreKelly(o.p, o.b, f);
    recordAttempt({ section: 'betting', skill: 'betting:kelly', correct: s >= 75 });
    log.current.push({ o, f, s });
    if (log.current.length >= seg.n) return finish();
    setO(makeOffer(rng));
    setStake('');
  };
  return (
    <div className="max-w-2xl space-y-4">
      <Clock left={left} total={seg.sec * 1000} />
      <div className="panel p-5 sm:p-6">
        <div className="text-sm text-paper-dim num">
          {log.current.length + 1} / {seg.n}
        </div>
        <p className="prose-math text-[19px]">{o.text}</p>
        <p className="text-sm text-paper-muted">You can repeat this bet many times. What percentage of your bankroll do you stake each time to grow it fastest? (Odds: {fmtOdds(o.b)}.)</p>
        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input autoFocus className="input w-24 num text-right" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="Stake percentage" autoComplete="off" />
          <span className="text-paper-muted">%</span>
          <Button variant="primary" type="submit">
            Submit
          </Button>
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ scorecard and history

function Scorecard({ preset, rec, results, onAgain, onBack }: { preset: Preset; rec: RunRecord; results: SegResult[]; onAgain: () => void; onBack: () => void }): JSX.Element {
  const prev = load<RunRecord[]>(HISTORY, []).filter((h) => h.preset === preset.id && h.t < rec.t).at(-1);
  const weakest = [...results].sort((a, b) => a.score - b.score)[0];
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline gap-4">
          <div>
            <div className="text-sm text-paper-muted">{preset.name}</div>
            <div className="text-3xl font-semibold num">{rec.overall} / 100</div>
          </div>
          <p className="flex-1 min-w-[200px]">{verdict(rec.overall)}</p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={onAgain}>
              Another round
            </Button>
            <Button onClick={onBack}>Choose a format</Button>
          </div>
        </div>
        <p className="text-sm text-paper-muted mt-2 num">
          Took {fmtClock(rec.durationMs)}
          {prev ? ` · last time ${prev.overall}` : ''} · weakest part: {weakest.title.toLowerCase()} ({weakest.score})
        </p>
      </div>
      <div className="space-y-3">
        {results.map((r, i) => (
          <div key={i} className="panel p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{r.title}</span>
              <span className="text-sm text-paper-muted">{r.summary}</span>
              <span className={cx('ml-auto num font-semibold', r.score >= 65 ? 'text-bid' : r.score < 50 ? 'text-ask' : '')}>{r.score}</span>
            </div>
            <ProgressBar className="mt-2" value={r.score / 100} tone={r.score >= 65 ? 'pos' : r.score < 50 ? 'neg' : 'signal'} />
            {r.review.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-paper-muted hover:text-paper">Review</summary>
                <ul className="mt-2 space-y-1 text-paper-muted">
                  {r.review.map((l, j) => (
                    <li key={j}>{l}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function History(): JSX.Element {
  useStorageVersion();
  const hist = load<RunRecord[]>(HISTORY, []);
  if (!hist.length) return <EmptyState title="No interviews yet">Finish a mock interview and your scorecards appear here.</EmptyState>;
  const kinds = [...new Set(hist.flatMap((h) => h.segments.map((s) => s.kind)))];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Interviews" value={hist.length} />
        <Stat label="Best" value={Math.max(...hist.map((h) => h.overall))} />
        <Stat label="Last" value={hist.at(-1)!.overall} />
        <Stat label="Average of last 5" value={Math.round(hist.slice(-5).reduce((s, h) => s + h.overall, 0) / Math.min(5, hist.length))} />
      </div>
      {hist.length >= 2 && (
        <Panel title="Overall score">
          <LineChart series={[{ name: 'Overall', values: hist.map((h) => h.overall) }]} xLabel="interview" yMin={0} yMax={100} height={180} yFormat={(v) => v.toFixed(0)} />
        </Panel>
      )}
      <Panel title="Average by part">
        <table className="w-full text-sm num">
          <tbody>
            {kinds.map((k) => {
              const xs = hist.flatMap((h) => h.segments.filter((s) => s.kind === k));
              const avg = Math.round(xs.reduce((s, x) => s + x.score, 0) / xs.length);
              return (
                <tr key={k} className="border-t border-ink-line/60 first:border-0">
                  <td className="py-1.5">{SEGMENT_LABEL[k]}</td>
                  <td className="text-right text-paper-muted">{xs.length} done</td>
                  <td className={cx('text-right w-16', avg < 50 && 'text-ask')}>{avg}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
