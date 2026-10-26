import { useEffect, useState } from 'react';
import { Rng } from '@/shared/random/prng';
import { load, update } from '@/shared/storage/store';
import { recordAttempt } from '@/shared/stats/activity';
import { breakdownValue, nextQuestion, TOPIC_LABEL, type FermiQuestion, type Topic } from '@/training/fermi/bank';
import { calibration, describeError, fmtQuantity, parseQuantity, score, type FermiScore } from '@/training/fermi/scoring';
import { Badge, Button, cx, EmptyState, Panel, Stat, Tabs } from '../../components/core';
import { LineChart } from '../../components/charts';
import { usePersistent, useStorageVersion } from '../../hooks';
import { navigate, useRoute } from '../../router';

const TABS = [
  { value: 'estimate', label: 'Estimate' },
  { value: 'calibration', label: 'Calibration' },
] as const;

interface Row {
  label: string;
  value: string;
  op: '×' | '÷';
}

interface Current {
  q: FermiQuestion;
  rows: Row[];
  est: string;
  lo: string;
  hi: string;
  started: number;
  result?: { est: number; lo: number; hi: number; s: FermiScore };
}

export interface FermiAttempt {
  id: string;
  prompt: string;
  topic: Topic;
  unit: string;
  truth: number;
  est: number;
  lo: number;
  hi: number;
  t: number;
  ms: number;
  logErr: number;
  hit: boolean;
  widthOom: number;
  intervalScore: number;
  usedBreakdown: boolean;
}

const HISTORY = 'fermi.history';
const SEEN = 'fermi.seen';
const getHistory = (): FermiAttempt[] => load<FermiAttempt[]>(HISTORY, []);

function fresh(): Current {
  const seen = new Set(load<string[]>(SEEN, []));
  const n = getHistory().length;
  const q = nextQuestion(new Rng(), seen, n % 3 !== 2);
  update<string[]>(SEEN, [], (xs) => [...xs, q.id].slice(-5000));
  return { q, rows: [{ label: '', value: '', op: '×' }], est: '', lo: '', hi: '', started: Date.now() };
}

export default function FermiPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? 'estimate';
  return (
    <div>
      <h1 className="text-2xl mb-2">Fermi estimation</h1>
      <Tabs value={tab} onChange={(v) => navigate(v === 'estimate' ? '/fermi' : `/fermi/${v}`)} tabs={TABS} />
      {tab === 'estimate' ? <Estimate /> : <CalibrationView />}
    </div>
  );
}

// ------------------------------------------------------------------ estimate

