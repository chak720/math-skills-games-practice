import { type ReactNode, useEffect, useState } from 'react';
import { Icon } from '../components/icons';
import { cx } from '../components/core';
import { Link, useRoute } from '../router';
import { GROUPS, SECTIONS } from '../sections';

function NavItem({ to, icon, label, active, onClick }: { to: string; icon: Parameters<typeof Icon>[0]['name']; label: string; active: boolean; onClick?: () => void }): JSX.Element {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex items-center gap-3 h-9 px-3 rounded transition-colors',
        active ? 'bg-ink-raised text-paper shadow-[inset_2px_0_0_theme(colors.signal.DEFAULT)]' : 'text-paper-muted hover:text-paper hover:bg-ink-raised/60',
      )}
    >
      <Icon name={icon} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function Nav({ path, onNavigate }: { path: string; onNavigate?: () => void }): JSX.Element {
  const isActive = (p: string): boolean => (p === '/' ? path === '/' : path === p || path.startsWith(p + '/'));
  return (
    <nav aria-label="Sections" className="flex flex-col gap-4 px-3 pb-4">
      <NavItem to="/" icon="home" label="Today" active={isActive('/')} onClick={onNavigate} />
      {GROUPS.map((g) => (
        <div key={g}>
          <div className="px-3 mb-1 text-xs text-paper-dim">{g}</div>
          <div className="flex flex-col gap-0.5">
            {SECTIONS.filter((s) => s.group === g).map((s) => (
              <NavItem key={s.id} to={s.path} icon={s.icon} label={s.title} active={isActive(s.path)} onClick={onNavigate} />
            ))}
          </div>
        </div>
      ))}
      <div className="border-t border-ink-line pt-3 flex flex-col gap-0.5">
        <NavItem to="/fairness" icon="fairness" label="Fairness lab" active={isActive('/fairness')} onClick={onNavigate} />
        <NavItem to="/settings" icon="settings" label="Settings" active={isActive('/settings')} onClick={onNavigate} />
      </div>
    </nav>
  );
}

function Wordmark(): JSX.Element {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-6 h-14 shrink-0">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#172234" />
        <path d="M8 22 L13.5 14 L18 18 L24.5 9" stroke="#E8A93A" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-semibold tracking-[-0.01em]">Quant Trainer</span>
    </Link>
  );
}

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }): JSX.Element {
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  // Page title follows the route, so history and screen readers name the page.
  useEffect(() => {
    const root = `/${path.split('/')[1] ?? ''}`;
    const name = root === '/' ? 'Today' : (SECTIONS.find((s) => s.path === root)?.title ?? (root === '/fairness' ? 'Fairness lab' : root === '/settings' ? 'Settings' : ''));
    document.title = name ? `${name} · Quant Trainer` : 'Quant Trainer';
  }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="min-h-screen flex">
      <a href="#main" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-ink-raised focus:text-paper focus:px-3 focus:py-2 focus:rounded">
        Skip to content
      </a>
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-ink-line bg-ink sticky top-0 h-screen overflow-y-auto">
        <Wordmark />
        <Nav path={path} />
      </aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setOpen(false)}>
          <aside role="dialog" aria-modal="true" aria-label="Navigation" className="w-64 h-full bg-ink border-r border-ink-line overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <Wordmark />
            <Nav path={path} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden flex items-center gap-2 h-14 px-2 border-b border-ink-line sticky top-0 bg-ink/95 backdrop-blur z-30">
          <button type="button" aria-label="Open navigation" className="w-10 h-10 rounded hover:bg-ink-raised inline-flex items-center justify-center" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <span className="font-semibold">Quant Trainer</span>
        </header>
        <main id="main" tabIndex={-1} className={cx('flex-1 w-full mx-auto px-4 sm:px-6 py-6 focus:outline-none', wide ? 'max-w-[1500px]' : 'max-w-[1200px]')}>
          {children}
        </main>
      </div>
    </div>
  );
}
