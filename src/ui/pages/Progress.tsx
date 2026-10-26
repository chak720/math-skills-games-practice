import { load, save } from '@/shared/storage/store';
import { currentStreak, dayKey, getAttempts, getDays, getSessions, type SectionId } from '@/shared/stats/activity';
import { getHistory as puzzleHistory } from '@/training/puzzles/scheduler';
import { allLeaks } from '@/training/progress/leaks';
import { Button, cx, EmptyState, Panel, Stat, Tabs } from '../components/core';
import { Heatmap, Sparkline, sequentialColor } from '../components/charts';
import { DataPanel } from '../components/DataPanel';
import { TodayPlan } from '../components/TodayPlan';
import { useStorageVersion } from '../hooks';
import { Link, navigate, useRoute } from '../router';
import { SECTIONS } from '../sections';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'leaks', label: 'Leaks' },
  { value: 'data', label: 'Data' },
] as const;

export default function ProgressPage(): JSX.Element {
  const { segments } = useRoute();
  const tab = TABS.find((t) => t.value === segments[1])?.value ?? 'overview';
  return (
    <div>
      <h1 className="text-2xl mb-2">Progress</h1>
      <Tabs value={tab} onChange={(v) => navigate(v === 'overview' ? '/progress' : `/progress/${v}`)} tabs={TABS} />
      {tab === 'overview' && <Overview />}
      {tab === 'leaks' && <Leaks />}
      {tab === 'data' && (
        <div className="max-w-3xl">
          <DataPanel />
        </div>
      )}
    </div>
  );
}

const DAY = 86_400_000;

function Overview(): JSX.Element {
  useStorageVersion();
  const days = getDays();
  const now = Date.now();
  const last30 = Array.from({ length: 30 }, (_, i) => days[dayKey(now - i * DAY)]).filter(Boolean);
  const week = Array.from({ length: 7 }, (_, i) => days[dayKey(now - i * DAY)]).filter(Boolean);
  const totalAttempts = Object.values(days).reduce((s, d) => s + d.attempts, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Streak" value={`${currentStreak()} day${currentStreak() === 1 ? '' : 's'}`} />
        <Stat label="Active days (30)" value={last30.length} />
        <Stat label="Time this week" value={`${Math.round(week.reduce((s, d) => s + d.ms, 0) / 60000)} min`} sub="timed questions and sessions" />
        <Stat label="Questions and decisions" value={totalAttempts.toLocaleString('en-GB')} />
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6 items-start">
        <TodayPlan />
        <Panel title="Activity, last 18 weeks">
          <Calendar />
        </Panel>
      </div>
      <SectionTrends />
    </div>
  );
}

function Calendar(): JSX.Element {
  const days = getDays();
  const weeks = 18;
  const today = new Date();
  // Columns are weeks (oldest left), rows are Monday..Sunday.
  const dow = (today.getDay() + 6) % 7;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow - (weeks - 1) * 7);
  const values: number[][] = Array.from({ length: 7 }, () => new Array<number>(weeks).fill(-1));
  const dates: string[][] = Array.from({ length: 7 }, () => new Array<string>(weeks).fill(''));
  let max = 1;
  for (let w = 0; w < weeks; w++)
    for (let d = 0; d < 7; d++) {
      const t = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      if (t > today) continue;
      const k = dayKey(t.getTime());
      const n = days[k]?.attempts ?? 0;
      values[d][w] = n;
      dates[d][w] = k;
      max = Math.max(max, n);
    }
  return (
    <div>
      <Heatmap
        values={values}
        cell={16}
        label="Questions answered per day"
        color={(v) => (v < 0 ? 'transparent' : v === 0 ? '#172234' : sequentialColor(0.2 + 0.8 * Math.min(1, v / max)))}
        describe={(r, c, v) => (v < 0 ? 'Future' : `${dates[r][c]}: ${v} question${v === 1 ? '' : 's'}${days[dates[r][c]] ? `, ${Math.round(days[dates[r][c]].ms / 60000)} min` : ''}`)}
      />
      <p className="text-xs text-paper-dim mt-2">Each square is a day (Monday at the top); darker means more questions answered.</p>
    </div>
  );
}

interface Trend {
  section: SectionId;
  headline: string;
  sub: string;
  values: number[];
  /** True when lower is better (e.g. estimation error). */
  lowerBetter?: boolean;
}

function dailyAccuracy(section: SectionId, n = 30): number[] {
  const by = new Map<string, { ok: number; n: number }>();
  for (const a of getAttempts(section)) {
    const k = dayKey(a.t);
    const s = by.get(k) ?? { ok: 0, n: 0 };
    s.n++;
    if (a.correct) s.ok++;
    by.set(k, s);
  }
  return [...by.values()].slice(-n).map((s) => s.ok / s.n);
}

