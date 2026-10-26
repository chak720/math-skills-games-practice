import { useState } from 'react';
import { getAttempts, getSessions, getSkillAggs } from '@/shared/stats/activity';
import { ALL_SKILLS, SKILL_LABEL, type SkillId } from '@/training/maths/generators';
import { DEFAULT_ZETAMAC, getLevels, MODES, type ModeDef, type ZetamacConfig } from '@/training/maths/modes';
import { TRICKS } from '@/training/maths/tricks';
import { Button, cx, EmptyState, Field, fmtMs, NumberField, Panel, Segmented, Tabs, Toggle } from '../../components/core';
import { LineChart } from '../../components/charts';
import { Example, F } from '../../components/Lesson';
import { usePersistent, useStorageVersion } from '../../hooks';
import { navigate, useRoute } from '../../router';
import { Drill, Results, type DrillResult } from './Drill';

const TABS = [
  { value: 'practice', label: 'Practice' },
  { value: 'tricks', label: 'Tricks' },
  { value: 'stats', label: 'Stats' },
] as const;

export default function MathsPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? 'practice';
  const [running, setRunning] = useState<{ mode: ModeDef; key: number } | null>(null);
  const [result, setResult] = useState<DrillResult | null>(null);
  const [zc, setZc] = usePersistent<ZetamacConfig>('maths.zetamac', DEFAULT_ZETAMAC);
  const [duration, setDuration] = usePersistent<Record<string, number>>('maths.durations', {});

  const startMode = (m: ModeDef): void => {
    setResult(null);
    setRunning({ mode: m, key: Date.now() });
    navigate('/maths');
  };
  const dur = (m: ModeDef): number => (m.id === 'zetamac' ? zc.durationSec : m.id === 'eighty' ? 480 : duration[m.id] ?? m.durationSec);

  if (running && !result)
    return <Drill key={running.key} mode={running.mode} zetamac={zc} durationSec={dur(running.mode)} onDone={setResult} onQuit={() => setRunning(null)} />;
  if (result && running) return <Results r={result} onAgain={() => startMode(running.mode)} onBack={() => (setRunning(null), setResult(null))} />;

  return (
    <div>
      <h1 className="text-2xl mb-2">Mental maths</h1>
      <Tabs value={tab} onChange={(v) => navigate(v === 'practice' ? '/maths' : `/maths/${v}`)} tabs={TABS} />
      {tab === 'practice' && <Practice onStart={startMode} zc={zc} setZc={setZc} duration={duration} setDuration={setDuration} />}
      {tab === 'tricks' && <Tricks onDrill={startMode} />}
      {tab === 'stats' && <Stats />}
    </div>
  );
}

function best(mode: string): number | null {
  const xs = getSessions('maths').filter((s) => s.mode === mode);
  return xs.length ? Math.max(...xs.map((s) => s.score)) : null;
}