function Estimate(): JSX.Element {
  const [cur, setCur] = usePersistent<Current | null>('fermi.current', null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!cur) setCur(fresh());
  }, [cur, setCur]);
  if (!cur) return <div className="h-40" />;
  const c = cur;
  const set = (patch: Partial<Current>): void => setCur({ ...c, ...patch });

  const rowsValid = c.rows.filter((r) => parseQuantity(r.value) !== null);
  const product = rowsValid.length ? breakdownValue(rowsValid.map((r) => ({ label: r.label, value: parseQuantity(r.value)!, op: r.op }))) : null;

  const submit = (): void => {
    const est = parseQuantity(c.est), lo = parseQuantity(c.lo), hi = parseQuantity(c.hi);
    if (est === null || lo === null || hi === null) return setErr('Enter a positive estimate and both ends of your 90% interval (e.g. 3.5 million, 2e6, 40k).');
    if (!(lo <= est && est <= hi)) return setErr('Your estimate should sit inside your interval: low ≤ estimate ≤ high.');
    setErr(null);
    const s = score(est, lo, hi, c.q.truth);
    const ms = Date.now() - c.started;
    const a: FermiAttempt = { id: c.q.id, prompt: c.q.prompt, topic: c.q.topic, unit: c.q.unit, truth: c.q.truth, est, lo, hi, t: Date.now(), ms, logErr: s.logErr, hit: s.hit, widthOom: s.widthOom, intervalScore: s.intervalScore, usedBreakdown: rowsValid.length > 1 };
    update<FermiAttempt[]>(HISTORY, [], (xs) => [...xs, a].slice(-2000));
    recordAttempt({ section: 'fermi', skill: `fermi:${c.q.topic}`, correct: s.within2, ms, score: s.intervalScore });
    set({ result: { est, lo, hi, s } });
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        <div className="panel p-5 sm:p-6">
          <div className="flex items-center gap-2 text-sm mb-1">
            <Badge>{TOPIC_LABEL[c.q.topic]}</Badge>
            <span className="text-paper-dim">answer in {c.q.unit}</span>
          </div>
          <p className="prose-math text-[19px]">{c.q.prompt}</p>

          <h2 className="text-sm text-paper-muted mt-5 mb-2">Break it down</h2>
          <div className="space-y-2">
            {c.rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[44px_minmax(0,1fr)_120px_32px] gap-2 items-center">
                {i === 0 ? (
                  <span />
                ) : (
                  <button type="button" disabled={!!c.result} title="Switch between multiply and divide" aria-label={`Operation for factor ${i + 1}: ${r.op === '×' ? 'multiply' : 'divide'}`} onClick={() => set({ rows: c.rows.map((x, j) => (j === i ? { ...x, op: x.op === '×' ? '÷' : '×' } : x)) })} className="h-9 rounded border border-ink-line text-lg text-paper-muted hover:text-paper">
                    {r.op}
                  </button>
                )}
                <input className="input h-9 py-1" disabled={!!c.result} placeholder={i === 0 ? 'e.g. people in the US' : 'next factor'} value={r.label} onChange={(e) => set({ rows: c.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label={`Factor ${i + 1} description`} />
                <input className={cx('input h-9 py-1 num text-right', r.value && parseQuantity(r.value) === null && 'border-ask')} disabled={!!c.result} placeholder="value" value={r.value} onChange={(e) => set({ rows: c.rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} aria-label={`Factor ${i + 1} value`} />
                <button type="button" disabled={!!c.result || c.rows.length === 1} aria-label={`Remove factor ${i + 1}`} onClick={() => set({ rows: c.rows.filter((_, j) => j !== i) })} className="h-9 text-paper-dim hover:text-ask disabled:opacity-30">
                  ✕
                </button>
              </div>
            ))}
          </div>
          {!c.result && (
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <Button size="sm" onClick={() => set({ rows: [...c.rows, { label: '', value: '', op: '×' }] })}>
                Add factor
              </Button>
              {product !== null && (
                <>
                  <span className="text-sm text-paper-muted">
                    Product: <span className="num text-paper">{fmtQuantity(product)}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => set({ est: Number(product.toPrecision(3)).toString() })}>
                    Use as estimate
                  </Button>
                </>
              )}
            </div>
          )}

          <h2 className="text-sm text-paper-muted mt-6 mb-2">Your answer</h2>
          <form
            className="grid sm:grid-cols-3 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!c.result) submit();
            }}
          >
            <QuantityField id="lo" label="90% low" value={c.lo} onChange={(v) => set({ lo: v })} disabled={!!c.result} />
            <QuantityField id="est" label="Best estimate" value={c.est} onChange={(v) => set({ est: v })} disabled={!!c.result} />
            <QuantityField id="hi" label="90% high" value={c.hi} onChange={(v) => set({ hi: v })} disabled={!!c.result} />
            {!c.result && (
              <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" type="submit" kbd="↵">
                  Submit estimate
                </Button>
                {err && (
                  <span className="text-sm text-ask" role="alert">
                    {err}
                  </span>
                )}
              </div>
            )}
          </form>
        </div>
        {c.result && <Result c={c} onNext={() => setCur(fresh())} />}
      </div>
      <aside className="space-y-4 text-sm">
        <Panel title="How it's scored">
          <ul className="space-y-2 text-paper-muted">
            <li>Error is measured in orders of magnitude: 3× too high is as bad as 3× too low.</li>
            <li>Your 90% interval should contain the truth nine times in ten. The Calibration tab tracks whether it does.</li>
            <li>Type numbers as 3.5 million, 3.5m, 2e6, 40k or 3×10^6.</li>
          </ul>
        </Panel>
      </aside>
    </div>
  );
}

