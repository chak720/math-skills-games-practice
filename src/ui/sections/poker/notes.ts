import { usePersistent } from '../../hooks';

export type NoteColor = 'red' | 'amber' | 'green' | 'blue' | '';
export const NOTE_COLORS: Record<Exclude<NoteColor, ''>, string> = { red: '#E2626B', amber: '#E8A93A', green: '#34B37E', blue: '#6CA6E8' };
export interface PlayerNote {
  text: string;
  color: NoteColor;
  updated: number;
}

/** Notes on players, keyed by screen name, kept across sessions (like an online client). */
export function useNotes(): [Record<string, PlayerNote>, (name: string, n: PlayerNote) => void] {
  const [notes, setNotes] = usePersistent<Record<string, PlayerNote>>('poker.notes', {});
  return [notes, (name, n) => setNotes((prev) => ({ ...prev, [name]: n }))];
}
