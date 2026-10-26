/**
 * Versioned localStorage wrapper. All keys live under `qt.v1.` so the whole
 * profile can be exported/imported as one JSON document. Falls back to an
 * in-memory map when localStorage is unavailable (tests, private mode).
 */
const PREFIX = 'qt.v1.';
export const EXPORT_FORMAT = 'quant-trainer-progress';
export const EXPORT_VERSION = 1;

interface Backend {
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
  keys(): string[];
}

function makeBackend(): Backend {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      const probe = PREFIX + '__probe';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return {
        get: (k) => ls.getItem(k),
        set: (k, v) => ls.setItem(k, v),
        remove: (k) => ls.removeItem(k),
        keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i)!).filter(Boolean),
      };
    }
  } catch {
    /* fall through to memory */
  }
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k), keys: () => [...m.keys()] };
}

const backend = makeBackend();
const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, unknown>();

function emit(key: string): void {
  listeners.get(key)?.forEach((f) => f());
  listeners.get('*')?.forEach((f) => f());
}

export function load<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  const raw = backend.get(PREFIX + key);
  let value: T = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, value);
  return value;
}

export function save<T>(key: string, value: T): void {
  cache.set(key, value);
  try {
    backend.set(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn(`storage: could not persist ${key}`, e);
  }
  emit(key);
}

export function update<T>(key: string, fallback: T, fn: (prev: T) => T): T {
  const next = fn(load(key, fallback));
  save(key, next);
  return next;
}

export function remove(key: string): void {
  cache.delete(key);
  backend.remove(PREFIX + key);
  emit(key);
}

export function subscribe(key: string, cb: () => void): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(cb);
  return () => listeners.get(key)?.delete(cb);
}

/** Cross-tab sync: another tab wrote a key, drop our cached copy. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key?.startsWith(PREFIX)) {
      const k = e.key.slice(PREFIX.length);
      cache.delete(k);
      emit(k);
    }
  });
}

export function allKeys(): string[] {
  return backend.keys().filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
}

export function exportAll(): string {
  const data: Record<string, unknown> = {};
  for (const k of allKeys()) data[k] = load(k, null);
  return JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), data }, null, 1);
}

export function importAll(json: string, mode: 'replace' | 'merge' = 'replace'): number {
  const doc = JSON.parse(json) as { format?: string; version?: number; data?: Record<string, unknown> };
  if (doc.format !== EXPORT_FORMAT || typeof doc.data !== 'object' || doc.data === null) throw new Error('Not a Quant Trainer export file');
  if ((doc.version ?? 0) > EXPORT_VERSION) throw new Error('Export is from a newer version');
  if (mode === 'replace') for (const k of allKeys()) remove(k);
  let n = 0;
  for (const [k, v] of Object.entries(doc.data)) {
    save(k, v);
    n++;
  }
  return n;
}

export function clearAll(): void {
  for (const k of allKeys()) remove(k);
}
