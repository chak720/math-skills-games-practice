import { useSyncExternalStore } from 'react';
import { load, subscribe } from '@/shared/storage/store';
import { getSettings, setSettings, type Settings } from '@/shared/settings';

getSettings(); // ensure defaults (and a client seed) exist before first render

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(
    (cb) => subscribe('settings', cb),
    () => load<Settings>('settings', getSettings()),
  );
  return [s, (p) => void setSettings(p)];
}