function QuantityField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }): JSX.Element {
  const parsed = parseQuantity(value);
  return (
    <div>
      <label className="label" htmlFor={`fermi-${id}`}>
        {label}
      </label>
      <input id={`fermi-${id}`} className={cx('input w-full num', value && parsed === null && 'border-ask')} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
      <div className="text-xs text-paper-dim mt-1 h-4 num">{value && parsed !== null ? fmtQuantity(parsed) : ''}</div>
    </div>
  );
}

function Result({ c, onNext }: { c: Current; onNext: () => void }): JSX.Element {
  const r = c.result!;
  const s = r.s;
  return (
    <div className="panel p-5 sm:p-6 space-y-5" aria-live="polite">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className={cx('text-lg', s.within2 ? 'text-bid' : s.within10 ? 'text-paper' : 'text-ask')}>{describeError(s.logErr).replace(/^./, (x) => x.toUpperCase())}</h2>
        <span className={cx('text-sm', s.hit ? 'text-bid' : 'text-ask')}>{s.hit ? 'Inside your 90% interval' : 'Outside your 90% interval'}</span>
        <Button variant="primary" className="ml-auto" onClick={onNext}>
          Next question
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Reference value" value={fmtQuantity(c.q.truth)} sub={c.q.unit} />
        <Stat label="Your estimate" value={fmtQuantity(r.est)} />
        <Stat label="Accuracy points" value={s.points} sub="100 = exact, 0 = 30× off" />
        <Stat label="Interval score" value={s.intervalScore.toFixed(2)} sub="lower is better" />
      </div>
      <LogStrip lo={r.lo} hi={r.hi} est={r.est} truth={c.q.truth} />
      <p className="text-sm text-paper-muted">{c.q.source}</p>
      <div>
        <h3 className="text-sm text-paper-muted mb-2">One way to break it down</h3>
        <ol className="space-y-1 text-sm num">
          {c.q.breakdown.map((f, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-5 text-paper-dim text-right">{i === 0 ? '' : f.op}</span>
              <span className="flex-1">{f.label}</span>
              <span>{fmtQuantity(f.value)}</span>
            </li>
          ))}
          <li className="flex gap-3 border-t border-ink-line pt-1 mt-1">
            <span className="w-5 text-paper-dim text-right">=</span>
            <span className="flex-1 text-paper-muted">Estimate from this breakdown</span>
            <span className="font-semibold">{fmtQuantity(breakdownValue(c.q.breakdown))}</span>
          </li>
        </ol>
      </div>
    </div>
  );
}