function Practice({ onStart, zc, setZc, duration, setDuration }: { onStart: (m: ModeDef) => void; zc: ZetamacConfig; setZc: (z: ZetamacConfig) => void; duration: Record<string, number>; setDuration: (d: Record<string, number>) => void }): JSX.Element {
  useStorageVersion();
  const [cfg, setCfg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {MODES.map((m) => {
        const pb = best(m.id);
        return (
          <div key={m.id} className="panel p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[220px]">
                <div className="font-medium">{m.title}</div>
                <div className="text-sm text-paper-muted">{m.blurb}</div>
              </div>
              <div className="text-sm text-paper-dim num w-28">{pb !== null ? `Best ${pb}` : 'No score yet'}</div>
              {m.id !== 'eighty' && (
                <Button size="sm" variant="ghost" onClick={() => setCfg(cfg === m.id ? null : m.id)}>
                  Options
                </Button>
              )}
              <Button variant="primary" onClick={() => onStart(m)}>
                Start
              </Button>
            </div>
            {cfg === m.id && m.id === 'zetamac' && <ZetamacOptions zc={zc} setZc={setZc} />}
            {cfg === m.id && m.id !== 'zetamac' && (
              <div className="mt-3">
                <Field label="Duration">
                  <Segmented value={duration[m.id] ?? m.durationSec} onChange={(v) => setDuration({ ...duration, [m.id]: v })} options={[60, 120, 180, 300, 600].map((s) => ({ value: s, label: `${s / 60} min` }))} />
                </Field>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ZetamacOptions({ zc, setZc }: { zc: ZetamacConfig; setZc: (z: ZetamacConfig) => void }): JSX.Element {
  const range = (k: 'addA' | 'addB' | 'mulA' | 'mulB', label: string): JSX.Element => (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <NumberField value={zc[k][0]} min={1} max={9999} onChange={(v) => setZc({ ...zc, [k]: [v, zc[k][1]] })} aria-label={`${label} from`} />
        <span className="text-paper-dim">to</span>
        <NumberField value={zc[k][1]} min={1} max={9999} onChange={(v) => setZc({ ...zc, [k]: [zc[k][0], v] })} aria-label={`${label} to`} />
      </div>
    </Field>
  );
  return (
    <div className="mt-4 grid sm:grid-cols-2 gap-4">
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        {(['add', 'sub', 'mul', 'div'] as const).map((o) => (
          <Toggle key={o} checked={zc.ops[o]} onChange={(v) => setZc({ ...zc, ops: { ...zc.ops, [o]: v } })} label={{ add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division' }[o]} />
        ))}
      </div>
      {range('addA', 'Addition: first number')}
      {range('addB', 'Addition: second number')}
      {range('mulA', 'Multiplication: first number')}
      {range('mulB', 'Multiplication: second number')}
      <Field label="Duration">
        <Segmented value={zc.durationSec} onChange={(v) => setZc({ ...zc, durationSec: v })} options={[30, 60, 120, 180, 300].map((s) => ({ value: s, label: s < 60 ? `${s}s` : `${s / 60} min` }))} />
      </Field>
      <p className="text-sm text-paper-muted sm:col-span-2">Subtraction and division use the addition and multiplication ranges in reverse, as on Zetamac.</p>
    </div>
  );
}

function Tricks({ onDrill }: { onDrill: (m: ModeDef) => void }): JSX.Element {
  const [open, setOpen] = useState(TRICKS[0].id);
  const t = TRICKS.find((x) => x.id === open)!;
  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-6">
      <ul className="space-y-0.5">
        {TRICKS.map((x) => (
          <li key={x.id}>
            <button type="button" onClick={() => setOpen(x.id)} className={cx('w-full text-left px-3 py-2 rounded', open === x.id ? 'bg-ink-raised text-paper' : 'text-paper-muted hover:text-paper')}>
              {x.title}
            </button>
          </li>
        ))}
      </ul>
      <Panel title={t.title} actions={<Button variant="primary" size="sm" onClick={() => onDrill({ id: 'trick', title: t.title, blurb: '', durationSec: 60, negativeMarking: false, skills: [t.skill] })}>Drill this for 1 minute</Button>}>
        <div className="prose-math">
          {t.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <F>
            {t.examples.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </F>
          <Example>Your current level for this skill: {getLevels()[t.skill]?.level ?? 2} of 5. Drills adapt as you get faster.</Example>
        </div>
      </Panel>
    </div>
  );
}

function Stats(): JSX.Element {
  useStorageVersion();
  const sessions = getSessions('maths');
  const aggs = getSkillAggs();
  const levels = getLevels();
  const attempts = getAttempts('maths');
  if (!sessions.length && !attempts.length) return <EmptyState title="No practice yet">Finish a drill and your scores, speeds and weak spots appear here.</EmptyState>;
  const skills = ALL_SKILLS.map((s) => ({ s, a: aggs[`maths:${s}`] })).filter((x) => x.a);
  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 gap-6">
        {MODES.filter((m) => sessions.some((x) => x.mode === m.id)).map((m) => {
          const xs = sessions.filter((x) => x.mode === m.id);
          let pb = -Infinity;
          const pbs = xs.map((x) => (pb = Math.max(pb, x.score)));
          return (
            <Panel key={m.id} title={m.title}>
              <LineChart series={[{ name: 'Score', values: xs.map((x) => x.score) }, { name: 'Personal best', values: pbs, dashed: true }]} height={170} xLabel="session" yFormat={(v) => v.toFixed(0)} />
            </Panel>
          );
        })}
      </div>
      <Panel title="By question type">
        <table className="w-full text-sm num">
          <thead className="text-paper-muted">
            <tr>
              <th className="text-left font-normal">Type</th>
              <th className="text-right font-normal">Answered</th>
              <th className="text-right font-normal">Accuracy (recent)</th>
              <th className="text-right font-normal">Speed (recent)</th>
              <th className="text-right font-normal">Level</th>
            </tr>
          </thead>
          <tbody>
            {skills
              .sort((x, y) => x.a!.ewmaAcc - y.a!.ewmaAcc)
              .map(({ s, a }) => (
                <tr key={s} className="border-t border-ink-line/60">
                  <td className="py-1">{SKILL_LABEL[s as SkillId]}</td>
                  <td className="text-right">{a!.n}</td>
                  <td className={cx('text-right', a!.ewmaAcc < 0.75 && 'text-ask')}>{Math.round(a!.ewmaAcc * 100)}%</td>
                  <td className="text-right">{a!.timed ? fmtMs(a!.ewmaMs) : '–'}</td>
                  <td className="text-right">{levels[s]?.level ?? 2}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
