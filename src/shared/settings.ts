/** App-wide preferences (persisted). */
import { load, save } from './storage/store';
import { newClientSeed } from './fairness/commit';

export interface Settings {
  fourColourDeck: boolean;
  /** Player-chosen half of the provably-fair seed. */
  clientSeed: string;
  /** Multiplier on bot/dealer think times; 0 = instant. */
  speed: number;
  chat: boolean;
  /** Show poker amounts in big blinds (true) or chips. */
  showBB: boolean;
}

export const DEFAULT_SETTINGS: Settings = { fourColourDeck: false, clientSeed: '', speed: 1, chat: true, showBB: true };

export function getSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) };
  if (!s.clientSeed) {
    s.clientSeed = newClientSeed();
    save('settings', s);
  }
  return s;
}

export function setSettings(patch: Partial<Settings>): Settings {
  const s = { ...getSettings(), ...patch };
  save('settings', s);
  return s;
}