function trends(): Trend[] {
  const out: Trend[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const lines = load<{ netBB: number }[]>('poker.heroLines', []);
  if (lines.length) {
    let c = 0;
    const cum = lines.map((l) => (c += l.netBB));
    const step = Math.max(1, Math.floor(cum.length / 120));
    out.push({ section: 'poker', headline: `${((c / lines.length) * 100).toFixed(1)} bb/100`, sub: `${lines.length.toLocaleString('en-GB')} hands · cumulative big blinds`, values: cum.filter((_, i) => i % step === 0 || i === cum.length - 1) });
  }
  for (const s of ['blackjack', 'maths', 'sequences'] as SectionId[]) {
    const acc = dailyAccuracy(s);
    if (acc.length) out.push({ section: s, headline: pct(acc.at(-1)!), sub: `accuracy on your last active day · ${acc.length} day${acc.length > 1 ? 's' : ''} shown`, values: acc });
  }
  const ph = puzzleHistory();
  if (ph.length) {
    const roll = ph.map((_, i) => {
      const w = ph.slice(Math.max(0, i - 9), i + 1);
      return w.filter((h) => h.correct && !h.revealed && !h.hintsUsed && !h.misses).length / w.length;
    });
    out.push({ section: 'puzzles', headline: pct(roll.at(-1)!), sub: `clean solves, last 10 · ${ph.length} puzzles`, values: roll });
  }
  const fh = load<{ logErr: number }[]>('fermi.history', []);
  if (fh.length) {
    const roll = fh.map((_, i) => {
      const w = fh.slice(Math.max(0, i - 9), i + 1);
      return w.reduce((s, h) => s + Math.abs(h.logErr), 0) / w.length;
    });
    out.push({ section: 'fermi', headline: `×${(10 ** roll.at(-1)!).toFixed(1)}`, sub: 'typical error factor, last 10', values: roll, lowerBetter: true });
  }
  const mh = load<{ edge: number }[]>('market.history', []);
  if (mh.length) out.push({ section: 'market', headline: mh.at(-1)!.edge.toFixed(1), sub: `edge vs fair value, last game · ${mh.length} games`, values: mh.map((h) => h.edge) });
  const bg = getSessions('betting').filter((s) => s.mode === 'kelly-game');
  if (bg.length) out.push({ section: 'betting', headline: `${bg.at(-1)!.score}%`, sub: "of Kelly's growth, last game", values: bg.map((g) => g.score) });
  const iv = getSessions('interview');
  if (iv.length) out.push({ section: 'interview', headline: `${iv.at(-1)!.score}`, sub: `last mock interview · ${iv.length} done`, values: iv.map((s) => s.score) });
  return out;
}

function SectionTrends(): JSX.Element {
  const ts = trends();
  if (!ts.length) return <EmptyState title="No history yet">Practise in any section and its trend appears here.</EmptyState>;
  return (
    <div>
      <h2 className="text-lg mb-3">By section</h2>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {ts.map((t) => {
          const s = SECTIONS.find((x) => x.id === t.section)!;
          return (
            <Link key={t.section} to={s.path} className="panel p-4 hover:border-ink-strong block">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{s.title}</span>
                <span className="text-xl font-semibold num">{t.headline}</span>
              </div>
              <div className="text-xs text-paper-dim mt-0.5">{t.sub}</div>
              <div className="mt-3">{t.values.length >= 2 ? <Sparkline values={t.values} width={280} height={36} title={`${s.title} trend`} /> : <div className="h-9 text-xs text-paper-dim">One data point so far.</div>}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Leaks(): JSX.Element {
  useStorageVersion();
  const leaks = allLeaks();
  if (!leaks.length)
    return (
      <EmptyState title="No leaks found yet" action={<Button onClick={() => navigate('/')}>See today's session</Button>}>
        Leaks need a minimum amount of history before they show (for example 12 big-blind steal spots in poker, or 8 attempts at a maths question type). Keep practising and check back.
      </EmptyState>
    );
  return (
    <div className="space-y-3 max-w-3xl">
      <p className="text-paper-muted">Specific weaknesses found in your history, most important first. Each one has a drill that targets it.</p>
      {leaks.map((l) => (
        <div key={l.id} className="panel p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-[220px]">
              <div className="text-xs text-paper-dim">{SECTIONS.find((s) => s.id === l.section)?.title}</div>
              <div className="font-medium">{l.title}</div>
              <p className="text-sm text-paper-muted mt-1">{l.detail}</p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (l.action.prefs) save(l.action.prefs.key, l.action.prefs.value);
                navigate(l.action.to);
              }}
            >
              {l.action.label}
            </Button>
          </div>
          <div className="mt-3 h-1 rounded bg-ink-raised overflow-hidden" aria-hidden>
            <div className={cx('h-full', l.severity > 0.6 ? 'bg-ask' : 'bg-signal')} style={{ width: `${Math.round(20 + 80 * l.severity)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}


