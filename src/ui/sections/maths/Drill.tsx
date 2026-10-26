import { useEffect, useMemo, useRef, useState } from 'react';
import { Rng } from '@/shared/random/prng';
import { parseAnswer } from '@/shared/math/rational';
import { gradeFromResult, recordReview } from '@/shared/srs/srs';
import { recordAttempt, recordSession } from '@/shared/stats/activity';
import { isCorrect, SKILL_LABEL, targetMs, type Question, type SkillId } from '@/training/maths/generators';
import { levelOf, nextSkill, questionFor, updateLevel, type ModeDef, type ZetamacConfig } from '@/training/maths/modes';
import { Button, cx, fmtClock, fmtMs, ProgressBar, Stat } from '../../components/core';
import { useNow } from '../../hooks';

export interface AnswerLog {
  q: Question;
  given: string;
  correct: boolean;
  skipped: boolean;
  ms: number;
}

export interface DrillResult {
  mode: ModeDef;
  score: number;
  log: AnswerLog[];
  durationMs: number;
}

function parseFor(q: Question, s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  if (q.percent) {
    const n = parseAnswer(t.replace('%', ''));
    return n;
  }
  return parseAnswer(t);
}

const coarse = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

export function Drill({ mode, zetamac, durationSec, onDone, onQuit }: { mode: ModeDef; zetamac?: ZetamacConfig; durationSec: number; onDone: (r: DrillResult) => void; onQuit: () => void }): JSX.Element {
  const rng = useMemo(() => new Rng(), []);
  const seen = useRef(new Set<string>());
  const recent = useRef<SkillId[]>([]);
  const start = useRef(Date.now());
  const qStart = useRef(Date.now());
  const [log, setLog] = useState<AnswerLog[]>([]);
  const [score, setScore] = useState(0);
  const [input, setInput] = useState('');
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null);
  const [q, setQ] = useState<Question>(() => first());
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const now = useNow(200);
  const remaining = durationSec * 1000 - (now - start.current);

  function first(): Question {
    const s = nextSkill(mode, [], rng);
    return questionFor(mode, s, rng, seen.current, zetamac);
  }

  const finish = (finalLog: AnswerLog[], finalScore: number): void => {
    if (done.current) return;
    done.current = true;
    const durationMs = Math.min(Date.now() - start.current, durationSec * 1000);
    recordSession({ section: 'maths', mode: mode.id, durationMs, score: finalScore, total: finalLog.length, summary: { correct: finalLog.filter((l) => l.correct).length } });
    onDone({ mode, score: finalScore, log: finalLog, durationMs });
  };

  useEffect(() => {
    if (remaining <= 0) finish(log, score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining <= 0]);

  useEffect(() => inputRef.current?.focus(), [q]);

  const submit = (given: string, skipped = false): void => {
    if (done.current) return;
    const ms = Date.now() - qStart.current;
    const ok = !skipped && isCorrect(q, parseFor(q, given));
    const entry: AnswerLog = { q, given, correct: ok, skipped, ms };
    const nextLog = [...log, entry];
    const delta = ok ? 1 : skipped ? 0 : mode.negativeMarking ? -1 : 0;
    const nextScore = score + delta;
    setLog(nextLog);
    setScore(nextScore);
    if (!skipped) {
      recordAttempt({ section: 'maths', skill: q.skill, correct: ok, ms });
      recordReview('maths', q.skill, gradeFromResult(ok, ms, targetMs(q.skill, levelOf(q.skill))));
      updateLevel(q.skill, ok, ms);
    }
    setFlash(ok ? 'ok' : skipped ? null : 'bad');
    setTimeout(() => setFlash(null), 180);
    if (mode.count && nextLog.length >= mode.count) return finish(nextLog, nextScore);
    recent.current.push(q.skill);
    const s = nextSkill(mode, recent.current, rng);
    setQ(questionFor(mode, s, rng, seen.current, zetamac));
    setInput('');
    qStart.current = Date.now();
  };

  const onChange = (v: string): void => {
    setInput(v);
    if (q.autoSubmit && isCorrect(q, parseFor(q, v))) submit(v);
  };

  const keypad = coarse();
  const correct = log.filter((l) => l.correct).length;
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-2 text-sm text-paper-muted">
        <span>{mode.title}</span>
        <span className="num">
          {mode.count ? `${log.length} / ${mode.count} · ` : ''}score {score}
        </span>
        <span className={cx('num font-semibold', remaining < 10_000 && 'text-ask')}>{fmtClock(remaining)}</span>
      </div>
      <ProgressBar value={1 - remaining / (durationSec * 1000)} />
      <div className={cx('mt-8 rounded-lg border p-6 sm:p-10 text-center transition-colors', flash === 'ok' ? 'border-bid' : flash === 'bad' ? 'border-ask' : 'border-ink-line')}>
        <div className="text-paper-dim text-sm mb-3">
          {SKILL_LABEL[q.skill]}
          {mode.id === 'adaptive' && ` · level ${levelOf(q.skill)}`}
        </div>
        <div className="text-3xl sm:text-4xl font-semibold num tracking-[-0.01em] break-words">{q.prompt}</div>
        <form
          className="mt-6 flex justify-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) submit(input);
          }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                submit('', true);
              }
            }}
            inputMode={keypad ? 'none' : 'decimal'}
            autoComplete="off"
            className="input text-2xl text-center w-56 num"
            aria-label="Answer"
          />
        </form>
        <p className="text-xs text-paper-dim mt-3">{q.autoSubmit ? 'Correct answers submit themselves.' : 'Press Enter to submit.'} Esc skips. Fractions like 3/8 and percentages like 37.5% are accepted.</p>
      </div>
      {keypad && <Keypad onKey={(k) => (k === '⌫' ? onChange(input.slice(0, -1)) : k === '↵' ? input.trim() && submit(input) : onChange(input + k))} />}
      <div className="mt-6 flex items-center justify-between text-sm">
        <span className="text-paper-muted num">
          {correct} correct · {log.length - correct} missed
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => submit('', true)}>
            Skip
          </Button>
          <Button size="sm" variant="ghost" onClick={() => finish(log, score)}>
            Finish now
          </Button>
          <Button size="sm" variant="ghost" onClick={onQuit}>
            Quit
          </Button>
        </div>
      </div>
    </div>
  );
}

