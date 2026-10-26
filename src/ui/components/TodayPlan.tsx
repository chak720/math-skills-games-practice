import { save } from '@/shared/storage/store';
import { isDone, todaysPlan, type PlanItem } from '@/training/progress/daily';
import { Icon } from './icons';
import { navigate } from '../router';
import { SECTIONS } from '../sections';
import { useStorageVersion } from '../hooks';
import { cx } from './core';

/** Today's ~20-minute session. Items tick off when you log activity in that section. */
export function TodayPlan(): JSX.Element {
  useStorageVersion();
  const plan = todaysPlan();
  const done = plan.items.filter((i) => isDone(i, plan)).length;
  const minutes = plan.items.reduce((s, i) => s + i.minutes, 0);
  const open = (i: PlanItem): void => {
    if (i.prefs) save(i.prefs.key, i.prefs.value);
    navigate(i.to);
  };
  return (
    <section aria-labelledby="today-title" className="panel">
      <header className="flex flex-wrap items-baseline gap-3 px-4 sm:px-5 pt-4">
        <h2 id="today-title" className="text-lg">
          Today's session
        </h2>
        <span className="text-sm text-paper-muted num">
          about {minutes} minutes · {done} of {plan.items.length} done
        </span>
      </header>
      <ol className="mt-3 divide-y divide-ink-line/70">
        {plan.items.map((item, k) => {
          const d = isDone(item, plan);
          const icon = SECTIONS.find((s) => s.id === item.section)?.icon ?? 'home';
          return (
            <li key={item.id}>
              <button type="button" onClick={() => open(item)} className="w-full text-left flex items-start gap-4 px-4 sm:px-5 py-3 hover:bg-ink-raised/50 focus-visible:bg-ink-raised/50">
                <span className={cx('mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center text-xs num shrink-0', d ? 'bg-bid border-bid text-ink' : 'border-ink-strong text-paper-muted')} aria-hidden>
                  {d ? '✓' : k + 1}
                </span>
                <span className="text-paper-muted mt-0.5">
                  <Icon name={icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block font-medium', d && 'text-paper-muted line-through decoration-paper-dim')}>{item.title}</span>
                  <span className="block text-sm text-paper-muted">{item.why}</span>
                </span>
                <span className="text-sm text-paper-dim num whitespace-nowrap">{item.minutes} min</span>
                <span className="sr-only">{d ? '(done)' : ''}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
