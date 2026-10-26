import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { load, save, subscribe } from '@/shared/storage/store';

/** React state persisted under a storage key (shared across components). */
export function usePersistent<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const value = useSyncExternalStore(
    (cb) => subscribe(key, cb),
    () => load(key, fallback),
  );
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(load(key, fallback)) : v;
      save(key, next);
    },
    // fallback is a literal default; identity changes must not churn the setter
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
}

/** Re-render whenever any stored key changes (dashboards). */
export function useStorageVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => subscribe('*', () => setV((x) => x + 1)), []);
  return v;
}

export function useInterval(fn: () => void, ms: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Current time, refreshed every `ms` (for countdown timers). */
export function useNow(ms = 250, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), active ? ms : null);
  return now;
}

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/**
 * Keyboard shortcuts. Keys are matched on `event.key` (case-insensitive for
 * letters). Shortcuts are ignored while typing in a field unless listed in
 * `allowInInputs` (e.g. Enter).
 */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, enabled = true, allowInInputs: string[] = []): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const on = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const fn = ref.current[k];
      if (!fn) return;
      if (isTyping(e.target) && !allowInInputs.includes(k)) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [enabled, allowInInputs.join(',')]);
}

export function useLatest<T>(v: T): React.MutableRefObject<T> {
  const r = useRef(v);
  r.current = v;
  return r;
}