function Keypad({ onKey }: { onKey: (k: string) => void }): JSX.Element {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '-', '0', '.', '/', '%', '⌫', '↵'];
  return (
    <div className="grid grid-cols-4 gap-2 mt-4 max-w-xs mx-auto">
      {keys.map((k) => (
        <button key={k} type="button" onClick={() => onKey(k)} className={cx('h-12 rounded border border-ink-line text-lg num active:bg-ink-raised', k === '↵' && 'bg-signal text-ink border-signal')}>
          {k}
        </button>
      ))}
    </div>
  );
}

export function Results({ r, onAgain, onBack }: { r: DrillResult; onAgain: () => void; onBack: () => void }): JSX.Element {
  const answered = r.log.filter((l) => !l.skipped);
  const correct = r.log.filter((l) => l.correct);
  const bySkill = new Map<SkillId, { n: number; ok: number; ms: number }>();
  for (const l of answered) {
    const s = bySkill.get(l.q.skill) ?? { n: 0, ok: 0, ms: 0 };
    s.n++;
    s.ok += l.correct ? 1 : 0;
    s.ms += l.ms;
    bySkill.set(l.q.skill, s);
  }
  const misses = r.log.filter((l) => !l.correct);
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Score" value={r.score} size="lg" />
        <Stat label="Accuracy" value={answered.length ? `${Math.round((100 * correct.length) / answered.length)}%` : '–'} />
        <Stat label="Average time" value={answered.length ? fmtMs(answered.reduce((a, l) => a + l.ms, 0) / answered.length) : '–'} />
        <Stat label="Answered" value={`${answered.length}`} sub={`${r.log.length - answered.length} skipped`} />
      </div>
      <table className="w-full text-sm num">
        <thead className="text-paper-muted">
          <tr>
            <th className="text-left font-normal">Type</th>
            <th className="text-right font-normal">Correct</th>
            <th className="text-right font-normal">Avg time</th>
          </tr>
        </thead>
        <tbody>
          {[...bySkill.entries()].map(([s, v]) => (
            <tr key={s} className="border-t border-ink-line/60">
              <td className="py-1">{SKILL_LABEL[s]}</td>
              <td className="text-right">
                {v.ok}/{v.n}
              </td>
              <td className="text-right">{fmtMs(v.ms / v.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {misses.length > 0 && (
        <div>
          <h3 className="text-md mb-2">Review your misses</h3>
          <ul className="space-y-1 text-sm">
            {misses.slice(0, 20).map((l, i) => (
              <li key={i} className="border-l-2 border-ask/60 pl-2">
                <span className="num">{l.q.prompt}</span> = <span className="font-semibold">{l.q.answerText}</span>
                {l.given && <span className="text-paper-dim"> (you: {l.given})</span>}
                {l.q.how && <span className="text-paper-muted"> · {l.q.how}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" onClick={onAgain}>
          Go again
        </Button>
        <Button onClick={onBack}>Choose another mode</Button>
      </div>
    </div>
  );
}