/** Log-scale strip: your interval, your estimate, and the reference value. */
function LogStrip({ lo, hi, est, truth }: { lo: number; hi: number; est: number; truth: number }): JSX.Element {
  const a = Math.floor(Math.log10(Math.min(lo, truth)) - 0.3), b = Math.ceil(Math.log10(Math.max(hi, truth)) + 0.3);
  const W = 600, H = 70, pad = 16;
  const x = (v: number) => pad + ((Math.log10(v) - a) / (b - a)) * (W - 2 * pad);
  const ticks = Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const step = Math.ceil(ticks.length / 8);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Log scale: interval ${fmtQuantity(lo)} to ${fmtQuantity(hi)}, estimate ${fmtQuantity(est)}, reference ${fmtQuantity(truth)}`}>
        <line x1={pad} x2={W - pad} y1={34} y2={34} stroke="#243146" strokeWidth={1} />
        {ticks.map((t, i) => (
          <g key={t}>
            <line x1={x(10 ** t)} x2={x(10 ** t)} y1={30} y2={38} stroke="#33445F" />
            {i % step === 0 && (
              <text x={x(10 ** t)} y={56} textAnchor="middle" fontSize={11} fill="#93A1B5">
                10{t < 0 ? '⁻' : ''}
                {String(Math.abs(t)).split('').map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]).join('')}
              </text>
            )}
          </g>
        ))}
        <rect x={x(lo)} y={28} width={Math.max(2, x(hi) - x(lo))} height={12} rx={4} fill="#6CA6E8" opacity={0.35} />
        <circle cx={x(est)} cy={34} r={6} fill="#E8A93A" stroke="#121B2A" strokeWidth={2} />
        <path d={`M ${x(truth)} 18 L ${x(truth) - 6} 8 L ${x(truth) + 6} 8 Z`} fill="#E6EBF2" />
        <line x1={x(truth)} x2={x(truth)} y1={18} y2={44} stroke="#E6EBF2" strokeWidth={2} />
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-paper-muted mt-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-2.5 rounded-sm bg-info/40" /> your 90% interval
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-signal" /> your estimate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-0 h-0 border-x-[5px] border-x-transparent border-t-[8px] border-t-paper" /> reference value
        </span>
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ calibration

function CalibrationView(): JSX.Element {
  useStorageVersion();
  const hist = getHistory();
  if (!hist.length) return <EmptyState title="No estimates yet">Answer a few questions with a 90% interval; this page then shows how often your intervals catch the truth.</EmptyState>;
  const cal = calibration(hist);
  const within2 = hist.filter((h) => Math.abs(h.logErr) <= Math.log10(2)).length;
  const within10 = hist.filter((h) => Math.abs(h.logErr) <= 1).length;
  const rolling = hist.map((_, i) => {
    const w = hist.slice(Math.max(0, i - 9), i + 1);
    return w.reduce((s, h) => s + Math.abs(h.logErr), 0) / w.length;
  });
  const bias = hist.reduce((s, h) => s + h.logErr, 0) / hist.length;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Interval hit rate" value={`${Math.round(cal.rate * 100)}%`} sub={`target 90% · ${cal.hits}/${cal.n} · 95% CI ${Math.round(cal.lo * 100)}–${Math.round(cal.hi * 100)}%`} tone={cal.n >= 8 && cal.hi < 0.9 ? 'neg' : undefined} />
        <Stat label="Within 2×" value={`${Math.round((100 * within2) / hist.length)}%`} />
        <Stat label="Within 10×" value={`${Math.round((100 * within10) / hist.length)}%`} />
        <Stat label="Average interval width" value={`×${(10 ** cal.meanWidth).toFixed(1)}`} sub="high ÷ low" />
      </div>
      <Panel title="Verdict">
        <p>{cal.verdict}</p>
        {hist.length >= 5 && Math.abs(bias) > 0.15 && <p className="text-paper-muted mt-1">You tend to guess {bias > 0 ? 'high' : 'low'}, by about {(10 ** Math.abs(bias)).toFixed(1)}× on average.</p>}
      </Panel>
      {hist.length >= 3 && (
        <Panel title="Error, 10-question rolling average">
          <LineChart series={[{ name: 'Orders of magnitude off', values: rolling }]} height={170} xLabel="question" yFormat={(v) => v.toFixed(2)} yMin={0} />
        </Panel>
      )}
      <Panel title={`Recent (${hist.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-paper-muted">
              <tr>
                <th className="text-left font-normal py-1">Question</th>
                <th className="text-right font-normal">You</th>
                <th className="text-right font-normal">Reference</th>
                <th className="text-right font-normal">Error</th>
                <th className="text-right font-normal">Interval</th>
              </tr>
            </thead>
            <tbody>
              {hist
                .slice(-40)
                .reverse()
                .map((h) => (
                  <tr key={`${h.id}-${h.t}`} className="border-t border-ink-line/60">
                    <td className="py-1.5 pr-3">{h.prompt}</td>
                    <td className="text-right num whitespace-nowrap pr-3">{fmtQuantity(h.est)}</td>
                    <td className="text-right num whitespace-nowrap pr-3">{fmtQuantity(h.truth)}</td>
                    <td className="text-right num whitespace-nowrap pr-3">{describeError(h.logErr)}</td>
                    <td className={cx('text-right whitespace-nowrap', h.hit ? 'text-bid' : 'text-ask')}>{h.hit ? 'hit' : 'miss'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
