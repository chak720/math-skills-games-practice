import { getSessions, currentStreak, getDays, dayKey } from '@/shared/stats/activity';
import { Icon } from '../components/icons';
import { Link } from '../router';
import { SECTIONS } from '../sections';
import { useStorageVersion } from '../hooks';
import { Panel } from '../components/core';

export default function Home(): JSX.Element {
  useStorageVersion();
  const sessions = getSessions();
  const streak = currentStreak();
  const today = getDays()[dayKey(Date.now())];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl">Today</h1>
          <p className="text-paper-muted mt-1">
            {streak > 0 ? `${streak}-day streak` : 'No streak yet'} · {today ? `${Math.round(today.ms / 60000)} min trained today` : 'nothing logged today'}
          </p>
        </div>
      </div>
      <Panel title="Sections" pad={false}>
        <ul className="divide-y divide-ink-line/70">
          {SECTIONS.map((s) => {
            const last = sessions.filter((x) => x.section === s.id).at(-1);
            return (
              <li key={s.id}>
                <Link to={s.path} className="flex items-center gap-4 px-4 py-3 hover:bg-ink-raised/50">
                  <span className="text-paper-muted">
                    <Icon name={s.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{s.title}</span>
                    <span className="block text-sm text-paper-muted truncate">{s.blurb}</span>
                  </span>
                  <span className="text-sm text-paper-dim hidden sm:block">{last ? new Date(last.t).toLocaleDateString() : 'Not started'}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
