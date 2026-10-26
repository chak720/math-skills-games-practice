import { currentStreak, dayKey, getAttempts, getDays, getSessions } from '@/shared/stats/activity';
import { allLeaks } from '@/training/progress/leaks';
import { Icon } from '../components/icons';
import { TodayPlan } from '../components/TodayPlan';
import { Link } from '../router';
import { SECTIONS } from '../sections';
import { useStorageVersion } from '../hooks';
import { Stat } from '../components/core';

export default function Home(): JSX.Element {
  useStorageVersion();
  const streak = currentStreak();
  const days = getDays();
  const today = days[dayKey(Date.now())];
  const weekAttempts = Array.from({ length: 7 }, (_, i) => days[dayKey(Date.now() - i * 86_400_000)]?.attempts ?? 0).reduce((a, b) => a + b, 0);
  const leaks = allLeaks().slice(0, 3);
  const lastBySection = (id: string): number => Math.max(getSessions().filter((x) => x.section === id).at(-1)?.t ?? 0, getAttempts().filter((x) => x.section === id).at(-1)?.t ?? 0);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl">Today</h1>
        <div className="grid grid-cols-3 gap-4 mt-4 max-w-xl">
          <Stat label="Streak" value={`${streak} day${streak === 1 ? '' : 's'}`} />
          <Stat label="Today" value={today ? `${Math.max(1, Math.round(today.ms / 60000))} min` : '–'} sub={today ? `${today.attempts} answered` : 'nothing yet'} />
          <Stat label="This week" value={weekAttempts.toLocaleString('en-GB')} sub="questions and decisions" />
        </div>
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6 items-start">
        <TodayPlan />
        <section className="panel p-4 sm:p-5" aria-labelledby="leaks-title">
          <div className="flex items-baseline justify-between">
            <h2 id="leaks-title" className="text-lg">
              What to fix
            </h2>
            <Link to="/progress/leaks" className="text-sm text-paper-muted hover:text-paper underline underline-offset-2">
              All leaks
            </Link>
          </div>
          {leaks.length ? (
            <ul className="mt-3 space-y-3">
              {leaks.map((l) => (
                <li key={l.id}>
                  <div className="font-medium">{l.title}</div>
                  <div className="text-sm text-paper-muted line-clamp-2">{l.detail}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-paper-muted">Nothing stands out yet. Weak spots appear here once there is enough history to be sure of them.</p>
          )}
        </section>
      </div>
      <section aria-labelledby="sections-title">
        <h2 id="sections-title" className="text-lg mb-3">
          All sections
        </h2>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {SECTIONS.filter((s) => s.id !== 'progress').map((s) => {
            const last = lastBySection(s.id);
            return (
              <Link key={s.id} to={s.path} className="panel p-4 flex items-start gap-3 hover:border-ink-strong">
                <span className="text-signal mt-0.5">
                  <Icon name={s.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{s.title}</span>
                  <span className="block text-sm text-paper-muted">{s.blurb}</span>
                  <span className="block text-xs text-paper-dim mt-1.5">
                    {s.group} · {last ? `last practised ${new Date(last).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'not started'}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
