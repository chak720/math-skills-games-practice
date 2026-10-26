import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react';

const cx = (...xs: (string | false | null | undefined)[]): string => xs.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'bid' | 'ask';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-signal text-ink hover:bg-signal-hover font-semibold',
  secondary: 'bg-ink-raised text-paper border border-ink-line hover:border-ink-strong hover:bg-ink-hover',
  ghost: 'text-paper-muted hover:text-paper hover:bg-ink-raised',
  danger: 'bg-ask/90 text-white hover:bg-ask font-semibold',
  bid: 'bg-bid/90 text-white hover:bg-bid font-semibold',
  ask: 'bg-ask/90 text-white hover:bg-ask font-semibold',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  kbd,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; kbd?: string }): JSX.Element {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded transition-colors disabled:opacity-40 disabled:pointer-events-none select-none',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4',
        size === 'lg' && 'h-12 px-6 text-md',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {kbd && <Kbd className={variant === 'primary' ? 'border-ink/30 text-ink/70' : undefined}>{kbd}</Kbd>}
    </button>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <kbd className={cx('hidden md:inline-block min-w-[1.4em] px-1 text-[11px] leading-4 rounded-sm border border-ink-strong text-paper-dim font-sans text-center', className)}>
      {children}
    </kbd>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  pad = true,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}): JSX.Element {
  return (
    <section className={cx('panel', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-2 border-b border-ink-line/70">
          {title && <h2 className="text-md">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : undefined}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl">{title}</h1>
        {lede && <p className="text-paper-muted mt-1 max-w-[70ch]">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  size = 'md',
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'pos' | 'neg' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
}): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-sm text-paper-muted truncate">{label}</div>
      <div
        className={cx(
          'num font-semibold',
          size === 'sm' && 'text-md',
          size === 'md' && 'text-xl',
          size === 'lg' && 'text-3xl',
          tone === 'pos' && 'text-bid',
          tone === 'neg' && 'text-ask',
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-paper-dim mt-0.5">{sub}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }): JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer select-none">
      <span className="relative mt-0.5 shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="block w-9 h-5 rounded-full bg-ink-strong peer-checked:bg-signal transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-signal peer-focus-visible:outline-offset-2" />
        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-paper transition-transform peer-checked:translate-x-4" />
      </span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-sm text-paper-dim">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: ReactNode; title?: string }[];
  size?: 'sm' | 'md';
  label?: string;
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded border border-ink-line bg-ink p-0.5 gap-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-sm transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-8 px-3',
            o.value === value ? 'bg-ink-raised text-paper shadow-[inset_0_0_0_1px_theme(colors.ink.strong)]' : 'text-paper-muted hover:text-paper',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-xs text-paper-dim mt-1">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'pos' | 'neg' | 'signal' | 'info'; className?: string }): JSX.Element {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 h-5 px-1.5 rounded-sm text-xs font-medium',
        tone === 'neutral' && 'bg-ink-raised text-paper-muted border border-ink-line',
        tone === 'pos' && 'bg-bid-soft text-bid',
        tone === 'neg' && 'bg-ask-soft text-ask',
        tone === 'signal' && 'bg-signal/15 text-signal',
        tone === 'info' && 'bg-info-soft text-info',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, tone = 'signal', className }: { value: number; tone?: 'signal' | 'pos' | 'neg' | 'info'; className?: string }): JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = { signal: 'bg-signal', pos: 'bg-bid', neg: 'bg-ask', info: 'bg-info' }[tone];
  return (
    <div className={cx('h-1.5 rounded-full bg-ink-line overflow-hidden', className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-[width] duration-200', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: readonly { value: T; label: ReactNode }[] }): JSX.Element {
  return (
    <div role="tablist" className="flex gap-1 border-b border-ink-line mb-5 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cx(
            'px-3 h-10 -mb-px border-b-2 whitespace-nowrap transition-colors',
            t.value === value ? 'border-signal text-paper' : 'border-transparent text-paper-muted hover:text-paper',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Accessible modal on the native <dialog> element (focus trap + Esc for free). */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        'backdrop:bg-black/60 bg-ink-panel text-paper border border-ink-line rounded-lg shadow-lift p-0 w-[calc(100%-2rem)]',
        wide ? 'max-w-4xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex flex-col max-h-[85vh]">
          <header className="flex items-center justify-between px-5 py-3 border-b border-ink-line">
            <h2 className="text-md">{title}</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="w-8 h-8 rounded hover:bg-ink-raised text-paper-muted">
              ✕
            </button>
          </header>
          <div className="p-5 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-md">{title}</p>
      {children && <p className="text-paper-muted mt-1 max-w-md mx-auto">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  ...rest
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  'aria-label'?: string;
  id?: string;
}): JSX.Element {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={cx('input w-full num', className)}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = e.target.valueAsNumber;
        if (Number.isFinite(v)) onChange(max !== undefined ? Math.min(max, min !== undefined ? Math.max(min, v) : v) : v);
      }}
      {...rest}
    />
  );
}

export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }): JSX.Element {
  return (
    <details className="group border border-ink-line rounded" open={defaultOpen}>
      <summary className="cursor-pointer list-none flex items-center gap-2 px-3 py-2 text-paper-muted hover:text-paper select-none">
        <span className="inline-block transition-transform group-open:rotate-90">›</span>
        {summary}
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

export const fmtPct = (x: number, d = 1): string => `${(x * 100).toFixed(d)}%`;
export const fmtSigned = (x: number, d = 1): string => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`;
export const fmtMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
